import { getUiOptions } from '@rjsf/utils';
import type { UiSchema } from '@rjsf/utils';
import { defaultValidator } from '@schemastud/rjsf-registry';
import type { ComponentType } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BlockdocManifest } from '../core';
import { BlockdocEditor } from '../react/BlockdocEditor';
import type { BlockdocEditorHandle, CommitBus } from '../react/BlockdocEditor';
import type { CommitPolicy, DocJson } from '../react/commit-controller';
import type { NodeViewRegistry } from '../react/node-views';

/**
 * The rjsf-registry uiSchema walker emits `ui:field` (not ui:widget) for
 * component resolutions on object/array nodes, so this component is mounted
 * as an RJSF FIELD for object-typed doc values — while plain hosts may mount
 * it with widget-signature props. It accepts both and normalizes internally.
 */
interface RichContentProps {
    // Field-signature props.
    formData?: unknown;
    schema?: Record<string, unknown>;
    uiSchema?: UiSchema;
    registry?: { formContext?: Record<string, unknown> };
    formContext?: Record<string, unknown>;
    /** RJSF v6 field-path identity; its `path` must ride every onChange or the update lands on the root. */
    fieldPathId?: { path?: Array<string | number> };
    // Widget-signature props.
    value?: unknown;
    options?: Record<string, unknown>;
    // Shared. In field mode RJSF's signature is (newFormData, path, errorSchema?, id?).
    onChange?: (doc: DocJson, path?: Array<string | number>) => void;
}

/**
 * The formContext intent-bus seam (structurally the rjsf-registry
 * FormIntentBus — typed here so blockdoc takes no dependency on it). When a
 * host provides one, the widget registers the island's commit flush (a dirty
 * editor can never race an intent with a stale doc) and renders the
 * selection-scoped revise chrome.
 */
export interface FormIntentBusLike {
    registerFlush(flush: () => void): () => void;
    /**
     * `origin` is the reserved collaboration/AI-provenance seam (B4, 10): when an
     * inline-AI or remote actor drives a write, it tags the intent so the flush
     * path can distinguish it from a local user edit. Optional and unset today —
     * the collab/AI build fills it; the doc never carries it (provenance is
     * SQL-authoritative — see the `document-is-a-location-index` doctrine).
     */
    dispatch(intent: {
        type: string;
        fieldPath: string;
        target?: unknown;
        payload?: unknown;
        origin?: string;
    }): Promise<void>;
}

export interface RichContentOptions {
    /** An inline profile manifest; wins over manifestRef. */
    manifest?: BlockdocManifest;
    /** A manifest reference resolved through the injected schema fetcher. */
    manifestRef?: string;
    /** Slot-level doc admission override (category slugs) — mirrors the server's write-path check. */
    docAdmits?: string[];
    /** Show the insert palette. Default true. */
    palette?: boolean;
    /** Commit policy for the island. */
    commit?: CommitPolicy;
}

export interface RichContentWidgetDefaults {
    /** The vendored base prose manifest, composed under the profile manifest. */
    baseManifest?: BlockdocManifest;
    /** Fallback fetcher when formContext.schemaFetcher is absent. */
    schemaFetcher?: (ref: string) => Promise<unknown>;
    commit?: CommitPolicy;
    palette?: boolean;
}

/** True for a field schema worth validating against (a real doc schema). */
function isRealDocSchema(schema: Record<string, unknown> | undefined): schema is Record<string, unknown> {
    return schema !== undefined && typeof schema === 'object' && Object.keys(schema).length > 0;
}

/**
 * Factory for the rich-content RJSF component: resolves the profile manifest
 * (inline `manifest` option, or `manifestRef` through the injected schema
 * fetcher), assembles [base, profile] into the island's PM schema, wires the
 * commit pipe through onChange with advisory client-side validation (server
 * stays authoritative), and rides formContext.commitBus for flush-before-submit.
 */
export function createRichContentWidget(
    nodeViewRegistry: NodeViewRegistry,
    defaults: RichContentWidgetDefaults = {},
): ComponentType<RichContentProps> {
    function RichContentWidget(props: RichContentProps) {
        // Props normalizer: field props win, widget props are the fallback.
        const value = (props.formData !== undefined ? props.formData : props.value) as DocJson | null | undefined;
        const options: Record<string, unknown> = {
            ...(props.options ?? {}),
            ...(props.uiSchema !== undefined ? getUiOptions(props.uiSchema) : {}),
        };
        const formContext = props.formContext ?? props.registry?.formContext ?? {};

        const inlineManifest = options.manifest as BlockdocManifest | undefined;
        const manifestRef = typeof options.manifestRef === 'string' ? options.manifestRef : undefined;
        const schemaFetcher = (formContext.schemaFetcher ?? defaults.schemaFetcher) as
            | ((ref: string) => Promise<unknown>)
            | undefined;

        const [fetchedManifest, setFetchedManifest] = useState<BlockdocManifest | null>(null);

        useEffect(() => {
            if (inlineManifest !== undefined || manifestRef === undefined) {
                return;
            }

            if (schemaFetcher === undefined) {
                console.warn(`blockdoc: no schema fetcher available to resolve manifestRef "${manifestRef}".`);
                return;
            }

            let cancelled = false;

            Promise.resolve(schemaFetcher(manifestRef)).then((manifest) => {
                if (!cancelled) {
                    setFetchedManifest(manifest as BlockdocManifest);
                }
            });

            return () => {
                cancelled = true;
            };
        }, [inlineManifest, manifestRef, schemaFetcher]);

        const profileManifest = inlineManifest ?? fetchedManifest;
        const docAdmits = Array.isArray(options.docAdmits)
            ? (options.docAdmits as string[])
            : undefined;
        const docAdmitsKey = docAdmits?.join('|');
        const manifests = useMemo(() => {
            if (profileManifest === null || profileManifest === undefined) {
                return null;
            }

            // A slot-level doc admission (x-widget-options.docAdmits) overrides
            // the profile manifest's doc — the same declaration the server's
            // write-path admission check reads, so both sides enforce one truth.
            const profile = docAdmits !== undefined
                ? { ...profileManifest, doc: { admitsChildCategories: docAdmits } }
                : profileManifest;

            return defaults.baseManifest !== undefined ? [defaults.baseManifest, profile] : [profile];
            // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [profileManifest, docAdmitsKey]);

        // Intent-bus seam: flush registration + the selection-scoped revise chrome.
        const rawIntentBus = formContext.intentBus as FormIntentBusLike | undefined;
        const intentBus =
            rawIntentBus !== undefined
                && typeof rawIntentBus.registerFlush === 'function'
                && typeof rawIntentBus.dispatch === 'function'
                ? rawIntentBus
                : undefined;

        const editorRef = useRef<BlockdocEditorHandle | null>(null);

        useEffect(() => {
            if (intentBus === undefined) {
                return;
            }

            return intentBus.registerFlush(() => editorRef.current?.flushCommits());
        }, [intentBus]);

        const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
        const [instruction, setInstruction] = useState('');
        const [dispatching, setDispatching] = useState(false);
        const intentFieldPath = (props.fieldPathId?.path ?? []).join('.');

        const dispatchRevise = useCallback(async () => {
            if (intentBus === undefined) {
                return;
            }

            setDispatching(true);

            try {
                await intentBus.dispatch({
                    type: 'sw:revise',
                    fieldPath: intentFieldPath,
                    target: { nodeId: selectedNodeId ?? undefined },
                    payload: { instruction: instruction || undefined },
                });
            } finally {
                setDispatching(false);
            }
        }, [intentBus, intentFieldPath, selectedNodeId, instruction]);

        const [advisoryErrors, setAdvisoryErrors] = useState<string[]>([]);
        const fieldSchema = props.schema;
        const onChangeRef = useRef(props.onChange);
        onChangeRef.current = props.onChange;
        const fieldPathRef = useRef(props.fieldPathId?.path);
        fieldPathRef.current = props.fieldPathId?.path;

        // Advisory validation at commit boundaries: surface as a red list;
        // never blocks the commit — the server's validation is authoritative.
        const handleChange = useCallback(
            (doc: DocJson) => {
                if (isRealDocSchema(fieldSchema)) {
                    const result = defaultValidator.rawValidation<{ instancePath?: string; message?: string }>(
                        fieldSchema,
                        doc,
                    );
                    setAdvisoryErrors(
                        (result.errors ?? []).map((error) =>
                            `${error.instancePath ?? ''} ${error.message ?? ''}`.trim(),
                        ),
                    );
                }

                // Field mode MUST scope the update by path (RJSF v6 routes a
                // path-less onChange to the form root, wiping sibling fields).
                onChangeRef.current?.(doc, fieldPathRef.current);
            },
            [fieldSchema],
        );

        if (manifests === null) {
            // Manifest still resolving (or unresolvable): render nothing.
            return null;
        }

        return (
            <div data-blockdoc-rich-content="">
                {advisoryErrors.length > 0 && (
                    <ul
                        data-blockdoc-advisory-errors=""
                        style={{ color: '#b91c1c', fontSize: 12, margin: '4px 0', paddingLeft: 18 }}
                    >
                        {advisoryErrors.map((error, index) => (
                            <li key={index}>{error}</li>
                        ))}
                    </ul>
                )}
                <BlockdocEditor
                    ref={editorRef}
                    manifests={manifests}
                    value={value ?? null}
                    onChange={handleChange}
                    commitPolicy={(options.commit as CommitPolicy | undefined) ?? defaults.commit}
                    palette={(options.palette as boolean | undefined) ?? defaults.palette ?? true}
                    nodeViews={nodeViewRegistry}
                    commitBus={formContext.commitBus as CommitBus | undefined}
                    onSelectionChange={intentBus !== undefined ? setSelectedNodeId : undefined}
                />
                {intentBus !== undefined && (
                    <div
                        data-blockdoc-intent-chrome=""
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            padding: '4px 0',
                            marginTop: 4,
                            borderTop: '1px solid #e4e4e7',
                            fontSize: 12,
                        }}
                    >
                        <span data-blockdoc-selected-node="" style={{ color: '#71717a', fontFamily: 'monospace' }}>
                            {selectedNodeId ?? 'no block selected'}
                        </span>
                        <input
                            type="text"
                            data-blockdoc-revise-instruction=""
                            value={instruction}
                            onChange={(event) => setInstruction(event.target.value)}
                            placeholder="Revise instruction…"
                            style={{
                                flex: 1,
                                font: 'inherit',
                                fontSize: 12,
                                padding: '2px 6px',
                                border: '1px solid #d4d4d8',
                                borderRadius: 4,
                            }}
                        />
                        <button
                            type="button"
                            data-blockdoc-revise=""
                            disabled={dispatching}
                            onClick={() => void dispatchRevise()}
                            style={{
                                font: 'inherit',
                                fontSize: 12,
                                padding: '2px 8px',
                                border: '1px solid #d4d4d8',
                                borderRadius: 4,
                                background: '#fff',
                                cursor: dispatching ? 'default' : 'pointer',
                                opacity: dispatching ? 0.5 : 1,
                            }}
                        >
                            Revise
                        </button>
                    </div>
                )}
            </div>
        );
    }

    return RichContentWidget;
}
