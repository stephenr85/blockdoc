import { Schema } from 'prosemirror-model';
import type { DOMOutputSpec, MarkSpec, Node as PMNode, NodeSpec, Mark } from 'prosemirror-model';
import { NODE_ID_ATTR } from '../core';

/**
 * The core assembler is deliberately render-free (manifests describe
 * structure, not presentation), but an EditorView needs toDOM/parseDOM for
 * every node rendered natively. This wraps an assembled schema with editing
 * DOM: semantic elements for the base prose set, and a generic
 * `div[data-node-type]` for typed blocks (which normally render through
 * NodeViews anyway — the generic toDOM also serves clipboard serialization).
 * Specs that already carry toDOM/parseDOM are left untouched.
 */
export function withEditingDOM(schema: Schema): Schema {
    const nodes: Record<string, NodeSpec> = {};
    schema.spec.nodes.forEach((name: string, spec: NodeSpec) => {
        nodes[name] = name === 'text' || name === 'doc' ? spec : withNodeDOM(name, spec);
    });

    const marks: Record<string, MarkSpec> = {};
    schema.spec.marks.forEach((name: string, spec: MarkSpec) => {
        marks[name] = withMarkDOM(name, spec);
    });

    return new Schema({ nodes, marks, topNode: schema.spec.topNode });
}

function idAttrs(node: PMNode): Record<string, string> {
    const id = node.attrs[NODE_ID_ATTR];

    return typeof id === 'string' && id !== '' ? { 'data-node-id': id } : {};
}

function parseId(dom: HTMLElement): Record<string, unknown> {
    return { [NODE_ID_ATTR]: dom.getAttribute('data-node-id') };
}

function withNodeDOM(name: string, spec: NodeSpec): NodeSpec {
    const next = { ...spec };

    if (next.toDOM === undefined) {
        next.toDOM = nodeToDOM(name, spec);
    }

    if (next.parseDOM === undefined) {
        next.parseDOM = nodeParseDOM(name, spec);
    }

    return next;
}

function nodeToDOM(name: string, spec: NodeSpec): (node: PMNode) => DOMOutputSpec {
    switch (name) {
        case 'paragraph':
            return (node) => ['p', idAttrs(node), 0];
        case 'heading':
            return (node) => [`h${clampLevel(node.attrs.level)}`, idAttrs(node), 0];
        case 'blockquote':
            return (node) => ['blockquote', idAttrs(node), 0];
        case 'bullet_list':
            return (node) => ['ul', idAttrs(node), 0];
        case 'ordered_list':
            return (node) => ['ol', idAttrs(node), 0];
        case 'list_item':
            return (node) => ['li', idAttrs(node), 0];
        case 'code_block':
            return (node) => ['pre', idAttrs(node), ['code', 0]];
        case 'horizontal_rule':
            return (node) => ['hr', idAttrs(node)];
        case 'hard_break':
            return () => ['br'];
        default: {
            const hasContent = spec.content !== undefined && spec.content !== '';
            const tag = spec.inline === true ? 'span' : 'div';

            return (node) =>
                hasContent
                    ? [tag, { 'data-node-type': name, ...idAttrs(node) }, 0]
                    : [tag, { 'data-node-type': name, ...idAttrs(node) }];
        }
    }
}

function nodeParseDOM(name: string, spec: NodeSpec): NodeSpec['parseDOM'] {
    switch (name) {
        case 'paragraph':
            return [{ tag: 'p', getAttrs: parseId }];
        case 'heading':
            return [1, 2, 3, 4, 5, 6].map((level) => ({
                tag: `h${level}`,
                getAttrs: (dom: HTMLElement) => ({ ...parseId(dom), level }),
            }));
        case 'blockquote':
            return [{ tag: 'blockquote', getAttrs: parseId }];
        case 'bullet_list':
            return [{ tag: 'ul', getAttrs: parseId }];
        case 'ordered_list':
            return [{ tag: 'ol', getAttrs: parseId }];
        case 'list_item':
            return [{ tag: 'li', getAttrs: parseId }];
        case 'code_block':
            return [{ tag: 'pre', preserveWhitespace: 'full', getAttrs: parseId }];
        case 'horizontal_rule':
            return [{ tag: 'hr', getAttrs: parseId }];
        case 'hard_break':
            return [{ tag: 'br' }];
        default: {
            const tag = spec.inline === true ? 'span' : 'div';

            return [{ tag: `${tag}[data-node-type="${name}"]`, getAttrs: parseId }];
        }
    }
}

function clampLevel(level: unknown): number {
    return typeof level === 'number' && level >= 1 && level <= 6 ? level : 1;
}

function withMarkDOM(name: string, spec: MarkSpec): MarkSpec {
    const next = { ...spec };

    if (next.toDOM === undefined) {
        next.toDOM = markToDOM(name);
    }

    if (next.parseDOM === undefined) {
        next.parseDOM = markParseDOM(name);
    }

    return next;
}

function markToDOM(name: string): (mark: Mark) => DOMOutputSpec {
    switch (name) {
        case 'strong':
            return () => ['strong', 0];
        case 'em':
            return () => ['em', 0];
        case 'code':
            return () => ['code', 0];
        case 'link':
            return (mark) => ['a', { href: String(mark.attrs.href ?? '') }, 0];
        case 'annotation':
            return (mark) => {
                const id = mark.attrs[NODE_ID_ATTR];

                return [
                    'span',
                    typeof id === 'string' && id !== ''
                        ? { 'data-annotation-id': id }
                        : { 'data-annotation': '' },
                    0,
                ];
            };
        default:
            return () => ['span', { 'data-mark': name }, 0];
    }
}

function markParseDOM(name: string): MarkSpec['parseDOM'] {
    switch (name) {
        case 'strong':
            return [{ tag: 'strong' }, { tag: 'b' }];
        case 'em':
            return [{ tag: 'em' }, { tag: 'i' }];
        case 'code':
            return [{ tag: 'code' }];
        case 'link':
            return [
                {
                    tag: 'a[href]',
                    getAttrs: (dom: HTMLElement) => ({ href: dom.getAttribute('href') }),
                },
            ];
        case 'annotation':
            return [
                {
                    tag: 'span[data-annotation-id]',
                    getAttrs: (dom: HTMLElement) => ({
                        [NODE_ID_ATTR]: dom.getAttribute('data-annotation-id'),
                    }),
                },
            ];
        default:
            return [{ tag: `span[data-mark="${name}"]` }];
    }
}
