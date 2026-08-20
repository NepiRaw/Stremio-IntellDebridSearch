/**
 * Search Coordinator Module
 * Orchestrates multi-phase search across different providers and APIs
 * Two-phase approach: fast title matching, then deep content analysis
 */

import { logger } from '../utils/logger.js';
import { prepareSearchTerms, generateEpisodeKeywords } from './phase-0-preparation.js';
import { fetchProviderTorrents, preFilterTorrentsByKeywords } from './provider-search.js';
import { buildAliasVocabularies, performTitleMatching, shouldProceedToPhase2 } from './phase-1-title-matching.js';
import { batchFetchTorrentDetails, performContentAnalysis } from './phase-2-content-analysis.js';
import { buildEpisodeAddresses, statesEpisode, statesSeasonWithoutEpisode, statesAmbiguousEpisode } from '../utils/episode-address.js';
import { parseName, movieParseContext } from '../parsing/parser.js';
import { disabledTracker } from '../utils/perf-tracker.js';
import { configManager } from '../config/configuration.js';
import { extractKeywords } from './keyword-extractor.js';

/**
 * Create title variants for enhanced search matching.
 * Creates "&" → "and" variants.
 */
function createTitleVariants(originalTitle, type) {
    const variants = [originalTitle];
    
    if (originalTitle.includes('&')) {
        const andVariant = originalTitle.replace(/\s*&\s*/g, ' and ');
        variants.push(andVariant);
        logger.debug(`[coordinator] Created "&" → "and" variant for ${type}: "${originalTitle}" → "${andVariant}"`);
    }
    
    return variants;
}

/**
 * Perform advanced search using TMDb/TVDB APIs when available.
 * Uses a two-phase approach: fast title matching, then deep content analysis.
 */
export async function coordinateSearch(params) {
    const {
        apiKey, provider, searchKey, type, imdbId,
        season, episode,
        threshold = 0.3, providers,
        tracker = disabledTracker
    } = params;
    
    // Implement fallback to environment variables for API keys when not provided by user
    let { tmdbApiKey, tvdbApiKey } = params;

    // Use centralized configuration manager for API key fallbacks
    const apiConfig = configManager.getApiConfig();
    tmdbApiKey = apiConfig.tmdbApiKey;
    tvdbApiKey = apiConfig.tvdbApiKey;
    
    logger.info('[coordinator] Starting two-phase search for:', searchKey);

    // Create title variants for enhanced search (movie-only)
    const titleVariants = createTitleVariants(searchKey, type);
    
    const providerImpl = providers[provider];
    if (!providerImpl) {
        throw new Error(`Invalid provider or make sure you encoded the request: ${provider}`);
    }

    // ========== PHASE 0 AND THE LIBRARY LISTING, CONCURRENTLY ==========
    // The listing needs a search key only on its two fallback paths, so it takes a promise and
    // starts now; a provider that has to fall back still waits for phase 0
    const preparation = tracker.span('phase0', () => prepareSearchTerms({
        searchKey, type, imdbId, season, episode, tmdbApiKey, tvdbApiKey
    }));

    // Both derived promises absorb a rejection: once these run concurrently, a phase-0 failure
    // would otherwise surface as an unhandled rejection rather than as the error thrown below.
    const fallbackSearchKey = preparation.then(result => result.normalizedSearchKey, () => '');

    const listing = tracker.span('list', () =>
        fetchProviderTorrents(provider, providerImpl, apiKey, fallbackSearchKey, threshold));
    listing.catch(() => {});

    const preparationResult = await preparation;
    let { normalizedSearchKey, alternativeTitles, uniqueSearchTerms, absoluteEpisode, seasonOneLength } = preparationResult;

    // Add both raw and normalized variants from title variant creation
    if (titleVariants.length > 1) {
        const rawVariants = titleVariants.slice(1); // Skip first (original), keep with punctuation
        const normalizedVariants = rawVariants.map(variant => extractKeywords(variant));
        uniqueSearchTerms = [...uniqueSearchTerms, ...rawVariants, ...normalizedVariants];
        logger.debug(`[coordinator] Added ${rawVariants.length} raw + ${normalizedVariants.length} normalized variant terms`);
    }

    // ========== OPTIMIZED PROVIDER SEARCH (SINGLE FETCH + PRE-FILTER) ==========

    let allTorrents = [];
    try {
        allTorrents = await listing;
    } catch (error) {
        logger.warn(`[coordinator] Failed to fetch torrents: ${error.message}`);
        return [];
    }

    tracker.note('torrents', allTorrents.length);

    if (allTorrents.length === 0) {
        logger.info('❌ [coordinator] No torrents found');
        return [];
    }

    const aliasVocabularies = buildAliasVocabularies([searchKey, ...alternativeTitles.map(alt => alt.title || alt)]);

    // Pre-filter torrents by keyword inclusion before expensive Fuse.js
    const keywords = generateEpisodeKeywords(type, season, episode, absoluteEpisode, uniqueSearchTerms);
    logger.info(`[coordinator] Generated ${keywords.length} keywords for search: ${keywords.join(', ')}`);
    const relevantTorrents = await tracker.span('prefilter', () =>
        preFilterTorrentsByKeywords(allTorrents, keywords, aliasVocabularies));

    tracker.note('candidates', relevantTorrents.length);

    if (relevantTorrents.length === 0) {
        logger.info('❌ [coordinator] No relevant torrents found after pre-filtering');
        return [];
    }

    // Convert to the format expected by Phase 1
    const allRawResults = relevantTorrents;
    
    // ========== PHASE 1: FAST TITLE MATCHING ==========
    const titleMatches = await tracker.span('phase1', () =>
        performTitleMatching(allRawResults, uniqueSearchTerms, threshold, aliasVocabularies));

    tracker.note('matches', titleMatches.length);

    // Check if we should proceed to Phase 2 or return early
    const phase2Decision = shouldProceedToPhase2(titleMatches, type, season, episode);
    
    if (!phase2Decision.shouldProceed) {
        if (phase2Decision.returnPhase1) {
            let results = titleMatches.map(m => m.item);
            
            if (type === 'movie') { // For movies, filter out torrents that are clearly series (S01E01, S01, Season packs, etc.)
                const beforeCount = results.length;
                const context = movieParseContext(searchKey);
                results = results.filter(item => {
                    const parsed = parseName(item.name || '');
                    const settled = statesAmbiguousEpisode(parsed) ? parseName(item.name || '', context) : parsed;
                    return !statesEpisode(settled) && !statesSeasonWithoutEpisode(settled);
                });
                if (results.length < beforeCount) {
                    logger.info(`[coordinator] Filtered ${beforeCount - results.length} series torrent(s) from movie results`);
                }
            }
            
            return {
                results,
                absoluteEpisode: null
            };
        }
        
        logger.info(`[coordinator] Stopping search: ${phase2Decision.reason}`);
        return [];
    }

    // ========== PHASE 2: DEEP CONTENT ANALYSIS ==========
    let matches = [];
    
    if (titleMatches.length > 0) {
        logger.info('[coordinator] Phase 2: Deep content analysis for episode matching');
        
        const addresses = buildEpisodeAddresses({
            season: parseInt(season),
            episode: parseInt(episode),
            absoluteEpisode: absoluteEpisode?.absoluteEpisode ?? null,
            seasonOneLength
        });

        await tracker.span('fetch', () =>
            batchFetchTorrentDetails(titleMatches, providers[provider], apiKey, addresses));

        // Perform content analysis for episode matching (now with parallel torrent processing)
        matches = await tracker.span('phase2', () =>
            performContentAnalysis(titleMatches, addresses, aliasVocabularies));

        tracker.note('selected', matches.length);
        logger.debug(`[coordinator] Phase 2 complete: ${matches.length} matching episodes found`);
    } else {
        logger.debug('[coordinator] Phase 2 skipped: No title matches from Phase 1');
    }
    
    logger.debug(`[coordinator] Performance summary: ${allRawResults.length} total → ${titleMatches.length} title matches → ${matches.length} final results`);

    return {
        results: matches,
        absoluteEpisode: absoluteEpisode,
        searchContext: {
            searchTitle: normalizedSearchKey,
            alternativeTitles: alternativeTitles,
            imdbId: imdbId,
            type: type
        }
    };
}

