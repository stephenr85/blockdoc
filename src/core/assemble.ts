import { Schema } from 'prosemirror-model';
import type { AttributeSpec, MarkSpec, NodeSpec } from 'prosemirror-model';
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
 */
function attrsFromSchema(attrsSchema: JsonSchema | undefined, forceId: boolean): Record<string, AttributeSpec> {
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

/**
 * Derive a node's content expression (rules 1-3). Returns undefined for leaves.
 *
 * 1. `contentExpression` set → verbatim.
 * 2. `admitsChildCategories` list → `(catA | catB)*`; empty list → leaf.
 * 3. null → `admitsText` ? 'inline*' : leaf.
 */
function contentExpressionFor(entry: {
    admitsChildCategories: string[] | null;
    admitsText?: boolean;
    contentExpression?: string | null;
}): string | undefined {
    if (entry.contentExpression != null && entry.contentExpression !== '') {
        return entry.contentExpression;
    }

    if (entry.admitsChildCategories !== null) {
        if (entry.admitsChildCategories.length === 0) {
            return undefined;
        }

        return `(${entry.admitsChildCategories.join(' | ')})*`;
    }

    return entry.admitsText ? 'inline*' : undefined;
}

function nodeSpecFor(entry: NodeManifestEntry): NodeSpec {
    const spec: NodeSpec = {
        attrs: attrsFromSchema(entry.attrsSchema, true),
    };

    // Rule 4: the PM group is the category — that is how content expressions
    // target nodes. Inline nodes additionally join the 'inline' group so the
    // rule-3 'inline*' expression (and PM's inline-content machinery) sees them.
    const groups: string[] = [];

    if (entry.group === 'inline') {
        spec.inline = true;
        groups.push('inline');
    }

    if (entry.category !== null) {
        groups.push(entry.category);
    }

    if (groups.length > 0) {
        spec.group = groups.join(' ');
    }

    const content = contentExpressionFor(entry);

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
 * (e.g. `[base, profile]`). Merging: nodes and marks concatenate — a later
 * manifest may NOT redeclare an existing name (throws); the last manifest with
 * a non-null `doc` wins. Exactly one manifest must provide a `doc`.
 */
export function assemblePMSchema(manifest: BlockdocManifest | BlockdocManifest[]): Schema {
    const manifests = Array.isArray(manifest) ? manifest : [manifest];

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

    // Rule 6: the doc node's content derives from doc.admitsChildCategories by
    // rules 2/3 (a doc never admits raw text, so null compiles to a leaf doc).
    const docSpec: NodeSpec = {};
    const docContent = contentExpressionFor({ admitsChildCategories: doc.admitsChildCategories });

    if (docContent !== undefined) {
        docSpec.content = docContent;
    }

    const nodes: Record<string, NodeSpec> = { doc: docSpec };

    for (const entry of nodeEntries) {
        nodes[entry.name] = nodeSpecFor(entry);
    }

    // Rule 7: the text node is implicit; manifests never declare it.
    nodes.text = { group: 'inline' };

    const marks: Record<string, MarkSpec> = {};

    for (const entry of markEntries) {
        marks[entry.name] = markSpecFor(entry);
    }

    return new Schema({ nodes, marks, topNode: 'doc' });
}
