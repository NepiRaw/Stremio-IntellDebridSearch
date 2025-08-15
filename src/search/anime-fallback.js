
/**
 * Anime Fallback Search Module - Phase 3 Implementation
 * -----------------------------------------------------
 * This module implements the final fallback search logic for anime content when no matches are found in Phases 1-2.
 * Purpose: Mainly for Anime series where seasoning is not correctly formatted by Stremio catalogs (eg. catalog showing only 1 season, but anime has multiple seasons)
 *
 * Process Overview:
 * 1. Generates prioritized title variations for anime search (country-specific, alternative titles).
 *
 * 2. For each title variation, queries the Jikan API to fetch anime season info.
 *    - Tries each variation until anime seasons are found.
 *
 * 3. Maps the requested season/episode to the correct anime season/episode using episode remapping logic.
 *    - Converts standard or absolute episode numbers to mapped values (e.g., S2E5 → S3E2).
 *
 * 4. Re-analyzes torrents (from Phase 1 or all raw results) using the mapped season/episode.
 *    - Uses analyzeTorrent to check if the torrent contains the mapped episode.
 *    - Annotates results with animeMapping and original/mapped season/episode info.
 *
 * 5. Deduplicates and sorts results by quality, returning only the best matches.
 *
 * 6. Handles special cases (e.g., Season 0/OVA) by skipping remapping and searching for direct matches only.
 */

import { logger } from '../utils/logger.js';
import { fetchAnimeSeasonInfo, mapAnimeEpisode, selectTitleVariationsForAnime } from '../api/jikan.js';
import { analyzeTorrent } from './torrent-analyzer.js';
import { sortMovieStreamsByQuality, deduplicateStreams } from '../stream/quality-processor.js';

/**
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
        if (season === 0) { // Skip if this is Season 0 (specials/OVA)
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
            const episodeMapping = mapAnimeEpisode(animeSeasons, season, episode);
            
            if (episodeMapping) {
                logger.debug(`[anime-fallback] Anime mapping found using "${successfulTitle}": S${season}E${episode} → S${episodeMapping.mappedSeason}E${episodeMapping.mappedEpisode}`);
                
                const animeMatches = [];
                
                const torrentsToAnalyze = titleMatches.length > 0 ? titleMatches : allRawResults;
                logger.debug(`[anime-fallback] Analyzing ${torrentsToAnalyze.length} torrents (source: ${titleMatches.length > 0 ? 'titleMatches' : 'allRawResults'})`);
                
                for (const [index, result] of torrentsToAnalyze.entries()) {
                    try {
                        const torrent = result.item || result;
                        
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