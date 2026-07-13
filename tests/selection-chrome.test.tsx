// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SelectionChrome } from '../src/react/selection-chrome';

afterEach(() => {
    cleanup();
});

/** A registered skin and the neutral fallback are just different children. */
function Skin() {
    return <div data-test-skin="">A product card, drawn by the host</div>;
}
function NeutralFallback() {
    return <div data-test-fallback="">type badge + attr summary</div>;
}

describe('SelectionChrome — the uniform shell chrome primitive (B3)', () => {
    it('draws the SAME ring around a registered skin and the neutral fallback, with zero skin-side chrome', () => {
        const skin = render(
            <SelectionChrome nodeId="n1" localSelected>
                <Skin />
            </SelectionChrome>,
        );
        const fallback = render(
            <SelectionChrome nodeId="n2" localSelected>
                <NeutralFallback />
            </SelectionChrome>,
        );

        // Both get a ring + drag handle from the shell — the children carry none.
        expect(skin.container.querySelector('[data-blockdoc-selection-ring]')).not.toBeNull();
        expect(fallback.container.querySelector('[data-blockdoc-selection-ring]')).not.toBeNull();
        expect(skin.container.querySelector('[data-blockdoc-drag-handle]')).not.toBeNull();
        expect(fallback.container.querySelector('[data-blockdoc-drag-handle]')).not.toBeNull();

        // The children themselves contain no chrome markup.
        expect(skin.container.querySelector('[data-test-skin] [data-blockdoc-selection-ring]')).toBeNull();
        expect(fallback.container.querySelector('[data-test-fallback] [data-blockdoc-selection-ring]')).toBeNull();
    });

    it('draws no ring when unselected', () => {
        const { container } = render(
            <SelectionChrome nodeId="n1">
                <Skin />
            </SelectionChrome>,
        );
        expect(container.querySelector('[data-blockdoc-selection-ring]')).toBeNull();
        expect(container.querySelector('[data-blockdoc-drag-handle]')).toBeNull();
        expect(container.querySelector('[data-blockdoc-chrome]')?.getAttribute('data-selected')).toBeNull();
    });

    it('renders the required badge from the B2/08 required flag', () => {
        const { container } = render(
            <SelectionChrome nodeId="n1" required>
                <Skin />
            </SelectionChrome>,
        );
        const badge = container.querySelector('[data-blockdoc-required-badge]');
        expect(badge).not.toBeNull();
        expect(badge?.textContent).toBe('required');
    });

    it('renders the incomplete outline from the B2 completeness flag', () => {
        const { container } = render(
            <SelectionChrome nodeId="n1" incomplete>
                <Skin />
            </SelectionChrome>,
        );
        expect(container.querySelector('[data-blockdoc-incomplete-outline]')).not.toBeNull();
        expect(container.querySelector('[data-blockdoc-chrome]')?.getAttribute('data-incomplete')).toBe('');
    });

    it('renders N remote cursors from the reserved presence prop (proves the reservation, no transport)', () => {
        const { container } = render(
            <SelectionChrome
                nodeId="n1"
                remoteSelections={[
                    { ownerId: 'alice', ownerLabel: 'Alice', color: '#e11d48' },
                    { ownerId: 'bob' },
                ]}
                advisory
            >
                <Skin />
            </SelectionChrome>,
        );

        const cursors = container.querySelectorAll('[data-blockdoc-remote-cursor]');
        expect(cursors).toHaveLength(2);
        expect(cursors[0].getAttribute('data-owner-id')).toBe('alice');
        expect(cursors[0].getAttribute('aria-label')).toBe('Alice');
        expect(cursors[1].getAttribute('aria-label')).toBe('bob'); // falls back to ownerId
        expect(container.querySelector('[data-blockdoc-chrome]')?.getAttribute('data-remote-count')).toBe('2');
        expect(container.querySelector('[data-blockdoc-chrome]')?.getAttribute('data-advisory')).toBe('');
    });

    it('exposes the node id on the chrome wrapper (the selectedNodeId currency)', () => {
        const { container } = render(
            <SelectionChrome nodeId="abc-123">
                <Skin />
            </SelectionChrome>,
        );
        expect(container.querySelector('[data-blockdoc-chrome]')?.getAttribute('data-node-id')).toBe('abc-123');
    });
});
