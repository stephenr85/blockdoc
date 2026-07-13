import { describe, expect, it } from 'vitest';
import {
    assemblePMSchema,
    attrDereferenceTarget,
    attrEditable,
    attrIsPickMany,
    attrWidgetOptions,
    contentExpressionFor,
    isReorderable,
    quantifierFor,
    requiredReason,
} from '../src/core';
import type { BlockdocManifest, NodeManifestEntry } from '../src/core';
import base from './fixtures/base.manifest.json';
import contentArticle from './fixtures/content-article.manifest.json';

describe('quantifierFor — ChildConstraint → PM repetition operator (B1)', () => {
    it('maps the arity cases', () => {
        expect(quantifierFor(undefined)).toBe('*');
        expect(quantifierFor({})).toBe('*');
        expect(quantifierFor({ required: true })).toBe('+');
        expect(quantifierFor({ min: 1 })).toBe('+');
        expect(quantifierFor({ min: 2 })).toBe('{2,}');
        expect(quantifierFor({ max: 1 })).toBe('?');
        expect(quantifierFor({ min: 1, max: 1 })).toBe('{1}');
        expect(quantifierFor({ required: true, max: 1 })).toBe('{1}');
        expect(quantifierFor({ min: 1, max: 3 })).toBe('{1,3}');
        expect(quantifierFor({ max: 3 })).toBe('{0,3}');
    });

    it('returns null for a category capped at zero (the caller drops the term)', () => {
        expect(quantifierFor({ max: 0 })).toBeNull();
    });
});

describe('contentExpressionFor — childConstraints compilation (B1)', () => {
    it('compiles a single required category to `cat+`', () => {
        expect(
            contentExpressionFor(
                { admitsChildCategories: ['section'], childConstraints: { section: { required: true } } },
                [],
            ),
        ).toBe('section+');
    });

    it('compiles required+max:1 to `cat{1}`', () => {
        expect(
            contentExpressionFor(
                { admitsChildCategories: ['heading'], childConstraints: { heading: { required: true, max: 1 } } },
                [],
            ),
        ).toBe('heading{1}');
    });

    it('compiles max:1 to `cat?` (schema-level ceiling)', () => {
        expect(
            contentExpressionFor(
                { admitsChildCategories: ['section'], childConstraints: { section: { max: 1 } } },
                [],
            ),
        ).toBe('section?');
    });

    it('compiles a multi-category constraint set to an ordered quantified sequence', () => {
        expect(
            contentExpressionFor(
                {
                    admitsChildCategories: ['heading', 'section'],
                    childConstraints: { heading: { required: true, max: 1 }, section: { min: 1 } },
                },
                [],
            ),
        ).toBe('heading{1} section+');
    });

    it('defaults an unconstrained-but-admitted category to `*` within the sequence', () => {
        expect(
            contentExpressionFor(
                {
                    admitsChildCategories: ['heading', 'prose'],
                    childConstraints: { heading: { max: 1 } },
                },
                [],
            ),
        ).toBe('heading? prose*');
    });

    it('drops a max:0 category from the sequence', () => {
        expect(
            contentExpressionFor(
                {
                    admitsChildCategories: ['heading', 'section'],
                    childConstraints: { heading: { max: 0 }, section: { min: 1 } },
                },
                [],
            ),
        ).toBe('section+');
    });

    it('an explicit contentExpression still overrides childConstraints (ordering hatch)', () => {
        expect(
            contentExpressionFor(
                {
                    admitsChildCategories: ['heading', 'section'],
                    contentExpression: 'heading section+',
                    childConstraints: { section: { min: 1 } },
                },
                [],
            ),
        ).toBe('heading section+');
    });

    it('NO REGRESSION: without childConstraints, a list stays the union `(a | b)*`', () => {
        expect(
            contentExpressionFor({ admitsChildCategories: ['section', 'prose'] }, []),
        ).toBe('(section | prose)*');
        // The existing fixtures are unchanged too.
        const schema = assemblePMSchema([base, contentArticle]);
        expect(schema.nodes.contentSection.spec.content).toBe('(section | prose)*');
        expect(schema.nodes.bullet_list.spec.content).toBe('(list_item)*');
    });
});

// A minimal profile whose doc arity is governed by childConstraints, used to
// prove the compiled expression actually gates PM structural validity.
function sectionedManifest(docConstraint: Record<string, { min?: number; max?: number; required?: boolean }>): BlockdocManifest[] {
    const doc: BlockdocManifest = {
        profile: 'sectioned',
        version: 1,
        doc: { admitsChildCategories: ['section'], childConstraints: docConstraint },
        nodes: [
            {
                name: 'sec',
                category: 'section',
                admitsChildCategories: null,
                admitsText: true,
            },
        ],
    };

    return [doc];
}

function docWith(sectionCount: number, manifest: BlockdocManifest[]) {
    const schema = assemblePMSchema(manifest);

    return schema.nodeFromJSON({
        type: 'doc',
        content: Array.from({ length: sectionCount }, () => ({
            type: 'sec',
            content: [{ type: 'text', text: 'x' }],
        })),
    });
}

describe('childConstraints gate PM structural validity (B1 acceptance)', () => {
    it('max:1 — a second child is rejected at the schema level', () => {
        const manifest = sectionedManifest({ section: { max: 1 } });
        expect(assemblePMSchema(manifest).nodes.doc.spec.content).toBe('section?');
        expect(() => docWith(1, manifest).check()).not.toThrow();
        expect(() => docWith(2, manifest).check()).toThrow();
    });

    it('required — an empty document is rejected, one child passes', () => {
        const manifest = sectionedManifest({ section: { required: true } });
        expect(assemblePMSchema(manifest).nodes.doc.spec.content).toBe('section+');
        expect(() => docWith(0, manifest).check()).toThrow();
        expect(() => docWith(1, manifest).check()).not.toThrow();
    });

    it('min:1,max:2 — zero and three are rejected, one and two pass', () => {
        const manifest = sectionedManifest({ section: { min: 1, max: 2 } });
        expect(assemblePMSchema(manifest).nodes.doc.spec.content).toBe('section{1,2}');
        expect(() => docWith(0, manifest).check()).toThrow();
        expect(() => docWith(1, manifest).check()).not.toThrow();
        expect(() => docWith(2, manifest).check()).not.toThrow();
        expect(() => docWith(3, manifest).check()).toThrow();
    });
});

describe('manifest extension-field accessors (B1)', () => {
    const referenceNode: NodeManifestEntry = {
        name: 'reference',
        category: 'embed',
        admitsChildCategories: [],
        'x-editable': { reorderable: true },
        'x-required-reason': 'every citation anchors a claim',
        attrsSchema: {
            properties: {
                targetId: {
                    type: 'string',
                    'x-editable': { inline: true, pickable: true },
                    'x-dereference-target': 'source',
                    'x-widget-options': { expand: true },
                },
                personIds: {
                    type: 'array',
                    items: { type: 'string', 'x-dereference-target': 'person' },
                },
                caption: { type: 'string' },
            },
        },
    };

    const props = referenceNode.attrsSchema!.properties as Record<string, Record<string, unknown>>;

    it('reads node-level x-editable.reorderable', () => {
        expect(isReorderable(referenceNode)).toBe(true);
        expect(isReorderable({ name: 'x', category: null, admitsChildCategories: [] })).toBe(false);
    });

    it('reads attr-level x-editable (inline/pickable)', () => {
        expect(attrEditable(props.targetId)).toEqual({ inline: true, pickable: true });
        expect(attrEditable(props.caption)).toEqual({});
    });

    it('reads x-dereference-target and detects pick-many arrays', () => {
        expect(attrDereferenceTarget(props.targetId)).toBe('source');
        expect(attrDereferenceTarget(props.caption)).toBeNull();
        expect(attrIsPickMany(props.personIds)).toBe(true);
        expect(attrIsPickMany(props.targetId)).toBe(false);
    });

    it('reads x-widget-options', () => {
        expect(attrWidgetOptions(props.targetId)).toEqual({ expand: true });
        expect(attrWidgetOptions(props.caption)).toEqual({});
    });

    it('resolves a required reason: constraint reason wins, else the child node fallback', () => {
        expect(requiredReason({ required: true, reason: 'scope is mandatory' }, referenceNode)).toBe('scope is mandatory');
        expect(requiredReason({ required: true }, referenceNode)).toBe('every citation anchors a claim');
        expect(requiredReason(undefined, undefined)).toBeNull();
    });
});
