/**
 * Phase 1: Title Matching Module
 * Handles fast fuzzy title matching using Fuse.js
 */

import { logger } from '../utils/logger.js';
import { extractKeywords } from './keyword-extractor.js';
import Fuse from 'fuse.js';

/**
 * Perform fast fuzzy title matching using Fuse.js
 * @param {Array} allRawResults - Raw torrent results to search through
 * @param {Array} uniqueSearchTerms - Unique search terms to match against
 * @param {number} threshold - Fuse.js matching threshold (0.0 = exact, 1.0 = match anything)
 * @returns {Array} Array of matched torrents with scores
 */
export function performTitleMatching(allRawResults, uniqueSearchTerms, threshold = 0.3) {
    logger.info('[phase-1] Starting fast title matching');
    
    // Normalize results for Fuse.js processing
    const normalizedResults = allRawResults.map(result => ({
        ...result,
        normalizedName: extractKeywords(result.name),
        normalizedTitle: extractKeywords(result.info?.title || ''),
        originalResult: result
    }));

    // Configure Fuse.js for title matching
    const titleFuse = new Fuse(normalizedResults, {
        keys: ['normalizedName', 'normalizedTitle'],
        threshold: threshold,
        minMatchCharLength: 2,
        includeScore: true
    });

    const titleMatches = [];
    const seenMatches = new Set(); // Track duplicates by original name

    // Search for each unique normalized term
    for (const term of uniqueSearchTerms) {
        const matches = titleFuse.search(term);
        
        // Add unique matches
        matches.forEach(match => {
            const originalName = match.item.originalResult.name;
            if (!seenMatches.has(originalName)) {
                seenMatches.add(originalName);
                titleMatches.push({
                    ...match,
                    item: match.item.originalResult
                });
            }
        });
        
        // Only log when matches are found
        if (matches.length > 0) {
            logger.info(`[phase-1] Found ${matches.length} matches for normalized term: "${term}"`);
        }
    }
    
    // Log Phase 1 summary
    logger.info(`[phase-1] Title matching complete: ${titleMatches.length} matches out of ${allRawResults.length} total results`);
    
    return titleMatches;
}

/**
 * Check if we should proceed to deep content analysis
 * @param {Array} titleMatches - Results from title matching
 * @param {string} type - Content type (movie/series)
 * @param {number} season - Season number
 * @param {number} episode - Episode number
 * @returns {Object} Decision result with shouldProceed flag and reason
 */
export function shouldProceedToPhase2(titleMatches, type, season, episode) {
    if (titleMatches.length === 0) {
        logger.info('[phase-1] ❌ No title matches found in Phase 1');
        
        // For movies, return empty results immediately (no anime fallback needed)
        if (type === 'movie') {
            return {
                shouldProceed: false,
                reason: 'movie-no-matches',
                shouldTryAnime: false
            };
        }
        
        // For series, continue to Phase 3 (anime fallback) if we have season/episode info
        if (type === 'series' && season && episode) {
            return {
                shouldProceed: false,
                reason: 'series-no-matches-try-anime',
                shouldTryAnime: true
            };
        } else {
            return {
                shouldProceed: false,
                reason: 'series-no-episode-info',
                shouldTryAnime: false
            };
        }
    }
    
    // For movies or when no episode info needed, skip Phase 2
    if (type === 'movie' || (!season && !episode)) {
        return {
            shouldProceed: false,
            reason: 'movie-or-no-episode-filtering',
            shouldTryAnime: false,
            returnPhase1: true
        };
    }

    // Series with episode info - proceed to Phase 2
    return {
        shouldProceed: true,
        reason: 'series-with-episode-info'
    };
}
