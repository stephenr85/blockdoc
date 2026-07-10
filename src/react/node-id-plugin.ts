import { Plugin } from 'prosemirror-state';
import type { Transaction } from 'prosemirror-state';
import { generateNodeId, NODE_ID_ATTR } from '../core';

/**
 * Identity integrity: after any doc-changing transaction, every node carrying
 * the id attr must hold a unique string id. Assigns generateNodeId() to nodes
 * whose id is null/empty and to later duplicates (paste duplicates ids!).
 * Attr-only patches, so positions stay stable while we walk.
 */
export function nodeIdPlugin(): Plugin {
    return new Plugin({
        appendTransaction(transactions, _oldState, newState): Transaction | null {
            if (!transactions.some((transaction) => transaction.docChanged)) {
                return null;
            }

            const seen = new Set<string>();
            let patch: Transaction | null = null;

            newState.doc.descendants((node, pos) => {
                if (!(NODE_ID_ATTR in node.attrs)) {
                    return true;
                }

                const id = node.attrs[NODE_ID_ATTR];

                if (typeof id !== 'string' || id === '' || seen.has(id)) {
                    patch = patch ?? newState.tr;
                    patch.setNodeAttribute(pos, NODE_ID_ATTR, generateNodeId());
                } else {
                    seen.add(id);
                }

                return true;
            });

            return patch;
        },
    });
}
