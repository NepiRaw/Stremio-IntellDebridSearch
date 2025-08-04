/**
 * Episode Mapper - Extracted from working advanced-search.js
 * Handles episode/season parsing and absolute episode mapping using modular API
 */

import { getEpisodeMapping as traktGetEpisodeMapping } from '../api/trakt.js';
import { logger } from '../utils/logger.js';
import parseTorrentTitleModule from '../utils/parse-torrent-title.js';

// Extract functions from the module
const { parse: parseTorrentTitle, parseSeason, parseRomanNumeral, romanToNumber } = parseTorrentTitleModule;

/**
 * Get absolute episode mapping using the dedicated Trakt API module
 * @param {string} traktApiKey - The Trakt API key
 * @param {string} imdbId - The IMDb ID
 * @param {number} season - Season number
 * @param {number} episode - Episode number
 * @returns {Promise<number|null>} - Absolute episode number or null
 */
export async function getEpisodeMapping(traktApiKey, imdbId, season, episode) {
    // Use the dedicated Trakt API module instead of implementing our own calls
    const result = await traktGetEpisodeMapping(traktApiKey, imdbId, season, episode);
    
    // The trakt.js module returns an object with absoluteEpisode, we need just the number
    if (result && typeof result === 'object' && result.absoluteEpisode) {
        return result.absoluteEpisode;
    }
    
    // If it returns a number directly, use that
    if (typeof result === 'number') {
        return result;
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
 * Enhanced episode matching logic
 * @param {Object} videoInfo - Parsed video information
 * @param {string} videoName - Original video filename  
 * @returns {boolean} - Whether this video matches the target episode
 */
export function isEpisodeMatch(videoInfo, videoName) {
    // Implementation would depend on target season/episode context
    // This is a simplified version - the full logic would be in the coordinator
    return videoInfo && (videoInfo.season || videoInfo.episode || videoInfo.absoluteEpisode);
}
