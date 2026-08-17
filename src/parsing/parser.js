/**
 * The single seam between the addon and the filename parser.
 *
 * Every parse in the addon goes through this module, so the engine, its cache and any
 * corroboration context are configured in exactly one place.
 */

import { createCachedParser, parseBatch, FIELD_REGISTRY } from 'parsium-media';

// One LRU per process
const cached = createCachedParser(10000);

/**
 * The fields that describe the release rather than the work. Taken from the parser's own registry so
 * the set cannot go stale: identity and episode belong to a title, and meta is populated on every parse.
 */
const RELEASE_FIELDS = FIELD_REGISTRY
    .filter(field => ['quality', 'language', 'release'].includes(field.category))
    .map(field => field.key);

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

/**
 * Whether a fragment reads as a release tag rather than as part of a work's name
 */
export function statesReleaseFields(text) {
    const parsed = parseName(text);
    if (!parsed) return false;

    return RELEASE_FIELDS.some(field => {
        const value = parsed[field];
        return Array.isArray(value) ? value.length > 0 : Boolean(value);
    });
}

/**
 * A frozen copy of the parse, so no consumer writes back onto what the filename said.
 * The copy is what keeps the cached entry itself reusable.
 */
export function frozenParse(filename) {
    if (!filename || typeof filename !== 'string') {
        return null;
    }

    return Object.freeze({ ...parseName(filename) });
}

/**
 * The pipeline's single decoration point: a torrent and its files are parsed here
 */
export function attachParse(details) {
    if (!details) {
        return details;
    }

    details.parsed = frozenParse(details.name);

    for (const video of details.videos ?? []) {
        if (video) {
            video.parsed = frozenParse(video.name);
        }
    }

    return details;
}

export function parserCacheSize() {
    return cached.size;
}

export function clearParserCache() {
    cached.clear();
}
