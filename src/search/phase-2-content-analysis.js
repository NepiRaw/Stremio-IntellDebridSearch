
/**
 * Phase 2: Content Analysis Module
 * --------------------------------
 * This module performs deep content analysis for episode matching after title-based filtering (Phase 1).
 *
 * Process Overview:
 * 1. Batch fetches missing torrent details (e.g., file lists) from the provider for torrents that lack them.
 *    - Uses the provider module to enrich torrent objects with video/file info.
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
 *    - Re-analyzes torrents using the mapped season/episode to find the correct episode.
 *
 * 5. Returns an array of matching episodes, each with detailed info and, if applicable, anime mapping metadata.
 */

import { logger } from '../utils/logger.js';
import { getProvider, fetchTorrentDetails } from '../providers/index.js';
import { analyzeTorrent, selectEpisodeFiles } from './torrent-analyzer.js';
import { isSameWorkStrict } from './phase-1-title-matching.js';
import { parseName, frozenParse, attachParse } from '../parsing/parser.js';
import { buildEpisodeAddresses, couldContain } from '../utils/episode-address.js';

/**
 * Batch fetch torrent details for torrents that need them
 * @param {Array} titleMatches - Matches from Phase 1
 * @param {string} apiKey - API key
 * @returns {Promise} Promise that resolves when all details are fetched
 */
export async function batchFetchTorrentDetails(titleMatches, apiKey, addresses = null, providerName = null) {
    if (!getProvider(providerName)) return;

    const torrentsNeedingDetails = titleMatches.filter(match =>
        !match.item.videos &&
        couldContain(match.item.parsed ?? frozenParse(match.item.name), addresses)
    );

    if (torrentsNeedingDetails.length === 0) {
        return;
    }

    logger.info(`[phase-2] Parallel batch fetching details for ${torrentsNeedingDetails.length} torrents`);

    const details = await fetchTorrentDetails(providerName, apiKey, torrentsNeedingDetails.map(match => match.item));
    for (const match of torrentsNeedingDetails) {
        const found = details.get(String(match.item.id));
        if (found) Object.assign(match.item, attachParse(found));
    }
    logger.debug(`[phase-2] Bulk fetch completed for ${torrentsNeedingDetails.length} torrents`);
}

/**
 * Perform deep content analysis for episode matching with optimized parallel processing
 * @param {Array} titleMatches - Matches from Phase 1
 * @param {number} season - Target season
 * @param {number} episode - Target episode  
 * @param {Object} absoluteEpisode - Absolute episode data from Trakt (optional)
 * @returns {Array} Array of matching episodes
 */
export async function performContentAnalysis(titleMatches, addresses, aliasVocabularies = []) {
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
                const torrent = match.item;
                const analysis = analyzeTorrent(torrent, addresses);
                return {
                    torrent,
                    analysis,
                    score: match.score,
                    matchedTerm: match.matchedTerm,
                    identityMatch: match.identityMatch === true
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
                if (result.identityMatch) {
                    const names = result.analysis.isContainer
                        ? result.analysis.matchingFiles.map(video => video.fileName)
                        : [result.torrent.name];

                    if (!names.some(name => isSameWorkStrict(parseName(name)?.title, aliasVocabularies))) {
                        logger.debug(`[phase-2] Identity check rejected ${result.torrent.name}`);
                        return [];
                    }
                }

                const streamFiles = result.analysis.isContainer
                    ? result.analysis.matchingFiles
                    : selectEpisodeFiles(result.torrent.videos, addresses);

                if (!streamFiles.length) {
                    logger.debug(`[phase-2] No usable file for ${result.torrent.name}`);
                    return [];
                }

                result.torrent.videos = streamFiles;

                // For containers, return each matching video as a separate result
                if (result.analysis.isContainer && result.analysis.matchingFiles.length > 0) {
                    return result.analysis.matchingFiles.map(video => ({
                        id: result.torrent.id,
                        provider: result.torrent.provider,
                        name: video.fileName,
                        size: video.size,
                        url: video.url,
                        containerName: result.torrent.name,
                        isExtractedVideo: true,
                        videos: [video],
                        matchedTerm: result.matchedTerm,
                        torrentDetails: result.torrent
                    }));
                } else {
                    // For direct files, return as is
                    return [{
                        ...result.torrent,
                        matchedTerm: result.matchedTerm,
                        torrentDetails: result.torrent
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
