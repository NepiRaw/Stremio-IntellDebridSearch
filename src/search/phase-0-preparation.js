/**
 * Phase 0: Search Preparation Module
 * Handles search term preparation, episode mapping, and term deduplication
 */

import { logger } from '../utils/logger.js';
import { extractKeywords } from './keyword-extractor.js';
import { fetchTMDbAlternativeTitles } from '../api/tmdb.js';
import { getEpisodeMapping } from '../api/trakt.js';

/**
 * Prepare search terms and fetch episode mapping
 * @param {Object} params - Preparation parameters
 * @param {string} params.searchKey - Main search term
 * @param {string} params.type - Content type (movie/series)
 * @param {string} params.imdbId - IMDB ID
 * @param {number} params.season - Season number (for series)
 * @param {number} params.episode - Episode number (for series)
 * @param {string} params.tmdbApiKey - TMDb API key
 * @param {string} params.traktApiKey - Trakt API key
 * @returns {Object} Prepared search data
 */
export async function prepareSearchTerms(params) {
    const { searchKey, type, imdbId, season, episode, tmdbApiKey, traktApiKey } = params;
    
    logger.info('[phase-0] Starting search preparation');
    
    // Get absolute episode number early if Trakt API is available
    let absoluteEpisode = null;
    if (traktApiKey && type === 'series' && season && episode) {
        logger.info(`[phase-0] Fetching absolute episode mapping for S${season}E${episode}`);
        absoluteEpisode = await getEpisodeMapping(traktApiKey, imdbId, season, episode);
        if (absoluteEpisode) {
            logger.info(`[phase-0] ✅ Found absolute episode: ${absoluteEpisode}`);
        } else {
            logger.info(`[phase-0] ❌ No absolute episode found from Trakt API`);
        }
    }
    
    // Fetch alternative titles from TMDb
    let alternativeTitles = [];
    if (tmdbApiKey && type && imdbId) {
        logger.info('[phase-0] TMDb API available, fetching alternative titles');
        alternativeTitles = await fetchTMDbAlternativeTitles(null, type, tmdbApiKey, imdbId);
    }
    
    // Prepare all search terms
    const normalizedSearchKey = extractKeywords(searchKey);
    const allSearchTerms = [normalizedSearchKey];
    
    if (alternativeTitles.length > 0) {
        // Extract normalized titles from the new format with country info
        const normalizedAlternatives = alternativeTitles.map(alt => alt.normalizedTitle || alt);
        allSearchTerms.push(...normalizedAlternatives);
    }

    // Deduplicate normalized search terms to reduce redundant Fuse.js searches
    const termMap = new Map();
    allSearchTerms.filter(term => term && term.trim()).forEach(term => {
        const lowerKey = term.toLowerCase();
        if (!termMap.has(lowerKey)) {
            termMap.set(lowerKey, term); // Keep first occurrence with original casing
        }
    });
    const uniqueSearchTerms = Array.from(termMap.values());
    
    logger.info(`[phase-0] Deduplicated search terms: ${allSearchTerms.length} → ${uniqueSearchTerms.length} unique terms`);

    return {
        normalizedSearchKey,
        alternativeTitles,
        uniqueSearchTerms,
        absoluteEpisode
    };
}

/**
 * Generate episode-specific keywords for series content
 * @param {string} type - Content type
 * @param {number} season - Season number
 * @param {number} episode - Episode number
 * @param {Object} absoluteEpisode - Absolute episode object
 * @param {Array} uniqueSearchTerms - Base search terms
 * @returns {Array} Extended keywords including episode-specific terms
 */
export function generateEpisodeKeywords(type, season, episode, absoluteEpisode, uniqueSearchTerms) {
    const keywords = uniqueSearchTerms.filter(term => term && typeof term === "string");
    
    // Add episode-specific keywords for series
    if (type === 'series' && season && episode) {
        keywords.push(`S${season}E${episode}`);
        if (absoluteEpisode && absoluteEpisode !== parseInt(episode)) {
            keywords.push(`${absoluteEpisode}`);
            keywords.push(`${absoluteEpisode} MULTI`);
            keywords.push(`${absoluteEpisode} BluRay`);
        }
    }

    return keywords;
}
