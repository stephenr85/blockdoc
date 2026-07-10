import { describe, expect, it } from 'vitest';
import { assemblePMSchema } from '../src/core';
import base from './fixtures/base.manifest.json';
import contentServer from './fixtures/content-server.manifest.json';
import serverDocument from './fixtures/content-server-document.json';

/**
 * The cross-boundary conformance guard (splicewire-editor issue 06): the
 * MANIFEST here is the real `block-schema:export-manifest content` output and
 * the DOCUMENT is the same fixture the server's DocumentHydrator round-trips
 * byte-stable (splicewire-app tests/fixtures/composition/content-pm-document.json)
 * — refresh both together when the vocabulary changes. Client and server must
 * accept exactly the same documents.
 *
 * Serialization parity is asserted up to ProseMirror's one legal
 * normalization: materializing declared attr defaults (`id: null` on nodes the
 * server omitted attrs for) — key order is canonicalized on both sides. A doc
 * that has passed through the editor once is byte-stable thereafter on both
 * sides (the server's RichContentSlotTest proves the PHP half).
 */
const schema = assemblePMSchema([base, contentServer]);

/** Canonicalize: sort object keys; drop null-valued `id` attrs and then-empty attrs. */
function canonical(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(canonical);
    }
    if (value && typeof value === 'object') {
        const entries = Object.entries(value as Record<string, unknown>)
            .filter(([key, child]) => {
                if (key === 'id' && child === null) return false;
                return true;
            })
            .map(([key, child]) => [key, canonical(child)] as const)
            .filter(([key, child]) =>
                !(key === 'attrs' && child && typeof child === 'object' && Object.keys(child).length === 0),
            )
            .sort(([a], [b]) => a.localeCompare(b));
        return Object.fromEntries(entries);
    }
    return value;
}

describe('client/server conformance', () => {
    it('accepts the document the server hydrates; re-serialization matches up to attr-default materialization', () => {
        const node = schema.nodeFromJSON(serverDocument);
        node.check();

        expect(canonical(node.toJSON())).toEqual(canonical(serverDocument));
    });

    it('is byte-stable across a PM re-parse of its own serialization', () => {
        const once = schema.nodeFromJSON(serverDocument).toJSON();
        const twice = schema.nodeFromJSON(once).toJSON();

        expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
    });

    it('rejects containment the server vocabulary does not admit', () => {
        const invalid = {
            type: 'doc',
            content: [
                // list_item outside a list — not admitted at doc level
                // (doc admits content_outline | content_section only).
                { type: 'list_item', content: [{ type: 'paragraph' }] },
            ],
        };

        expect(() => schema.nodeFromJSON(invalid).check()).toThrow();
    });
});
