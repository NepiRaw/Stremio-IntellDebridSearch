/**
 * Legacy parsing entry point. The parse itself lives in parsing/adapter.js; this module keeps
 * only the name its remaining callers import, and is retired with the adapter in C7.
 */

import { parseUnifiedCompat } from '../parsing/adapter.js';

/**
 * Parse a torrent or video filename into the structured result the rest of the addon reads.
 */
export function parseUnified(filename) {
    return parseUnifiedCompat(filename);
}
