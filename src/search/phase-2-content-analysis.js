
/**
 * Phase 2: Content Analysis Module
 * --------------------------------
 * This module performs deep content analysis for episode matching after title-based filtering (Phase 1).
 *
 * Process Overview:
 * 1. Batch fetches missing torrent details (e.g., file lists) from the provider for torrents that lack them.
 *    - Uses provider.getTorrentDetails to enrich torrent objects with video/file info.
 *
 * 2. Analyzes each torrent to determine if it contains the requested episode (season/episode or absolute episode).
 *    - Uses analyzeTorrent to inspect file names, metadata, and episode info.
 *    - Filters out torrents that do not contain the requested episode.
 *
 * 3. Handles both direct episode files and containers (packs with multiple episodes):
 *    - For containers, extracts each matching video as a separate result.
 *    - For direct files, returns the torrent as-is.
 *
 * 4. Supports anime and non-standard episode numbering via episode remapping:
 *    - If anime fallback (Phase 3) is triggered, an episodeMapping object is provided (e.g., { mappedSeason, mappedEpisode }).
 *    - Re-analyzes torrents using the mapped season/episode to find the correct episode.
 *    - Annotates results with animeMapping for traceability.
 *
 * 5. Returns an array of matching episodes, each with detailed info and, if applicable, anime mapping metadata.
 */

import { logger } from '../utils/logger.js';
import { analyzeTorrent } from './torrent-analyzer.js';

/**
 * Batch fetch torrent details for torrents that need them
 * @param {Array} titleMatches - Matches from Phase 1
 * @param {Object} provider - Provider implementation
 * @param {string} apiKey - API key
 * @returns {Promise} Promise that resolves when all details are fetched
 */
export async function batchFetchTorrentDetails(titleMatches, provider, apiKey) {
    const torrentsNeedingDetails = titleMatches.filter(match => 
        provider?.getTorrentDetails && !match.item.videos
    );

    if (torrentsNeedingDetails.length === 0) {
        return;
    }

    logger.info(`[phase-2] Parallel batch fetching details for ${torrentsNeedingDetails.length} torrents`);

    const BATCH_SIZE = 20; // Process 20 torrents in parallel at a time
    const batches = [];
    for (let i = 0; i < torrentsNeedingDetails.length; i += BATCH_SIZE) {
        batches.push(torrentsNeedingDetails.slice(i, i + BATCH_SIZE));
    }

    // Process all batches sequentially but each batch is parallel internally
    for (const batch of batches) {
        await Promise.all(
            batch.map(async match => {
                try {
                    const details = await provider.getTorrentDetails(apiKey, match.item.id, 'stream');
                    Object.assign(match.item, details);
                } catch (e) {
                    logger.warn(`[phase-2] Failed to fetch details for ${match.item.name}:`, e);
                }
            })
        );
    }
    
    logger.debug(`[phase-2] Parallel batch fetch completed for ${torrentsNeedingDetails.length} torrents`);
}

/**
 * Perform deep content analysis for episode matching with optimized parallel processing
 * @param {Array} titleMatches - Matches from Phase 1
 * @param {number} season - Target season
 * @param {number} episode - Target episode  
 * @param {Object} absoluteEpisode - Absolute episode data from Trakt (optional)
 * @returns {Array} Array of matching episodes
 */
export async function performContentAnalysis(titleMatches, season, episode, absoluteEpisode = null) {
    logger.info('[phase-2] Starting optimized parallel content analysis for episode matching');
    
    // Process torrents in parallel batches for optimal performance
    const PARALLEL_BATCH_SIZE = 15; // Process 15 torrents in parallel at a time
    const batches = [];
    for (let i = 0; i < titleMatches.length; i += PARALLEL_BATCH_SIZE) {
        batches.push(titleMatches.slice(i, i + PARALLEL_BATCH_SIZE));
    }
    
    logger.debug(`[phase-2] Processing ${titleMatches.length} torrents in ${batches.length} parallel batches`);
    
    // Process ALL batches in parallel instead of sequential
    const allBatchPromises = batches.map(async (batch, batchIndex) => {
        logger.debug(`[phase-2] Starting parallel batch ${batchIndex + 1}/${batches.length} with ${batch.length} torrents`);
        
        const batchPromises = batch.map(async (match) => {
            try {
                const analysis = analyzeTorrent(match.item, parseInt(season), parseInt(episode), absoluteEpisode);
                return {
                    torrent: match.item,
                    analysis,
                    score: match.score,
                    matchedTerm: match.matchedTerm
                };
            } catch (error) {
                logger.warn(`[phase-2] Failed to analyze torrent ${match.item.name}:`, error);
                return null;
            }
        });
        
        const batchResults = await Promise.all(batchPromises);
        
        // Filter and process results for this batch
        const batchMatches = batchResults
            .filter(result => result !== null && result.analysis.hasMatchingEpisode)
            .flatMap(result => {
                // For containers, return each matching video as a separate result
                if (result.analysis.isContainer && result.analysis.matchingFiles.length > 0) {
                    return result.analysis.matchingFiles.map(video => ({
                        id: result.torrent.id,
                        source: result.torrent.source,
                        name: video.name,
                        size: video.size,
                        url: video.url,
                        info: {
                            ...(result.torrent.info || {}),
                            ...(video.info || {})
                        },
                        containerName: result.torrent.name,
                        isExtractedVideo: true,
                        videos: [video],
                        matchedTerm: result.matchedTerm
                    }));
                } else {
                    // For direct files, return as is
                    return [{
                        ...result.torrent,
                        matchedTerm: result.matchedTerm
                    }];
                }
            });
        
        logger.debug(`[phase-2] Parallel batch ${batchIndex + 1} completed: ${batchMatches.length} matches found`);
        return batchMatches;
    });
    
    // Wait for ALL batches to complete in parallel
    const allBatchResults = await Promise.all(allBatchPromises);
    const allMatches = allBatchResults.flat();
    
    logger.debug(`[phase-2] TRUE parallel content analysis complete: ${allMatches.length} matching episodes found`);
    return allMatches;
}

/**
 * Re-analyze existing torrents with new season/episode criteria (for anime mapping)
 * @param {Array} titleMatches - Original title matches
 * @param {Object} episodeMapping - Anime episode mapping
 * @returns {Array} Array of matching episodes with anime mapping
 */
export function reAnalyzeWithMapping(titleMatches, episodeMapping) {
    logger.info('[phase-2] Re-analyzing existing torrents with anime mapping');
    
    // Re-analyze the same torrents we already found with the new season/episode
    const reAnalyzedResults = titleMatches.map(match => {
        const analysis = analyzeTorrent(
            match.item, 
            parseInt(episodeMapping.mappedSeason), 
            parseInt(episodeMapping.mappedEpisode)
        );
        return {
            torrent: match.item,
            analysis,
            score: match.score
        };
    });
    
    // Extract matching episodes with new criteria
    const animeMatches = reAnalyzedResults
        .filter(result => {
            const hasMatch = result.analysis.hasMatchingEpisode;
            if (hasMatch) {
                logger.info(`[phase-2] ✅ ANIME MATCH: ${result.torrent.name} - Found S${episodeMapping.mappedSeason}E${episodeMapping.mappedEpisode}`);
            }
            return hasMatch;
        })
        .flatMap(result => {
            // For containers, return each matching video as a separate result
            if (result.analysis.isContainer && result.analysis.matchingFiles.length > 0) {
                const extractedVideos = result.analysis.matchingFiles.map(video => ({
                    ...result.torrent,
                    name: video.name,
                    size: video.size,
                    info: {
                        ...(result.torrent.info || {}),
                        ...(video.info || {})
                    },
                    // Keep track that this is from a container and anime mapping was used
                    containerName: result.torrent.name,
                    isExtractedVideo: true,
                    animeMapping: episodeMapping,
                    videos: [video]
                }));
                
                return extractedVideos;
            }
            // For direct files, return as is with anime mapping info
            return [{
                ...result.torrent,
                animeMapping: episodeMapping
            }];
        });
    
    return animeMatches;
}