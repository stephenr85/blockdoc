import { EditorState } from '@tiptap/pm/state';
import { describe, expect, it } from 'vitest';
import { assemblePMSchema, NODE_ID_ATTR } from '../src/core';
import type { BlockdocManifest } from '../src/core';
import { nodeIdPlugin } from '../src/react/node-id-plugin';
import base from './fixtures/base.manifest.json';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const proseDoc: BlockdocManifest = {
    profile: 'test',
    version: 1,
    doc: { admitsChildCategories: ['prose'] },
    nodes: [],
};

const schema = assemblePMSchema([base, proseDoc]);

function paragraph(id: string | null, text: string) {
    return { type: 'paragraph', attrs: { [NODE_ID_ATTR]: id }, content: [{ type: 'text', text }] };
}

function stateFromDoc(content: unknown[]): EditorState {
    return EditorState.create({
        doc: schema.nodeFromJSON({ type: 'doc', content }),
        plugins: [nodeIdPlugin()],
    });
}

function idsOf(state: EditorState): (string | null)[] {
    const ids: (string | null)[] = [];
    state.doc.descendants((node) => {
        if (NODE_ID_ATTR in node.attrs) {
            ids.push(node.attrs[NODE_ID_ATTR] as string | null);
        }
        return true;
    });
    return ids;
}

describe('node-id plugin', () => {
    it('assigns UUIDv7 ids to id-less nodes after a doc change', () => {
        const state = stateFromDoc([paragraph(null, 'one'), paragraph(null, 'two')]);

        const next = state.apply(state.tr.insertText('x', 2));

        for (const id of idsOf(next)) {
            expect(id).toMatch(UUID_V7);
        }
    });

    it('reassigns duplicated ids, keeping the first occurrence (paste duplicates ids)', () => {
        const state = stateFromDoc([paragraph('dup-id', 'one'), paragraph('dup-id', 'two'), paragraph('keep-id', 'three')]);

        const next = state.apply(state.tr.insertText('x', 2));
        const ids = idsOf(next);

        expect(ids[0]).toBe('dup-id');
        expect(ids[1]).toMatch(UUID_V7);
        expect(ids[2]).toBe('keep-id');
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('leaves already-unique ids untouched', () => {
        const state = stateFromDoc([paragraph('id-a', 'one'), paragraph('id-b', 'two')]);

        const next = state.apply(state.tr.insertText('x', 2));

        expect(idsOf(next)).toEqual(['id-a', 'id-b']);
    });

    it('does nothing for selection-only transactions', () => {
        const state = stateFromDoc([paragraph(null, 'one')]);

        const next = state.apply(state.tr.setMeta('probe', true));

        expect(idsOf(next)).toEqual([null]);
    });
});
