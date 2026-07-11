import path from 'path';
import { defineConfig } from 'tsup';

export default defineConfig({
    entry: {
        core: 'src/core/index.ts',
        react: 'src/react/index.ts',
        rjsf: 'src/rjsf/index.ts',
    },
    format: ['esm'],
    platform: 'browser',
    dts: true,
    sourcemap: true,
    clean: true,
    // React + the RJSF stack resolve to the HOST's single copies; Tiptap/PM/uuid
    // are this package's own runtime and ship bundled (hosts like thingsontv
    // have no Tiptap of their own — bundling avoids cross-package resolution).
    external: [
        'react',
        'react-dom',
        'react/jsx-runtime',
        '@rjsf/core',
        '@rjsf/shadcn',
        '@rjsf/utils',
        '@rjsf/validator-ajv8',
        '@rushing/rjsf-registry',
    ],
    noExternal: [/@tiptap\//, 'uuid'],
    esbuildOptions(options) {
        // use-sync-external-store (a @tiptap/react dep) is CJS-only; bundled into
        // ESM browser output its `require("react")` becomes esbuild's throwing
        // dynamic-require stub. Our peer range is react >= 18, so alias both shim
        // entries to ESM ports over React's built-in hook (src/shims/).
        options.alias = {
            ...(options.alias ?? {}),
            'use-sync-external-store/shim/index.js': path.resolve('src/shims/use-sync-external-store-shim.ts'),
            'use-sync-external-store/shim/with-selector.js': path.resolve(
                'src/shims/use-sync-external-store-with-selector.ts',
            ),
        };
    },
});
