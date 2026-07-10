import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView, NodeView, ViewMutationRecord } from 'prosemirror-view';
import type { ComponentType, ReactPortal } from 'react';
import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { NODE_ID_ATTR } from '../core';
import type { JsonSchema } from '../core';

/**
 * The hand-rolled React↔ProseMirror NodeView bridge (the sanctioned exit: the
 * NYT-lineage @handlewithcare/react-prosemirror now peer-depends on Tiptap,
 * which blockdoc bans). Each ReactNodeView renders its component into its own
 * `dom` via createPortal; the portals are collected through a registry the
 * island renders alongside the editor mount, so they live in the island's
 * React tree and can use context.
 */

/** Props every React NodeView component receives. */
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

export interface PortalRegistry {
    mount(key: string, portal: ReactPortal): void;
    unmount(key: string): void;
}

/**
 * The island-side half of the bridge: returns the portals to render plus the
 * registry NodeViews mount into.
 */
export function usePortalRegistry(): [ReactPortal[], PortalRegistry] {
    const [portals, setPortals] = useState<ReadonlyMap<string, ReactPortal>>(new Map());

    const registry = useMemo<PortalRegistry>(
        () => ({
            mount(key, portal) {
                setPortals((previous) => new Map(previous).set(key, portal));
            },
            unmount(key) {
                setPortals((previous) => {
                    const next = new Map(previous);
                    next.delete(key);
                    return next;
                });
            },
        }),
        [],
    );

    return [Array.from(portals.values()), registry];
}

let nextNodeViewKey = 0;

/** The PM-side half of the bridge: a NodeView hosting one React component. */
export class ReactNodeView implements NodeView {
    dom: HTMLElement;
    contentDOM: HTMLElement | null = null;

    private readonly key = `blockdoc-node-view-${nextNodeViewKey++}`;
    private node: PMNode;

    constructor(
        node: PMNode,
        private readonly view: EditorView,
        private readonly getPos: () => number | undefined,
        private readonly component: ComponentType<NodeViewComponentProps>,
        private readonly attrsSchema: JsonSchema | undefined,
        private readonly portals: PortalRegistry,
    ) {
        this.node = node;
        this.dom = document.createElement(node.isInline ? 'span' : 'div');
        this.dom.classList.add('blockdoc-node-view');

        if (node.type.spec.content) {
            this.contentDOM = document.createElement(node.isInline ? 'span' : 'div');
            this.contentDOM.classList.add('blockdoc-node-view__content');
        }

        this.renderPortal();
    }

    update(node: PMNode): boolean {
        if (node.type !== this.node.type) {
            return false;
        }

        this.node = node;
        this.renderPortal();

        return true;
    }

    /** PM handles events inside its contentDOM; the React chrome keeps the rest. */
    stopEvent(event: Event): boolean {
        const target = event.target as globalThis.Node | null;

        if (this.contentDOM !== null && target !== null && this.contentDOM.contains(target)) {
            return false;
        }

        return true;
    }

    /** React mutates the chrome freely; only contentDOM mutations concern PM. */
    ignoreMutation(mutation: ViewMutationRecord): boolean {
        if (this.contentDOM === null) {
            return true;
        }

        return !this.contentDOM.contains(mutation.target);
    }

    destroy(): void {
        this.portals.unmount(this.key);
    }

    private readonly contentRefCallback = (element: HTMLElement | null): void => {
        if (element !== null && this.contentDOM !== null && this.contentDOM.parentElement !== element) {
            element.appendChild(this.contentDOM);
        }
    };

    private readonly updateAttrs = (attrs: Record<string, unknown>): void => {
        const pos = this.getPos();

        if (pos === undefined) {
            return;
        }

        this.view.dispatch(
            this.view.state.tr.setNodeMarkup(pos, null, {
                ...this.node.attrs,
                ...attrs,
                [NODE_ID_ATTR]: this.node.attrs[NODE_ID_ATTR],
            }),
        );
    };

    private renderPortal(): void {
        const Component = this.component;

        this.portals.mount(
            this.key,
            createPortal(
                <Component
                    node={this.node}
                    view={this.view}
                    getPos={this.getPos}
                    updateAttrs={this.updateAttrs}
                    attrsSchema={this.attrsSchema}
                    contentRef={this.contentDOM !== null ? this.contentRefCallback : null}
                />,
                this.dom,
                this.key,
            ),
        );
    }
}
