/**
 * Torrent Analyzer - Extract analyzeTorrent and related functions from working addon
 * Handles torrent content analysis for episode matching (Phase 2)
 */

import { logger } from '../utils/logger.js';
import parseTorrentTitleModule from '../utils/parse-torrent-title.js';

// Extract functions from the module
const { parse: parseTorrentTitle } = parseTorrentTitleModule;

/**
 * Check if filename is a video file
 * @param {string} filename - The filename to check
 * @returns {boolean} - Whether it's a video file
 */
function isVideo(filename) {
    if (!filename) return false;
    const videoExtensions = ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.ts', '.m2ts'];
    return videoExtensions.some(ext => filename.toLowerCase().endsWith(ext));
}

/**
 * Convert Roman numeral to number
 * @param {string} roman - Roman numeral string
 * @returns {number|null} - Converted number or null
 */
function romanToNumber(roman) {
    const romanNumerals = {
        'I': 1, 'V': 5, 'X': 10, 'L': 50, 'C': 100, 'D': 500, 'M': 1000
    };
    
    let result = 0;
    let prevValue = 0;
    
    for (let i = roman.length - 1; i >= 0; i--) {
        const currentValue = romanNumerals[roman[i]];
        if (!currentValue) return null;
        
        if (currentValue < prevValue) {
            result -= currentValue;
        } else {
            result += currentValue;
        }
        prevValue = currentValue;
    }
    
    return result;
}

/**
 * Parse season number from string with enhanced handling
 * @param {string} seasonStr - Season string to parse
 * @param {boolean} strict - Whether to use strict parsing
 * @returns {number|null} - Parsed season number or null
 */
function parseSeason(seasonStr, strict = false) {
    if (!seasonStr) return null;
    
    // Try direct integer parsing first
    const directParse = parseInt(seasonStr, 10);
    if (!isNaN(directParse) && directParse >= 0 && directParse <= 30) {
        return directParse;
    }
    
    // Try Roman numeral parsing
    if (typeof seasonStr === 'string') {
        const upperCase = seasonStr.toUpperCase();
        const romanResult = romanToNumber(upperCase);
        if (romanResult && romanResult >= 1 && romanResult <= 30) {
            return romanResult;
        }
    }
    
    return null;
}

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
    
    // If either is a string, try to parse it as a season number
    if (typeof foundSeason === 'string') {
        const parsed = parseSeason(foundSeason, true); // Use strict mode
        if (parsed) foundSeason = parsed;
    }
    if (typeof targetSeason === 'string') {
        const parsed = parseSeason(targetSeason, true); // Use strict mode
        if (parsed) targetSeason = parsed;
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
    if (!filename) return null;
    
    // Clean the filename for better parsing
    const cleanFilename = filename.replace(/\.(mkv|mp4|avi|m4v)$/i, '');
    
    // Patterns to match absolute episode numbers
    const absolutePatterns = [
        // Pattern for "DanMachi 031", "Title 031", etc. (common in anime)
        /(\w+)\s+(\d{3,4})(?:\s|$)/i,
        // Pattern for "Title 001", "Title 031", etc. (common in anime)
        /(\w+)\s+(\d{2,4})(?:\s|$)/i,
        // Pattern for "Title - 001", "Title - 031"
        /(\w+)\s*-\s*(\d{2,4})(?:\s|$)/i,
        // Pattern for "001 - Title", "031 - Title"
        /^(\d{2,4})\s*-\s*(.+)/i,
        // Pattern for "Ep001", "Episode 031", "Episode 1000"
        /(?:ep|episode)\s*(\d{2,4})(?:\s|$)/i,
        // Pattern for numbers after title but before quality/source keywords
        /^([^0-9]*?)(\d{2,4})(?:\s+(?:multi|bluray|1080p|720p|x264|x265|web|dl|hdtv))/i
    ];
    
    for (const pattern of absolutePatterns) {
        const match = cleanFilename.match(pattern);
        if (match) {
            // For patterns where episode is in group 2, use that
            const episodeStr = match[2] || match[1];
            if (episodeStr && /^\d{2,4}$/.test(episodeStr)) {
                const episode = parseInt(episodeStr, 10);
                
                // Reasonable range for absolute episodes (1-9999)
                if (episode >= 1 && episode <= 9999) {
                    return episode;
                }
            }
        }
    }
    
    return null;
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

            // Fallback: try parsing absolute episode from filename using original parser
            if (!videoInfo.absoluteEpisode) {
                const parsedInfo = parseTorrentTitle(videoName || videoInfo.name || '');
                if (parsedInfo.episode && parseInt(parsedInfo.episode, 10) === parseInt(absoluteEpisode, 10)) {
                    logger.info(`[torrent-analyzer] ✅ Trakt absolute episode ${absoluteEpisode} match (parsed: ${parsedInfo.episode}) for: ${videoName}`);
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
        
        // Parse season/episode from filename if not in info
        if (!info.season || !info.episode) {
            const parsed = parseTorrentTitle(torrent.name);
            logger.info(`[torrent-analyzer] parseTorrentTitle for "${torrent.name}": season=${parsed.season}, episode=${parsed.episode}`);
            info.season = info.season || parsed.season;
            info.episode = info.episode || parsed.episode;
            info.absoluteEpisode = info.absoluteEpisode || parsed.episode; // For absolute numbering
            
            // Enhanced Roman numeral detection for season
            if (!info.season) {
                const romanMatch = torrent.name.match(/\b([IVXLCDM]+)\s*-?\s*(\d+)/i);
                if (romanMatch) {
                    const romanNumeral = romanMatch[1].toUpperCase();
                    const episodeNum = parseInt(romanMatch[2], 10);
                    
                    // Convert Roman numeral to season number
                    const seasonFromRoman = romanToNumber(romanNumeral);
                    
                    if (seasonFromRoman) {
                        info.season = seasonFromRoman;
                        info.episode = info.episode || episodeNum;
                    }
                }
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
                const parsed = parseTorrentTitle(video.name);
                logger.info(`[torrent-analyzer] parseTorrentTitle for video "${video.name}": season=${parsed.season}, episode=${parsed.episode}`);
                videoInfo.season = videoInfo.season || parsed.season;
                videoInfo.episode = videoInfo.episode || parsed.episode;
                videoInfo.absoluteEpisode = videoInfo.absoluteEpisode || parsed.episode; // For absolute numbering
                
                // Enhanced Roman numeral detection for season
                if (!videoInfo.season) {
                    const romanMatch = video.name.match(/\b([IVXLCDM]+)\s*-?\s*(\d+)/i);
                    if (romanMatch) {
                        const romanNumeral = romanMatch[1].toUpperCase();
                        const episodeNum = parseInt(romanMatch[2], 10);
                        
                        // Convert Roman numeral to season number
                        const seasonFromRoman = romanToNumber(romanNumeral);
                        
                        if (seasonFromRoman) {
                            videoInfo.season = seasonFromRoman;
                            videoInfo.episode = videoInfo.episode || episodeNum;
                        }
                    }
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
