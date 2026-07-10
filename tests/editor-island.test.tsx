// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { TextSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NODE_ID_ATTR } from '../src/core';
import type { BlockdocManifest } from '../src/core';
import { BlockdocEditor } from '../src/react/BlockdocEditor';
import type { BlockdocEditorHandle } from '../src/react/BlockdocEditor';
import type { DocJson } from '../src/react/commit-controller';
import { selectionForNodeId, selectionNodeId } from '../src/react/selection';
import base from './fixtures/base.manifest.json';

const proseDoc: BlockdocManifest = {
    profile: 'test',
    version: 1,
    doc: { admitsChildCategories: ['prose'] },
    nodes: [],
};

const manifests: BlockdocManifest[] = [base, proseDoc];

function paragraph(id: string, text: string) {
    return { type: 'paragraph', attrs: { [NODE_ID_ATTR]: id }, content: [{ type: 'text', text }] };
}

function doc(...paragraphs: unknown[]): DocJson {
    return { type: 'doc', content: paragraphs };
}

interface Mounted {
    view: EditorView;
    handle: BlockdocEditorHandle;
    onChange: ReturnType<typeof vi.fn>;
    setValue: (value: DocJson | null) => void;
}

function mountIsland(initial: DocJson | null): Mounted {
    const ref = createRef<BlockdocEditorHandle>();
    const onChange = vi.fn();

    const view = (value: DocJson | null) => (
        <BlockdocEditor ref={ref} manifests={manifests} value={value} onChange={onChange} palette={false} />
    );

    const utils = render(view(initial));

    return {
        view: ref.current!.view!,
        handle: ref.current!,
        onChange,
        setValue: async (value) => {
            utils.rerender(view(value));
            // External rebuilds are deferred a microtask (React flushSync rule).
            await act(async () => {
                await Promise.resolve();
            });
        },
    };
}

function typeText(view: EditorView, text: string, pos: number): void {
    act(() => {
        view.dispatch(view.state.tr.insertText(text, pos));
    });
}

describe('BlockdocEditor island', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        cleanup();
        vi.useRealTimers();
    });

    it('initializes from null as an empty doc valid per schema', () => {
        const { view } = mountIsland(null);

        expect(view.state.doc.check()).toBeUndefined();
        expect(view.state.doc.childCount).toBe(0);
    });

    it('commits once per burst on the trailing debounce (no commit storm at keystroke rate)', () => {
        const { view, onChange } = mountIsland(doc(paragraph('p1', 'hello')));

        for (const char of 'world') {
            typeText(view, char, 6);
            act(() => {
                vi.advanceTimersByTime(100);
            });
        }

        expect(onChange).not.toHaveBeenCalled();

        act(() => {
            vi.advanceTimersByTime(400);
        });

        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange.mock.calls[0][0]).toEqual(view.state.doc.toJSON());
    });

    it('commits immediately on blur', () => {
        const { view, onChange } = mountIsland(doc(paragraph('p1', 'hello')));

        typeText(view, '!', 6);
        act(() => {
            fireEvent.blur(view.dom);
        });

        expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('flushCommits commits synchronously when dirty and is a no-op when clean', () => {
        const { view, handle, onChange } = mountIsland(doc(paragraph('p1', 'hello')));

        act(() => {
            handle.flushCommits();
        });
        expect(onChange).not.toHaveBeenCalled();

        typeText(view, '!', 6);
        act(() => {
            handle.flushCommits();
        });
        expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('registers its flush on the commitBus and unregisters on unmount', () => {
        const flushes = new Set<() => void>();
        const commitBus = {
            register: (flush: () => void) => {
                flushes.add(flush);
                return () => flushes.delete(flush);
            },
        };
        const ref = createRef<BlockdocEditorHandle>();
        const onChange = vi.fn();

        const utils = render(
            <BlockdocEditor
                ref={ref}
                manifests={manifests}
                value={doc(paragraph('p1', 'hello'))}
                onChange={onChange}
                commitBus={commitBus}
                palette={false}
            />,
        );

        expect(flushes.size).toBe(1);

        typeText(ref.current!.view!, '!', 6);
        act(() => {
            for (const flush of flushes) flush();
        });
        expect(onChange).toHaveBeenCalledTimes(1);

        utils.unmount();
        expect(flushes.size).toBe(0);
    });

    it('ignores the onChange echo: the value prop returning to last-committed does not rebuild', async () => {
        const { view, handle, onChange, setValue } = mountIsland(doc(paragraph('p1', 'hello')));

        typeText(view, '!', 6);
        act(() => {
            handle.flushCommits();
        });
        const committed = onChange.mock.calls[0][0] as DocJson;
        const stateBefore = view.state;

        await act(async () => {
            await setValue(JSON.parse(JSON.stringify(committed)) as DocJson);
        });

        // No rebuild: the document node is untouched (state identity may shift
        // from doc-preserving selection/plugin transactions) and no echo commit.
        expect(view.state.doc).toBe(stateBefore.doc);
        expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('rebuilds from an external value with the selection remapped to the surviving node id', async () => {
        const initial = doc(paragraph('p1', 'alpha'), paragraph('p2', 'beta'));
        const { view, onChange, setValue } = mountIsland(initial);

        // Park the selection inside p2.
        act(() => {
            const position = view.state.doc.resolve(9);
            view.dispatch(view.state.tr.setSelection(TextSelection.near(position)));
        });
        expect(selectionNodeId(view.state)).toBe('p2');

        const external = doc(paragraph('p2', 'beta'), paragraph('p3', 'gamma'));
        await act(async () => {
            await setValue(external);
        });

        expect(view.state.doc.toJSON()).toEqual(external);
        expect(selectionNodeId(view.state)).toBe('p2');

        // The rebuild itself never fires a commit.
        act(() => {
            vi.advanceTimersByTime(1000);
        });
        expect(onChange).not.toHaveBeenCalled();
    });

    it('falls back to the doc start when the selection node did not survive', async () => {
        const initial = doc(paragraph('p1', 'alpha'), paragraph('p2', 'beta'));
        const { view, setValue } = mountIsland(initial);

        act(() => {
            const position = view.state.doc.resolve(9);
            view.dispatch(view.state.tr.setSelection(TextSelection.near(position)));
        });

        const external = doc(paragraph('p9', 'replaced'));
        await act(async () => {
            await setValue(external);
        });

        expect(view.state.doc.toJSON()).toEqual(external);
        expect(view.state.selection.from).toBe(selectionForNodeId(view.state.doc, null).from);
    });

    it('resets undo history on an external rebuild', async () => {
        const { view, setValue } = mountIsland(doc(paragraph('p1', 'alpha')));

        typeText(view, '!', 6);

        const external = doc(paragraph('p1', 'omega'));
        await act(async () => {
            await setValue(external);
        });

        // Mod-z after the rebuild has nothing to undo: the doc stays put.
        act(() => {
            fireEvent.keyDown(view.dom, { key: 'z', ctrlKey: true });
        });
        expect(view.state.doc.toJSON()).toEqual(external);
    });
});
