import { describe, expect, it } from 'vitest';
import { assemblePMSchema, generateNodeId } from '../src/core';
import base from './fixtures/base.manifest.json';
import contentArticle from './fixtures/content-article.manifest.json';

const schema = assemblePMSchema([base, contentArticle]);

describe('attr round-tripping', () => {
    it('round-trips node attrs (including id) and mark attrs through toJSON', () => {
        const sectionId = generateNodeId();

        const docJson = {
            type: 'doc',
            content: [
                {
                    type: 'contentSection',
                    attrs: {
                        id: sectionId,
                        heading: 'Grounded intro',
                        groundingTokens: ['fragment:0197a2c0-0000-7000-8000-000000000000'],
                        imagePrompt: null,
                        strategy: null,
                    },
                    content: [
                        {
                            type: 'heading',
                            attrs: { id: null, level: 2 },
                            content: [{ type: 'text', text: 'Grounded intro' }],
                        },
                        {
                            type: 'paragraph',
                            attrs: { id: generateNodeId() },
                            content: [
                                { type: 'text', text: 'Hello ' },
                                {
                                    type: 'text',
                                    text: 'world',
                                    marks: [
                                        { type: 'strong' },
                                        { type: 'link', attrs: { href: 'https://example.com' } },
                                        { type: 'annotation', attrs: { id: generateNodeId() } },
                                    ],
                                },
                                { type: 'hardBreak', attrs: { id: null } },
                            ],
                        },
                    ],
                },
            ],
        };

        const doc = schema.nodeFromJSON(docJson);

        expect(() => doc.check()).not.toThrow();
        expect(doc.toJSON()).toEqual(docJson);
        expect(doc.firstChild!.attrs.id).toBe(sectionId);
    });

    it('fills omitted attrs from schema defaults (id null, declared defaults honoured)', () => {
        const heading = schema.nodeFromJSON({ type: 'heading', content: [] });

        expect(heading.attrs).toEqual({ id: null, level: 1 });

        const section = schema.nodeFromJSON({ type: 'contentSection', content: [] });

        expect(section.attrs).toEqual({
            id: null,
            heading: '',
            groundingTokens: [],
            imagePrompt: null,
            strategy: null,
        });
    });
});
