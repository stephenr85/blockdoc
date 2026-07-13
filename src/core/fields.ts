/**
 * Readers for the manifest extension keywords landed in B1. The manifest keeps
 * attrsSchema deliberately loose (`Record<string, unknown>`) so the assembler
 * never has to understand attr semantics; these accessors are the *typed door*
 * the editor surface (B2 legality, B8 affordances, B12 array widget) reads
 * through instead of reaching into raw JSON. Every reader is total and
 * defensive: a malformed or absent key yields the neutral default, never throws.
 */

import type { AttrEditable, AttrWidgetOptions, ChildConstraint, NodeEditable, NodeManifestEntry } from './types';

/** A single attrsSchema `properties` entry, kept loose like the schema itself. */
export type PropertySchema = Record<string, unknown>;

function asObject(value: unknown): Record<string, unknown> | undefined {
    return typeof value === 'object' && value !== null && ! Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
    return typeof value === 'boolean' ? value : undefined;
}

/** The `x-editable` object on a node manifest entry (node-level: reorderable). */
export function nodeEditable(entry: NodeManifestEntry): NodeEditable {
    return entry['x-editable'] ?? {};
}

/** Whether a node's instances may be reordered among siblings (`x-editable.reorderable`). */
export function isReorderable(entry: NodeManifestEntry): boolean {
    return nodeEditable(entry).reorderable === true;
}

/**
 * The reason string a negative affordance should display for a required child
 * of `category` under `entry`: the constraint's own `reason` wins, else the
 * child node type's `x-required-reason` (looked up via `childEntry`), else null.
 */
export function requiredReason(
    constraint: ChildConstraint | undefined,
    childEntry?: NodeManifestEntry,
): string | null {
    return constraint?.reason ?? childEntry?.['x-required-reason'] ?? null;
}

/** The `x-editable` object inside a single attrsSchema property (attr-level). */
export function attrEditable(property: PropertySchema | undefined): AttrEditable {
    const raw = asObject(property?.['x-editable']);

    if (raw === undefined) {
        return {};
    }

    return {
        inline: asBoolean(raw.inline),
        pickable: asBoolean(raw.pickable),
    };
}

/**
 * The `x-dereference-target` on an attr property — the category/type name whose
 * instances scope a picker's candidate set (a reference edge, 02/09). Null when
 * the attr is not a scoped reference.
 */
export function attrDereferenceTarget(property: PropertySchema | undefined): string | null {
    const target = property?.['x-dereference-target'];

    return typeof target === 'string' ? target : null;
}

/**
 * Whether an attr is a `pick-many` multi-reference (array of edges, 09 G1) —
 * true when the property declares `pick-many: true`, or is an array whose items
 * carry an `x-dereference-target`.
 */
export function attrIsPickMany(property: PropertySchema | undefined): boolean {
    if (asBoolean(property?.['pick-many']) === true) {
        return true;
    }

    if (property?.type === 'array') {
        return attrDereferenceTarget(asObject(property.items)) !== null;
    }

    return false;
}

/** The `x-widget-options` presentation hints on an attr property. */
export function attrWidgetOptions(property: PropertySchema | undefined): AttrWidgetOptions {
    const raw = asObject(property?.['x-widget-options']);

    if (raw === undefined) {
        return {};
    }

    return { expand: asBoolean(raw.expand) };
}
