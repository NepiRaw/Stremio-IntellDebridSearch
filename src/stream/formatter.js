/**
 * Stream formatter module for creating formatted stream objects
 * Handles title formatting, technical details extraction, and stream metadata
 */

import { extractReleaseGroup, isValidReleaseGroup } from '../utils/groups-util.js';
import { detectSimpleVariant } from '../utils/variant-detector.js';
import { extractQualityDisplay, 
         TECHNICAL_PATTERNS, CLEANUP_PATTERNS, LANGUAGE_PATTERNS, 
         SOURCE_PATTERNS, CODEC_PATTERNS, AUDIO_PATTERNS, 
         COMPREHENSIVE_TECH_PATTERNS } from '../utils/media-patterns.js';
import { logger } from '../utils/logger.js';
import { FILE_TYPES } from '../utils/file-types.js';
import { romanToNumber as centralizedRomanToNumber } from '../utils/roman-numeral-utils.js';
import { parseUnified, extractTechnicalDetailsLegacy } from '../utils/unified-torrent-parser.js';

const STREAM_NAME_MAP = {
    debridlink: "[DL+] DebridSearch",
    realdebrid: "[RD+] DebridSearch",
    alldebrid: "[AD⚡] DebridSearch",
    premiumize: "[PM+] DebridSearch",
    torbox: "[TB+] DebridSearch"
};

export function formatSize(size) {
    if (!size) {
        return undefined;
    }

    const i = size === 0 ? 0 : Math.floor(Math.log(size) / Math.log(1024));
    return Number((size / Math.pow(1024, i)).toFixed(2)) + ' ' + ['B', 'kB', 'MB', 'GB', 'TB'][i];
}

function calculateStringSimilarity(str1, str2) {
    if (!str1 || !str2) return 0;
    if (str1 === str2) return 1;
    
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;
    
    if (longer.length === 0) return 1;
    
    const editDistance = levenshteinDistance(longer, shorter);
    return (longer.length - editDistance) / longer.length;
}

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

function removeExtension(filename) {
    if (!filename) return '';
    const lastDotIndex = filename.lastIndexOf('.');
    return lastDotIndex > 0 ? filename.substring(0, lastDotIndex) : filename;
}


/**
 * Extract series information (title, season, episode) from filename
 * Uses unified parser for enhanced accuracy and performance
 * Maintains backward compatibility with existing API
 */
export function extractSeriesInfo(videoName, containerName) {
    logger.debug(`[extractSeriesInfo] Processing: videoName="${videoName}", containerName="${containerName}"`);
    
    // Use unified parser for core parsing
    const filename = videoName || containerName || '';
    const parseResult = parseUnified(filename);
    
    logger.debug(`[extractSeriesInfo] Unified parser result:`, parseResult);
    
    // Handle cases where no season/episode detected
    if (!parseResult.season && !parseResult.episode && !parseResult.absoluteEpisode) {
        // Try to extract basic title from filename
        let title = filename
            .replace(/^[\[\(][^\]\)]*[\]\)]\s*/, '') // Remove group tags at start
            .replace(/[\._]/g, ' ')                   // Replace dots and underscores with spaces
            .replace(/\s*-\s*$/, '')                  // Remove trailing dash
            .replace(/\s+/g, ' ')                     // Collapse multiple spaces
            .trim();
            
        // Look for title pattern before technical info
        const titleMatch = filename.match(/^([A-Za-z][A-Za-z0-9\s]*?)(?:\s+\d{3,}|\s+[Ss]\d+|\s+[IVX]+|\s*[\[\(])/);
        if (titleMatch) {
            title = titleMatch[1].trim();
        }
        
        // Clean up overly long titles
        if (title.length > 50 || title.match(/\b(MULTI|BluRay|1080p|720p|x264|x265|HEVC|mkv)\b/i)) {
            const shortTitleMatch = title.match(/^([A-Za-z][A-Za-z0-9\s]{2,25}?)(?:\s+\d+|\s+(MULTI|BluRay|1080p|720p|x264|x265|HEVC))/i);
            if (shortTitleMatch) {
                title = shortTitleMatch[1].trim();
            }
        }
        
        if (!title || title.length < 3) {
            title = (containerName || 'Unknown Series')
                .replace(/^[\[\(][^\]\)]*[\]\)]\s*/, '')
                .replace(/[\._]/g, ' ')
                .replace(/\s+/g, ' ')
                .trim() || 'Unknown Series';
        }
        
        return {
            title: title,
            seasonEpisode: 'Unknown Episode',
            episodeName: null
        };
    }
    
    // Format season/episode string
    let seasonEpisode = 'Unknown Episode';
    if (parseResult.season && parseResult.episode) {
        seasonEpisode = `S${parseResult.season.toString().padStart(2, '0')}E${parseResult.episode.toString().padStart(2, '0')}`;
    } else if (parseResult.episode && !parseResult.season) {
        // Default to season 1 if only episode is found
        seasonEpisode = `S01E${parseResult.episode.toString().padStart(2, '0')}`;
    } else if (parseResult.absoluteEpisode) {
        // For absolute episodes, format differently
        seasonEpisode = `E${parseResult.absoluteEpisode.toString().padStart(3, '0')}`;
    }
    
    // Extract episode name from filename (preserve existing logic for episode names)
    let episodeName = null;
    const episodePatterns = [
        /"([^"]+)"/,           // Double quotes: "Episode Name"
        /'([^']+)'/,           // Single quotes: 'Episode Name'
        /''([^']+)''/,         // Double single quotes: ''Episode Name''
        /- [Ss]\d+[Ee]\d+ - ([^(]+?)(?:\s*\([^)]*\)|$)/
    ];
    
    logger.debug(`[extractSeriesInfo] Checking for episode names in: "${filename}"`);
    logger.debug(`[extractSeriesInfo] Series title: "${parseResult.title}"`);
    
    for (const pattern of episodePatterns) {
        const match = filename.match(pattern);
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
            
            // Check similarity to title to avoid redundant episode names
            const normalizedTitle = parseResult.title.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
            const normalizedContent = content.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
            
            logger.debug(`[extractSeriesInfo] Normalized title: "${normalizedTitle}"`);
            logger.debug(`[extractSeriesInfo] Normalized content: "${normalizedContent}"`);
            
            // Check if episode name is too similar to title
            const titleWords = normalizedTitle.split(' ').filter(word => word.length > 3);
            const isRedundant = titleWords.some(word => {
                if (word.length > 4 && normalizedContent.includes(word)) {
                    logger.debug(`[extractSeriesInfo] Found redundant word: "${word}" in "${normalizedContent}"`);
                    return true;
                }
                return false;
            });
            
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
        title: parseResult.title || 'Unknown Series',
        seasonEpisode: seasonEpisode,
        episodeName: episodeName
    };
}

/**
 * Extract movie information (title, year) from filename using unified parser
 * @param {string} movieName - Movie filename
 * @returns {Object} - Extracted movie info (maintains API compatibility)
 */
export function extractMovieInfo(movieName) {
    if (!movieName) return { title: 'Unknown Movie', year: null };
    
    // Use unified parser for consistent results
    const parseResult = parseUnified(movieName);
    
    // Use the movie title from parser with year formatting
    const title = parseResult.title || 'Unknown Movie';
    const year = parseResult.year || null;
    
    // Format title with year like original implementation
    const formattedTitle = title + (year ? ` (${year})` : '');
    
    // Return in same format for backward compatibility
    return {
        title: formattedTitle,
        year: year,
        cleanTitleOnly: title  // For technical details filtering
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
    // Use unified parser for technical details extraction
    return extractTechnicalDetailsLegacy(name);
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
        const variantSystemEnabled = process.env.VARIANT_SYSTEM_ENABLED !== 'false'; // Default to true unless explicitly disabled
        
        if (variantSystemEnabled && searchContext && searchContext.searchTitle && searchContext.alternativeTitles) {
            logger.debug(`[formatStreamTitle] Variant detection: seriesInfo.title="${seriesInfo.title}", searchContext.searchTitle="${searchContext.searchTitle}", alternativeTitles=${searchContext.alternativeTitles.length}`);
            detectedVariant = detectSimpleVariant(seriesInfo.title, searchContext.searchTitle, searchContext.alternativeTitles);
            logger.debug(`[formatStreamTitle] Variant result: ${JSON.stringify(detectedVariant)}`);
        } else if (!variantSystemEnabled) {
            logger.debug(`[formatStreamTitle] Variant detection disabled via VARIANT_SYSTEM_ENABLED=false`);
        } else {
            logger.debug(`[formatStreamTitle] Variant detection skipped: searchContext=${!!searchContext}, searchTitle=${searchContext?.searchTitle}, alternativeTitles=${searchContext?.alternativeTitles?.length}`);
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
