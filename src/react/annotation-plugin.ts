import type { Mark, Node as PMNode } from 'prosemirror-model';
import { Plugin, PluginKey } from 'prosemirror-state';
import { generateNodeId } from '../core/ids';

/**
 * Annotation-mark id integrity (splicewire-editor issue 09). The `annotation`
 * mark (base manifest; `excludes: ''` so distinct annotations may overlap)
 * carries an `id` attr addressing span-level bindings — the SQL graph is
 * authoritative, mark ids are a location index. Distinct ids already prevent
 * ProseMirror's adjacent-mark merging; an id legitimately becomes multi-range
 * after a split, so resolvers return ALL ranges for an id. What integrity has
 * to enforce is existence: an annotation mark must never live without an id
 * (paste from external sources, programmatic marks) — this plugin assigns one
 * in an appendTransaction.
 */

export const ANNOTATION_MARK_NAME = 'annotation';

export const annotationIntegrityKey = new PluginKey('blockdoc-annotation-integrity');

function annotationMarksOf(node: PMNode): Mark[] {
    return node.marks.filter((mark) => mark.type.name === ANNOTATION_MARK_NAME);
}

export function annotationIntegrityPlugin(): Plugin {
    return new Plugin({
        key: annotationIntegrityKey,
        appendTransaction(transactions, _oldState, newState) {
            if (!transactions.some((tr) => tr.docChanged)) {
                return null;
            }
            if (!newState.schema.marks[ANNOTATION_MARK_NAME]) {
                return null;
            }

            const tr = newState.tr;
            let changed = false;

            newState.doc.descendants((node, pos) => {
                for (const mark of annotationMarksOf(node)) {
                    if (mark.attrs.id == null) {
                        const markType = newState.schema.marks[ANNOTATION_MARK_NAME];
                        tr.removeMark(pos, pos + node.nodeSize, mark);
                        tr.addMark(
                            pos,
                            pos + node.nodeSize,
                            markType.create({ ...mark.attrs, id: generateNodeId() }),
                        );
                        changed = true;
                    }
                }
                return true;
            });

            return changed ? tr : null;
        },
    });
}

export interface AnnotationRange {
    from: number;
    to: number;
}

/**
 * Every range the annotation id covers, in document order. A split annotation
 * (an id spanning discontiguous text after edits) yields multiple ranges;
 * adjacent same-id leaves coalesce into one.
 */
export function annotationRanges(doc: PMNode, id: string): AnnotationRange[] {
    const ranges: AnnotationRange[] = [];

    doc.descendants((node, pos) => {
        const marked = annotationMarksOf(node).some((mark) => mark.attrs.id === id);
        if (!marked) {
            return true;
        }

        const from = pos;
        const to = pos + node.nodeSize;
        const last = ranges[ranges.length - 1];

        if (last && last.to === from) {
            last.to = to;
        } else {
            ranges.push({ from, to });
        }

        return true;
    });

    return ranges;
}

/** Every annotation id present in the document. */
export function annotationIds(doc: PMNode): Set<string> {
    const ids = new Set<string>();

    doc.descendants((node) => {
        for (const mark of annotationMarksOf(node)) {
            if (typeof mark.attrs.id === 'string') {
                ids.add(mark.attrs.id);
            }
        }
        return true;
    });

    return ids;
}
