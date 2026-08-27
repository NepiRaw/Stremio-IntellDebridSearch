/**
 * Stream Builder Module - Constructs stream objects with detailed titles and quality information.
 */

import { streamTitle, detectVariant, qualityRank } from './display.js';
import { extractQuality } from './quality-processor.js';
import { logger } from '../utils/logger.js';

/**
 * How well the file's own name answers the requested address. Ranking prefers a release that states
 * the address outright over one matched through a fallback or a cross-season remap.
 */
const MATCH_RANK = { stated: 4, absolute: 3, 'season-fallback': 2, remap: 1 };

// ================================================================================================
// CONFIGURATION
// ================================================================================================

/**
 * Configuration flag to control multi-stream per torrent behavior
 * When true: Allows multiple streams per torrent container (slower but comprehensive)
 * When false: Forces single stream per torrent (ultra-fast performance)
 */
const ENABLE_MULTI_STREAM_PER_TORRENT = process.env.ENABLE_MULTI_STREAM_PER_TORRENT === 'true';

const STREAM_NAME_MAP = {
    DebridLink: "[DL⚡] Intell DebridSearch",
    RealDebrid: "[RD⚡] Intell DebridSearch",
    AllDebrid: "[AD⚡] Intell DebridSearch",
    Premiumize: "[PM⚡] Intell DebridSearch",
    TorBox: "[TB⚡] Intell DebridSearch"
};

// ================================================================================================
// MAIN STREAM CREATION ENTRY POINTS
// ================================================================================================

/** Main entry point with intelligent routing for optimal performance */
export function optimizedStreamCreation(details, type, knownSeasonEpisode = null, searchContext = null) {
    if (!details) return [];

    logger.debug(`[optimizedStreamCreation] Processing ${type} content with ${details.videos?.length || 1} video(s), multi-stream enabled: ${ENABLE_MULTI_STREAM_PER_TORRENT}`);

    const singleVideo = !details.videos?.length || details.videos.length === 1;

    if (!ENABLE_MULTI_STREAM_PER_TORRENT || singleVideo) {
        const stream = toStreamSingle(details, type, knownSeasonEpisode, searchContext);
        return stream ? [stream] : [];
    }

    logger.debug(`[optimizedStreamCreation] 🔄 Multi-stream mode enabled - processing all ${details.videos.length} videos`);
    return toStreams(details, type, knownSeasonEpisode, searchContext);
}

/** Optimized single video stream creation */
export function toStreamSingle(details, type, knownSeasonEpisode = null, searchContext = null) {
    if (!details) return null;

    // Phase 2 selected and ranked the files, so the first one is the one to show.
    const video = details.videos?.[0];

    if (!video) {
        logger.debug(`[toStreamSingle] No video found in torrent details`);
        return null;
    }

    return createStream(details, video, type, '💾', knownSeasonEpisode, searchContext);
}

/** Multi-video stream creation for torrent containers */
export function toStreams(details, type, knownSeasonEpisode = null, searchContext = null) {
    if (!details) return [];

    logger.debug(`[toStreams] Processing ${details.videos?.length || 0} videos for ${type} content`);

    const streams = [];
    for (const video of details.videos ?? []) {
        if (!video) continue;

        const stream = createStream(details, video, type, '💾', knownSeasonEpisode, searchContext);
        if (stream) streams.push(stream);
    }

    return streams;
}

function createStream(details, video, type, icon, knownSeasonEpisode, searchContext) {
    if (!video?.fileName || !video?.url) return null;

    const variant = type === 'series' ? detectVariant(details, video, searchContext) : null;
    const quality = extractQuality(video, details);

    const stream = {
        name: (STREAM_NAME_MAP[details.provider] || 'Unknown') + '\n' + quality,
        title: streamTitle(details, video, type, icon, knownSeasonEpisode, variant),
        url: video.url,
        behaviorHints: {
            bingeGroup: details.provider + '|' + details.id,
            filename: video.fileName || null,
            videoSize: video.size || null,
        }
    };

    Object.defineProperty(stream, 'rank', {
        value: {
            isVariant: Boolean(variant?.isVariant),
            match: MATCH_RANK[video.match?.source] ?? 0,
            quality: qualityRank(quality),
            size: video.size || 0
        },
        enumerable: false
    });

    return stream;
}

// ================================================================================================
// FILTERING FUNCTIONS
// ================================================================================================

/**
 * Filter torrents by year for movies.
 */
export function filterYear(torrent, cinemetaDetails) {
    if (!cinemetaDetails?.year) return true;

    const torrentYear = torrent?.parsed?.year;
    if (!torrentYear) return true;

    // A release is often dated a year either side of the listed release.
    return Math.abs(torrentYear - cinemetaDetails.year) <= 1;
}

// ================================================================================================
// DISPLAY UTILITIES
// ================================================================================================

/**
 * Format an array of stream objects for display - for terminal output only.
 */
export function formatStreamsForDisplay(streams) {
    if (!Array.isArray(streams)) return '';
    return streams.map(stream => {
        const nameLines = (stream.name || '').split('\n');
        const titleLines = (stream.title || '').split('\n').map(line => '\t' + line);
        const hintsLine = 'behaviorHints: ' + JSON.stringify(stream.behaviorHints || {});

        // Display both lines of stream.name: provider tag and quality information
        const nameDisplay = nameLines.length > 1 ?
            nameLines[0] + '\n' + nameLines[1] :
            nameLines[0];

        return [nameDisplay, ...titleLines, hintsLine].join('\n');
    }).join('\n\n');
}
