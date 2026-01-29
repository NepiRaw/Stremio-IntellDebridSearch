/**
 * Search Coordinator Module
 * Orchestrates multi-phase search across different providers and APIs
 * Two-phase approach: fast title matching, then deep content analysis
 * Also handles anime season mapping as a final fallback (phase 3)
 */

import { logger } from '../utils/logger.js';
import { prepareSearchTerms, generateEpisodeKeywords } from './phase-0-preparation.js';
import { fetchProviderTorrents, preFilterTorrentsByKeywords } from './provider-search.js';
import { performTitleMatching, shouldProceedToPhase2 } from './phase-1-title-matching.js';
import { batchFetchTorrentDetails, performContentAnalysis, reAnalyzeWithMapping } from './phase-2-content-analysis.js';
import AbsoluteEpisodeProcessor from '../utils/absolute-episode-processor.js';
import { configManager } from '../config/configuration.js';
import { extractKeywords } from './keyword-extractor.js';

/**
 * Create title variants for enhanced search matching.
 * Creates "&" → "and" variants.
 */
export function createTitleVariants(originalTitle, type) {
    const variants = [originalTitle];
    
    if (originalTitle.includes('&')) {
        const andVariant = originalTitle.replace(/\s*&\s*/g, ' and ');
        variants.push(andVariant);
        logger.debug(`[coordinator] Created "&" → "and" variant for ${type}: "${originalTitle}" → "${andVariant}"`);
    }
    
    return variants;
}

/**
 * Get basic title information without complete metadata
 */
export function getBasicTitleInfo(searchKey, type) {
    const cleanedTitle = extractKeywords(searchKey);
    return {
        title: cleanedTitle,
        normalizedTitle: cleanedTitle.toLowerCase(),
        type: type
    };
}

/**
 * Get search strategy based on content type and metadata availability
 */
export function getSearchStrategy(type, season, episode, alternativeTitles) {
    return {
        useMultiplePhases: type === 'series' && season && episode,
        useTitleVariations: alternativeTitles.length > 0,
        useAnimeSearch: type === 'series'
    };
}

/**
 * Perform advanced search using TMDb/Trakt APIs when available.
 * Uses a two-phase approach: fast title matching, then deep content analysis.
 */
export async function coordinateSearch(params) {
    const {
        apiKey, provider, searchKey, type, imdbId,
        season, episode, 
        threshold = 0.3, providers
    } = params;
    
    // Implement fallback to environment variables for API keys when not provided by user
    let { tmdbApiKey, traktApiKey } = params;
    
    // Use centralized configuration manager for API key fallbacks
    const apiConfig = configManager.getApiConfig();
    tmdbApiKey = apiConfig.tmdbApiKey;
    traktApiKey = apiConfig.traktApiKey;
    
    logger.info('[coordinator] Starting two-phase search for:', searchKey);

    // Create title variants for enhanced search (movie-only)
    const titleVariants = createTitleVariants(searchKey, type);
    
    // ========== PARALLEL PHASE EXECUTION: PHASE 0 + PROVIDER VALIDATION ==========
    const [preparationResult, validatedProvider] = await Promise.all([
        prepareSearchTerms({
            searchKey, type, imdbId, season, episode, tmdbApiKey, traktApiKey
        }),
        Promise.resolve().then(() => {
            const providerImplementation = providers[provider];
            if (!providerImplementation) {
                throw new Error(`Invalid provider or make sure you encoded the request: ${provider}`);
            }
            return providerImplementation;
        })
    ]);
    
    let { normalizedSearchKey, alternativeTitles, uniqueSearchTerms, absoluteEpisode } = preparationResult;
    const providerImpl = validatedProvider;
    
    // Add both raw and normalized variants from title variant creation
    if (titleVariants.length > 1) {
        const rawVariants = titleVariants.slice(1); // Skip first (original), keep with punctuation
        const normalizedVariants = rawVariants.map(variant => extractKeywords(variant));
        uniqueSearchTerms = [...uniqueSearchTerms, ...rawVariants, ...normalizedVariants];
        logger.debug(`[coordinator] Added ${rawVariants.length} raw + ${normalizedVariants.length} normalized variant terms`);
    }

    // ========== OPTIMIZED PROVIDER SEARCH (SINGLE FETCH + PRE-FILTER) ==========

    // Get ALL torrents once
    let allTorrents = [];
    try {
        allTorrents = await fetchProviderTorrents(provider, providerImpl, apiKey, normalizedSearchKey, threshold);
    } catch (error) {
        logger.warn(`[coordinator] Failed to fetch torrents: ${error.message}`);
        return [];
    }

    if (allTorrents.length === 0) {
        logger.info('❌ [coordinator] No torrents found');
        return [];
    }

    // Pre-filter torrents by keyword inclusion before expensive Fuse.js
    const keywords = generateEpisodeKeywords(type, season, episode, absoluteEpisode, uniqueSearchTerms);
    logger.info(`[coordinator] Generated ${keywords.length} keywords for search: ${keywords.join(', ')}`);
    const relevantTorrents = await preFilterTorrentsByKeywords(allTorrents, keywords);
    
    if (relevantTorrents.length === 0) {
        logger.info('❌ [coordinator] No relevant torrents found after pre-filtering');
        return [];
    }

    // Convert to the format expected by Phase 1
    const allRawResults = relevantTorrents;
    
    // ========== PHASE 1: FAST TITLE MATCHING ==========
    const titleMatches = await performTitleMatching(allRawResults, uniqueSearchTerms, threshold);
    
    // Check if we should proceed to Phase 2 or return early
    const phase2Decision = shouldProceedToPhase2(titleMatches, type, season, episode);
    
    if (!phase2Decision.shouldProceed) {
        if (phase2Decision.returnPhase1) {
            return {
                results: titleMatches.map(m => m.item),
                absoluteEpisode: null
            };
        }
        
        if (!phase2Decision.shouldTryAnime) {
            logger.info(`[coordinator] Stopping search: ${phase2Decision.reason}`);
            return [];
        }
        
        // Continue to Phase 3 anime fallback
        logger.info(`[coordinator] No Phase 1 matches - proceeding to Phase 3 anime fallback`);
    }

    // ========== PHASE 2: DEEP CONTENT ANALYSIS ==========
    let matches = [];
    
    if (titleMatches.length > 0) {
        logger.info('[coordinator] Phase 2: Deep content analysis for episode matching');
        
        // Run batch fetch and content analysis preparation in parallel
        await Promise.all([
            // Parallel task 1: Batch fetch torrent details
            batchFetchTorrentDetails(titleMatches, providers[provider], apiKey),
            // Parallel task 2: Any other preparation that can be done concurrently
            Promise.resolve() 
        ]);

        // Perform content analysis for episode matching (now with parallel torrent processing)
        matches = await performContentAnalysis(titleMatches, season, episode, absoluteEpisode);
        
        logger.debug(`[coordinator] Phase 2 complete: ${matches.length} matching episodes found`);
    } else {
        logger.debug('[coordinator] Phase 2 skipped: No title matches from Phase 1');
    }
    
    logger.debug(`[coordinator] Performance summary: ${allRawResults.length} total → ${titleMatches.length} title matches → ${matches.length} final results`);
    
    // ========== PHASE 3: ANIME SEASON CHECK (Final fallback) ==========
    if (matches.length === 0 && type === 'series' && season && episode) {
        // Check if this is Season 0 (specials/OVA) - don't do anime mapping for S00
        if (parseInt(season) === 0) {
            logger.info('[coordinator] Season 0 (specials/OVA) detected - skipping anime mapping phase');
            logger.info('[coordinator] For S00 episodes, we only look for direct S00E{episode} matches');
            
            return {
                results: [],
                absoluteEpisode: absoluteEpisode
            };
        }
        
        logger.info('[coordinator] Phase 3: Trying anime season mapping as final fallback');
        
        try {
            // Import anime functions from jikan.js
            const { fetchAnimeSeasonInfo, mapAnimeEpisode, selectTitleVariationsForAnime } = await import('../api/jikan.js');
            
            // Use country-aware title selection for anime searches
            const titleVariations = selectTitleVariationsForAnime(
                searchKey, 
                alternativeTitles, 
                'anime'
            );
            
            logger.info(`[coordinator] Country-prioritized anime search with ${titleVariations.length} title variations`);
            
            // Try each title variation until we find anime seasons
            let animeSeasons = [];
            let successfulTitle = null;
            
            for (const titleVariation of titleVariations) {
                logger.info(`[coordinator] Trying anime search with: "${titleVariation}"`);
                animeSeasons = await fetchAnimeSeasonInfo(titleVariation);
                
                if (animeSeasons.length > 0) {
                    successfulTitle = titleVariation;
                    logger.info(`[coordinator] ✅ Found anime seasons with country-prioritized title: "${titleVariation}"`);
                    logger.info(`[anime-search] ✅ Found ${animeSeasons.length} anime seasons for "${titleVariation}":`, 
                        animeSeasons.map(r => `${r.season_number} (${r.episodes} eps) - ${r.title}`));
                    break;
                } else {
                    logger.info(`[coordinator] ❌ No anime found for: "${titleVariation}"`);
                }
            }
            
            if (animeSeasons.length > 0) {
                // Try to map the episode to correct season
                const episodeMapping = mapAnimeEpisode(animeSeasons, parseInt(season), parseInt(episode));
                
                if (episodeMapping) {
                    logger.info(`[coordinator] Anime mapping found using "${successfulTitle}": S${season}E${episode} → S${episodeMapping.mappedSeason}E${episodeMapping.mappedEpisode}`);
                    
                    // Instead of full recursive search, reuse existing data and only re-analyze
                    logger.info('[coordinator] Optimized anime retry: Re-analyzing existing torrents with new season/episode');
                    
                    // Re-analyze the same torrents we already found with the new season/episode
                    const animeMatches = reAnalyzeWithMapping(titleMatches, episodeMapping);
                    
                    if (animeMatches.length > 0) {
                        logger.info(`[coordinator] ✅ Optimized anime retry successful: Found ${animeMatches.length} results (no additional API calls needed)`);
                        
                        // Apply absolute episode post-processing if Trakt data available
                        // Convert anime matches to the expected format and apply absolute episode processing
                        const wrappedAnimeMatches = animeMatches.map(torrent => ({
                            item: torrent,
                            torrentDetails: torrent
                        }));
                        const finalAnimeMatches = applyAbsoluteEpisodePostProcessing(wrappedAnimeMatches, absoluteEpisode);
                        
                        return {
                            results: finalAnimeMatches.map(r => r.item), // Extract back to flat format
                            absoluteEpisode: absoluteEpisode,
                            animeMapping: episodeMapping, // Pass the complete mapping object instead of just true
                            mappedSeason: episodeMapping.mappedSeason,
                            mappedEpisode: episodeMapping.mappedEpisode
                        };
                    } else {
                        logger.info('[coordinator] ❌ Optimized anime retry failed: No results found with mapped season/episode');
                    }
                } else {
                    logger.info('[coordinator] No anime episode mapping found');
                }
            } else {
                logger.info('[coordinator] No anime seasons found for any country-prioritized title variation');
            }
        } catch (error) {
            logger.warn('[coordinator] Anime season check failed:', error);
        }
    }
    
    // Apply absolute episode post-processing to all final results
    // Convert flat torrent results to the expected format with torrentDetails
    const wrappedMatches = matches.map(torrent => ({
        item: torrent,
        torrentDetails: torrent // The torrent already has videos array from phase-2
    }));
    
    const finalResults = applyAbsoluteEpisodePostProcessing(wrappedMatches, absoluteEpisode);
    
    return {
        results: finalResults.map(r => r.item), // Extract back to flat format
        absoluteEpisode: absoluteEpisode,
        searchContext: {
            searchTitle: normalizedSearchKey,
            alternativeTitles: alternativeTitles,
            imdbId: imdbId,
            type: type
        }
    };
}

/**
 * Apply absolute episode post-processing to search results
 */
function applyAbsoluteEpisodePostProcessing(searchResults, absoluteEpisodeData) {
    if (!absoluteEpisodeData || !absoluteEpisodeData.absoluteEpisode || !Array.isArray(searchResults)) {
        if (absoluteEpisodeData && !absoluteEpisodeData.absoluteEpisode) {
            logger.debug(`[coordinator] ⚡ Skipping absolute episode processing - no absolute episode data from Trakt`);
        }
        return searchResults; // No absolute episode data or invalid input
    }
    
    logger.debug(`[coordinator] Applying absolute episode post-processing to ${searchResults.length} results`);
    
    const processedResults = searchResults.map(result => {
        if (!result.torrentDetails || !result.torrentDetails.videos) {
            return result; // No videos to process
        }
        
        // Apply absolute episode processing only if Trakt API is enabled
        const enhancedVideos = configManager.getIsTraktEnabled() 
            ? AbsoluteEpisodeProcessor.processAbsoluteEpisodes(absoluteEpisodeData, result.torrentDetails.videos)
            : result.torrentDetails.videos;
        
        // Return enhanced result with processed videos
        return {
            ...result,
            torrentDetails: {
                ...result.torrentDetails,
                videos: enhancedVideos
            }
        };
    });
    
    return processedResults;
}