/**
 * Centralized Absolute Episode Processing
 * Handles all absolute episode logic in one place
 * 
 * Design Philosophy:
 * - Trakt-first approach: Only use absolute episodes from Trakt API
 * - Post-processing: Apply AFTER standard parsing is complete
 * - Non-interfering: Does not affect standard season/episode parsing
 * - Simple matching: Only exact Trakt numbers, no pattern guessing
 */

import { logger } from './logger.js';

export class AbsoluteEpisodeProcessor {
    
    /**
     * Process absolute episode matching for torrents
     * Called AFTER standard parsing is complete
     * 
     * @param {Object} traktData - Absolute episode info from Trakt API
     * @param {Array} torrentVideos - Array of video files from torrent
     * @returns {Array} Enhanced video files with absolute episode matches
     */
    static processAbsoluteEpisodes(traktData, torrentVideos) {
        if (!traktData || !traktData.absoluteEpisode) {
            logger.debug('[AbsoluteEpisodeProcessor] No Trakt absolute episode data, skipping processing');
            return torrentVideos; // No absolute episode, return as-is
        }
        
        const absoluteNumber = traktData.absoluteEpisode;
        logger.debug(`[AbsoluteEpisodeProcessor] Processing ${torrentVideos.length} videos for absolute episode ${absoluteNumber}`);
        
        const enhancedVideos = [];
        let matchCount = 0;
        
        for (const video of torrentVideos) {
            const enhanced = { ...video };
            
            // Check if this video matches the Trakt absolute episode
            if (this.matchesAbsoluteEpisode(video.name, absoluteNumber)) {
                matchCount++;
                logger.debug(`[AbsoluteEpisodeProcessor] ✅ Absolute episode ${absoluteNumber} match: "${video.name}"`);
                
                // Apply Trakt mapping (season/episode from Trakt)
                enhanced.isAbsoluteMatch = true;
                enhanced.traktMapping = {
                    season: traktData.season,
                    episode: traktData.episode,
                    absoluteEpisode: absoluteNumber,
                    title: traktData.title || 'Unknown Title'
                };
                
                // Update season/episode from Trakt for absolute matches
                // This ensures the stream shows the correct season/episode from Trakt
                if (enhanced.info) {
                    enhanced.info.season = traktData.season;
                    enhanced.info.episode = traktData.episode;
                    enhanced.info.absoluteEpisode = absoluteNumber;
                    enhanced.info.traktMapped = true;
                }
                
                logger.debug(`[AbsoluteEpisodeProcessor] Applied Trakt mapping: absolute ${absoluteNumber} → S${traktData.season}E${traktData.episode}`);
            }
            
            enhancedVideos.push(enhanced);
        }
        
        logger.debug(`[AbsoluteEpisodeProcessor] Found ${matchCount} absolute episode matches out of ${torrentVideos.length} videos`);
        return enhancedVideos;
    }
    
    /**
     * Check if a filename contains the Trakt absolute episode number
     * Uses simple, reliable patterns for EXACT matching only
     * Enhanced to be season-aware and avoid false positives
     * 
     * @param {string} filename - Video filename
     * @param {number} absoluteEpisode - Trakt absolute episode number
     * @returns {boolean} True if match found
     */
    static matchesAbsoluteEpisode(filename, absoluteEpisode) {
        if (!filename || !absoluteEpisode || typeof absoluteEpisode !== 'number') {
            return false;
        }
        
        // Convert to string for pattern matching
        const episodeStr = absoluteEpisode.toString();
        const filenameLower = filename.toLowerCase();
        
        // Check if file contains season/episode patterns that would conflict
        // If file has clear S01E01, S02E01, etc. patterns, be more careful with absolute matching
        const seasonEpisodeMatch = filenameLower.match(/s(\d+)e(\d+)/);
        if (seasonEpisodeMatch) {
            const fileSeason = parseInt(seasonEpisodeMatch[1], 10);
            const fileEpisode = parseInt(seasonEpisodeMatch[2], 10);
            
            // For files with season/episode patterns, only consider absolute matching if:
            // 1. It's a high episode number (>100, likely anime absolute numbering)
            // 2. Or it's a specific anime-style pattern (like "029", "030", etc.)
            if (absoluteEpisode <= 50) {
                // For low absolute episode numbers, be very restrictive
                // Only match if it's clearly anime-style absolute numbering
                const animeAbsolutePatterns = [
                    // Padded absolute episode numbers (anime style)
                    new RegExp(`\\b0{1,2}${absoluteEpisode}\\b`),        // " 029 ", " 030 "
                    // Separated by dots/dashes with padding
                    new RegExp(`[-\\.]0{1,2}${absoluteEpisode}[\\.\\s-]`),   // "-029.", ".030 "
                ];
                
                for (const pattern of animeAbsolutePatterns) {
                    if (pattern.test(filename)) {
                        logger.debug(`[AbsoluteEpisodeProcessor] Anime-style absolute pattern match: "${pattern.source}" found in "${filename}"`);
                        return true;
                    }
                }
                
                // Don't match generic "Episode X" patterns for low numbers
                // This prevents S02E01 "Episode 1" from matching absolute episode 1
                logger.debug(`[AbsoluteEpisodeProcessor] Skipping generic episode pattern for low absolute number ${absoluteEpisode} in season/episode file: "${filename}"`);
                return false;
            }
        }
        
        // Original patterns for files without clear season/episode structure
        // or for high absolute episode numbers (>50, likely genuine absolute numbering)
        const patterns = [
            // Word boundary patterns (most reliable)
            new RegExp(`\\b0*${absoluteEpisode}\\b`),        // " 030 ", " 30 "
            
            // Delimited patterns
            new RegExp(`[-\\.]0*${absoluteEpisode}[\\.\\s-]`),   // "-030.", ".30 "
            
            // Episode prefix patterns (only for files without season patterns or high episode numbers)
            ...(absoluteEpisode > 50 || !seasonEpisodeMatch ? [
                new RegExp(`(?:episode|ep)\\s*0*${absoluteEpisode}\\b`, 'i')
            ] : []),
            
            // Dot separation patterns
            new RegExp(`\\.0*${absoluteEpisode}\\.`),
        ];
        
        for (const pattern of patterns) {
            if (pattern.test(filename)) {
                logger.debug(`[AbsoluteEpisodeProcessor] Pattern match: "${pattern.source}" found in "${filename}"`);
                return true;
            }
        }
        
        return false;
    }
    
    /**
     * Validate that absolute episode processing is working correctly
     * Used for testing and debugging
     * 
     * @param {Object} traktData - Trakt data to validate
     * @param {Array} results - Processing results
     * @returns {Object} Validation report
     */
    static validateProcessing(traktData, results) {
        if (!traktData || !traktData.absoluteEpisode) {
            return {
                valid: true,
                reason: 'No absolute episode to validate'
            };
        }
        
        const absoluteMatches = results.filter(video => video.isAbsoluteMatch);
        
        return {
            valid: absoluteMatches.length > 0,
            absoluteEpisode: traktData.absoluteEpisode,
            matchCount: absoluteMatches.length,
            totalVideos: results.length,
            matches: absoluteMatches.map(video => ({
                name: video.name,
                traktMapping: video.traktMapping
            }))
        };
    }
    
    /**
     * Get statistics about absolute episode processing
     * Useful for monitoring and debugging
     * 
     * @param {Array} processedVideos - Videos after processing
     * @returns {Object} Processing statistics
     */
    static getProcessingStats(processedVideos) {
        const totalVideos = processedVideos.length;
        const absoluteMatches = processedVideos.filter(video => video.isAbsoluteMatch);
        const traktMapped = processedVideos.filter(video => video.info?.traktMapped);
        
        return {
            totalVideos,
            absoluteMatches: absoluteMatches.length,
            traktMapped: traktMapped.length,
            hasAbsoluteEpisodes: absoluteMatches.length > 0,
            matchPercentage: totalVideos > 0 ? (absoluteMatches.length / totalVideos * 100).toFixed(1) : 0
        };
    }
}

/**
 * Utility function for backward compatibility
 * Processes absolute episodes for a single torrent result
 * 
 * @param {Object} torrentResult - Single torrent search result
 * @param {Object} traktData - Trakt absolute episode data
 * @returns {Object} Enhanced torrent result
 */
export function processAbsoluteEpisodesForTorrent(torrentResult, traktData) {
    if (!torrentResult || !torrentResult.torrentDetails || !torrentResult.torrentDetails.videos) {
        return torrentResult;
    }
    
    const enhanced = { ...torrentResult };
    enhanced.torrentDetails = { ...torrentResult.torrentDetails };
    enhanced.torrentDetails.videos = AbsoluteEpisodeProcessor.processAbsoluteEpisodes(
        traktData, 
        torrentResult.torrentDetails.videos
    );
    
    return enhanced;
}

/**
 * Utility function to check if a video file matches absolute episode criteria
 * Simplified interface for external use
 * 
 * @param {string} filename - Video filename to check
 * @param {number} absoluteEpisode - Absolute episode number from Trakt
 * @returns {boolean} True if filename matches absolute episode
 */
export function isAbsoluteEpisodeMatch(filename, absoluteEpisode) {
    return AbsoluteEpisodeProcessor.matchesAbsoluteEpisode(filename, absoluteEpisode);
}

export default AbsoluteEpisodeProcessor;
