import type { Node as PMNode, NodeType, Schema } from 'prosemirror-model';
import { baseKeymap } from 'prosemirror-commands';
import { history, redo, undo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { EditorState } from 'prosemirror-state';
import type { Plugin } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { assemblePMSchema, generateNodeId, NODE_ID_ATTR } from '../core';
import type { BlockdocManifest } from '../core';
import { CommitController } from './commit-controller';
import type { CommitPolicy, DocJson } from './commit-controller';
import { withEditingDOM } from './editing-schema';
import { valueDocSource } from './doc-source';
import type { DocSource } from './doc-source';
import { annotationIntegrityPlugin } from './annotation-plugin';
import { nodeIdPlugin } from './node-id-plugin';
import { resolveNodeViewComponents } from './node-views';
import type { NodeViewRegistry } from './node-views';
import { ReactNodeView, usePortalRegistry } from './portal-bridge';
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
}

export interface BlockdocEditorProps {
    /** Ordered manifests (e.g. [base, profile]) assembled into the PM schema. */
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
    /** Show the insert palette (manifest block node types). Default true. */
    palette?: boolean;
    className?: string;
}

function docFromJson(schema: Schema, value: DocJson | null): PMNode {
    // Hosts hand us null, undefined, {} (RJSF's empty-object default for an
    // unfilled $ref field), or a PHP-side [] — anything without a node type is
    // an empty document.
    if (value == null || typeof (value as { type?: unknown }).type !== 'string') {
        const empty = schema.topNodeType.createAndFill();

        if (empty === null) {
            throw new Error('blockdoc: the schema cannot produce an empty doc.');
        }

        return empty;
    }

    return schema.nodeFromJSON(value);
}

function buildPlugins(schema: Schema, extraPlugins?: (context: { schema: Schema }) => Plugin[]): Plugin[] {
    return [
        history(),
        keymap({ 'Mod-z': undo, 'Shift-Mod-z': redo, 'Mod-y': redo }),
        keymap(baseKeymap),
        nodeIdPlugin(),
        annotationIntegrityPlugin(),
        ...(extraPlugins?.({ schema }) ?? []),
    ];
}

function insertPaletteNode(view: EditorView, type: NodeType): void {
    const node = type.createAndFill({ [NODE_ID_ATTR]: generateNodeId() });

    if (node === null) {
        return;
    }

    try {
        view.dispatch(view.state.tr.replaceSelectionWith(node).scrollIntoView());
        view.focus();
    } catch {
        // The node doesn't fit at the selection; a plain palette stays quiet.
    }
}

/**
 * The editor island: owns EditorState for its lifetime, initializes from
 * `value`, commits doc.toJSON() through onChange on trailing debounce, blur,
 * and flush (ref or commitBus). The last-committed guard absorbs the RJSF
 * onChange echo; a genuinely external value rebuilds state (fresh undo
 * history, selection remapped by node id) without firing a commit.
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
        palette = true,
        className,
    },
    ref,
) {
    const manifestList = useMemo(() => (Array.isArray(manifests) ? manifests : [manifests]), [manifests]);
    const schema = useMemo(() => withEditingDOM(assemblePMSchema(manifestList)), [manifestList]);
    const [portals, portalRegistry] = usePortalRegistry();

    const mountRef = useRef<HTMLDivElement | null>(null);
    const viewRef = useRef<EditorView | null>(null);
    const controllerRef = useRef<CommitController | null>(null);

    // Kept as refs so the view effect only re-runs on schema changes.
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;
    const commitPolicyRef = useRef(commitPolicy);
    commitPolicyRef.current = commitPolicy;
    const extraPluginsRef = useRef(extraPlugins);
    extraPluginsRef.current = extraPlugins;
    const nodeViewsRef = useRef(nodeViews);
    nodeViewsRef.current = nodeViews;
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

    useEffect(() => {
        const initialValue = sourceRef.current.get();

        const controller = new CommitController(
            () => viewRef.current!.state.doc.toJSON() as DocJson,
            (doc) => onChangeRef.current?.(doc),
            commitPolicyRef.current ?? {},
            initialValue,
        );
        controllerRef.current = controller;

        const resolvedNodeViews = resolveNodeViewComponents(manifestList, nodeViewsRef.current);
        const pmNodeViews: NonNullable<ConstructorParameters<typeof EditorView>[1]['nodeViews']> = {};

        for (const [name, { component, attrsSchema }] of resolvedNodeViews) {
            pmNodeViews[name] = (node, editorView, getPos) =>
                new ReactNodeView(node, editorView, getPos, component, attrsSchema, portalRegistry);
        }

        const view: EditorView = new EditorView(mountRef.current!, {
            state: EditorState.create({
                doc: docFromJson(schema, initialValue),
                plugins: buildPlugins(schema, extraPluginsRef.current),
            }),
            nodeViews: pmNodeViews,
            dispatchTransaction: (transaction) => {
                view.updateState(view.state.apply(transaction));

                if (transaction.docChanged) {
                    controller.noteChange();
                }

                noteSelection(view.state);
            },
            handleDOMEvents: {
                blur: () => {
                    controller.noteBlur();
                    return false;
                },
            },
        });
        viewRef.current = view;
        noteSelection(view.state);

        return () => {
            viewRef.current = null;
            controllerRef.current = null;
            view.destroy();
            controller.dispose();
        };
    }, [schema, manifestList, portalRegistry, noteSelection]);

    // External value intake: the echo guard decides ignore vs rebuild. A
    // rebuild replaces EditorState wholesale (fresh history), remaps the
    // selection by node id, and never fires a commit.
    useEffect(() => {
        const applyExternalValue = (doc: DocJson | null) => {
            const view = viewRef.current;
            const controller = controllerRef.current;

            if (view === null || controller === null) {
                return;
            }

            if (controller.receiveExternalValue(doc) === 'ignore') {
                return;
            }

            const survivingId = selectionNodeId(view.state);
            const nextDoc = docFromJson(schema, doc);

            view.updateState(
                EditorState.create({
                    doc: nextDoc,
                    selection: selectionForNodeId(nextDoc, survivingId),
                    plugins: buildPlugins(schema, extraPluginsRef.current),
                }),
            );
            controller.noteRebuilt(doc);
            noteSelection(view.state);
        };

        applyExternalValue(source.get());

        return source.subscribe?.((doc) => applyExternalValue(doc));
    }, [source, schema, noteSelection]);

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
                return viewRef.current;
            },
        }),
        [],
    );

    const paletteTypes = useMemo(
        () =>
            manifestList.flatMap((manifest) =>
                manifest.nodes.filter((node) => (node.group ?? 'block') === 'block').map((node) => node.name),
            ),
        [manifestList],
    );

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
                                const view = viewRef.current;
                                const type = schema.nodes[name];

                                if (view && type) {
                                    insertPaletteNode(view, type);
                                }
                            }}
                            style={{
                                font: 'inherit',
                                fontSize: 12,
                                padding: '2px 8px',
                                border: '1px solid #d4d4d8',
                                borderRadius: 4,
                                background: '#fff',
                                cursor: 'pointer',
                            }}
                        >
                            {name}
                        </button>
                    ))}
                </div>
            )}
            <div ref={mountRef} data-blockdoc-mount="" />
            {portals}
        </div>
    );
});
