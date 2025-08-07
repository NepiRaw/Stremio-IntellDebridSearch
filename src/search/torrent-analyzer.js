/**
 * Torrent Analyzer - Extract analyzeTorrent and related functions from working addon
 * Handles torrent content analysis for episode matching (Phase 2)
 */

import { logger } from '../utils/logger.js';
import { FILE_EXTENSIONS } from '../utils/media-patterns.js';
import { extractAbsoluteEpisodeLegacy, parseUnified } from '../utils/unified-torrent-parser.js';
import { isVideo } from '../stream/metadata-extractor.js';

/**
 * Check if two season numbers match, handling various formats and edge cases
 * @param {string|number} foundSeason - The season number found in the torrent
 * @param {string|number} targetSeason - The season number we're looking for
 * @returns {boolean} - Whether the seasons match
 */
export function checkSeasonMatch(foundSeason, targetSeason) {
    // Handle null/undefined values, but allow 0 (since season 0 is valid for specials/OVA)
    if ((foundSeason === null || foundSeason === undefined) || 
        (targetSeason === null || targetSeason === undefined)) {
        return false;
    }
    
    // If either is a string, try to parse it as a number directly
    // (unified parser handles complex season parsing)
    if (typeof foundSeason === 'string') {
        const parsed = parseInt(foundSeason, 10);
        if (!isNaN(parsed)) foundSeason = parsed;
    }
    if (typeof targetSeason === 'string') {
        const parsed = parseInt(targetSeason, 10);
        if (!isNaN(parsed)) targetSeason = parsed;
    }
    
    // Convert both to numbers for comparison
    const normalizedTarget = parseInt(targetSeason, 10);
    const normalizedFound = parseInt(foundSeason, 10);
    
    // Check if both are valid numbers within reasonable range (0-30, including season 0 for specials/OVA)
    if (!isNaN(normalizedTarget) && !isNaN(normalizedFound) &&
        normalizedTarget >= 0 && normalizedTarget <= 30 &&
        normalizedFound >= 0 && normalizedFound <= 30) {
        return normalizedFound === normalizedTarget;
    }
    
    return false;
}

/**
 * Enhanced absolute episode number extraction from filename
 * @param {string} filename - The filename to parse
 * @returns {number|null} - Absolute episode number or null
 */
export function extractAbsoluteEpisode(filename) {
    // Use unified parser implementation for consistency
    return extractAbsoluteEpisodeLegacy(filename);
}

/**
 * Analyze a torrent for episode matching - PHASE 2: Deep content analysis
 * @param {Object} torrent - The torrent to analyze
 * @param {number} targetSeason - Target season number
 * @param {number} targetEpisode - Target episode number
 * @param {number} absoluteEpisode - Absolute episode number from Trakt (optional)
 * @returns {Object} - Analysis result
 */
export function analyzeTorrent(torrent, targetSeason, targetEpisode, absoluteEpisode = null) {
    const result = {
        isDirect: false,
        isContainer: false,
        hasMatchingEpisode: false,
        matchingFiles: [],
        details: null,
        seasonInfo: { found: null, target: targetSeason }
    };

    const info = torrent.info || {};
    
    // Function to check episode match accounting for different formats
    const isEpisodeMatch = (videoInfo, videoName = '') => {
        if (!videoInfo) return false;
        
        // Try explicit season/episode first (classic matching)
        if (checkSeasonMatch(videoInfo.season, targetSeason) && 
            parseInt(videoInfo.episode, 10) === parseInt(targetEpisode, 10)) {
            logger.info(`[torrent-analyzer] ✅ Classic S${targetSeason}E${targetEpisode} match (found S${videoInfo.season}E${videoInfo.episode}) for: ${videoName}`);
            return true;
        }
        
        // Try absolute episode number ONLY if we couldn't find clear season/episode pattern
        if (absoluteEpisode && !videoInfo.season && !videoInfo.episode) {
            logger.info(`[torrent-analyzer] No season/episode found, trying absolute episode matching for: ${videoName}`);
            
            // Check if videoInfo already has absoluteEpisode
            if (videoInfo.absoluteEpisode && 
                parseInt(videoInfo.absoluteEpisode, 10) === parseInt(absoluteEpisode, 10)) {
                logger.info(`[torrent-analyzer] ✅ Trakt absolute episode ${absoluteEpisode} match (from videoInfo) for: ${videoName}`);
                return true;
            }

            // Try extracting from filename using enhanced method
            const extractedAbsolute = extractAbsoluteEpisode(videoName || videoInfo.name || '');
            if (extractedAbsolute && extractedAbsolute === parseInt(absoluteEpisode, 10)) {
                logger.info(`[torrent-analyzer] ✅ Trakt absolute episode ${absoluteEpisode} match (extracted: ${extractedAbsolute}) for: ${videoName}`);
                return true;
            }

            // Fallback: try parsing absolute episode from filename using unified parser
            if (!videoInfo.absoluteEpisode) {
                const parsedInfo = parseUnified(videoName || videoInfo.name || '');
                if (parsedInfo.absoluteEpisode && parseInt(parsedInfo.absoluteEpisode, 10) === parseInt(absoluteEpisode, 10)) {
                    logger.info(`[torrent-analyzer] ✅ Trakt absolute episode ${absoluteEpisode} match (parsed: ${parsedInfo.absoluteEpisode}) for: ${videoName}`);
                    return true;
                }
            }
        }
        
        // Handle files with absolute numbering but no season/episode pattern
        // This handles cases like "DanMachi 031" where no season/episode pattern is detected
        // but an absolute number is found that could match the target episode
        if (!videoInfo.season && !videoInfo.episode) {
            logger.info(`[torrent-analyzer] No season/episode detected, trying absolute number extraction for: ${videoName}`);
            
            // Extract potential absolute number from filename (not using Trakt absoluteEpisode)
            const extractedNumber = extractAbsoluteEpisode(videoName || videoInfo.name || '');
            if (extractedNumber) {
                logger.info(`[torrent-analyzer] Extracted absolute number: ${extractedNumber} from filename: ${videoName}`);
                
                // Method 1: Direct match with target episode (for absolute episode numbering)
                if (parseInt(extractedNumber, 10) === parseInt(targetEpisode, 10)) {
                    logger.info(`[torrent-analyzer] ✅ Direct absolute number ${extractedNumber} matches target episode ${targetEpisode}: ${videoName}`);
                    return true;
                }
                
                // Method 2: Direct match with Trakt absolute episode (preferred)
                if (absoluteEpisode && parseInt(extractedNumber, 10) === parseInt(absoluteEpisode, 10)) {
                    logger.info(`[torrent-analyzer] ✅ Direct absolute number ${extractedNumber} matches Trakt absolute ${absoluteEpisode}: ${videoName}`);
                    return true;
                }
            }
        }
        
        return false;
    };
    
    // Check if this is a single video file
    if (isVideo(torrent.name)) {
        result.isDirect = true;
        
        // Parse season/episode from filename if not in info using unified parser
        if (!info.season || !info.episode) {
            const parsed = parseUnified(torrent.name);
            logger.info(`[torrent-analyzer] parseUnified for "${torrent.name}": season=${parsed.season}, episode=${parsed.episode}`);
            info.season = info.season || parsed.season;
            info.episode = info.episode || parsed.episode;
            info.absoluteEpisode = info.absoluteEpisode || parsed.absoluteEpisode; // For absolute numbering
            
            // Enhanced Roman numeral detection is already handled by unified parser
            if (!info.season && parsed.season) {
                info.season = parsed.season;
                info.episode = info.episode || parsed.episode;
            }
            
            // Fallback: if still no season and we're looking for season 1, assume it's season 1
            // Note: Check for null/undefined explicitly since season 0 is valid (for OVAs/specials)
            if ((info.season === null || info.season === undefined) && targetSeason === 1 && info.episode) {
                logger.warn(`[torrent-analyzer] PROBLEMATIC FALLBACK: Setting season=1 for "${torrent.name}" with episode=${info.episode} (originally season=${info.season})`);
                info.season = 1;
            }
        }
        
        if (isEpisodeMatch(info, torrent.name)) {
            result.hasMatchingEpisode = true;
            result.matchingFiles = [torrent];
        }

        return result;
    }
    
    // It's a container, check its video files
    result.isContainer = true;
    if (torrent.videos?.length) {
        
        // For containers, try to find matching episodes - NO FALLBACK CALCULATIONS
        const matchingVideos = torrent.videos.filter(video => {
            const videoInfo = video.info || {};
            
            // Only parse if not already parsed (performance improvement)
            if (!videoInfo.season || !videoInfo.episode) {
                const parsed = parseUnified(video.name);
                logger.info(`[torrent-analyzer] parseUnified for video "${video.name}": season=${parsed.season}, episode=${parsed.episode}`);
                videoInfo.season = videoInfo.season || parsed.season;
                videoInfo.episode = videoInfo.episode || parsed.episode;
                videoInfo.absoluteEpisode = videoInfo.absoluteEpisode || parsed.absoluteEpisode; // For absolute numbering
                
                // Enhanced Roman numeral detection is already handled by unified parser
                if (!videoInfo.season && parsed.season) {
                    videoInfo.season = parsed.season;
                    videoInfo.episode = videoInfo.episode || parsed.episode;
                }
                
                // Fallback: if still no season and we're looking for season 1, assume it's season 1
                // Note: Check for null/undefined explicitly since season 0 is valid (for OVAs/specials)
                if ((videoInfo.season === null || videoInfo.season === undefined) && targetSeason === 1 && videoInfo.episode) {
                    logger.warn(`[torrent-analyzer] PROBLEMATIC FALLBACK (video): Setting season=1 for video "${video.name}" with episode=${videoInfo.episode} (originally season=${videoInfo.season})`);
                    videoInfo.season = 1;
                }
                
                // Store parsed info for later use
                video.info = videoInfo;
            }

            return isEpisodeMatch(videoInfo, video.name);
        });
        
        if (matchingVideos.length > 0) {
            result.hasMatchingEpisode = true;
            result.matchingFiles = matchingVideos;
        }
    } else {
        logger.info(`[torrent-analyzer] Container has no processed videos:`, torrent.name);
    }

    return result;
}
