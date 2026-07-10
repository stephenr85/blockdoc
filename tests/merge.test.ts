import { describe, expect, it } from 'vitest';
import { assemblePMSchema } from '../src/core';
import type { BlockdocManifest, NodeManifestEntry } from '../src/core';
import base from './fixtures/base.manifest.json';
import contentArticle from './fixtures/content-article.manifest.json';

function leafNode(name: string, category: string): NodeManifestEntry {
    return {
        name,
        group: 'block',
        category,
        admitsChildCategories: [],
        admitsText: false,
        contentExpression: null,
        attrsSchema: { type: 'object', properties: { id: { type: ['string', 'null'] } } },
    };
}

function manifest(profile: string, overrides: Partial<BlockdocManifest> = {}): BlockdocManifest {
    return { profile, version: 1, doc: null, nodes: [], marks: [], ...overrides };
}

describe('manifest merging', () => {
    it('concatenates nodes and marks across an array of manifests', () => {
        const schema = assemblePMSchema([base, contentArticle]);

        expect(schema.nodes.paragraph).toBeDefined();
        expect(schema.nodes.contentSection).toBeDefined();
        expect(schema.marks.strong).toBeDefined();
    });

    it('lets the last manifest with a non-null doc win', () => {
        const a = manifest('a', {
            doc: { admitsChildCategories: ['alpha'] },
            nodes: [leafNode('alphaNode', 'alpha')],
        });
        const b = manifest('b', {
            doc: { admitsChildCategories: ['beta'] },
            nodes: [leafNode('betaNode', 'beta')],
        });

        expect(assemblePMSchema([a, b]).nodes.doc.spec.content).toBe('(beta)*');

        const bWithoutDoc = manifest('b', { nodes: [leafNode('betaNode', 'beta')] });

        expect(assemblePMSchema([a, bWithoutDoc]).nodes.doc.spec.content).toBe('(alpha)*');
    });

    it('throws when a later manifest redeclares an existing node name', () => {
        const clash = manifest('clash', {
            nodes: [leafNode('paragraph', 'prose')],
        });

        expect(() => assemblePMSchema([base, contentArticle, clash])).toThrow(/paragraph/);
        expect(() => assemblePMSchema([base, contentArticle, base])).toThrow(/already declared/);
    });

    it('throws when a manifest declares the reserved doc or text node names', () => {
        const reserved = manifest('reserved', {
            doc: { admitsChildCategories: null },
            nodes: [leafNode('text', 'prose')],
        });

        expect(() => assemblePMSchema(reserved)).toThrow(/text/);
    });

    it('throws when a later manifest redeclares an existing mark name', () => {
        const clash = manifest('clash', { marks: [{ name: 'strong' }] });

        expect(() => assemblePMSchema([base, contentArticle, clash])).toThrow(/strong/);
    });

    it('throws when no manifest declares a doc', () => {
        expect(() => assemblePMSchema(base)).toThrow(/doc/);
    });
});
