/**
 * Compatibility layer that answers in the shape the addon's previous parser used.
 *
 * It exists so the parsing engine can be replaced without touching the modules that read
 * parse results. Consumers still write into what they get back, so every call returns a
 * freshly built object: the parser's own cached result is never handed out by reference.
 */

import { parseName } from './parser.js';

const EXTENSION = /\.([a-z0-9]{2,4})$/i;

/** Field names the consumers expect, kept identical for the empty and the parsed case. */
function emptyResult() {
    return {
        title: null,
        season: null,
        episode: null,
        absoluteEpisode: null,
        resolution: null,
        source: null,
        codec: null,
        audio: null,
        language: null,
        languages: [],
        group: null,
        year: null,
        extension: null,
        container: null,
        romanSeason: null,
        technicalDetails: {
            source: null,
            codec: null,
            resolution: null,
            container: null,
            bitDepth: null,
            hdr: null,
            audioChannels: null,
            frameRate: null
        }
    };
}

function extensionOf(filename) {
    const match = EXTENSION.exec(filename);
    return match ? match[1].toLowerCase() : null;
}

export function parseUnifiedCompat(filename) {
    if (!filename || typeof filename !== 'string') {
        return emptyResult();
    }

    const parsed = parseName(filename);

    return {
        title: parsed.title ?? null,
        // Multi-season packs keep the first season, which is what the previous parser reported.
        season: parsed.seasons?.[0] ?? null,
        episode: parsed.episodes?.[0] ?? null,
        absoluteEpisode: parsed.absoluteEpisode ?? null,
        resolution: parsed.resolution ?? null,
        source: parsed.source ?? null,
        codec: parsed.codec ?? null,
        audio: parsed.audio?.[0] ?? null,
        language: null,
        // Lower-cased to match the values already stored by the catalog and the cache recorder.
        languages: parsed.languages?.map(entry => entry.label.toLowerCase()) ?? [],
        group: parsed.releaseGroup ?? null,
        year: parsed.year ?? null,
        extension: extensionOf(filename),
        container: parsed.container ?? null,
        // Roman numerals are resolved into seasons, so no separate roman result exists.
        romanSeason: null,
        technicalDetails: {
            source: parsed.source ?? null,
            codec: parsed.codec ?? null,
            resolution: parsed.resolution ?? null,
            container: parsed.container ?? null,
            bitDepth: parsed.bitDepth ?? null,
            hdr: parsed.hdr?.join(' ') ?? null,
            audioChannels: parsed.channels?.[0] ?? null,
            frameRate: parsed.frameRate ?? null
        }
    };
}
