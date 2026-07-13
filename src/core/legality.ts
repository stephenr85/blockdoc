/**
 * The grammar-legality read API (B2) — a headless reader over an assembled
 * schema + its manifests that answers every "is this move legal, and if not
 * why?" question the prevent-first surface (B8) needs, plus the shell-owned
 * structural `completeness` read (08 §2). It computes against the ProseMirror
 * model only (no view, no DOM), so it is fully unit-testable and medium-agnostic.
 *
 * Position convention: every `pos` argument is the position *directly before*
 * the target node — exactly what `doc.descendants((node, pos) => …)` yields and
 * what a `NodeSelection` resolves from, so `doc.resolve(pos).nodeAfter` is the
 * node and `doc.resolve(pos).index()` its index in its parent.
 *
 * The structural checks (can this be deleted / duplicated / dropped here) ride
 * ProseMirror's own content-match machinery (`Node.canReplace*`), which already
 * enforces the richer content expressions B1 compiles from `childConstraints`.
 * The manifest index adds only what PM does not carry: the *reason* strings and
 * the required-minimums / required-attrs that drive `completeness`.
 */

import { NodeRange } from '@tiptap/pm/model';
import type { Node as PMNode, NodeType } from '@tiptap/pm/model';
import { liftTarget } from '@tiptap/pm/transform';
import type { BlockdocManifest, ChildConstraint } from './types';
import { collectManifestEntries } from './assemble';
import { requiredReason } from './fields';

/** A legality answer: whether the gesture is allowed and, if not, why (opaque). */
export interface Verdict {
    allowed: boolean;
    reason: string | null;
}

/** The shell-owned structural completeness read (08 §2) — medium-agnostic. */
export interface Completeness {
    /** Sum of every required-child minimum across the document. */
    requiredTotal: number;
    /** How many of those required slots are satisfied by a present, non-empty child. */
    requiredFilled: number;
    /** Ids of nodes that are structurally incomplete (missing a required child,
     * or present-but-empty while occupying a required slot). */
    incompleteNodeIds: string[];
}

/** Per-node manifest metadata PM's schema does not carry. */
interface NodeMeta {
    category: string | null;
    childConstraints: Record<string, ChildConstraint>;
    requiredAttrs: string[];
    requiredReason: string | null;
}

const ALLOWED: Verdict = { allowed: true, reason: null };

/** `required` is sugar for `min: 1`; the effective floor a category must meet. */
function effectiveMin(constraint: ChildConstraint | undefined): number {
    if (constraint === undefined) {
        return 0;
    }

    return constraint.required === true ? Math.max(1, constraint.min ?? 1) : (constraint.min ?? 0);
}

function isBlank(value: unknown): boolean {
    return value === null || value === undefined || value === '';
}

export interface LegalityReader {
    /** Categories that may be inserted at `pos` (the palette's candidate set). */
    insertableAt(doc: PMNode, pos: number): string[];
    /** May the node before `pos` be removed without violating its parent? */
    canDelete(doc: PMNode, pos: number): Verdict;
    /** May a copy of the node before `pos` be inserted after it (ceiling check)? */
    canDuplicate(doc: PMNode, pos: number): Verdict;
    /** May the node before `pos` be lifted one level out of its parent? */
    canUnnest(doc: PMNode, pos: number): Verdict;
    /** May the node before `from` move to the gap at `targetPos`? Guards BOTH
     * the target (does it accept?) and the SOURCE floor (does removing it keep
     * the source valid?) — a move is delete-here + insert-there (08). */
    canDragTo(doc: PMNode, from: number, targetPos: number): Verdict;
    /** The nearest insert position to `targetPos` that legally accepts the node
     * before `from`, or null if none (e.g. the source floor forbids the move). */
    nearestValidSlot(doc: PMNode, from: number, targetPos: number): number | null;
    /** Structural completeness of the whole document (shell-owned). */
    completeness(doc: PMNode): Completeness;
    /** Q7: is this node content-empty? Textblock/container → no content; leaf →
     * an unset required attr; plain atomic leaf → never empty. */
    isContentEmpty(node: PMNode): boolean;
    /** Does this node itself lack a required child (self-computable shortfall)? */
    isIncomplete(node: PMNode): boolean;
}

/**
 * Build a legality reader bound to a manifest composition (e.g. `[base,
 * profile]`). The reader is stateless per call — pass whichever `doc` you are
 * asking about.
 */
export function createLegalityReader(manifest: BlockdocManifest | BlockdocManifest[]): LegalityReader {
    const manifests = Array.isArray(manifest) ? manifest : [manifest];
    const { doc: docManifest, nodeEntries } = collectManifestEntries(manifests);

    const metaByName = new Map<string, NodeMeta>();
    const entryByName = new Map(nodeEntries.map((entry) => [entry.name, entry]));

    for (const entry of nodeEntries) {
        const required = (entry.attrsSchema?.required as string[] | undefined) ?? [];

        metaByName.set(entry.name, {
            category: entry.category,
            childConstraints: entry.childConstraints ?? {},
            requiredAttrs: required,
            requiredReason: entry['x-required-reason'] ?? null,
        });
    }

    // The doc node has no manifest entry; synthesize its meta from DocManifest.
    metaByName.set('doc', {
        category: null,
        childConstraints: docManifest.childConstraints ?? {},
        requiredAttrs: [],
        requiredReason: null,
    });

    const categoryOf = (name: string): string | null => metaByName.get(name)?.category ?? null;
    const constraintsOf = (name: string): Record<string, ChildConstraint> =>
        metaByName.get(name)?.childConstraints ?? {};

    function isContentEmpty(node: PMNode): boolean {
        const meta = metaByName.get(node.type.name);

        for (const attr of meta?.requiredAttrs ?? []) {
            if (isBlank(node.attrs[attr])) {
                return true;
            }
        }

        // A pure atomic leaf (no content, no required attrs) is complete by presence.
        if (node.type.isLeaf) {
            return false;
        }

        return node.content.size === 0;
    }

    /** Every category → present count and non-empty count among a node's children. */
    function tallyChildren(node: PMNode): Map<string, { present: number; filled: number; emptyIds: string[] }> {
        const tally = new Map<string, { present: number; filled: number; emptyIds: string[] }>();

        node.forEach((child) => {
            const category = categoryOf(child.type.name);

            if (category === null) {
                return;
            }

            const bucket = tally.get(category) ?? { present: 0, filled: 0, emptyIds: [] };
            bucket.present += 1;

            if (isContentEmpty(child)) {
                const id = child.attrs.id;

                if (typeof id === 'string') {
                    bucket.emptyIds.push(id);
                }
            } else {
                bucket.filled += 1;
            }

            tally.set(category, bucket);
        });

        return tally;
    }

    function isIncomplete(node: PMNode): boolean {
        const constraints = constraintsOf(node.type.name);
        const tally = tallyChildren(node);

        for (const [category, constraint] of Object.entries(constraints)) {
            const min = effectiveMin(constraint);

            if (min > 0 && (tally.get(category)?.filled ?? 0) < min) {
                return true;
            }
        }

        return false;
    }

    function completeness(doc: PMNode): Completeness {
        let requiredTotal = 0;
        let requiredFilled = 0;
        const incompleteNodeIds = new Set<string>();

        const visit = (node: PMNode): void => {
            const constraints = constraintsOf(node.type.name);
            const tally = tallyChildren(node);

            for (const [category, constraint] of Object.entries(constraints)) {
                const min = effectiveMin(constraint);

                if (min <= 0) {
                    continue;
                }

                const bucket = tally.get(category) ?? { present: 0, filled: 0, emptyIds: [] };
                requiredTotal += min;
                requiredFilled += Math.min(bucket.filled, min);

                if (bucket.filled < min) {
                    const id = node.attrs.id;

                    if (typeof id === 'string') {
                        incompleteNodeIds.add(id);
                    }

                    // Present-but-empty children of a required category are themselves incomplete.
                    for (const emptyId of bucket.emptyIds) {
                        incompleteNodeIds.add(emptyId);
                    }
                }
            }

            node.forEach((child) => visit(child));
        };

        visit(doc);

        return { requiredTotal, requiredFilled, incompleteNodeIds: [...incompleteNodeIds] };
    }

    function insertableAt(doc: PMNode, pos: number): string[] {
        const $pos = doc.resolve(pos);
        const parent = $pos.parent;
        const index = $pos.index();
        const categories: string[] = [];

        for (const type of Object.values(doc.type.schema.nodes) as NodeType[]) {
            if (type.name === 'doc' || type.name === 'text' || type.isText) {
                continue;
            }

            if (parent.canReplaceWith(index, index, type)) {
                const category = categoryOf(type.name);
                const label = category ?? type.name;

                if (! categories.includes(label)) {
                    categories.push(label);
                }
            }
        }

        return categories;
    }

    /** The reason a required-category floor blocks removing `node` from `parent`. */
    function floorReason(parent: PMNode, node: PMNode): string {
        const category = categoryOf(node.type.name);
        const constraint = category !== null ? constraintsOf(parent.type.name)[category] : undefined;
        const min = effectiveMin(constraint);
        const named = requiredReason(constraint, entryByName.get(node.type.name));

        return named ?? `at least ${min} ${category ?? node.type.name} required`;
    }

    function canDelete(doc: PMNode, pos: number): Verdict {
        const $pos = doc.resolve(pos);
        const node = $pos.nodeAfter;

        if (node === null) {
            return { allowed: false, reason: 'no node at position' };
        }

        const index = $pos.index();

        if ($pos.parent.canReplace(index, index + 1)) {
            return ALLOWED;
        }

        return { allowed: false, reason: floorReason($pos.parent, node) };
    }

    function canDuplicate(doc: PMNode, pos: number): Verdict {
        const $pos = doc.resolve(pos);
        const node = $pos.nodeAfter;

        if (node === null) {
            return { allowed: false, reason: 'no node at position' };
        }

        const index = $pos.index();

        if ($pos.parent.canReplaceWith(index + 1, index + 1, node.type, node.marks)) {
            return ALLOWED;
        }

        const category = categoryOf(node.type.name);
        const constraint = category !== null ? constraintsOf($pos.parent.type.name)[category] : undefined;
        const ceiling = constraint?.max;
        const reason = ceiling !== undefined
            ? `at most ${ceiling} ${category ?? node.type.name} allowed`
            : 'cannot duplicate here';

        return { allowed: false, reason };
    }

    function canUnnest(doc: PMNode, pos: number): Verdict {
        const $pos = doc.resolve(pos);
        const node = $pos.nodeAfter;

        if (node === null) {
            return { allowed: false, reason: 'no node at position' };
        }

        // A block range spanning just this node; lifting moves it up one level.
        const $start = doc.resolve(pos + 1);
        const $end = doc.resolve(pos + node.nodeSize - 1);
        const range = new NodeRange($start, $end, $pos.depth + 1);

        if (liftTarget(range) === null) {
            return { allowed: false, reason: 'nothing to unnest into here' };
        }

        return ALLOWED;
    }

    function canDragTo(doc: PMNode, from: number, targetPos: number): Verdict {
        const $from = doc.resolve(from);
        const node = $from.nodeAfter;

        if (node === null) {
            return { allowed: false, reason: 'no node at source' };
        }

        // Source floor: removing the node from its current parent must stay valid.
        if (! $from.parent.canReplace($from.index(), $from.index() + 1)) {
            return { allowed: false, reason: floorReason($from.parent, node) };
        }

        const $target = doc.resolve(targetPos);

        if (! $target.parent.canReplaceWith($target.index(), $target.index(), node.type, node.marks)) {
            return { allowed: false, reason: 'not a valid slot for this block' };
        }

        return ALLOWED;
    }

    function nearestValidSlot(doc: PMNode, from: number, targetPos: number): number | null {
        const $from = doc.resolve(from);
        const node = $from.nodeAfter;

        if (node === null) {
            return null;
        }

        // Source floor forbids the move entirely → no slot is valid.
        if (! $from.parent.canReplace($from.index(), $from.index() + 1)) {
            return null;
        }

        let best: number | null = null;
        let bestDistance = Infinity;

        for (let candidate = 0; candidate <= doc.content.size; candidate += 1) {
            let $candidate;

            try {
                $candidate = doc.resolve(candidate);
            } catch {
                continue;
            }

            if (! $candidate.parent.canReplaceWith($candidate.index(), $candidate.index(), node.type, node.marks)) {
                continue;
            }

            const distance = Math.abs(candidate - targetPos);

            if (distance < bestDistance) {
                best = candidate;
                bestDistance = distance;
            }
        }

        return best;
    }

    return {
        insertableAt,
        canDelete,
        canDuplicate,
        canUnnest,
        canDragTo,
        nearestValidSlot,
        completeness,
        isContentEmpty,
        isIncomplete,
    };
}
