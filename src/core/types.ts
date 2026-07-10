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
    /** Explicit escape hatch (base set only); overrides derivation when set. */
    contentExpression?: string | null;
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
