import type { Node as PMNode } from 'prosemirror-model';
import { NodeSelection, Selection } from 'prosemirror-state';
import type { EditorState } from 'prosemirror-state';
import { NODE_ID_ATTR } from '../core';

/**
 * The id of the node the selection lives in: the selected node itself for a
 * NodeSelection, otherwise the nearest ancestor of $from carrying a string id.
 */
export function selectionNodeId(state: EditorState): string | null {
    if (state.selection instanceof NodeSelection) {
        const id = state.selection.node.attrs[NODE_ID_ATTR];

        if (typeof id === 'string' && id !== '') {
            return id;
        }
    }

    const $from = state.selection.$from;

    for (let depth = $from.depth; depth > 0; depth--) {
        const id = $from.node(depth).attrs[NODE_ID_ATTR];

        if (typeof id === 'string' && id !== '') {
            return id;
        }
    }

    return null;
}

/**
 * Remap a selection into a (rebuilt) doc by node id: place it at the start of
 * the node carrying `id`, falling back to the doc start when the node did not
 * survive.
 */
export function selectionForNodeId(doc: PMNode, id: string | null): Selection {
    if (id !== null) {
        let found: number | null = null;

        doc.descendants((node, pos) => {
            if (found !== null) {
                return false;
            }

            if (node.attrs[NODE_ID_ATTR] === id) {
                found = pos;
                return false;
            }

            return true;
        });

        if (found !== null) {
            return Selection.near(doc.resolve(found + 1));
        }
    }

    return Selection.atStart(doc);
}
