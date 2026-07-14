import type { Node as PMNode } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';
import { NodeViewWrapper, useReactNodeView } from '@tiptap/react';
import type { ReactNodeViewProps } from '@tiptap/react';
import { SchemaForm } from '@schemastud/seam';
import type { ComponentType } from 'react';
import { useMemo } from 'react';
import { NODE_ID_ATTR } from '../core';
import type { BlockdocManifest, JsonSchema, NodeManifestEntry } from '../core';

/**
 * Props every blockdoc NodeView component receives. This is the PUBLIC
 * contract hosts register components against — it survived the Tiptap swap
 * unchanged (the Tiptap-side plumbing is absorbed by {@link tiptapNodeView}).
 */
export interface NodeViewComponentProps {
    node: PMNode;
    view: EditorView;
    getPos: () => number | undefined;
    /** Patch node attrs (merged over the current ones; id is preserved). */
    updateAttrs: (attrs: Record<string, unknown>) => void;
    /** The manifest's attrsSchema for this node type, when known. */
    attrsSchema?: JsonSchema;
    /**
     * Where PM-managed child content goes: render `<div ref={contentRef} />`
     * at the passthrough spot. Null for leaf nodes.
     */
    contentRef: ((element: HTMLElement | null) => void) | null;
}

/**
 * The base prose set renders natively — PM's own DOM, no NodeView chrome.
 * Everything else in a manifest is a typed block whose attrs (beyond id) are
 * only editable through chrome, so it gets the generic NodeView unless a host
 * registers a richer component.
 */
export const BASE_PROSE_NODE_NAMES: ReadonlySet<string> = new Set([
    'paragraph',
    'heading',
    'blockquote',
    'bullet_list',
    'ordered_list',
    'list_item',
    'code_block',
    'horizontal_rule',
    'hard_break',
    'text',
]);

export interface NodeViewRegistry {
    registerNodeView(nodeTypeName: string, component: ComponentType<NodeViewComponentProps>): void;
    resolveNodeView(nodeTypeName: string): ComponentType<NodeViewComponentProps> | undefined;
}

/** A plain map-backed registry; later registrations replace earlier ones. */
export function createNodeViewRegistry(): NodeViewRegistry {
    const components = new Map<string, ComponentType<NodeViewComponentProps>>();

    return {
        registerNodeView(nodeTypeName, component) {
            components.set(nodeTypeName, component);
        },
        resolveNodeView(nodeTypeName) {
            return components.get(nodeTypeName);
        },
    };
}

/**
 * Whether a manifest node needs the generic NodeView when nothing is
 * registered: any node outside the base prose set (it either carries attrs
 * beyond id or is a typed block with no native rendering — both need chrome).
 */
export function needsGenericNodeView(entry: NodeManifestEntry): boolean {
    if (BASE_PROSE_NODE_NAMES.has(entry.name)) {
        return false;
    }

    const properties = (entry.attrsSchema?.properties ?? {}) as Record<string, unknown>;

    return Object.keys(properties).some((name) => name !== NODE_ID_ATTR) || !BASE_PROSE_NODE_NAMES.has(entry.name);
}

export interface ResolvedNodeView {
    component: ComponentType<NodeViewComponentProps>;
    attrsSchema?: JsonSchema;
}

/**
 * The resolution the manifest→extensions generator binds NodeViews from: a
 * registered component wins; unregistered non-base nodes fall back to the
 * generic NodeView; base prose nodes are absent (native rendering).
 */
export function resolveNodeViewComponents(
    manifests: readonly BlockdocManifest[],
    registry?: NodeViewRegistry,
): Map<string, ResolvedNodeView> {
    const resolved = new Map<string, ResolvedNodeView>();

    for (const manifest of manifests) {
        for (const entry of manifest.nodes) {
            const registered = registry?.resolveNodeView(entry.name);

            if (registered !== undefined) {
                resolved.set(entry.name, { component: registered, attrsSchema: entry.attrsSchema });
                continue;
            }

            if (needsGenericNodeView(entry)) {
                resolved.set(entry.name, { component: GenericNodeView, attrsSchema: entry.attrsSchema });
            }
        }
    }

    return resolved;
}

/**
 * Adapt a blockdoc NodeView component to Tiptap's ReactNodeViewRenderer: the
 * wrapper element rides NodeViewWrapper, the contentDOM passthrough rides the
 * React NodeView context's contentRef (equivalent to rendering
 * NodeViewContent), and updateAttrs keeps the merge-and-preserve-id contract.
 */
export function tiptapNodeView(resolved: ResolvedNodeView): ComponentType<ReactNodeViewProps> {
    const { component: Component, attrsSchema } = resolved;

    function BlockdocNodeViewAdapter({ node, editor, getPos, updateAttributes }: ReactNodeViewProps) {
        const { nodeViewContentRef } = useReactNodeView();
        const contentRef = node.isLeaf ? null : (nodeViewContentRef ?? null);

        return (
            <NodeViewWrapper as={node.isInline ? 'span' : 'div'} className="blockdoc-node-view">
                <Component
                    node={node}
                    view={editor.view}
                    getPos={getPos}
                    updateAttrs={(attrs) =>
                        updateAttributes({ ...attrs, [NODE_ID_ATTR]: node.attrs[NODE_ID_ATTR] })
                    }
                    attrsSchema={attrsSchema}
                    contentRef={contentRef}
                />
            </NodeViewWrapper>
        );
    }

    BlockdocNodeViewAdapter.displayName = `BlockdocNodeView(${Component.displayName ?? Component.name ?? 'Component'})`;

    return BlockdocNodeViewAdapter;
}

/** The manifest attrsSchema minus the identity attr — id is not hand-edited. */
function formSchemaFor(attrsSchema: JsonSchema | undefined): JsonSchema | null {
    const properties = (attrsSchema?.properties ?? {}) as Record<string, unknown>;
    const editable = Object.entries(properties).filter(([name]) => name !== NODE_ID_ATTR);

    if (editable.length === 0) {
        return null;
    }

    return {
        ...attrsSchema,
        type: 'object',
        properties: Object.fromEntries(editable),
    };
}

/**
 * The generic NodeView — the drill-down seam: labeled chrome plus a
 * SchemaForm over the node's attrs (per the manifest's attrsSchema), with
 * contentDOM passthrough below when the node has content. Form changes
 * dispatch attr-patching transactions.
 */
export function GenericNodeView({ node, updateAttrs, attrsSchema, contentRef }: NodeViewComponentProps) {
    const formSchema = useMemo(() => formSchemaFor(attrsSchema), [attrsSchema]);

    const formData = useMemo(() => {
        const data: Record<string, unknown> = {};

        for (const name of Object.keys((formSchema?.properties ?? {}) as Record<string, unknown>)) {
            data[name] = node.attrs[name];
        }

        return data;
    }, [formSchema, node]);

    return (
        <div
            data-blockdoc-node={node.type.name}
            style={{
                border: '1px solid #d4d4d8',
                borderRadius: 6,
                margin: '8px 0',
                background: '#fafafa',
            }}
        >
            <div
                style={{
                    padding: '4px 10px',
                    fontSize: 11,
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    color: '#71717a',
                    borderBottom: '1px solid #e4e4e7',
                }}
                contentEditable={false}
            >
                {node.type.name}
            </div>
            {formSchema !== null && (
                <div style={{ padding: '8px 10px' }} contentEditable={false}>
                    <SchemaForm
                        schema={formSchema}
                        formData={formData}
                        onChange={(event) => updateAttrs((event.formData ?? {}) as Record<string, unknown>)}
                        liveValidate={false}
                    >
                        {/* onChange dispatches; hide the submit affordance. */}
                        <button type="submit" hidden />
                    </SchemaForm>
                </div>
            )}
            {contentRef !== null && <div ref={contentRef} style={{ padding: '8px 10px' }} />}
        </div>
    );
}
