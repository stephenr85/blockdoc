import { describe, expect, it } from 'vitest';
import type { BlockdocManifest } from '../src/core';
import {
    BASE_PROSE_NODE_NAMES,
    createNodeViewRegistry,
    GenericNodeView,
    needsGenericNodeView,
    resolveNodeViewComponents,
} from '../src/react/node-views';
import type { NodeViewComponentProps } from '../src/react/portal-bridge';
import base from './fixtures/base.manifest.json';
import contentArticle from './fixtures/content-article.manifest.json';

const manifests: BlockdocManifest[] = [base, contentArticle];

function StubNodeView(_props: NodeViewComponentProps) {
    return null;
}

describe('NodeView resolution', () => {
    it('gives unregistered manifest nodes outside the base prose set the generic NodeView', () => {
        const resolved = resolveNodeViewComponents(manifests);

        expect(resolved.get('contentSection')?.component).toBe(GenericNodeView);
        expect(resolved.get('contentOutline')?.component).toBe(GenericNodeView);
        expect(resolved.get('contentArticle')?.component).toBe(GenericNodeView);
    });

    it('leaves base prose nodes without a NodeView (native rendering)', () => {
        const resolved = resolveNodeViewComponents(manifests);

        for (const name of BASE_PROSE_NODE_NAMES) {
            expect(resolved.has(name)).toBe(false);
        }
    });

    it('lets a registered component override the generic NodeView', () => {
        const registry = createNodeViewRegistry();
        registry.registerNodeView('contentSection', StubNodeView);

        const resolved = resolveNodeViewComponents(manifests, registry);

        expect(resolved.get('contentSection')?.component).toBe(StubNodeView);
        expect(resolved.get('contentOutline')?.component).toBe(GenericNodeView);
    });

    it('carries the manifest attrsSchema through resolution for the attrs drill-down', () => {
        const resolved = resolveNodeViewComponents(manifests);
        const attrsSchema = resolved.get('contentSection')?.attrsSchema;

        expect(attrsSchema).toBeDefined();
        expect(Object.keys((attrsSchema?.properties ?? {}) as Record<string, unknown>)).toContain('heading');
    });

    it('detects generic-NodeView candidates by name and attrs shape', () => {
        expect(
            needsGenericNodeView({
                name: 'contentSection',
                category: 'section',
                admitsChildCategories: ['prose'],
            }),
        ).toBe(true);

        expect(
            needsGenericNodeView({
                name: 'paragraph',
                category: 'prose',
                admitsChildCategories: null,
                admitsText: true,
            }),
        ).toBe(false);
    });
});
