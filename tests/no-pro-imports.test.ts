import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * License guardrail (ADR-0072): MIT core + free extensions only — no Tiptap
 * Pro packages, no Tiptap Cloud/collab services. And the single-PM-instance
 * guardrail: every ProseMirror import must ride `@tiptap/pm/*`; direct
 * `prosemirror-*` imports would risk a second instance.
 */

const packageRoot = join(__dirname, '..');

function sourceFiles(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);

        if (entry.isDirectory()) {
            return sourceFiles(path);
        }

        return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
    });
}

const files = sourceFiles(join(packageRoot, 'src'));

describe('Tiptap dependency guardrails', () => {
    it('imports no paid or cloud Tiptap modules anywhere in src/', () => {
        const banned = /@tiptap-pro|@tiptap\/pro|@tiptap\/extension-[a-z-]*-pro|tiptap-cloud|@tiptap-cloud|@hocuspocus\/cloud/;

        for (const file of files) {
            expect(readFileSync(file, 'utf8'), file).not.toMatch(banned);
        }
    });

    it('declares no paid or cloud Tiptap packages in package.json', () => {
        const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as Record<
            string,
            Record<string, string> | undefined
        >;
        const declared = [
            ...Object.keys(manifest.dependencies ?? {}),
            ...Object.keys(manifest.peerDependencies ?? {}),
            ...Object.keys(manifest.devDependencies ?? {}),
        ];

        expect(declared.filter((name) => /tiptap-pro|tiptap\/pro|-pro$|cloud/.test(name))).toEqual([]);
    });

    it('imports ProseMirror only through @tiptap/pm/* in src/ (single PM instance)', () => {
        const direct = /from\s+['"]prosemirror-/;

        for (const file of files) {
            expect(readFileSync(file, 'utf8'), file).not.toMatch(direct);
        }
    });

    it('declares no direct prosemirror-* dependency in package.json', () => {
        const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as Record<
            string,
            Record<string, string> | undefined
        >;
        const declared = [
            ...Object.keys(manifest.dependencies ?? {}),
            ...Object.keys(manifest.peerDependencies ?? {}),
            ...Object.keys(manifest.devDependencies ?? {}),
        ];

        expect(declared.filter((name) => name.startsWith('prosemirror-'))).toEqual([]);
    });
});
