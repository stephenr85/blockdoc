// @vitest-environment jsdom
import { getSchema } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { assemblePMSchema } from '../src/core';
import { createManifestExtensions } from '../src/react/manifest-extensions';
import base from './fixtures/base.manifest.json';
import contentServer from './fixtures/content-server.manifest.json';
import serverDocument from './fixtures/content-server-document.json';

/**
 * The Tiptap-side half of the conformance guard (splicewire-editor issue 11):
 * `assemblePMSchema` stays the ORACLE; the schema Tiptap compiles from
 * `createManifestExtensions` must accept and reject exactly the same
 * documents. Same fixtures as conformance.test.ts — refresh together.
 */
const oracle = assemblePMSchema([base, contentServer]);
const tiptapSchema = getSchema(createManifestExtensions([base, contentServer]));

describe('manifest-extensions schema parity with assemblePMSchema', () => {
    it('accepts the server conformance document', () => {
        const node = tiptapSchema.nodeFromJSON(serverDocument);

        expect(() => node.check()).not.toThrow();
    });

    it('is byte-stable across a re-parse of its own serialization, matching the oracle', () => {
        const once = tiptapSchema.nodeFromJSON(serverDocument).toJSON();
        const twice = tiptapSchema.nodeFromJSON(once).toJSON();

        expect(JSON.stringify(twice)).toBe(JSON.stringify(once));

        const oracleOnce = oracle.nodeFromJSON(serverDocument).toJSON();

        expect(JSON.stringify(once)).toBe(JSON.stringify(oracleOnce));
    });

    it('rejects the same invalid containment the oracle rejects', () => {
        const invalid = {
            type: 'doc',
            content: [
                // list_item outside a list — not admitted at doc level
                // (doc admits content_outline | content_section only).
                { type: 'list_item', content: [{ type: 'paragraph' }] },
            ],
        };

        expect(() => oracle.nodeFromJSON(invalid).check()).toThrow();
        expect(() => tiptapSchema.nodeFromJSON(invalid).check()).toThrow();
    });

    it('derives identical content expressions, groups, and attr defaults for every node and mark', () => {
        expect(Object.keys(tiptapSchema.nodes).sort()).toEqual(Object.keys(oracle.nodes).sort());
        expect(Object.keys(tiptapSchema.marks).sort()).toEqual(Object.keys(oracle.marks).sort());

        for (const [name, type] of Object.entries(oracle.nodes)) {
            const generated = tiptapSchema.nodes[name];

            expect(generated.spec.content ?? undefined, `node ${name} content`).toBe(type.spec.content ?? undefined);
            expect(generated.spec.group ?? undefined, `node ${name} group`).toBe(type.spec.group ?? undefined);
            expect(Boolean(generated.spec.inline), `node ${name} inline`).toBe(Boolean(type.spec.inline));

            const oracleDefaults = Object.fromEntries(
                Object.entries(type.spec.attrs ?? {}).map(([attr, spec]) => [attr, spec.default]),
            );
            const generatedDefaults = Object.fromEntries(
                Object.entries(generated.spec.attrs ?? {}).map(([attr, spec]) => [attr, spec.default]),
            );

            expect(generatedDefaults, `node ${name} attrs`).toEqual(oracleDefaults);
        }

        for (const [name, type] of Object.entries(oracle.marks)) {
            const generated = tiptapSchema.marks[name];

            expect(generated.spec.excludes ?? undefined, `mark ${name} excludes`).toBe(type.spec.excludes ?? undefined);

            const oracleDefaults = Object.fromEntries(
                Object.entries(type.spec.attrs ?? {}).map(([attr, spec]) => [attr, spec.default]),
            );
            const generatedDefaults = Object.fromEntries(
                Object.entries(generated.spec.attrs ?? {}).map(([attr, spec]) => [attr, spec.default]),
            );

            expect(generatedDefaults, `mark ${name} attrs`).toEqual(oracleDefaults);
        }
    });

    it('honors a docAdmits override exactly like a manifest-level doc override', () => {
        const overridden = getSchema(
            createManifestExtensions([base, contentServer], { docAdmits: ['prose'] }),
        );

        const proseDoc = {
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'plain prose at top level' }] }],
        };

        expect(() => overridden.nodeFromJSON(proseDoc).check()).not.toThrow();
        expect(() => tiptapSchema.nodeFromJSON(proseDoc).check()).toThrow();
    });
});
