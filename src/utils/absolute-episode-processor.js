/**
 * Centralized Absolute Episode Processing
 * Handles all absolute episode logic in one place
 */

import { logger } from './logger.js';
import { parseRomanSeasons } from './roman-numeral-utils.js';
import { parseSeasonFromTitle } from './episode-patterns.js';
import cache from './cache-manager.js'; // Use unified cache manager

const ABSOLUTE_CACHE_TTL = 86400; // 24 hours TTL - torrent filenames never change

export class AbsoluteEpisodeProcessor {
    
    /**
     * Process absolute episode matching for torrents
     * Called AFTER standard parsing is complete
     */
    static processAbsoluteEpisodes(episodeMapping, torrentVideos) {
        if (!episodeMapping || !episodeMapping.absoluteEpisode) {
            logger.debug('[AbsoluteEpisodeProcessor] No absolute episode data, skipping processing');
            return torrentVideos; // No absolute episode, return as-is
        }

        const absoluteNumber = episodeMapping.absoluteEpisode;

        const enhancedVideos = [];
        let matchCount = 0;

        for (const video of torrentVideos) {
            const enhanced = { ...video };

            if (this.matchesAbsoluteEpisode(video.name, absoluteNumber)) {
                matchCount++;
                logger.debug(`[AbsoluteEpisodeProcessor] ✅ Absolute episode ${absoluteNumber} match: "${video.name}"`);

                enhanced.isAbsoluteMatch = true;
                enhanced.absoluteMapping = {
                    season: episodeMapping.season,
                    episode: episodeMapping.episode,
                    absoluteEpisode: absoluteNumber,
                    title: episodeMapping.title || 'Unknown Title'
                };

                // Carry the mapped address onto the video so the stream shows the right episode.
                if (enhanced.info) {
                    enhanced.info.season = episodeMapping.season;
                    enhanced.info.episode = episodeMapping.episode;
                    enhanced.info.absoluteEpisode = absoluteNumber;
                    enhanced.info.traktMapped = true;
                }

                logger.debug(`[AbsoluteEpisodeProcessor] Applied mapping: absolute ${absoluteNumber} → S${episodeMapping.season}E${episodeMapping.episode}`);
            }
            
            enhancedVideos.push(enhanced);
        }
        return enhancedVideos;
    }
    
    /**
     * Check if a filename contains the resolved absolute episode number
     */
    static matchesAbsoluteEpisode(filename, absoluteEpisode) {
        if (!filename || !absoluteEpisode || typeof absoluteEpisode !== 'number') {
            return false;
        }
        
        // Performance optimization: Check unified cache first
        const cacheKey = `absolute:${filename}:${absoluteEpisode}`;
        const cached = cache.get(cacheKey);
        if (cached !== null) {
            return cached;
        }
        
        const result = this._performAbsoluteEpisodeMatch(filename, absoluteEpisode);
        
        // Cache the result in unified cache
        cache.set(cacheKey, result, ABSOLUTE_CACHE_TTL, { type: 'absolute-episode' });
        
        return result;
    }
    
    /**
     * Internal method to perform the actual absolute episode matching
     */
    static _performAbsoluteEpisodeMatch(filename, absoluteEpisode) {
        
        // Check for roman numeral season context first
        // If this file has roman numerals representing seasons, don't use absolute episode matching
        const romanSeasonInfo = parseRomanSeasons(filename);
        if (romanSeasonInfo) {return false;        }
        
        // Convert to string for pattern matching
        const episodeStr = absoluteEpisode.toString();
        const filenameLower = filename.toLowerCase();
        
        // Check if file contains season/episode patterns that would conflict
        // If file has clear S01E01, S02E01, S02 - 01, etc. patterns, do NOT use absolute episode matching
        // Explicit season/episode patterns take precedence over absolute episode numbers
        const seasonEpisodeMatch = filenameLower.match(/s(\d+)(?:e(\d+)|\s*-\s*(\d+))/);
        if (seasonEpisodeMatch) {
            return false; // Never match absolute episodes for files with explicit season/episode patterns
        }
        
        // If any RELIABLE season indicator is found, don't use absolute episode matching
        const detectedSeason = parseSeasonFromTitle(filename, true);
        if (detectedSeason !== null) {
            logger.debug(`[AbsoluteEpisodeProcessor] Season ${detectedSeason} detected (strict), skipping absolute episode matching`);
            return false; // Files with clear season indicators should not use absolute episode matching
        }
        
        // Original patterns for files without clear season/episode structure
        const patterns = [
            // Word boundary patterns (most reliable)
            new RegExp(`\\b0*${absoluteEpisode}\\b`),        // " 030 ", " 30 "
            
            // Delimited patterns
            new RegExp(`[-\\.]0*${absoluteEpisode}[\\.\\s-]`),   // "-030.", ".30 "
            
            // Episode prefix patterns - handles E012, Ep012, Episode 012 formats
            // This is common in anime releases like "One.Piece.E012.MULTi.1080p.mkv"
            new RegExp(`[\\.-]E[Pp]?0*${absoluteEpisode}[\\.-]`, 'i'),  // ".E012.", ".EP012."
            
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
     */
    static validateProcessing(episodeMapping, results) {
        if (!episodeMapping || !episodeMapping.absoluteEpisode) {
            return {
                valid: true,
                reason: 'No absolute episode to validate'
            };
        }

        const absoluteMatches = results.filter(video => video.isAbsoluteMatch);

        return {
            valid: absoluteMatches.length > 0,
            absoluteEpisode: episodeMapping.absoluteEpisode,
            matchCount: absoluteMatches.length,
            totalVideos: results.length,
            matches: absoluteMatches.map(video => ({
                name: video.name,
                absoluteMapping: video.absoluteMapping
            }))
        };
    }
    
    /**
     * Get statistics about absolute episode processing
     * Useful for monitoring and debugging
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
 */
export function processAbsoluteEpisodesForTorrent(torrentResult, episodeMapping) {
    if (!torrentResult || !torrentResult.torrentDetails || !torrentResult.torrentDetails.videos) {
        return torrentResult;
    }

    const enhanced = { ...torrentResult };
    enhanced.torrentDetails = { ...torrentResult.torrentDetails };
    enhanced.torrentDetails.videos = AbsoluteEpisodeProcessor.processAbsoluteEpisodes(
        episodeMapping,
        torrentResult.torrentDetails.videos
    );
    
    return enhanced;
}

/**
 * Utility function to check if a video file matches absolute episode criteria
 */
export function isAbsoluteEpisodeMatch(filename, absoluteEpisode) {
    return AbsoluteEpisodeProcessor.matchesAbsoluteEpisode(filename, absoluteEpisode);
}

export default AbsoluteEpisodeProcessor;