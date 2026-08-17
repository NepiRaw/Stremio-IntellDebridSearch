/**
 * Torrent Analyzer
 * Handles torrent content analysis for episode matching (Phase 2)
 */

import { logger } from '../utils/logger.js';
import { isVideo } from '../utils/file-types.js';
import { frozenParse } from '../parsing/parser.js';
import { matchEpisodeAddress, keepBestTier } from '../utils/episode-address.js';

/**
 * Check if two season numbers match, handling various formats and edge cases
 * @param {string|number} foundSeason - The season number found in the torrent
 * @param {string|number} targetSeason - The season number we're looking for
 * @returns {boolean} - Whether the seasons match
 */
export function checkSeasonMatch(foundSeason, targetSeason) {
    if ((foundSeason === null || foundSeason === undefined) || 
        (targetSeason === null || targetSeason === undefined)) {
        return false;
    }
    
    if (typeof foundSeason === 'string') {
        const parsed = parseInt(foundSeason, 10);
        if (!isNaN(parsed)) foundSeason = parsed;
    }
    if (typeof targetSeason === 'string') {
        const parsed = parseInt(targetSeason, 10);
        if (!isNaN(parsed)) targetSeason = parsed;
    }
    
    const normalizedTarget = parseInt(targetSeason, 10);
    const normalizedFound = parseInt(foundSeason, 10);
    
    if (!isNaN(normalizedTarget) && !isNaN(normalizedFound) &&
        normalizedTarget >= 0 && normalizedTarget <= 30 &&
        normalizedFound >= 0 && normalizedFound <= 30) {
        return normalizedFound === normalizedTarget;
    }
    
    return false;
}

// A debrid re-download keeps the original name and adds "(1)" before the extension.
const REDOWNLOAD_COPY = /\([1-3]\)\.[a-z0-9]{2,4}$/i;

export function isRedownloadCopy(filename) {
    return REDOWNLOAD_COPY.test(filename || '');
}

/** Records how each file matched, then keeps only those that matched at the strongest tier. */
export function selectEpisodeFiles(videos = [], addresses) {
    const candidates = [];

    for (const video of videos) {
        if (!video || isRedownloadCopy(video.name)) {
            continue;
        }

        video.match = matchEpisodeAddress(video.parsed ?? frozenParse(video.name), addresses);
        if (video.match) {
            candidates.push(video);
        }
    }

    return rankEpisodeFiles(keepBestTier(candidates));
}

/** A release that names the episode outranks one recognized through its absolute number. */
export function rankEpisodeFiles(videos) {
    if (videos.length < 2) {
        return videos;
    }

    const derived = video => video.match?.source === 'absolute' || video.match?.source === 'remap';

    return [...videos].sort((a, b) => Number(derived(a)) - Number(derived(b)));
}

/**
 * Analyze a torrent for episode matching - PHASE 2: Deep content analysis
 * @param {Object} torrent - The torrent to analyze
 * @param {number} targetSeason - Target season number
 * @param {number} targetEpisode - Target episode number
 * @param {Object} absoluteEpisode - Absolute episode data from Trakt (optional)
 * @returns {Object} - Analysis result
 */
export function analyzeTorrent(torrent, addresses) {
    const result = {
        isDirect: false,
        isContainer: false,
        hasMatchingEpisode: false,
        matchingFiles: [],
        details: null,
        seasonInfo: { found: null, target: addresses?.season ?? null }
    };

    if (isVideo(torrent.name)) {
        result.isDirect = true;
        torrent.match = matchEpisodeAddress(torrent.parsed ?? frozenParse(torrent.name), addresses);

        if (torrent.match) {
            logger.info(`[torrent-analyzer] ✅ ${torrent.match.source} match for: ${torrent.name}`);
            result.hasMatchingEpisode = true;
            result.matchingFiles = [torrent];
        }

        return result;
    }

    result.isContainer = true;

    if (!torrent.videos?.length) {
        logger.info(`[torrent-analyzer] Container has no processed videos:`, torrent.name);
        return result;
    }

    const selected = selectEpisodeFiles(torrent.videos, addresses);

    if (selected.length > 0) {
        result.hasMatchingEpisode = true;
        result.matchingFiles = selected;
    }

    return result;
}