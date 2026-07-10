import { describe, expect, it } from 'vitest';
import { generateNodeId, NODE_ID_ATTR } from '../src/core';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('id conventions', () => {
    it('names the id attr', () => {
        expect(NODE_ID_ATTR).toBe('id');
    });

    it('generates valid UUIDv7 ids', () => {
        for (let i = 0; i < 20; i++) {
            expect(generateNodeId()).toMatch(UUID_V7);
        }
    });

    it('generates unique, monotonically sortable ids across calls', () => {
        const ids = Array.from({ length: 2000 }, () => generateNodeId());

        expect(new Set(ids).size).toBe(ids.length);
        expect([...ids].sort()).toEqual(ids);
    });
});
