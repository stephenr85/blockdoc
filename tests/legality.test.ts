import { describe, expect, it } from 'vitest';
import { assemblePMSchema, createLegalityReader } from '../src/core';
import type { BlockdocManifest } from '../src/core';
import type { Node as PMNode } from '@tiptap/pm/model';

// A profile exercising every legality dimension:
//   sec  → `heading{1} prose+`  (a required, capped heading + at least one prose)
//   bag  → `prose+ bag*`        (at least one prose; bags nest, for unnest tests)
const manifest: BlockdocManifest = {
    profile: 'legality-fixture',
    version: 1,
    doc: { admitsChildCategories: ['section', 'bag'] },
    nodes: [
        {
            name: 'sec',
            category: 'section',
            admitsChildCategories: ['heading', 'prose'],
            childConstraints: {
                heading: { required: true, max: 1, reason: 'a section needs a title' },
                prose: { min: 1 },
            },
        },
        {
            name: 'bag',
            category: 'bag',
            admitsChildCategories: ['prose', 'bag'],
            childConstraints: { prose: { min: 1 } },
        },
        { name: 'head', category: 'heading', admitsChildCategories: null, admitsText: true },
        { name: 'para', category: 'prose', admitsChildCategories: null, admitsText: true },
    ],
};

const schema = assemblePMSchema(manifest);
const reader = createLegalityReader(manifest);

function head(id: string, text = 'Title') {
    return { type: 'head', attrs: { id }, content: [{ type: 'text', text }] };
}
function para(id: string, text?: string) {
    return text === undefined
        ? { type: 'para', attrs: { id } }
        : { type: 'para', attrs: { id }, content: [{ type: 'text', text }] };
}
function sec(id: string, content: unknown[]) {
    return { type: 'sec', attrs: { id }, content };
}
function bag(id: string, content: unknown[]) {
    return { type: 'bag', attrs: { id }, content };
}

function build(content: unknown[]): PMNode {
    return schema.nodeFromJSON({ type: 'doc', content });
}

/** Position directly before the node with the given id. */
function posOf(doc: PMNode, id: string): number {
    let found = -1;
    doc.descendants((node, pos) => {
        if (node.attrs.id === id) {
            found = pos;
            return false;
        }
        return true;
    });
    if (found === -1) {
        throw new Error(`no node with id ${id}`);
    }
    return found;
}

describe('canDelete — required-child floor (B2 acceptance)', () => {
    it('refuses to delete the last required child and names the reason', () => {
        const doc = build([sec('s', [head('h'), para('p', 'body')])]);
        const verdict = reader.canDelete(doc, posOf(doc, 'h'));
        expect(verdict.allowed).toBe(false);
        expect(verdict.reason).toBe('a section needs a title');
    });

    it('refuses to delete the sole prose (min:1) with a derived reason', () => {
        const doc = build([sec('s', [head('h'), para('p', 'body')])]);
        const verdict = reader.canDelete(doc, posOf(doc, 'p'));
        expect(verdict.allowed).toBe(false);
        expect(verdict.reason).toBe('at least 1 prose required');
    });

    it('allows deleting a prose when another remains', () => {
        const doc = build([sec('s', [head('h'), para('p1', 'a'), para('p2', 'b')])]);
        expect(reader.canDelete(doc, posOf(doc, 'p2')).allowed).toBe(true);
    });
});

describe('canDuplicate — ceiling (B2 acceptance)', () => {
    it('refuses to duplicate at the max:1 ceiling', () => {
        const doc = build([sec('s', [head('h'), para('p', 'body')])]);
        const verdict = reader.canDuplicate(doc, posOf(doc, 'h'));
        expect(verdict.allowed).toBe(false);
        expect(verdict.reason).toBe('at most 1 heading allowed');
    });

    it('allows duplicating an uncapped prose', () => {
        const doc = build([sec('s', [head('h'), para('p', 'body')])]);
        expect(reader.canDuplicate(doc, posOf(doc, 'p')).allowed).toBe(true);
    });
});

describe('canDragTo + nearestValidSlot — source floor (B2 acceptance)', () => {
    it('refuses to drag the last required child away, at the SOURCE', () => {
        const doc = build([sec('s', [head('h'), para('p', 'body')])]);
        const verdict = reader.canDragTo(doc, posOf(doc, 'h'), 0);
        expect(verdict.allowed).toBe(false);
        expect(verdict.reason).toBe('a section needs a title');
    });

    it('nearestValidSlot returns null when the source floor forbids the move', () => {
        const doc = build([sec('s', [head('h'), para('p', 'body')])]);
        expect(reader.nearestValidSlot(doc, posOf(doc, 'h'), 0)).toBeNull();
    });

    it('allows a legal reorder within a bag and finds a slot', () => {
        const doc = build([bag('b', [para('p1', 'a'), para('p2', 'b'), para('p3', 'c')])]);
        const target = posOf(doc, 'p1');
        expect(reader.canDragTo(doc, posOf(doc, 'p3'), target).allowed).toBe(true);
        expect(reader.nearestValidSlot(doc, posOf(doc, 'p3'), target)).not.toBeNull();
    });

    it('rejects a drop into a parent that does not admit the block', () => {
        // A prose cannot land at doc top level (doc admits section|bag only).
        const doc = build([bag('b', [para('p1', 'a'), para('p2', 'b')])]);
        expect(reader.canDragTo(doc, posOf(doc, 'p2'), 0).allowed).toBe(false);
    });
});

describe('canUnnest — lift legality', () => {
    it('lets a nested bag unnest one level up', () => {
        const doc = build([bag('outer', [para('p', 'a'), bag('inner', [para('ip', 'b')])])]);
        expect(reader.canUnnest(doc, posOf(doc, 'inner')).allowed).toBe(true);
    });

    it('refuses to unnest a top-level block', () => {
        const doc = build([bag('b', [para('p', 'a')])]);
        expect(reader.canUnnest(doc, posOf(doc, 'b')).allowed).toBe(false);
    });
});

describe('insertableAt — palette candidate set', () => {
    it('offers only categories the doc admits at the top level', () => {
        const doc = build([bag('b', [para('p', 'a')])]);
        expect(reader.insertableAt(doc, 0).sort()).toEqual(['bag', 'section']);
    });

    it('excludes a capped category from a section gap', () => {
        const doc = build([sec('s', [head('h'), para('p', 'body')])]);
        // The gap between head and para: another heading is illegal (max:1); prose is fine.
        const gap = posOf(doc, 'p');
        const categories = reader.insertableAt(doc, gap);
        expect(categories).toContain('prose');
        expect(categories).not.toContain('heading');
    });
});

describe('isContentEmpty + completeness — Q7 and the structural mirror (B2 acceptance)', () => {
    it('classifies content-emptiness per node kind (Q7)', () => {
        const doc = build([sec('s', [head('h', 'x'), para('full', 'body'), para('empty')])]);
        const emptyPara = doc.resolve(posOf(doc, 'empty')).nodeAfter!;
        const fullPara = doc.resolve(posOf(doc, 'full')).nodeAfter!;
        expect(reader.isContentEmpty(emptyPara)).toBe(true);
        expect(reader.isContentEmpty(fullPara)).toBe(false);
    });

    it('counts an unset required attr as content-empty', () => {
        const attrManifest: BlockdocManifest = {
            profile: 'attr-required',
            version: 1,
            doc: { admitsChildCategories: ['widget'] },
            nodes: [
                {
                    name: 'widget',
                    category: 'widget',
                    admitsChildCategories: [],
                    attrsSchema: { properties: { src: { type: 'string' } }, required: ['src'] },
                },
            ],
        };
        const attrReader = createLegalityReader(attrManifest);
        const attrSchema = assemblePMSchema(attrManifest);
        const filled = attrSchema.nodeFromJSON({ type: 'widget', attrs: { id: 'w1', src: 'x.png' } });
        const unset = attrSchema.nodeFromJSON({ type: 'widget', attrs: { id: 'w2', src: null } });
        expect(attrReader.isContentEmpty(filled)).toBe(false);
        expect(attrReader.isContentEmpty(unset)).toBe(true);
    });

    it('reports completeness with a present-but-empty required child', () => {
        // sec requires heading{1} + prose+; para is present but EMPTY.
        const doc = build([sec('s', [head('h', 'Title'), para('p')])]);
        const result = reader.completeness(doc);
        expect(result.requiredTotal).toBe(2); // heading:1 + prose:1
        expect(result.requiredFilled).toBe(1); // heading filled; empty prose not counted
        expect(result.incompleteNodeIds.sort()).toEqual(['p', 's']);
    });

    it('reports a fully-satisfied document as complete', () => {
        const doc = build([sec('s', [head('h', 'Title'), para('p', 'body')])]);
        const result = reader.completeness(doc);
        expect(result.requiredTotal).toBe(2);
        expect(result.requiredFilled).toBe(2);
        expect(result.incompleteNodeIds).toEqual([]);
    });

    it('per-node isIncomplete flags a section missing its prose', () => {
        const doc = build([sec('s', [head('h', 'Title'), para('p')])]);
        const section = doc.resolve(posOf(doc, 's')).nodeAfter!;
        expect(reader.isIncomplete(section)).toBe(true);
    });
});
