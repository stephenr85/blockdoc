import { describe, expect, it } from 'vitest';
import { assemblePMSchema } from '../src/core';
import base from './fixtures/base.manifest.json';
import contentArticle from './fixtures/content-article.manifest.json';

const schema = assemblePMSchema([base, contentArticle]);

describe('containment via assembled schema', () => {
    it('accepts a conforming content-article document', () => {
        const doc = schema.nodeFromJSON({
            type: 'doc',
            content: [
                {
                    type: 'contentSection',
                    attrs: { heading: 'Intro' },
                    content: [
                        {
                            type: 'heading',
                            attrs: { level: 2 },
                            content: [{ type: 'text', text: 'Intro' }],
                        },
                        {
                            type: 'paragraph',
                            content: [{ type: 'text', text: 'Grounded prose.' }],
                        },
                        {
                            type: 'bulletList',
                            content: [
                                {
                                    type: 'listItem',
                                    content: [
                                        { type: 'paragraph', content: [{ type: 'text', text: 'point' }] },
                                    ],
                                },
                            ],
                        },
                        {
                            // Nested section: 'section' admits itself.
                            type: 'contentSection',
                            attrs: { heading: 'Sub' },
                            content: [
                                { type: 'paragraph', content: [{ type: 'text', text: 'nested' }] },
                            ],
                        },
                    ],
                },
            ],
        });

        expect(() => doc.check()).not.toThrow();
        expect(doc.childCount).toBe(1);
    });

    it('rejects a doc child whose category is not admitted by the doc', () => {
        // doc admits only 'section'; paragraph is category 'prose'.
        const doc = schema.nodeFromJSON({
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'loose prose' }] }],
        });

        expect(() => doc.check()).toThrow(RangeError);
    });

    it('rejects a child whose category is not admitted by its container', () => {
        // blockquote admits ['prose']; listItem is category 'listItem'.
        const doc = schema.nodeFromJSON({
            type: 'doc',
            content: [
                {
                    type: 'contentSection',
                    content: [
                        {
                            type: 'blockquote',
                            content: [
                                {
                                    type: 'listItem',
                                    content: [{ type: 'paragraph', content: [] }],
                                },
                            ],
                        },
                    ],
                },
            ],
        });

        expect(() => doc.check()).toThrow(RangeError);
    });

    it('rejects an outline inside a section (outline is only admitted by contentArticle)', () => {
        const doc = schema.nodeFromJSON({
            type: 'doc',
            content: [
                {
                    type: 'contentSection',
                    content: [{ type: 'contentOutline', attrs: { title: 'Plan' } }],
                },
            ],
        });

        expect(() => doc.check()).toThrow(RangeError);
    });

    it('rejects raw text directly inside a category-constrained container', () => {
        const doc = schema.nodeFromJSON({
            type: 'doc',
            content: [
                {
                    type: 'contentSection',
                    content: [{ type: 'text', text: 'no bare text here' }],
                },
            ],
        });

        expect(() => doc.check()).toThrow(RangeError);
    });
});
