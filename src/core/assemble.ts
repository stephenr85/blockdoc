import { Schema } from '@tiptap/pm/model';
import type { AttributeSpec, MarkSpec, NodeSpec } from '@tiptap/pm/model';
import type { BlockdocManifest, DocManifest, JsonSchema, MarkManifestEntry, NodeManifestEntry } from './types';
import { NODE_ID_ATTR } from './ids';

/**
 * Names owned by the assembler itself: `doc` is synthesized from the manifest's
 * `doc` entry and `text` is implicit (rule 7) — manifests never declare either.
 */
const RESERVED_NODE_NAMES = ['doc', 'text'];

/**
 * Derive a PM attrs spec from a manifest attrsSchema (rule 5): one attr per
 * `properties` key, each `{ default: schema.default ?? null }`. When `forceId`
 * is set (nodes, not marks), `id` is present even if the schema omits it.
 *
 * Exported as a derivation piece: the Tiptap extension generator consumes the
 * same rule so the manifest compilation lives exactly once.
 */
export function attrsFromSchema(attrsSchema: JsonSchema | undefined, forceId: boolean): Record<string, AttributeSpec> {
    const attrs: Record<string, AttributeSpec> = {};

    if (forceId) {
        attrs[NODE_ID_ATTR] = { default: null };
    }

    const properties = (attrsSchema?.properties ?? {}) as Record<string, JsonSchema | undefined>;

    for (const [name, propertySchema] of Object.entries(properties)) {
        attrs[name] = { default: propertySchema?.default ?? null };
    }

    return attrs;
}

/** The containment subset of a manifest entry {@link contentExpressionFor} reads. */
export interface ContainmentDeclaration {
    admitsChildCategories: string[] | null;
    admitsText?: boolean;
    contentExpression?: string | null;
}

/**
 * Derive a node's content expression (rules 1-3). Returns undefined for leaves.
 *
 * 1. `contentExpression` set → verbatim.
 * 2. `admitsChildCategories` list → `(catA | catB)*`; empty list → leaf.
 * 3. null → `admitsText` ? 'inline*' : UNCONSTRAINED — the server's
 *    `admitsChildCategories() === null` means "admits anything"
 *    (Block::withContent enforces nothing), so the faithful compilation is the
 *    union of every block category the composed manifests declare. With no
 *    categories at all it degrades to a leaf.
 *
 * Exported as a derivation piece (shared with the Tiptap extension generator).
 */
export function contentExpressionFor(
    entry: ContainmentDeclaration,
    allCategories: readonly string[],
): string | undefined {
    if (entry.contentExpression != null && entry.contentExpression !== '') {
        return entry.contentExpression;
    }

    if (entry.admitsChildCategories !== null) {
        if (entry.admitsChildCategories.length === 0) {
            return undefined;
        }

        return `(${entry.admitsChildCategories.join(' | ')})*`;
    }

    if (entry.admitsText) {
        return 'inline*';
    }

    if (allCategories.length === 0) {
        return undefined;
    }

    return `(${allCategories.join(' | ')})*`;
}

/**
 * Rule 4: the PM groups a node joins — its category (that is how content
 * expressions target nodes), and 'inline' first for inline nodes so the
 * rule-3 'inline*' expression (and PM's inline-content machinery) sees them.
 *
 * Exported as a derivation piece (shared with the Tiptap extension generator).
 */
export function groupsFor(entry: NodeManifestEntry): string[] {
    const groups: string[] = [];

    if (entry.group === 'inline') {
        groups.push('inline');
    }

    if (entry.category !== null) {
        groups.push(entry.category);
    }

    return groups;
}

/** The merged declarations of an ordered manifest composition. */
export interface CollectedManifestEntries {
    doc: DocManifest;
    nodeEntries: NodeManifestEntry[];
    markEntries: MarkManifestEntry[];
}

/**
 * Merge an ordered manifest composition (e.g. `[base, profile]`): nodes and
 * marks concatenate — a later manifest may NOT redeclare an existing name
 * (throws); the last manifest with a non-null `doc` wins. Exactly one manifest
 * must provide a `doc`.
 *
 * Exported as a derivation piece (shared with the Tiptap extension generator).
 */
export function collectManifestEntries(manifests: readonly BlockdocManifest[]): CollectedManifestEntries {
    let doc: DocManifest | null = null;
    const nodeEntries: NodeManifestEntry[] = [];
    const markEntries: MarkManifestEntry[] = [];
    const seenNodes = new Set<string>(RESERVED_NODE_NAMES);
    const seenMarks = new Set<string>();

    for (const current of manifests) {
        if (current.doc != null) {
            doc = current.doc;
        }

        for (const node of current.nodes) {
            if (seenNodes.has(node.name)) {
                throw new Error(`blockdoc: node "${node.name}" is already declared; manifests may not redeclare node names.`);
            }

            seenNodes.add(node.name);
            nodeEntries.push(node);
        }

        for (const mark of current.marks ?? []) {
            if (seenMarks.has(mark.name)) {
                throw new Error(`blockdoc: mark "${mark.name}" is already declared; manifests may not redeclare mark names.`);
            }

            seenMarks.add(mark.name);
            markEntries.push(mark);
        }
    }

    if (doc === null) {
        throw new Error('blockdoc: no manifest declares a doc; at least one manifest must carry a non-null "doc" entry.');
    }

    return { doc, nodeEntries, markEntries };
}

/**
 * Every block category the composed manifests declare, in declaration order —
 * the compilation target for unconstrained (null) admits.
 *
 * Exported as a derivation piece (shared with the Tiptap extension generator).
 */
export function allBlockCategories(nodeEntries: readonly NodeManifestEntry[]): string[] {
    const allCategories: string[] = [];

    for (const entry of nodeEntries) {
        if (entry.group !== 'inline' && entry.category !== null && ! allCategories.includes(entry.category)) {
            allCategories.push(entry.category);
        }
    }

    return allCategories;
}

function nodeSpecFor(entry: NodeManifestEntry, allCategories: readonly string[]): NodeSpec {
    const spec: NodeSpec = {
        attrs: attrsFromSchema(entry.attrsSchema, true),
    };

    if (entry.group === 'inline') {
        spec.inline = true;
    }

    const groups = groupsFor(entry);

    if (groups.length > 0) {
        spec.group = groups.join(' ');
    }

    const content = contentExpressionFor(entry, allCategories);

    if (content !== undefined) {
        spec.content = content;
    }

    if (entry.description !== undefined) {
        spec.description = entry.description;
    }

    return spec;
}

function markSpecFor(entry: MarkManifestEntry): MarkSpec {
    const spec: MarkSpec = {};

    const attrs = attrsFromSchema(entry.attrsSchema, false);

    if (Object.keys(attrs).length > 0) {
        spec.attrs = attrs;
    }

    // Rule 8: pass through when present — including '' (overlap-allowing).
    if (entry.excludes !== undefined) {
        spec.excludes = entry.excludes;
    }

    return spec;
}

/**
 * Assemble a ProseMirror Schema from one manifest or an ordered array of them
 * (e.g. `[base, profile]`). Merging per {@link collectManifestEntries}. This
 * stays the conformance ORACLE: the Tiptap extension generator derives from
 * the same exported pieces, and the schema-parity test pins both compilations
 * to the same acceptance behavior.
 */
export function assemblePMSchema(manifest: BlockdocManifest | BlockdocManifest[]): Schema {
    const manifests = Array.isArray(manifest) ? manifest : [manifest];
    const { doc, nodeEntries, markEntries } = collectManifestEntries(manifests);
    const allCategories = allBlockCategories(nodeEntries);

    // Rule 6: the doc node's content derives from doc.admitsChildCategories by
    // rules 2/3 (a doc never admits raw text; null means unconstrained).
    const docSpec: NodeSpec = {};
    const docContent = contentExpressionFor({ admitsChildCategories: doc.admitsChildCategories }, allCategories);

    if (docContent !== undefined) {
        docSpec.content = docContent;
    }

    const nodes: Record<string, NodeSpec> = { doc: docSpec };

    for (const entry of nodeEntries) {
        nodes[entry.name] = nodeSpecFor(entry, allCategories);
    }

    // Rule 7: the text node is implicit; manifests never declare it.
    nodes.text = { group: 'inline' };

    const marks: Record<string, MarkSpec> = {};

    for (const entry of markEntries) {
        marks[entry.name] = markSpecFor(entry);
    }

    return new Schema({ nodes, marks, topNode: 'doc' });
}
