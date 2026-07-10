// @vitest-environment jsdom
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BlockdocManifest } from '../src/core';
import { createNodeViewRegistry } from '../src/react/node-views';
import type { NodeViewComponentProps } from '../src/react/portal-bridge';
import { createRichContentWidget } from '../src/rjsf';
import base from './fixtures/base.manifest.json';
import contentArticle from './fixtures/content-article.manifest.json';

const profileManifest: BlockdocManifest = contentArticle;

const sectionDoc = {
    type: 'doc',
    content: [
        {
            type: 'contentSection',
            attrs: { id: 'section-1', heading: 'Intro' },
            content: [
                {
                    type: 'paragraph',
                    attrs: { id: 'p1' },
                    content: [{ type: 'text', text: 'Grounded prose.' }],
                },
            ],
        },
    ],
};

describe('createRichContentWidget', () => {
    afterEach(() => {
        cleanup();
    });

    it('mounts the island from an inline manifest option without consulting the fetcher', async () => {
        const fetcher = vi.fn();
        const RichContent = createRichContentWidget(createNodeViewRegistry(), {
            baseManifest: base,
            schemaFetcher: fetcher,
        });

        const { container } = render(
            <RichContent
                formData={null}
                schema={{}}
                uiSchema={{ 'ui:options': { manifest: profileManifest } }}
            />,
        );

        await waitFor(() => {
            expect(container.querySelector('[data-blockdoc-editor]')).not.toBeNull();
        });
        expect(fetcher).not.toHaveBeenCalled();
    });

    it('resolves manifestRef through the formContext schema fetcher (shows nothing while loading)', async () => {
        const fetcher = vi.fn().mockResolvedValue(profileManifest);
        const RichContent = createRichContentWidget(createNodeViewRegistry(), { baseManifest: base });

        const { container } = render(
            <RichContent
                formData={null}
                schema={{}}
                uiSchema={{ 'ui:options': { manifestRef: 'profiles/content' } }}
                formContext={{ schemaFetcher: fetcher }}
            />,
        );

        expect(container.querySelector('[data-blockdoc-editor]')).toBeNull();

        await waitFor(() => {
            expect(container.querySelector('[data-blockdoc-editor]')).not.toBeNull();
        });
        expect(fetcher).toHaveBeenCalledWith('profiles/content');
    });

    it('prefers the formContext fetcher over the defaults fetcher, falling back when absent', async () => {
        const contextFetcher = vi.fn().mockResolvedValue(profileManifest);
        const defaultsFetcher = vi.fn().mockResolvedValue(profileManifest);
        const RichContent = createRichContentWidget(createNodeViewRegistry(), {
            baseManifest: base,
            schemaFetcher: defaultsFetcher,
        });

        const first = render(
            <RichContent
                formData={null}
                schema={{}}
                uiSchema={{ 'ui:options': { manifestRef: 'profiles/content' } }}
                formContext={{ schemaFetcher: contextFetcher }}
            />,
        );
        await waitFor(() => {
            expect(first.container.querySelector('[data-blockdoc-editor]')).not.toBeNull();
        });
        expect(contextFetcher).toHaveBeenCalledTimes(1);
        expect(defaultsFetcher).not.toHaveBeenCalled();
        first.unmount();

        const second = render(
            <RichContent
                formData={null}
                schema={{}}
                uiSchema={{ 'ui:options': { manifestRef: 'profiles/content' } }}
            />,
        );
        await waitFor(() => {
            expect(second.container.querySelector('[data-blockdoc-editor]')).not.toBeNull();
        });
        expect(defaultsFetcher).toHaveBeenCalledTimes(1);
    });

    it('accepts widget-signature props (value/options) as the fallback shape', async () => {
        const RichContent = createRichContentWidget(createNodeViewRegistry(), { baseManifest: base });

        const { container } = render(
            <RichContent value={null} options={{ manifest: profileManifest, palette: false }} />,
        );

        await waitFor(() => {
            expect(container.querySelector('[data-blockdoc-editor]')).not.toBeNull();
        });
        expect(container.querySelector('[data-blockdoc-palette]')).toBeNull();
    });

    it('honors the palette option (on by default)', async () => {
        const RichContent = createRichContentWidget(createNodeViewRegistry(), { baseManifest: base });

        const { container } = render(
            <RichContent formData={null} schema={{}} uiSchema={{ 'ui:options': { manifest: profileManifest } }} />,
        );

        await waitFor(() => {
            expect(container.querySelector('[data-blockdoc-palette]')).not.toBeNull();
        });
    });

    it('renders a registered NodeView component for its node type', async () => {
        const registry = createNodeViewRegistry();

        function SectionStub({ node, contentRef }: NodeViewComponentProps) {
            return (
                <div data-testid="section-stub">
                    <span>{String(node.attrs.heading)}</span>
                    {contentRef !== null && <div ref={contentRef} />}
                </div>
            );
        }

        registry.registerNodeView('contentSection', SectionStub);
        const RichContent = createRichContentWidget(registry, { baseManifest: base });

        const { findByTestId } = render(
            <RichContent
                formData={sectionDoc}
                schema={{}}
                uiSchema={{ 'ui:options': { manifest: profileManifest, palette: false } }}
            />,
        );

        const stub = await findByTestId('section-stub');
        expect(stub.textContent).toContain('Intro');
    });

    it('renders the generic NodeView chrome for unregistered manifest nodes', async () => {
        const RichContent = createRichContentWidget(createNodeViewRegistry(), { baseManifest: base });

        const { container } = render(
            <RichContent
                formData={sectionDoc}
                schema={{}}
                uiSchema={{ 'ui:options': { manifest: profileManifest, palette: false } }}
            />,
        );

        await waitFor(() => {
            expect(container.querySelector('[data-blockdoc-node="contentSection"]')).not.toBeNull();
        });
    });
});
