import { v7 as uuidv7 } from 'uuid';

/**
 * The attribute name carrying a node's stable identity. Force-present on every
 * assembled node type (default null); the server stamps UUIDv7 ids lazily
 * (Block::id()) and the client mirrors that convention via generateNodeId().
 */
export const NODE_ID_ATTR = 'id';

/**
 * Generate a fresh node id: a UUIDv7, matching the server's `Str::uuid7()` so
 * client-minted and server-minted ids sort together chronologically.
 */
export function generateNodeId(): string {
    return uuidv7();
}
