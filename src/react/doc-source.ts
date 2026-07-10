import type { DocJson } from './commit-controller';

/**
 * The collaboration seam, deliberately empty of implementation: the island
 * consumes a DocSource internally, so a collab-backed source (pushing remote
 * docs through `subscribe`) can replace the default without touching the
 * island. The default simply wraps the `value` prop.
 */
export interface DocSource {
    get(): DocJson | null;
    subscribe?(listener: (doc: DocJson | null) => void): () => void;
}

/** The default DocSource: a snapshot of the island's `value` prop. */
export function valueDocSource(value: DocJson | null | undefined): DocSource {
    return {
        get: () => value ?? null,
    };
}
