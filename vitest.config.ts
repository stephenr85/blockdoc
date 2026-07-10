import { defineConfig } from 'vitest/config';

export default defineConfig({
    resolve: {
        // rjsf-registry is a file:-linked working copy; dedupe keeps its peer
        // deps resolving to this package's single copy instead of the
        // symlink's own node_modules (two Reacts break hooks).
        dedupe: ['react', 'react-dom', '@rjsf/core', '@rjsf/shadcn', '@rjsf/utils', '@rjsf/validator-ajv8'],
    },
    test: {
        // Core tests run in node; react/rjsf tests opt into jsdom via a
        // `// @vitest-environment jsdom` docblock at the top of the file.
        environment: 'node',
        setupFiles: ['tests/setup.ts'],
    },
});
