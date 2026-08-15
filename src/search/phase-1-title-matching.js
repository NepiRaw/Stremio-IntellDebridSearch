
/**
 * Phase 1: Title Matching Module
 * --------------------------------
 * This module performs fast fuzzy title matching for torrent results using Fuse.js.
 *
 * Process Overview:
 * 1. For each torrent result, both the raw torrent name and the title (from metadata) are normalized using extractKeywords().
 *    - normalizedName: extractKeywords(result.name) // splits words, removes punctuation, but technical details/tags (e.g. 1080p, WEB-DL, x264) remain
 *    - normalizedTitle: extractKeywords(result.info?.title || '') // splits words, removes punctuation
 *
 * 2. The search terms (usually originating from normalized titles or user queries) are also normalized using extractKeywords().
 *
 * 3. Fuse.js is configured to match each normalized search term against both normalizedName and normalizedTitle for every torrent result.
 *    - keys: ['normalizedName', 'normalizedTitle']
 *    - threshold: controls fuzziness (lower = stricter, higher = more matches)
 *
 * 4. For each search term, Fuse.js returns matches with a score. Note that the score is ONLY informational and not used for filtering
 *    - Lower score = better match (0 = exact match)
 *    - Higher score = weaker match (potential false positive)
 *
 * 5. The process ensures that both the noisy torrent name and the clean title are considered for matching, improving robustness against release naming variations.
 *
 * 6. Results are deduplicated and returned with their scores for further filtering or ranking.
 */

import { logger } from '../utils/logger.js';
import { extractKeywords } from './keyword-extractor.js';
import { parseName } from '../parsing/parser.js';
import Fuse from 'fuse.js';

export function tokenizeTitle(value) {
    if (!value) {
        return [];
    }

    return String(value)
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
        .trim()
        .split(' ')
        .filter(Boolean);
}

export function buildAliasVocabularies(aliases = []) {
    const vocabularies = [];

    for (const alias of aliases) {
        const tokens = tokenizeTitle(alias);
        if (tokens.length) {
            vocabularies.push(new Set(tokens));
        }
    }

    return vocabularies;
}

/**
 * Identity by alias vocabulary: every word of the release title must belong to ONE alias
 */
export function isSameWork(parsedTitle, vocabularies = []) {
    const candidate = tokenizeTitle(parsedTitle);
    if (!candidate.length) {
        return false;
    }

    return vocabularies.some(vocabulary => candidate.every(token => vocabulary.has(token)));
}

export function isSameWorkStrict(parsedTitle, vocabularies = []) {
    const candidate = tokenizeTitle(parsedTitle);
    if (!candidate.length) {
        return false;
    }

    const stated = new Set(candidate);

    return vocabularies.some(vocabulary => {
        if (!candidate.every(token => vocabulary.has(token))) {
            return false;
        }

        const omitted = [...vocabulary].filter(token => !stated.has(token)).length;
        return omitted <= candidate.length;
    });
}

/**
 * Perform fast fuzzy title matching using Fuse.js
 * @param {Array} allRawResults - Raw torrent results to search through
 * @param {Array} uniqueSearchTerms - Unique search terms to match against
 * @param {number} threshold - Fuse.js matching threshold (0.0 = exact, 1.0 = match anything)
 * @param {Array<Set<string>>} aliasVocabularies - Alias vocabularies for the identity lane
 * @returns {Promise<Array>} Array of matched torrents with scores
 */
export async function performTitleMatching(allRawResults, uniqueSearchTerms, threshold = 0.3, aliasVocabularies = []) {
    logger.debug('[phase-1] Starting fast title matching');
    
    const normalizedResults = allRawResults.map(result => ({ // Normalize results for Fuse.js processing
        ...result,
        normalizedName: extractKeywords(result.name),
        normalizedTitle: extractKeywords(result.info?.title || ''),
        originalResult: result
    }));

    const titleFuse = new Fuse(normalizedResults, {
        keys: ['normalizedName', 'normalizedTitle'],
        threshold: threshold,
        minMatchCharLength: 2,
        includeScore: true
    });

    const titleMatches = [];
    const seenMatches = new Set(); // Track duplicates by original name

    const startTime = Date.now();
    
    const parallelSearches = uniqueSearchTerms.map(async (term) => {
        return new Promise((resolve) => {
            const matches = titleFuse.search(term);
            
            if (matches.length > 0) {
                logger.info(`[phase-1] Found ${matches.length} matches for normalized term: "${term}"`);
            }
            
            resolve({ term, matches });
        });
    });

    const allSearchResults = await Promise.all(parallelSearches);

    // Deduplicate by torrent ID
    allSearchResults.forEach(({ term, matches }) => {
        matches.forEach(match => {
            const torrentId = match.item.originalResult.id;
            const originalName = match.item.originalResult.name;
            const size = match.item.originalResult.size;
            
            if (!seenMatches.has(torrentId)) {
                seenMatches.add(torrentId);
                titleMatches.push({
                    ...match,
                    item: match.item.originalResult,
                    matchedTerm: term // Store which search term actually matched this torrent
                });
                logger.debug(`[phase-1] Added torrent: ${originalName} (ID: ${torrentId}, Size: ${size})`);
            }
        });
    });
    
    let identityMatches = 0;
    if (aliasVocabularies.length) {
        for (const result of allRawResults) {
            if (seenMatches.has(result.id) || !isSameWork(parseName(result.name)?.title, aliasVocabularies)) {
                continue;
            }

            seenMatches.add(result.id);
            identityMatches++;
            titleMatches.push({ item: result, score: null, matchedTerm: null, identityMatch: true });
        }
    }

    const parallelDuration = Date.now() - startTime;

    logger.info(`[phase-1] Title matching complete: ${titleMatches.length} matches out of ${allRawResults.length} total results (${identityMatches} by title identity)`);

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