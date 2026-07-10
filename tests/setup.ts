/**
 * jsdom shims for prosemirror-view (jsdom implements neither layout nor
 * client rects). Guarded so the node-environment core tests pass through.
 */
if (typeof window !== 'undefined') {
    const rect: DOMRect = {
        x: 0,
        y: 0,
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        width: 0,
        height: 0,
        toJSON: () => ({}),
    };

    const emptyRectList = (): DOMRectList =>
        ({
            length: 0,
            item: () => null,
            [Symbol.iterator]: [][Symbol.iterator],
        }) as unknown as DOMRectList;

    Range.prototype.getBoundingClientRect = () => rect;
    Range.prototype.getClientRects = emptyRectList;
    Element.prototype.getClientRects = emptyRectList;

    if (!Element.prototype.scrollIntoView) {
        Element.prototype.scrollIntoView = () => {};
    }

    if (!document.elementFromPoint) {
        document.elementFromPoint = () => null;
    }
}

export {};
