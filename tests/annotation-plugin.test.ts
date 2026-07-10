import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { assemblePMSchema } from '../src/core';
import {
    annotationIds,
    annotationIntegrityPlugin,
    annotationRanges,
} from '../src/react/annotation-plugin';
import base from './fixtures/base.manifest.json';

const schema = assemblePMSchema([{ ...base, doc: { admitsChildCategories: ['prose'] } }]);
const annotation = schema.marks.annotation;

function stateWithDoc(docJson: unknown): EditorState {
    return EditorState.create({
        schema,
        doc: schema.nodeFromJSON(docJson),
        plugins: [annotationIntegrityPlugin()],
    });
}

const annotatedDoc = {
    type: 'doc',
    content: [
        {
            type: 'paragraph',
            content: [
                { type: 'text', text: 'An ' },
                { type: 'text', text: 'evidence-bound', marks: [{ type: 'annotation', attrs: { id: 'span-1' } }] },
                { type: 'text', text: ' claim.' },
            ],
        },
    ],
};

describe('annotation mark integrity', () => {
    it('distinct ids prevent adjacent-mark merging', () => {
        const doc = schema.nodeFromJSON({
            type: 'doc',
            content: [
                {
                    type: 'paragraph',
                    content: [
                        { type: 'text', text: 'one', marks: [{ type: 'annotation', attrs: { id: 'a' } }] },
                        { type: 'text', text: 'two', marks: [{ type: 'annotation', attrs: { id: 'b' } }] },
                    ],
                },
            ],
        });

        expect(annotationIds(doc)).toEqual(new Set(['a', 'b']));
        expect(annotationRanges(doc, 'a')).toHaveLength(1);
        expect(annotationRanges(doc, 'b')).toHaveLength(1);
    });

    it('an id survives a mid-span split as multiple ranges, resolvable by id', () => {
        const state = stateWithDoc(annotatedDoc);

        // Split the annotated span by inserting unannotated text in its middle.
        const mid = 4 + 7; // inside 'evidence-bound'
        let tr = state.tr.setSelection(TextSelection.create(state.doc, mid));
        tr = tr.insertText(' PLAIN ', mid, mid);
        tr.setStoredMarks([]);
        const next = state.apply(tr);

        // The inserted text inherits marks by default in PM unless stored marks
        // cleared — strip the annotation from the inserted range to model a
        // genuine split.
        const cleaned = next.apply(
            next.tr.removeMark(mid, mid + 7, annotation.create({ id: 'span-1' })),
        );

        const ranges = annotationRanges(cleaned.doc, 'span-1');
        expect(ranges).toHaveLength(2);
        expect(annotationIds(cleaned.doc)).toEqual(new Set(['span-1']));
    });

    it('assigns ids to annotation marks that arrive without one', () => {
        const state = stateWithDoc({
            type: 'doc',
            content: [
                {
                    type: 'paragraph',
                    content: [
                        { type: 'text', text: 'raw', marks: [{ type: 'annotation', attrs: { id: null } }] },
                    ],
                },
            ],
        });

        // Any doc-changing transaction triggers the integrity pass.
        const next = state.apply(state.tr.insertText('!', state.doc.content.size - 1));

        const ids = annotationIds(next.doc);
        expect(ids.size).toBe(1);
        const [id] = [...ids];
        expect(id.split('-')[2]?.startsWith('7')).toBe(true); // UUIDv7
    });

    it('adjacent same-id leaves coalesce into one range', () => {
        const doc = schema.nodeFromJSON({
            type: 'doc',
            content: [
                {
                    type: 'paragraph',
                    content: [
                        { type: 'text', text: 'one', marks: [{ type: 'annotation', attrs: { id: 'x' } }] },
                        {
                            type: 'text',
                            text: 'two',
                            marks: [
                                { type: 'annotation', attrs: { id: 'x' } },
                                { type: 'strong' },
                            ],
                        },
                    ],
                },
            ],
        });

        expect(annotationRanges(doc, 'x')).toHaveLength(1);
    });
});
