// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { BlockdocManifest } from '../src/core';
import { createNodeViewRegistry } from '../src/react/node-views';
import { createRichContentWidget } from '../src/rjsf';
import type { FormIntentBusLike } from '../src/rjsf';
import base from './fixtures/base.manifest.json';
import contentArticle from './fixtures/content-article.manifest.json';

const profileManifest: BlockdocManifest = contentArticle;

const proseDoc = {
    type: 'doc',
    content: [
        {
            type: 'paragraph',
            attrs: { id: 'p1' },
            content: [{ type: 'text', text: 'Grounded prose.' }],
        },
    ],
};

interface RecordedIntent {
    type: string;
    fieldPath: string;
    target?: unknown;
    payload?: unknown;
}

/** A fake bus that records flush/dispatch call order (the real bus's contract). */
function createRecordingBus() {
    const order: string[] = [];
    const flushers = new Set<() => void>();
    const dispatched: RecordedIntent[] = [];

    const bus: FormIntentBusLike = {
        registerFlush(flush) {
            flushers.add(flush);
            return () => flushers.delete(flush);
        },
        async dispatch(intent) {
            for (const flush of flushers) {
                order.push('flush');
                flush();
            }

            order.push('dispatch');
            dispatched.push(intent);
        },
    };

    return { bus, order, flushers, dispatched };
}

function renderWidget(bus?: FormIntentBusLike) {
    const RichContent = createRichContentWidget(createNodeViewRegistry(), { baseManifest: base });

    return render(
        <RichContent
            formData={proseDoc}
            schema={{}}
            uiSchema={{ 'ui:options': { manifest: profileManifest, palette: false } }}
            formContext={bus !== undefined ? { intentBus: bus } : {}}
            fieldPathId={{ path: ['bodyDoc'] }}
        />,
    );
}

describe('rich-content widget intent-bus integration', () => {
    afterEach(() => {
        cleanup();
    });

    it('registers the island flush on mount and unregisters on unmount', async () => {
        const { bus, flushers } = createRecordingBus();

        const { container, unmount } = renderWidget(bus);

        await waitFor(() => {
            expect(container.querySelector('[data-blockdoc-editor]')).not.toBeNull();
        });
        expect(flushers.size).toBe(1);

        unmount();
        expect(flushers.size).toBe(0);
    });

    it('renders no intent chrome without a bus on formContext', async () => {
        const { container } = renderWidget();

        await waitFor(() => {
            expect(container.querySelector('[data-blockdoc-editor]')).not.toBeNull();
        });
        expect(container.querySelector('[data-blockdoc-intent-chrome]')).toBeNull();
    });

    it('dispatches sw:revise carrying the selected node id, field path, and instruction', async () => {
        const { bus, dispatched } = createRecordingBus();

        const { container } = renderWidget(bus);

        // The initial selection sits inside the first paragraph — the chrome
        // tracks its node id through the island's onSelectionChange.
        await waitFor(() => {
            expect(container.querySelector('[data-blockdoc-selected-node]')?.textContent).toBe('p1');
        });

        fireEvent.change(container.querySelector('[data-blockdoc-revise-instruction]')!, {
            target: { value: 'Tighten the lede.' },
        });
        fireEvent.click(container.querySelector('[data-blockdoc-revise]')!);

        await waitFor(() => {
            expect(dispatched).toHaveLength(1);
        });
        expect(dispatched[0]).toEqual({
            type: 'sw:revise',
            fieldPath: 'bodyDoc',
            target: { nodeId: 'p1' },
            payload: { instruction: 'Tighten the lede.' },
        });
    });

    it('flushes registered commits before the intent reaches handlers', async () => {
        const { bus, order } = createRecordingBus();

        const { container } = renderWidget(bus);

        await waitFor(() => {
            expect(container.querySelector('[data-blockdoc-revise]')).not.toBeNull();
        });

        fireEvent.click(container.querySelector('[data-blockdoc-revise]')!);

        await waitFor(() => {
            expect(order).toEqual(['flush', 'dispatch']);
        });
    });

    it('disables the Revise button while a dispatch is pending', async () => {
        let release: () => void = () => {};
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });

        const bus: FormIntentBusLike = {
            registerFlush: () => () => {},
            dispatch: () => gate,
        };

        const { container } = renderWidget(bus);

        await waitFor(() => {
            expect(container.querySelector('[data-blockdoc-revise]')).not.toBeNull();
        });

        const button = container.querySelector<HTMLButtonElement>('[data-blockdoc-revise]')!;
        fireEvent.click(button);

        await waitFor(() => {
            expect(button.disabled).toBe(true);
        });

        release();

        await waitFor(() => {
            expect(button.disabled).toBe(false);
        });
    });
});
