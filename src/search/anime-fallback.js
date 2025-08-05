/**
 * Anime Fallback Search Module - Phase 3 Implementation
 * Handles anime season mapping and cross-season episode searches using Jikan API
 * This is Phase 3 of the search process when no matches are found in Phases 1-2
 */

import { logger } from '../utils/logger.js';
import { fetchAnimeSeasonInfo, mapAnimeEpisode, selectTitleVariationsForAnime } from '../api/jikan.js';
import { analyzeTorrent } from './torrent-analyzer.js';
import { sortMovieStreamsByQuality, deduplicateStreams } from '../stream/quality-processor.js';

/**
 * Execute Phase 3: Anime season mapping fallback search
 * Called by coordinator when Phases 1-2 return no results for anime content
 * 
 * @param {Object} params - Search parameters
 * @param {string} params.searchKey - Original search title
 * @param {number} params.season - Target season number
 * @param {number} params.episode - Target episode number  
 * @param {Array} params.titleMatches - Results from Phase 1 (may be empty for Phase 3)
 * @param {Array} params.allRawResults - All torrents from provider search (fallback when titleMatches empty)
 * @param {string} params.type - Content type ('series')
 * @param {Array} params.alternativeTitles - TMDb alternative titles
 * @param {Object} params.searchContext - Search context object
 * @returns {Promise<Array>} - Array of matching torrents with anime episode mapping
 */
export async function executeAnimePhase3(params) {
    const { searchKey, season, episode, titleMatches, allRawResults, type, alternativeTitles, searchContext } = params;
    
    logger.debug('[anime-fallback] Phase 3: Trying anime season mapping as final fallback');
    
    try {
        // Skip if this is Season 0 (specials/OVA)
        if (season === 0) {
            logger.debug('[anime-fallback] Season 0 (specials/OVA) detected - skipping anime mapping phase');
            logger.debug('[anime-fallback] For S00 episodes, we only look for direct S00E{episode} matches');
            logger.debug(`[anime-fallback] No matches found for S${season}E${episode} - this might be because:`);
            logger.debug('  1. The torrent uses different OVA/special naming (e.g., "OVA", "Special", "Extra")');
            logger.debug('  2. The episode number might be different in the torrent');
            logger.debug('  3. The special might be bundled with a regular season');
            return [];
        }

        // Get country-prioritized title variations for anime search
        const titleVariations = selectTitleVariationsForAnime(searchKey, alternativeTitles, type);
        logger.debug(`[anime-fallback] Country-prioritized anime search with ${titleVariations.length} title variations:`, titleVariations);

        let animeSeasons = [];
        let successfulTitle = null;

        // Try each title variation until we find anime seasons
        for (const titleVariation of titleVariations) {
            try {
                logger.debug(`[anime-fallback] Trying anime search with: "${titleVariation}"`);
                animeSeasons = await fetchAnimeSeasonInfo(titleVariation);
                
                if (animeSeasons && animeSeasons.length > 0) {
                    logger.debug(`[anime-fallback] ✅ Found anime seasons with country-prioritized title: "${titleVariation}"`);
                    successfulTitle = titleVariation;
                    break;
                } else {
                    logger.debug(`[anime-fallback] ❌ No anime found for: "${titleVariation}"`);
                }
            } catch (error) {
                logger.warn(`[anime-fallback] Error searching anime for "${titleVariation}":`, error.message);
                continue;
            }
        }

        if (animeSeasons.length > 0 && successfulTitle) {
            // Try to map the episode to correct anime season/episode
            const episodeMapping = mapAnimeEpisode(animeSeasons, season, episode);
            
            if (episodeMapping) {
                logger.debug(`[anime-fallback] Anime mapping found using "${successfulTitle}": S${season}E${episode} → S${episodeMapping.mappedSeason}E${episodeMapping.mappedEpisode}`);
                
                // Re-analyze existing torrents with new season/episode
                logger.debug('[anime-fallback] Optimized anime retry: Re-analyzing existing torrents with new season/episode');
                
                const animeMatches = [];
                
                // Use all raw results if titleMatches is empty (Phase 1 found nothing)
                const torrentsToAnalyze = titleMatches.length > 0 ? titleMatches : allRawResults;
                logger.debug(`[anime-fallback] Analyzing ${torrentsToAnalyze.length} torrents (source: ${titleMatches.length > 0 ? 'titleMatches' : 'allRawResults'})`);
                
                // Re-analyze the torrents we have with the mapped season/episode
                for (const [index, result] of torrentsToAnalyze.entries()) {
                    try {
                        // Handle both titleMatches format and allRawResults format
                        const torrent = result.item || result;
                        
                        // Analyze with mapped season/episode
                        const animeAnalysisResult = await analyzeTorrent(
                            torrent,
                            episodeMapping.mappedSeason,
                            episodeMapping.mappedEpisode,
                            null, // absoluteEpisode not needed for anime mapping
                            searchContext.tmdbApiKey,
                            searchContext.traktApiKey,
                            searchContext.imdbId,
                            searchContext.searchKey
                        );
                        
                        if (animeAnalysisResult.videos && animeAnalysisResult.videos.length > 0) {
                            // Add the mapping info to the result
                            animeAnalysisResult.animeMapping = episodeMapping;
                            animeAnalysisResult.originalSeasonEpisode = `S${season}E${episode}`;
                            animeAnalysisResult.mappedSeasonEpisode = `S${episodeMapping.mappedSeason}E${episodeMapping.mappedEpisode}`;
                            
                            animeMatches.push(animeAnalysisResult);
                            logger.debug(`[anime-fallback] ✅ ANIME MATCH: ${torrent.name} - Found S${episodeMapping.mappedSeason}E${episodeMapping.mappedEpisode}`);
                        }
                    } catch (error) {
                        logger.warn(`[anime-fallback] Error analyzing torrent for anime mapping:`, error.message);
                        continue;
                    }
                }
                
                if (animeMatches.length > 0) {
                    logger.debug(`[anime-fallback] ✅ Optimized anime retry successful: Found ${animeMatches.length} results (no additional API calls needed)`);
                    
                    // Apply fuzzy matching and sorting to anime results
                    const processedAnimeMatches = sortMovieStreamsByQuality(animeMatches, type);
                    const deduplicatedAnimeMatches = deduplicateStreams(processedAnimeMatches);
                    
                    return deduplicatedAnimeMatches;
                } else {
                    logger.debug('[anime-fallback] ❌ Optimized anime retry failed: No results found with mapped season/episode');
                    return [];
                }
            } else {
                logger.debug('[anime-fallback] No anime episode mapping found');
                return [];
            }
        } else {
            logger.debug('[anime-fallback] No anime seasons found for any country-prioritized title variation');
            return [];
        }
        
    } catch (error) {
        logger.warn('[anime-fallback] Anime season check failed:', error);
        return [];
    }
}

/**
 * Check if content should use anime fallback search
 * @param {string} searchKey - Content title
 * @param {Array} alternativeTitles - TMDb alternative titles
 * @returns {boolean} - True if content might be anime
 */
export function shouldUseAnimeFallback(searchKey, alternativeTitles) {
    // Simple heuristics to detect potential anime content
    const animeKeywords = ['anime', 'shonen', 'shounen', 'seinen', 'shoujo', 'shojo', 'ova', 'oav'];
    const searchLower = searchKey.toLowerCase();
    
    // Check if title contains anime-related keywords
    const hasAnimeKeywords = animeKeywords.some(keyword => searchLower.includes(keyword));
    
    // Check if we have Japanese alternative titles (JP country code)
    const hasJapaneseTitles = alternativeTitles && alternativeTitles.some(alt => alt.country === 'JP');
    
    return hasAnimeKeywords || hasJapaneseTitles;
}
