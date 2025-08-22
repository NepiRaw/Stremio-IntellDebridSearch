/**
 * Episode Mapper
 * Handles episode/season parsing and absolute episode mapping
 */

import { getEpisodeMapping as traktGetEpisodeMapping } from '../api/trakt.js';
import { parseSeasonFromTitle } from '../utils/episode-patterns.js';
import { extractAbsoluteEpisodeLegacy } from '../utils/unified-torrent-parser.js';

// Extract functions for compatibility
const parseSeason = parseSeasonFromTitle;

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
 */
export function extractAbsoluteEpisode(filename) {
    return extractAbsoluteEpisodeLegacy(filename);
}

/**
 * Enhanced episode matching logic without problematic tolerance matching
 * @param {Object} videoInfo - Parsed video information
 * @param {string} videoName - Original video filename  
 * @param {number} targetSeason - Target season number
 * @param {number} targetEpisode - Target episode number
 * @param {number} absoluteEpisode - Absolute episode number from Trakt (preferred)
 * @returns {boolean} - Whether this video matches the target episode
 */
export function isEpisodeMatch(videoInfo, videoName, targetSeason, targetEpisode, absoluteEpisode = null) {
    if (!videoInfo) return false;
    
    // PRIORITY 1: Classic S##E## matching (most reliable)
    if (checkSeasonMatch(videoInfo.season, targetSeason) && 
        parseInt(videoInfo.episode, 10) === parseInt(targetEpisode, 10)) {
        return true;
    }
    
    // PRIORITY 2: Trakt absolute episode matching (when available and reliable)
    if (absoluteEpisode && videoInfo.absoluteEpisode && 
        parseInt(videoInfo.absoluteEpisode, 10) === parseInt(absoluteEpisode, 10)) {
        return true;
    }
    
    // PRIORITY 3: Direct absolute number extraction (exact match only, no tolerance)
    // Only use this when no season/episode pattern is detected
    if (!videoInfo.season && !videoInfo.episode) {
        // Extract potential absolute number from filename
        const extractedNumber = extractAbsoluteEpisode(videoName || videoInfo.name || '');
        if (extractedNumber) {
            // Method 1: Direct match with Trakt absolute episode (preferred)
            if (absoluteEpisode && parseInt(extractedNumber, 10) === parseInt(absoluteEpisode, 10)) {
                return true;
            }
            
            // Method 2: Direct match with target episode (for absolute episode numbering without Trakt)
            // This handles cases where the series uses absolute numbering instead of S##E##
            if (!absoluteEpisode && parseInt(extractedNumber, 10) === parseInt(targetEpisode, 10)) {
                return true;
            }
        }
    }
    
    // No matches found
    return false;
}