/**
 * The single seam between the addon and the filename parser.
 *
 * Every parse in the addon goes through this module, so the engine, its cache and any
 * corroboration context are configured in exactly one place.
 */

import { createCachedParser, parseBatch } from 'parsium-media';

// One LRU per process
const cached = createCachedParser(10000);

/**
 * Parse one filename. `context` is corroboration only: 
 * it can settle what the name leaves open, never override what the name states.
 */
export function parseName(name, context) {
    return cached.parse(name, context ? { context } : undefined);
}

/** Parse many filenames at once, deduplicating repeats within the batch. */
export function parseNames(names, context) {
    return parseBatch(names, context ? { context } : undefined);
}

export function parserCacheSize() {
    return cached.size;
}

export function clearParserCache() {
    cached.clear();
}
