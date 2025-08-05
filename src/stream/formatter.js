/**
 * Stream formatter module for creating formatted stream objects
 * Handles title formatting, technical details extraction, and stream metadata
 */

import { extractReleaseGroup, isValidReleaseGroup } from '../utils/groups-util.js';
import { extractQualityDisplay, 
         TECHNICAL_PATTERNS, CLEANUP_PATTERNS, LANGUAGE_PATTERNS, 
         SOURCE_PATTERNS, CODEC_PATTERNS, AUDIO_PATTERNS, 
         COMPREHENSIVE_TECH_PATTERNS } from '../utils/media-patterns.js';
import { logger } from '../utils/logger.js';
import { FILE_TYPES } from '../utils/file-types.js';

const STREAM_NAME_MAP = {
    debridlink: "[DL+] DebridSearch",
    realdebrid: "[RD+] DebridSearch",
    alldebrid: "[AD⚡] DebridSearch",
    premiumize: "[PM+] DebridSearch",
    torbox: "[TB+] DebridSearch"
};

/**
 * Format file size in human readable format
 * @param {number} size - Size in bytes
 * @returns {string} - Formatted size string
 */
export function formatSize(size) {
    if (!size) {
        return undefined;
    }

    const i = size === 0 ? 0 : Math.floor(Math.log(size) / Math.log(1024));
    return Number((size / Math.pow(1024, i)).toFixed(2)) + ' ' + ['B', 'kB', 'MB', 'GB', 'TB'][i];
}

/**
 * Calculate string similarity using a simple algorithm
 * @param {string} str1 - First string
 * @param {string} str2 - Second string
 * @returns {number} - Similarity ratio between 0 and 1
 */
function calculateStringSimilarity(str1, str2) {
    if (!str1 || !str2) return 0;
    if (str1 === str2) return 1;
    
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;
    
    if (longer.length === 0) return 1;
    
    const editDistance = levenshteinDistance(longer, shorter);
    return (longer.length - editDistance) / longer.length;
}

/**
 * Calculate Levenshtein distance between two strings
 * @param {string} str1 - First string
 * @param {string} str2 - Second string
 * @returns {number} - Edit distance
 */
function levenshteinDistance(str1, str2) {
    const matrix = [];
    
    for (let i = 0; i <= str2.length; i++) {
        matrix[i] = [i];
    }
    
    for (let j = 0; j <= str1.length; j++) {
        matrix[0][j] = j;
    }
    
    for (let i = 1; i <= str2.length; i++) {
        for (let j = 1; j <= str1.length; j++) {
            if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }
    
    return matrix[str2.length][str1.length];
}

/**
 * Convert Roman numerals to numbers
 * @param {string} roman - Roman numeral string
 * @returns {number} - Corresponding number
 */
function romanToNumber(roman) {
    const romanMap = { 'I': 1, 'V': 5, 'X': 10, 'L': 50, 'C': 100, 'D': 500, 'M': 1000 };
    let result = 0;
    
    for (let i = 0; i < roman.length; i++) {
        const current = romanMap[roman[i]];
        const next = romanMap[roman[i + 1]];
        
        if (current < next) {
            result += next - current;
            i++;
        } else {
            result += current;
        }
    }
    
    return result;
}

/**
 * Remove file extension from filename
 * @param {string} filename - Filename with extension
 * @returns {string} - Filename without extension
 */
function removeExtension(filename) {
    if (!filename) return '';
    const lastDotIndex = filename.lastIndexOf('.');
    return lastDotIndex > 0 ? filename.substring(0, lastDotIndex) : filename;
}

/**
 * Extract series information (title, season, episode) from filename
 * @param {string} videoName - Video filename
 * @param {string} containerName - Container name
 * @returns {Object} - Extracted series info
 */
export function extractSeriesInfo(videoName, containerName) {
    const name = videoName || containerName || '';
    
    let seasonEpisode = 'Unknown Episode';
    let title = name;
    let episodeName = null;
    
    // Try multiple season/episode patterns (order matters - most specific first)
    const patterns = [
        { regex: /[Ss](\d+)[Ee](\d+)/, type: 'standard' },           // S01E01
        { regex: /[Ss](\d+)\s*-\s*(\d+)/, type: 'dash' },            // S5 - 14
        { regex: /\b([IVX]+)\s*-\s*(\d+)/, type: 'roman' },          // III - 06
        { regex: /\b([IVX]+)\s+(\d+)/, type: 'roman_space' },        // I 04
        { regex: /(\d+)x(\d+)/, type: 'standard' },                  // 1x01
        { regex: /[Ee](\d+)/, type: 'episode_only' },                // E07 (assume season 1)
        // Add absolute episode patterns for anime-style filenames
        { regex: /\b(\d{3})\s/, type: 'absolute' }                   // DanMachi 031 MULTI
    ];
    
    let seasonEpisodeMatch = null;
    let matchType = null;
    
    for (const pattern of patterns) {
        seasonEpisodeMatch = name.match(pattern.regex);
        if (seasonEpisodeMatch) {
            matchType = pattern.type;
            break;
        }
    }
    
    if (seasonEpisodeMatch) {
        let season, episode;
        
        if (matchType === 'roman' || matchType === 'roman_space') {
            season = romanToNumber(seasonEpisodeMatch[1]) || 1;
            episode = parseInt(seasonEpisodeMatch[2]);
        } else if (matchType === 'episode_only') {
            season = 1; // Default to season 1 when only episode is found
            episode = parseInt(seasonEpisodeMatch[1]);
        } else if (matchType === 'absolute') {
            // For absolute episodes, we don't know the exact season/episode
            // This will be handled by advanced search later
            seasonEpisode = 'Unknown Episode';
            // Extract only the series name (everything before the absolute episode number)
            title = name.substring(0, seasonEpisodeMatch.index).trim();
        } else {
            season = parseInt(seasonEpisodeMatch[1]);
            episode = parseInt(seasonEpisodeMatch[2]);
        }
        
        if (matchType !== 'absolute') {
            seasonEpisode = `S${season.toString().padStart(2, '0')}E${episode.toString().padStart(2, '0')}`;
            // Extract title (everything before the season/episode pattern)
            title = name.substring(0, seasonEpisodeMatch.index).trim();
        }
    } else {
        // For files without clear patterns, try to extract a reasonable series title
        // Look for common series title patterns at the beginning
        const titleMatch = name.match(/^([A-Za-z][A-Za-z0-9\s]*?)(?:\s+\d{3,}|\s+[Ss]\d+|\s+[IVX]+|\s*[\[\(])/);
        if (titleMatch) {
            title = titleMatch[1].trim();
        }
    }
    
    // Clean up the title - remove group tags and clean separators
    title = title
        .replace(/^[\[\(][^\]\)]*[\]\)]\s*/, '') // Remove group tags at start like [Group]
        .replace(/[\._]/g, ' ')                   // Replace dots and underscores with spaces
        .replace(/\s*-\s*$/, '')                  // Remove trailing dash
        .replace(/\s+/g, ' ')                     // Collapse multiple spaces
        .trim();
    
    // If title is still too long or contains technical terms, try to shorten it
    if (title.length > 50 || title.match(/\b(MULTI|BluRay|1080p|720p|x264|x265|HEVC|mkv)\b/i)) {
        // Try to extract just the actual series name from the beginning
        const shortTitleMatch = title.match(/^([A-Za-z][A-Za-z0-9\s]{2,25}?)(?:\s+\d+|\s+(MULTI|BluRay|1080p|720p|x264|x265|HEVC))/i);
        if (shortTitleMatch) {
            title = shortTitleMatch[1].trim();
        }
    }
    
    // If title is too short, try container name
    if (!title || title.length < 3) {
        title = (containerName || 'Unknown Series')
            .replace(/^[\[\(][^\]\)]*[\]\)]\s*/, '')
            .replace(/[\._]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim() || 'Unknown Series';
    }
    
    // Extract episode name from various patterns
    const episodePatterns = [
        /"([^"]+)"/,           // Double quotes: "Episode Name"
        /'([^']+)'/,           // Single quotes: 'Episode Name'
        // Pattern for: Series - SxxExx - Episode Name (technical info)
        /- [Ss]\d+[Ee]\d+ - ([^(]+?)(?:\s*\([^)]*\)|$)/
    ];
    
    logger.debug(`[extractSeriesInfo] Checking for episode names in: "${name}"`);
    logger.debug(`[extractSeriesInfo] Series title: "${title}"`);
    
    for (const pattern of episodePatterns) {
        const match = name.match(pattern);
        if (match && match[1] && match[1].trim().length > 2) {
            const content = match[1].trim();
            logger.debug(`[extractSeriesInfo] Found episode name pattern: "${content}"`);
            
            // Skip technical patterns
            if (content.match(/^\d+p$|^x26[45]$|^hevc$|^avc$|^10bits?$/i) || 
                content.match(/^[A-Z0-9]{8}$/i) || // Skip hashes
                content.match(/^(VRV|Multiple Subtitle|1080p|720p|480p)$/i)) {
                logger.debug(`[extractSeriesInfo] Skipping technical pattern: "${content}"`);
                continue;
            }
            
            // For redundancy check, use only the clean series title, not the whole filename
            // This fixes the issue where "DanMachi 031 MULTI..." was being used as the title
            const cleanTitleForComparison = title.replace(/\d+/g, '').replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
            const normalizedTitle = cleanTitleForComparison.toLowerCase();
            const normalizedContent = content.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
            
            logger.debug(`[extractSeriesInfo] Normalized title for comparison: "${normalizedTitle}"`);
            logger.debug(`[extractSeriesInfo] Normalized content: "${normalizedContent}"`);
            
            // Check if the episode name is too similar to the series title
            const titleWords = normalizedTitle.split(' ').filter(word => word.length > 3);
            const isRedundant = titleWords.some(word => {
                if (word.length > 4 && normalizedContent.includes(word)) {
                    logger.debug(`[extractSeriesInfo] Found redundant word: "${word}" in "${normalizedContent}"`);
                    return true;
                }
                return false;
            });
            
            // Also skip if episode name is just the series title or contains too much of it
            const similarity = calculateStringSimilarity(normalizedTitle, normalizedContent);
            logger.debug(`[extractSeriesInfo] Similarity: ${similarity}, Redundant: ${isRedundant}`);
            
            if (!isRedundant && similarity < 0.7 && content.length > 3) {
                logger.debug(`[extractSeriesInfo] ✅ Using episode name: "${content}"`);
                episodeName = content;
                break;
            } else {
                logger.debug(`[extractSeriesInfo] ❌ Rejecting episode name: "${content}" (redundant: ${isRedundant}, similarity: ${similarity})`);
            }
        }
    }
    
    return {
        title: title,
        seasonEpisode: seasonEpisode,
        episodeName: episodeName
    };
}

/**
 * Extract movie information (title, year) from filename
 * @param {string} movieName - Movie filename
 * @returns {Object} - Extracted movie info
 */
export function extractMovieInfo(movieName) {
    if (!movieName) return { title: 'Unknown Movie', year: null };
    
    let title = movieName;
    let year = null;
    
    // Extract year first (prefer parentheses, then standalone 4-digit numbers)
    const yearMatch = title.match(/\((\d{4})\)|(\d{4})/);
    if (yearMatch) {
        year = yearMatch[1] || yearMatch[2];
    }
    
    // Remove group tags at the beginning
    title = title.replace(/^[\[\{][^\]\}]+[\]\}]\s*/, '');
    
    // Find where technical info starts (use centralized patterns)
    let titleEndIndex = title.length;
    for (const pattern of TECHNICAL_PATTERNS) {
        const match = title.match(pattern);
        if (match && match.index < titleEndIndex) {
            titleEndIndex = Math.min(titleEndIndex, match.index);
        }
    }
    
    // Extract clean title
    let cleanTitle = title.substring(0, titleEndIndex).trim();
    
    // Clean up the title
    cleanTitle = cleanTitle
        .replace(/[\._]/g, ' ')
        .replace(/\s*-\s*$/, '')
        .replace(/\s+/g, ' ')
        .trim();
    
    // Remove year from title to avoid duplication
    if (year) {
        cleanTitle = cleanTitle.replace(new RegExp(`\\(${year}\\)`, 'g'), '').replace(/\s+/g, ' ').trim();
        cleanTitle = cleanTitle.replace(new RegExp(`\\b${year}\\b`, 'g'), '').replace(/\s+/g, ' ').trim();
    }
    
    if (!cleanTitle || cleanTitle.length < 3) {
        cleanTitle = 'Unknown Movie';
    }
    
    return {
        title: cleanTitle + (year ? ` (${year})` : ''),
        year: year,
        cleanTitleOnly: cleanTitle  // For technical details filtering
    };
}

/**
 * Extract and enhance technical details using centralized patterns
 * @param {string} name - Filename to analyze
 * @param {string} titleToRemove - Title to remove from details
 * @param {string} releaseGroupToRemove - Release group to remove from details
 * @param {string} episodeNameToRemove - Episode name to remove from details
 * @returns {string} - Enhanced technical details
 */
export function extractTechnicalDetails(name, titleToRemove = '', releaseGroupToRemove = '', episodeNameToRemove = '') {
    // Extract only recognized technical details instead of removing everything else
    // Note: Quality is already shown in the stream name, so we skip it here
    
    // Separate arrays for different types of details to control ordering
    const languageDetails = [];
    const sourceDetails = [];
    const codecDetails = [];
    const audioDetails = [];
    const techDetails = [];
    
    // 1. Extract Languages FIRST using centralized patterns
    for (const pattern of LANGUAGE_PATTERNS) {
        if (pattern.pattern.test(name) && !languageDetails.some(detail => detail.includes(pattern.displayName))) {
            languageDetails.push(`${pattern.emoji} ${pattern.displayName}`);
        }
    }
    
    // 2. Extract Source (BluRay, WEB-DL, etc.) using centralized patterns
    for (const pattern of SOURCE_PATTERNS) {
        if (pattern.pattern.test(name)) {
            sourceDetails.push(`${pattern.emoji} ${pattern.displayName}`);
            break; // Only match first source
        }
    }
    
    // 3. Extract Codecs using centralized patterns
    for (const pattern of CODEC_PATTERNS) {
        if (pattern.pattern.test(name)) {
            codecDetails.push(`${pattern.emoji} ${pattern.codec}`);
            // Don't break - can have multiple codecs (video + audio)
        }
    }
    
    // 4. Extract Audio information - prioritize more specific patterns over generic ones
    const foundAudio = new Set();
    const audioMatches = [];
    
    // First pass: collect all matching audio patterns
    for (const pattern of AUDIO_PATTERNS) {
        if (pattern.pattern.test(name)) {
            audioMatches.push(pattern);
        }
    }
    
    // Second pass: filter out generic patterns if specific ones exist
    for (const pattern of audioMatches) {
        const isGeneric = audioMatches.some(otherPattern => {
            if (otherPattern === pattern) return false;
            
            // Check if this pattern is a subset/generic version of another more specific pattern
            const currentAudio = pattern.audio.toLowerCase().replace(/[^\w]/g, '');
            const otherAudio = otherPattern.audio.toLowerCase().replace(/[^\w]/g, '');
            
            // If current audio is contained in other audio, it's generic
            // e.g., "dts" is contained in "dtsx"
            return otherAudio.includes(currentAudio) && currentAudio.length < otherAudio.length;
        });
        
        if (!isGeneric && !foundAudio.has(pattern.audio)) {
            audioDetails.push(`${pattern.emoji} ${pattern.audio}`);
            foundAudio.add(pattern.audio);
        }
    }
    
    // 5. Extract comprehensive technical terms using centralized patterns
    // Since overlapping audio patterns have been removed from COMPREHENSIVE_TECH_PATTERNS,
    // we can use simpler logic here
    for (const tech of COMPREHENSIVE_TECH_PATTERNS) {
        if (tech.pattern.test(name) && !techDetails.some(detail => detail.includes(tech.display))) {
            techDetails.push(tech.display);
        }
    }
    
    // Combine all details with languages first
    const detectedDetails = [
        ...languageDetails,
        ...sourceDetails, 
        ...codecDetails,
        ...audioDetails,
        ...techDetails
    ];
    
    // 6. Remove duplicates while preserving order
    const uniqueDetails = [];
    const seenDetails = new Set();
    
    for (const detail of detectedDetails) {
        const normalized = detail.toLowerCase().replace(/[^\w]/g, '');
        if (!seenDetails.has(normalized)) {
            seenDetails.add(normalized);
            uniqueDetails.push(detail);
        }
    }
    
    return uniqueDetails.join(' • ');
}

/**
 * Format stream title for display in Stremio
 * @param {Object} details - Torrent details
 * @param {Object} video - Video file details
 * @param {string} type - Content type (movie/series)
 * @param {string} icon - Icon to display
 * @param {Object} knownSeasonEpisode - Known season/episode info
 * @param {Object} variantInfo - Variant information
 * @param {Object} searchContext - Search context
 * @returns {string} - Formatted title
 */
export function formatStreamTitle(details, video, type, icon, knownSeasonEpisode = null, variantInfo = null, searchContext = null) {
    const containerName = details.containerName || details.name || 'Unknown';
    const videoName = video.name || '';
    const size = formatSize(video?.size || 0);
    
    if (type === 'series') {
        const seriesInfo = extractSeriesInfo(videoName, containerName);
        const releaseGroup = extractReleaseGroup(videoName || containerName);
        
        // Detect variants using the clean series title if search context is available
        let detectedVariant = null;
        if (searchContext && searchContext.searchTitle && searchContext.alternativeTitles) {
            // TODO: Implement detectSimpleVariant function
            // detectedVariant = detectSimpleVariant(seriesInfo.title, searchContext.searchTitle, searchContext.alternativeTitles);
        }
        
        // Use known season/episode info if provided (from advanced search), but be conservative
        let seasonEpisode = seriesInfo.seasonEpisode;
        if (knownSeasonEpisode && knownSeasonEpisode.season && knownSeasonEpisode.episode) {
            const season = String(knownSeasonEpisode.season).padStart(2, '0');
            const episode = String(knownSeasonEpisode.episode).padStart(2, '0');
            const knownSeasonEpisodeStr = `S${season}E${episode}`;
            
            // Only override if the filename doesn't have clear season/episode info or if it's season 0
            const shouldOverride = 
                seriesInfo.seasonEpisode === 'Unknown Episode' ||
                seriesInfo.seasonEpisode.startsWith('S00E');
            
            if (shouldOverride) {
                seasonEpisode = knownSeasonEpisodeStr;
                logger.debug(`[formatStreamTitle] Using advanced search season/episode: ${knownSeasonEpisodeStr} (filename had: ${seriesInfo.seasonEpisode})`);
            } else {
                logger.debug(`[formatStreamTitle] Keeping filename season/episode: ${seriesInfo.seasonEpisode} (advanced search: ${knownSeasonEpisodeStr})`);
            }
        }
        
        const lines = [];
        
        // Line 1: Original video torrent name as it comes from debrid provider (with folder emoji)
        lines.push(`📁 ${videoName || containerName}`);
        
        // Line 2: Clean series title with season/episode
        const cleanTitle = seriesInfo.title.replace(/[\[\]()]/g, '').trim();
        lines.push(`${cleanTitle} - ${seasonEpisode}`);
        
        // Line 3: Variant information if this is a spin-off or variant
        if (detectedVariant && detectedVariant.isVariant && detectedVariant.variantName) {
            lines.push(`🔄 Variant: ${detectedVariant.variantName}`);
        } else if (variantInfo && variantInfo.isVariant && variantInfo.variantName) {
            lines.push(`🔄 Variant: ${variantInfo.variantName}`);
        }
        
        // Line 3 or 4: Episode name if found
        if (seriesInfo.episodeName) {
            lines.push(`📺 "${seriesInfo.episodeName}"`);
        }
        
        // Line 4 or 5: Enhanced technical details with good emojis for easy reading
        const techDetails = extractTechnicalDetails(removeExtension(videoName || containerName), seriesInfo.title, releaseGroup, seriesInfo.episodeName);
        if (techDetails && techDetails.length > 0) {
            lines.push(`⚙️ ${techDetails}`);
        }
        
        // Final line: Season/Episode formatted as "Sxx - Exx" + Size with icon + Release Group
        const seasonPart = seasonEpisode.substring(0, 3); // S01
        const episodePart = seasonEpisode.substring(3);    // E04
        let sizeLine = `${seasonPart} - ${episodePart} • ${icon} ${size}`;
        if (releaseGroup && releaseGroup.trim().length > 0 && isValidReleaseGroup(releaseGroup)) {
            sizeLine += ` • 👥 [${releaseGroup}]`;
        }
        lines.push(sizeLine);
        
        return lines.join('\n');
        
    } else {
        // Movie format - keep original structure but improved
        const movieInfo = extractMovieInfo(removeExtension(videoName || containerName));
        const releaseGroup = extractReleaseGroup(videoName || containerName);
        
        const lines = [];
        
        // Line 1: Original video torrent name as it comes from debrid provider (with folder emoji)
        lines.push(`📁 ${videoName || containerName}`);
        
        // Line 2: Clean movie title with year
        lines.push(movieInfo.title);
        
        // Line 3: Variant information if this is a spin-off or variant
        if (variantInfo && variantInfo.isVariant && variantInfo.variantName) {
            lines.push(`🔄 Variant: ${variantInfo.variantName}`);
        }
        
        // Line 3 or 4: Enhanced technical details with good emojis for easy reading
        const techDetails = extractTechnicalDetails(removeExtension(videoName || containerName), movieInfo.cleanTitleOnly, releaseGroup, '');
        if (techDetails && techDetails.length > 0) {
            lines.push(`⚙️ ${techDetails}`);
        }
        
        // Final line: Size with icon + Release Group
        let sizeLine = `${icon} ${size}`;
        if (releaseGroup && releaseGroup.trim().length > 0 && isValidReleaseGroup(releaseGroup)) {
            sizeLine += ` • 👥 [${releaseGroup}]`;
        }
        lines.push(sizeLine);
        
        return lines.join('\n');
    }
}
