/**
 * TypeScript mirror of the frozen blockdoc node-manifest format (v1). The server's
 * `block-schema:export-manifest` command emits this shape per profile; the client's
 * `assemblePMSchema` consumes it. JSON-schema payloads are deliberately kept loose
 * (`Record<string, unknown>`) — blockdoc only reads `properties` keys and their
 * `default`s; everything else passes through untouched.
 */

/** A JSON Schema node, kept structurally loose. */
export type JsonSchema = Record<string, unknown>;

/**
 * A per-category arity/mandatory constraint (B1). Declared on a parent node's
 * {@link NodeManifestEntry.childConstraints}, keyed by the child *category*.
 * Compiled into a quantified PM content expression (see `quantifierFor`):
 * `required`/`min` ≥ 1 → `+` or `{min,}`; `max` caps repetition (`?`, `{n}`,
 * `{min,max}`). Absent → the category keeps its default `*` (zero-or-more).
 * `reason` is an opaque string the shell *displays* (never parses) when a
 * negative affordance fires (e.g. "can't delete the last required child").
 */
export interface ChildConstraint {
    /** Minimum count of this category among the node's children. Default 0. */
    min?: number;
    /** Maximum count. Absent = unbounded. `max: 0` excludes the category. */
    max?: number;
    /** Sugar for `min: 1` — at least one is mandatory. */
    required?: boolean;
    /** Opaque human reason shown when this constraint blocks a gesture. */
    reason?: string;
}

/** Paste-coercion policy (05/B8). `reject` (default) refuses foreign structure;
 * `coerce` lets PM's slice-fitting reshape it, reported to the user. */
export type PastePolicy = 'reject' | 'coerce';

/** Node-level editability hints carried under the `x-editable` key (B1). The
 * attr-level half (`inline`/`pickable`) rides inside each attrsSchema property;
 * see {@link AttrEditable}. */
export interface NodeEditable {
    /** May instances be reordered among their siblings by direct manipulation? */
    reorderable?: boolean;
}

/** Attr-level editability hints, carried as an `x-editable` key inside a single
 * attrsSchema property (B1; read via `attrEditable`). */
export interface AttrEditable {
    /** Edit this attr inline on the canvas (not only in the inspector)? */
    inline?: boolean;
    /** Offer a picker for this attr (candidate set scoped by dereference)? */
    pickable?: boolean;
}

/** Widget presentation hints carried as an `x-widget-options` key inside an
 * attrsSchema property (B1; read via `attrWidgetOptions`). */
export interface AttrWidgetOptions {
    /** Render the inspector widget expanded by default. */
    expand?: boolean;
}

/**
 * One node declaration. `name` equals the server `#[NodeType]` name; `category`
 * (the server Block::category()) becomes the ProseMirror group; containment is
 * expressed by `admitsChildCategories` (the server Block::admitsChildCategories())
 * and compiled into a PM content expression unless `contentExpression` overrides.
 */
export interface NodeManifestEntry {
    /** PM node type name == server #[NodeType] name. */
    name: string;
    description?: string;
    /** From #[NodeType]->group; 'block' | 'inline'. Defaults to 'block'. */
    group?: string;
    /** Block::category(); becomes the PM group. Null = no category (untargetable). */
    category: string | null;
    /** Null = unconstrained; [] = leaf; list = category union. */
    admitsChildCategories: string[] | null;
    /** True → textblock (content 'inline*') when admitsChildCategories is null. */
    admitsText?: boolean;
    /**
     * Explicit escape hatch; overrides derivation when set. Allowed in profile
     * manifests, not only the base set (B1) — the profile-facing lever for
     * *ordering* (`heading paragraph+`), which `childConstraints` cannot express
     * because it governs per-category arity, not sequence.
     */
    contentExpression?: string | null;
    /**
     * Per-category arity/mandatory constraints (B1). Keyed by child category.
     * When present (and no `contentExpression` override), the union derivation
     * `(a | b)*` is replaced by a quantified *sequence* over
     * `admitsChildCategories` order — so declaring constraints also pins order;
     * use `contentExpression` for order without arity. Absent → union unchanged
     * (no regression). See {@link ChildConstraint}.
     */
    childConstraints?: Record<string, ChildConstraint>;
    /** Node-level editability hints (`x-editable`); see {@link NodeEditable}. */
    'x-editable'?: NodeEditable;
    /**
     * Hint mapping a bare child *category* to the wrapper node type to
     * synthesize when it is dropped somewhere that requires wrapping (B8's
     * derive-or-disable nest step). The shell carries it; it never guesses one.
     */
    nestWrappers?: Record<string, string>;
    /** Paste-coercion policy for foreign content (default `reject`). */
    pastePolicy?: PastePolicy;
    /** Opaque reason this node type is mandatory, shown (never parsed) as a
     * fallback when a parent constraint carries no `reason` of its own. */
    'x-required-reason'?: string;
    /** JSON Schema object over node attrs; `id` is always force-present. */
    attrsSchema?: JsonSchema;
}

/** One mark declaration. Attrs derive from `attrsSchema` (no forced id). */
export interface MarkManifestEntry {
    name: string;
    description?: string;
    attrsSchema?: JsonSchema;
    /** PM excludes; '' allows overlapping same-type marks. */
    excludes?: string;
}

/** What the document node admits — same semantics as node admitsChildCategories. */
export interface DocManifest {
    admitsChildCategories: string[] | null;
    /** Per-category arity/mandatory constraints on the doc's own children (B1);
     * same compilation as {@link NodeManifestEntry.childConstraints}. */
    childConstraints?: Record<string, ChildConstraint>;
}

/** A full profile manifest. */
export interface BlockdocManifest {
    /** Profile key, or 'base' for the vendored base set. */
    profile: string;
    /** Manifest format version. */
    version: number;
    /** Null/absent when the manifest doesn't own the doc node (e.g. the base set). */
    doc?: DocManifest | null;
    nodes: NodeManifestEntry[];
    marks?: MarkManifestEntry[];
}
