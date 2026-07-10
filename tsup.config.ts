import { defineConfig } from 'tsup';

export default defineConfig({
    entry: {
        core: 'src/core/index.ts',
        react: 'src/react/index.ts',
        rjsf: 'src/rjsf/index.ts',
    },
    format: ['esm'],
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
});
