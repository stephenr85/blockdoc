/**
 * Build-time replacement for `use-sync-external-store/shim/index.js`.
 *
 * The npm shim is CJS-only; bundling it into our ESM dist leaves esbuild's
 * throwing `__require("react")` stub in browser output ("Dynamic require of
 * 'react' is not supported"). Our peer range is react >= 18, where the hook is
 * built in — so the shim collapses to a re-export (tsup aliases the specifier
 * here; see tsup.config.ts).
 */
export { useSyncExternalStore } from 'react';
