import type { CSSProperties, ReactNode } from 'react';

/**
 * The uniform selection-chrome primitive (B3) — row 2 of the four-part render
 * model (06). It draws the *same* ring / handle / badge / outline around ANY
 * skin (a registered NodeView or the neutral fallback), so a skin ships **zero
 * chrome code**: the shell owns selection, the skin owns only its resting look.
 * It is grammar-blind and medium-agnostic (it rides `selectedNodeId` + B2's
 * completeness flags, never the document model), which is what lets rows 2 + 4
 * generalize across media while rows 1 + 3 stay PM-specific.
 *
 * The contract is **plural from day one** so it doubles as the collaboration
 * presence reservation (10, = 06's chrome extraction): `remoteSelections` and
 * `advisory` are rendered but wired to nothing — no transport exists yet. When
 * collab lands, the realtime channel (never the document — see
 * `lock-and-presence-state-lives-in-transport`) fills these props.
 */
export interface RemoteSelection {
    /** Stable id of the participant holding this remote selection. */
    ownerId: string;
    /** Human label to show on the cursor (falls back to `ownerId`). */
    ownerLabel?: string;
    /** Presentation color for the cursor/ring (host-assigned per participant). */
    color?: string;
}

export interface SelectionChromeProps {
    /** Stable id of the node this chrome wraps (the `selectedNodeId` currency). */
    nodeId: string;
    /** Is this node the local user's current selection? Draws the ring + handle. */
    localSelected?: boolean;
    /** Remote participants selecting this node (reserved; renders N cursors). */
    remoteSelections?: RemoteSelection[];
    /** Advisory soft-lock presence (reserved; decoration only, never a gate). */
    advisory?: boolean;
    /** Grammar-required node (08) — draws the required badge. */
    required?: boolean;
    /** Structurally incomplete per B2 completeness — draws the incomplete outline. */
    incomplete?: boolean;
    /** The skin (row 1) or fallback card this chrome is drawn around. */
    children: ReactNode;
}

const RING_STYLE: CSSProperties = {
    position: 'absolute',
    inset: -2,
    borderRadius: 6,
    border: '2px solid #2563eb',
    pointerEvents: 'none',
};

const HANDLE_STYLE: CSSProperties = {
    position: 'absolute',
    top: -2,
    left: -18,
    width: 14,
    height: 14,
    cursor: 'grab',
    color: '#71717a',
};

const REQUIRED_BADGE_STYLE: CSSProperties = {
    position: 'absolute',
    top: -8,
    right: -6,
    fontSize: 9,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    color: '#b91c1c',
    background: '#fee2e2',
    borderRadius: 4,
    padding: '1px 4px',
    pointerEvents: 'none',
};

const INCOMPLETE_OUTLINE_STYLE: CSSProperties = {
    position: 'absolute',
    inset: -2,
    borderRadius: 6,
    border: '2px dashed #d97706',
    pointerEvents: 'none',
};

/**
 * Draw the shell selection chrome around a skin. All decoration is
 * `pointer-events: none` and absolutely positioned so the wrapped skin keeps
 * its own layout and interaction untouched.
 */
export function SelectionChrome({
    nodeId,
    localSelected = false,
    remoteSelections = [],
    advisory = false,
    required = false,
    incomplete = false,
    children,
}: SelectionChromeProps) {
    return (
        <div
            data-blockdoc-chrome=""
            data-node-id={nodeId}
            data-selected={localSelected ? '' : undefined}
            data-advisory={advisory ? '' : undefined}
            data-required={required ? '' : undefined}
            data-incomplete={incomplete ? '' : undefined}
            data-remote-count={remoteSelections.length}
            style={{ position: 'relative' }}
        >
            {children}

            {incomplete && <div data-blockdoc-incomplete-outline="" style={INCOMPLETE_OUTLINE_STYLE} />}

            {localSelected && (
                <>
                    <div data-blockdoc-selection-ring="" style={RING_STYLE} />
                    <span data-blockdoc-drag-handle="" style={HANDLE_STYLE} aria-label="Drag to reorder">
                        ⠿
                    </span>
                </>
            )}

            {required && (
                <span data-blockdoc-required-badge="" style={REQUIRED_BADGE_STYLE}>
                    required
                </span>
            )}

            {remoteSelections.map((selection) => (
                <div
                    key={selection.ownerId}
                    data-blockdoc-remote-cursor=""
                    data-owner-id={selection.ownerId}
                    aria-label={selection.ownerLabel ?? selection.ownerId}
                    style={{
                        position: 'absolute',
                        inset: -2,
                        borderRadius: 6,
                        border: `2px solid ${selection.color ?? '#9333ea'}`,
                        opacity: 0.5,
                        pointerEvents: 'none',
                    }}
                />
            ))}
        </div>
    );
}
