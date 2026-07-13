import { Extension } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import type { NodeType, Schema } from '@tiptap/pm/model';
import type { Plugin } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { UndoRedo } from '@tiptap/extensions';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { EditorState } from '@tiptap/pm/state';
import { generateNodeId, NODE_ID_ATTR } from '../core';
import type { BlockdocManifest } from '../core';
import { CommitController } from './commit-controller';
import type { CommitPolicy, DocJson } from './commit-controller';
import { valueDocSource } from './doc-source';
import type { DocSource } from './doc-source';
import { annotationIntegrityPlugin } from './annotation-plugin';
import { nodeIdPlugin } from './node-id-plugin';
import { createManifestExtensions } from './manifest-extensions';
import type { NodeViewRegistry } from './node-views';
import { selectionForNodeId, selectionNodeId } from './selection';

/**
 * The flush-before-intent hook: hosts hand the island a bus; the island
 * registers its flush and the host calls every registered flush before
 * dispatching an intent or submitting.
 */
export interface CommitBus {
    register(flush: () => void): () => void;
}

export interface BlockdocEditorHandle {
    /** Commit synchronously when dirty (no-op when clean). */
    flushCommits(): void;
    /** The live EditorView (null before mount). */
    view: EditorView | null;
    /** The live Tiptap Editor (null before mount). */
    editor: Editor | null;
}

export interface BlockdocEditorProps {
    /** Ordered manifests (e.g. [base, profile]) compiled into Tiptap extensions. */
    manifests: BlockdocManifest | BlockdocManifest[];
    /** PM doc JSON; null/undefined initializes an empty doc valid per schema. */
    value?: DocJson | null;
    /** Receives doc.toJSON() at every commit boundary. */
    onChange?: (doc: DocJson) => void;
    commitPolicy?: CommitPolicy;
    commitBus?: CommitBus;
    /** Fires with {@link selectionNodeId} whenever the selection's node id changes. */
    onSelectionChange?: (nodeId: string | null) => void;
    nodeViews?: NodeViewRegistry;
    /** Collab seam: extra PM plugins appended to the island's list. */
    extraPlugins?: (context: { schema: Schema }) => Plugin[];
    /** Collab seam: replaces the default value-prop-wrapping source. */
    docSource?: DocSource;
    /**
     * Collab seam (B4, 10): swap the id-stamping plugin. Defaults to
     * {@link nodeIdPlugin} (single-user, content-similarity rematch). A
     * collaborative build replaces it with a CRDT-aware plugin that guarantees
     * stable ids survive a merge — the named debt: `NodeIdRematcher` does NOT
     * cover concurrency, and id-merge-safety is the collab effort's to own.
     */
    idPlugin?: () => Plugin;
    /** Show the insert palette (manifest block node types). Default true. */
    palette?: boolean;
    className?: string;
}

/**
 * Anything without a node type is an empty document: hosts hand us null,
 * undefined, {} (RJSF's empty-object default for an unfilled $ref field), or
 * a PHP-side [].
 */
function isDocJson(value: DocJson | null | undefined): value is DocJson {
    return value != null && typeof (value as { type?: unknown }).type === 'string';
}

function insertPaletteNode(editor: Editor, type: NodeType): void {
    const node = type.createAndFill({ [NODE_ID_ATTR]: generateNodeId() });

    if (node === null) {
        return;
    }

    try {
        editor.view.dispatch(editor.state.tr.replaceSelectionWith(node).scrollIntoView());
        editor.view.focus();
    } catch {
        // The node doesn't fit at the selection; a plain palette stays quiet.
    }
}

const buttonStyle: CSSProperties = {
    font: 'inherit',
    fontSize: 12,
    padding: '2px 8px',
    border: '1px solid #d4d4d8',
    borderRadius: 4,
    background: '#fff',
    cursor: 'pointer',
};

const BUBBLE_TOGGLE_MARKS = [
    ['strong', 'B'],
    ['em', 'I'],
    ['code', '</>'],
] as const;

function markIsActive(editor: Editor, name: string): boolean {
    return editor.schema.marks[name] !== undefined && editor.isActive(name);
}

/**
 * The editor island, on Tiptap (ADR-0072, amended): owns the Editor for its
 * lifetime, initializes from `value`, commits doc.toJSON() through onChange
 * on trailing debounce, blur, and flush (ref or commitBus). The
 * last-committed guard absorbs the RJSF onChange echo; a genuinely external
 * value rebuilds the document via a commit-suppressed, history-free
 * setContent with the selection remapped by node id. Our integrity plugins
 * (node id, annotation) stay raw PM plugins registered through
 * `addProseMirrorPlugins`, as does the `extraPlugins` collab seam.
 */
export const BlockdocEditor = forwardRef<BlockdocEditorHandle, BlockdocEditorProps>(function BlockdocEditor(
    {
        manifests,
        value,
        onChange,
        commitPolicy,
        commitBus,
        onSelectionChange,
        nodeViews,
        extraPlugins,
        docSource,
        idPlugin,
        palette = true,
        className,
    },
    ref,
) {
    const manifestList = useMemo(() => (Array.isArray(manifests) ? manifests : [manifests]), [manifests]);

    const controllerRef = useRef<CommitController | null>(null);
    // External rebuilds must never fire a commit: suppresses onUpdate.
    const suppressCommitsRef = useRef(false);

    // Kept as refs so the editor is only recreated on manifest/registry changes.
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;
    const commitPolicyRef = useRef(commitPolicy);
    commitPolicyRef.current = commitPolicy;
    const extraPluginsRef = useRef(extraPlugins);
    extraPluginsRef.current = extraPlugins;
    const idPluginRef = useRef(idPlugin);
    idPluginRef.current = idPlugin;
    const onSelectionChangeRef = useRef(onSelectionChange);
    onSelectionChangeRef.current = onSelectionChange;

    // Selection-node tracking: hosts (the intent chrome among them) hear the
    // id of the block the selection lives in whenever it changes.
    const lastSelectionNodeIdRef = useRef<string | null>(null);
    const noteSelection = useCallback((state: EditorState) => {
        const id = selectionNodeId(state);

        if (id !== lastSelectionNodeIdRef.current) {
            lastSelectionNodeIdRef.current = id;
            onSelectionChangeRef.current?.(id);
        }
    }, []);

    const source = useMemo(() => docSource ?? valueDocSource(value ?? null), [docSource, value]);
    const sourceRef = useRef(source);
    sourceRef.current = source;

    // Deferred-apply generation: only the LATEST scheduled external apply may
    // run. A schedule that flushes after a newer one was queued is stale by
    // definition — acting on it would reassert an older value over the live
    // document (e.g. a mount-time value over edits committed since).
    const externalApplyGenerationRef = useRef(0);

    // The editor whose initial value the intake effect has already seen: the
    // FIRST effect run per editor instance never applies (useEditor's own
    // `content` seeded it) — only source CHANGES rebuild.
    const intakeSeededEditorRef = useRef<unknown>(null);


    const extensions = useMemo(
        () => [
            ...createManifestExtensions(manifestList, { nodeViews }),
            UndoRedo,
            // GUARDRAIL (ADR-0072): our plugins stay raw PM plugins — one-layer
            // portability in both directions.
            Extension.create({
                name: 'blockdocPlugins',
                addProseMirrorPlugins() {
                    return [
                        (idPluginRef.current ?? nodeIdPlugin)(),
                        annotationIntegrityPlugin(),
                        ...(extraPluginsRef.current?.({ schema: this.editor.schema }) ?? []),
                    ];
                },
            }),
        ],
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [manifestList, nodeViews],
    );

    const initialValue = sourceRef.current.get();

    const editor = useEditor(
        {
            extensions,
            content: isDocJson(initialValue) ? initialValue : null,
            immediatelyRender: true,
            shouldRerenderOnTransaction: false,
            onCreate: ({ editor: created }) => noteSelection(created.state),
            onTransaction: ({ editor: current }) => noteSelection(current.state),
            onUpdate: () => {
                if (!suppressCommitsRef.current) {
                    controllerRef.current?.noteChange();
                }
            },
            onBlur: () => controllerRef.current?.noteBlur(),
        },
        [extensions],
    );

    // The commit controller lives exactly as long as its editor.
    useEffect(() => {
        if (editor === null) {
            return;
        }

        const controller = new CommitController(
            () => editor.state.doc.toJSON() as DocJson,
            (doc) => onChangeRef.current?.(doc),
            commitPolicyRef.current ?? {},
            sourceRef.current.get(),
        );
        controllerRef.current = controller;

        return () => {
            if (controllerRef.current === controller) {
                controllerRef.current = null;
            }

            controller.dispose();
        };
    }, [editor]);

    // External value intake: the echo guard decides ignore vs rebuild. A
    // rebuild replaces the document via setContent in ONE transaction that is
    // kept out of the undo history (fresh history semantics), remaps the
    // selection by node id, and never fires a commit (suppression + the
    // controller's noteRebuilt re-seed).
    useEffect(() => {
        if (editor === null) {
            return;
        }

        const applyExternalValue = (doc: DocJson | null) => {
            const controller = controllerRef.current;

            if (controller === null || editor.isDestroyed) {
                return;
            }

            if (controller.receiveExternalValue(doc) === 'ignore') {
                return;
            }

            // Hard guard: even when the controller's last-committed record has
            // drifted, an external value identical to the LIVE document must
            // never rebuild (it would swap the doc node and rebase history).
            if (JSON.stringify(doc ?? null) === JSON.stringify(editor.state.doc.toJSON())) {
                controller.noteRebuilt(doc);
                return;
            }

            const survivingId = selectionNodeId(editor.state);

            suppressCommitsRef.current = true;

            try {
                editor
                    .chain()
                    .command(({ tr }) => {
                        tr.setMeta('addToHistory', false);

                        return true;
                    })
                    .setContent(isDocJson(doc) ? doc : null, { emitUpdate: false })
                    .command(({ tr }) => {
                        tr.setSelection(selectionForNodeId(tr.doc, survivingId));

                        return true;
                    })
                    .run();
            } finally {
                suppressCommitsRef.current = false;
            }

            controller.noteRebuilt(doc);
            noteSelection(editor.state);
        };

        // Deferred a microtask: setContent re-renders React NodeViews via
        // flushSync, which React forbids from inside a render/effect pass (the
        // value prop often changes as part of a parent render). The flush
        // reads the CURRENT source rather than a value captured at schedule
        // time — a stale scheduled apply must never rebuild from a mid-flight
        // doc (repeat flushes collapse into the echo guard's 'ignore').
        const scheduleExternalApply = () => {
            const generation = ++externalApplyGenerationRef.current;

            queueMicrotask(() => {
                if (generation !== externalApplyGenerationRef.current) {
                    return; // superseded by a newer schedule
                }

                applyExternalValue(sourceRef.current.get());
            });
        };

        if (intakeSeededEditorRef.current === editor) {
            // A NEW source identity on a live editor is a genuinely new
            // external value (a revise landed, the form data moved).
            scheduleExternalApply();
        } else {
            // First run for this editor: its initial content came from
            // useEditor({ content }) — re-applying the same value could only
            // clobber edits made before a late microtask flush.
            intakeSeededEditorRef.current = editor;
        }

        const unsubscribe = source.subscribe?.(() => scheduleExternalApply());

        return () => {
            unsubscribe?.();
        };
    }, [source, editor, noteSelection]);

    useEffect(() => {
        if (commitBus === undefined) {
            return;
        }

        return commitBus.register(() => controllerRef.current?.flush());
    }, [commitBus]);

    useImperativeHandle(
        ref,
        () => ({
            flushCommits: () => controllerRef.current?.flush(),
            get view() {
                return editor !== null && !editor.isDestroyed ? editor.view : null;
            },
            get editor() {
                return editor !== null && !editor.isDestroyed ? editor : null;
            },
        }),
        [editor],
    );

    const paletteTypes = useMemo(
        () =>
            manifestList.flatMap((manifest) =>
                manifest.nodes.filter((node) => (node.group ?? 'block') === 'block').map((node) => node.name),
            ),
        [manifestList],
    );

    // The BubbleMenu chrome only offers marks the manifests actually declare.
    const bubbleToggles = useMemo(
        () => (editor === null ? [] : BUBBLE_TOGGLE_MARKS.filter(([name]) => editor.schema.marks[name] !== undefined)),
        [editor],
    );
    const hasLinkMark = editor !== null && editor.schema.marks.link !== undefined;

    const activeMarks = useEditorState({
        editor,
        selector: ({ editor: current }) =>
            current === null || current.isDestroyed
                ? null
                : {
                      strong: markIsActive(current, 'strong'),
                      em: markIsActive(current, 'em'),
                      code: markIsActive(current, 'code'),
                      link: markIsActive(current, 'link'),
                  },
    });

    const [linkDraft, setLinkDraft] = useState('');

    return (
        <div className={className} data-blockdoc-editor="">
            {palette && (
                <div
                    data-blockdoc-palette=""
                    style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 4,
                        padding: '4px 0',
                        marginBottom: 4,
                        borderBottom: '1px solid #e4e4e7',
                    }}
                >
                    {paletteTypes.map((name) => (
                        <button
                            key={name}
                            type="button"
                            onClick={() => {
                                const type = editor?.schema.nodes[name];

                                if (editor && type) {
                                    insertPaletteNode(editor, type);
                                }
                            }}
                            style={buttonStyle}
                        >
                            {name}
                        </button>
                    ))}
                </div>
            )}
            {editor !== null && (bubbleToggles.length > 0 || hasLinkMark) && (
                <BubbleMenu
                    editor={editor}
                    data-blockdoc-bubble-menu=""
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        padding: 4,
                        border: '1px solid #d4d4d8',
                        borderRadius: 6,
                        background: '#fff',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
                    }}
                >
                    {bubbleToggles.map(([name, label]) => (
                        <button
                            key={name}
                            type="button"
                            data-blockdoc-bubble-toggle={name}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => editor.chain().focus().toggleMark(name).run()}
                            style={{
                                ...buttonStyle,
                                fontWeight: activeMarks?.[name] === true ? 700 : 400,
                                background: activeMarks?.[name] === true ? '#e4e4e7' : '#fff',
                            }}
                        >
                            {label}
                        </button>
                    ))}
                    {hasLinkMark && (
                        <>
                            <input
                                type="text"
                                data-blockdoc-bubble-link-input=""
                                value={linkDraft}
                                onChange={(event) => setLinkDraft(event.target.value)}
                                placeholder="https://…"
                                style={{
                                    font: 'inherit',
                                    fontSize: 12,
                                    width: 140,
                                    padding: '2px 6px',
                                    border: '1px solid #d4d4d8',
                                    borderRadius: 4,
                                }}
                            />
                            <button
                                type="button"
                                data-blockdoc-bubble-link-set=""
                                disabled={linkDraft === ''}
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={() => {
                                    editor.chain().focus().setMark('link', { href: linkDraft }).run();
                                    setLinkDraft('');
                                }}
                                style={{ ...buttonStyle, opacity: linkDraft === '' ? 0.5 : 1 }}
                            >
                                Link
                            </button>
                            {activeMarks?.link === true && (
                                <button
                                    type="button"
                                    data-blockdoc-bubble-link-unset=""
                                    onMouseDown={(event) => event.preventDefault()}
                                    onClick={() => editor.chain().focus().unsetMark('link').run()}
                                    style={buttonStyle}
                                >
                                    Unlink
                                </button>
                            )}
                        </>
                    )}
                </BubbleMenu>
            )}
            <EditorContent editor={editor} data-blockdoc-mount="" />
        </div>
    );
});
