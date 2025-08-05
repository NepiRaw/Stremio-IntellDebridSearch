/**
 * Stream builder module - EXACT WORKING FUNCTIONS from working addon
 * Contains toStream() and related functions extracted from working stream-provider.js
 */

import { FILE_TYPES } from '../utils/file-types.js';
import { 
    extractQualityDisplay, 
    LANGUAGE_PATTERNS, 
    AUDIO_PATTERNS, 
    CODEC_PATTERNS, 
    SOURCE_PATTERNS, 
    COMPREHENSIVE_TECH_PATTERNS 
} from '../utils/media-patterns.js';
import { extractReleaseGroup, isValidReleaseGroup } from '../utils/groups-util.js';
import { logger } from '../utils/logger.js';

const STREAM_NAME_MAP = {
    debridlink: "[DL+] DebridSearch",
    realdebrid: "[RD+] DebridSearch",
    alldebrid: "[AD⚡] DebridSearch",
    premiumize: "[PM+] DebridSearch",
    torbox: "[TB+] DebridSearch"
};

/**
 * EXACT WORKING FUNCTION from working addon stream-provider.js line 641-695
 * Create stream object from torrent details and video file
 */
export function toStream(details, type, knownSeasonEpisode = null, variantInfo = null, searchContext = null) {
    if (!details) return null;

    logger.debug(`[toStream] Processing ${type} with details.name="${details.name}"`);
    logger.debug(`[toStream] knownSeasonEpisode:`, knownSeasonEpisode);
    logger.debug(`[toStream] details.videos length:`, details.videos?.length || 0);

    let video, icon
    if (details.fileType == FILE_TYPES.DOWNLOADS) {
        icon = '⬇️'
        video = details
    } else {
        icon = '💾'
        // Safely handle videos array
        if (!details.videos?.length) return null;
        
        // After episode filtering, videos array should contain only matching episodes
        // Take the first video (don't re-sort by size as it might pick wrong episode)
        video = details.videos[0];
        
        logger.debug(`[toStream] Selected video: "${video.name}" (S${video.info?.season}E${video.info?.episode})`);
        
        // Only sort by size if there are multiple videos of the same episode
        if (details.videos.length > 1) {
            // Check if all videos are for the same episode
            const firstEpisodeId = `${details.videos[0].info?.season}x${details.videos[0].info?.episode}`;
            const allSameEpisode = details.videos.every(v => 
                `${v.info?.season}x${v.info?.episode}` === firstEpisodeId
            );
            
            logger.debug(`[toStream] Multiple videos (${details.videos.length}), all same episode: ${allSameEpisode}`);
            
            if (allSameEpisode) {
                // All videos are same episode, pick largest
                details.videos.sort((a, b) => b.size - a.size);
                video = details.videos[0];
                logger.debug(`[toStream] After size sorting, selected: "${video.name}"`);
            }
            // If not all same episode, keep the first one (episode filtering should have handled this)
        }
    }

    if (!video) return null;

    // Enhanced quality extraction with emojis
    const quality = extractQuality(video, details);
    
    // Enhanced name with quality emojis
    let name = STREAM_NAME_MAP[details.source] || 'Unknown'
    name = name + '\n' + quality

    // Enhanced title formatting - pass known season/episode info and variant info if available
    let title = formatStreamTitle(details, video, type, icon, knownSeasonEpisode, variantInfo, searchContext);

    let bingeGroup = details.source + '|' + details.id

    return {
        name,
        title,
        url: video.url,
        behaviorHints: {
            bingeGroup: bingeGroup
        }
    }
}

/**
 * EXACT WORKING FUNCTION from working addon stream-provider.js line 701-718
 * Extract quality information from video and torrent details with emoji indicators
 */
function extractQuality(video, details) {
    const videoName = video.name || '';
    const torrentName = details.name || '';
    
    // Use ONLY the current video name, not multiple videos
    const combinedName = `${torrentName} ${videoName}`;
    
    logger.debug(`[extractQuality] Analyzing: "${combinedName}"`);
    
    // Use centralized quality extraction with fallback support
    const fallbackInfo = {
        resolution: video.info?.resolution || details.info?.resolution
    };
    
    const quality = extractQualityDisplay(combinedName, fallbackInfo);
    logger.debug(`[extractQuality] Found quality: ${quality}`);
    
    return quality;
}

/**
 * EXACT WORKING FUNCTION from working addon stream-provider.js 
 * Format file size in human readable format
 */
function formatSize(size) {
    if (!size) {
        return undefined
    }

    const i = size === 0 ? 0 : Math.floor(Math.log(size) / Math.log(1024))
    return Number((size / Math.pow(1024, i)).toFixed(2)) + ' ' + ['B', 'kB', 'MB', 'GB', 'TB'][i]
}

/**
 * PLACEHOLDER: formatStreamTitle will be imported from formatter.js or extracted here
 * This function creates the multi-line stream title format
 */
function formatStreamTitle(details, video, type, icon, knownSeasonEpisode = null, variantInfo = null, searchContext = null) {
    const containerName = details.containerName || details.name || 'Unknown';
    const videoName = video.name || '';
    const size = formatSize(video?.size || 0);
    
    if (type === 'series') {
        const seriesInfo = extractSeriesInfo(videoName, containerName);
        const releaseGroup = extractReleaseGroup(videoName || containerName);
        
        // Detect variants using the clean series title if search context is available
        let detectedVariant = null;
        if (searchContext && searchContext.searchTitle && searchContext.alternativeTitles) {
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

/**
 * WORKING HELPER FUNCTIONS - Extracted from working addon
 */

/**
 * Calculate string similarity using a simple algorithm
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
 */
function romanToNumber(roman) {
    const romanMap = { 
        'I': 1, 'II': 2, 'III': 3, 'IV': 4, 'V': 5, 
        'VI': 6, 'VII': 7, 'VIII': 8, 'IX': 9, 'X': 10 
    };
    return romanMap[roman.toUpperCase()] || null;
}

/**
 * Remove file extension from filename
 */
function removeExtension(filename) {
    if (!filename) return filename;
    return filename.replace(/\.(mkv|mp4|avi|m4v|mov|wmv|flv|webm|ogm|ts|m2ts|3g2|3gp|mpe|mpeg|mpg|mpv|mk3d|mp2)$/i, '');
}

/**
 * Extract series information (title, season, episode) from filename
 */
function extractSeriesInfo(videoName, containerName) {
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
 */
function extractMovieInfo(movieName) {
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
    const TECHNICAL_PATTERNS = [
        /\b(1080p|720p|480p|2160p|4K|UHD)\b/i,
        /\b(BluRay|BDRip|DVDRip|WEBRip|HDTV|CAM|TS)\b/i,
        /\b(x264|x265|HEVC|AVC|H264|H265|XviD|DivX)\b/i,
        /\b(AAC|MP3|AC3|DTS|FLAC|Atmos)\b/i,
        /\b(MULTI|FRENCH|ENGLISH|VOSTFR|SUBFRENCH)\b/i,
        /\b(REMUX|REPACK|PROPER|INTERNAL|LIMITED)\b/i,
        /\.[a-zA-Z0-9]{2,4}$/
    ];
    
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
 * Extract comprehensive technical details from filename with sophisticated pattern matching
 * Uses centralized patterns from media-patterns.js for consistency
 * Integrates with release-groups.js for proper group handling
 */
export function extractTechnicalDetails(filename, seriesTitle, releaseGroup, episodeName) {
    if (!filename) return '';
    
    logger.debug(`[extractTechnicalDetails] Analyzing: "${filename}"`);
    logger.debug(`[extractTechnicalDetails] Title: "${seriesTitle}", Release Group: "${releaseGroup}"`);
    
    // Create a cleaned filename that excludes the title and episode name to avoid false matches
    let cleanedFilename = filename;
    if (seriesTitle && seriesTitle.length > 3) {
        // Remove title from filename to avoid false technical matches
        const titleVariants = [
            seriesTitle,
            seriesTitle.replace(/\s+/g, '.'),
            seriesTitle.replace(/\s+/g, '_'),
            seriesTitle.replace(/[^\w\s]/g, '').replace(/\s+/g, '.')
        ];
        
        for (const variant of titleVariants) {
            if (variant.length > 3) {
                const regex = new RegExp(variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
                cleanedFilename = cleanedFilename.replace(regex, '');
            }
        }
    }
    
    // Remove episode name from filename to avoid false technical matches
    if (episodeName && episodeName.length > 3) {
        const regex = new RegExp(episodeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        cleanedFilename = cleanedFilename.replace(regex, '');
    }
    
    logger.debug(`[extractTechnicalDetails] Cleaned filename: "${cleanedFilename}"`);
    
    
    // Separate arrays for different types of details to control ordering
    const languageDetails = [];
    const sourceDetails = [];
    const codecDetails = [];
    const audioDetails = [];
    const techDetails = [];
    
    // 1. Extract Languages FIRST using centralized patterns
    for (const pattern of LANGUAGE_PATTERNS) {
        if (pattern.pattern.test(cleanedFilename) && !languageDetails.some(detail => detail.includes(pattern.displayName))) {
            languageDetails.push(`${pattern.emoji} ${pattern.displayName}`);
        }
    }
    
    // 2. Extract Source (BluRay, WEB-DL, etc.) using centralized patterns
    for (const pattern of SOURCE_PATTERNS) {
        if (pattern.pattern.test(cleanedFilename)) {
            sourceDetails.push(`${pattern.emoji} ${pattern.displayName}`);
            break; // Only match first source
        }
    }
    
    // 3. Extract Codecs using centralized patterns
    for (const pattern of CODEC_PATTERNS) {
        if (pattern.pattern.test(cleanedFilename)) {
            codecDetails.push(`${pattern.emoji} ${pattern.codec}`);
            // Don't break - can have multiple codecs (video + audio)
        }
    }
    
    // 4. Extract Audio information - prioritize more specific patterns over generic ones
    const foundAudio = new Set();
    const audioMatches = [];
    
    // First pass: collect all matching audio patterns
    for (const pattern of AUDIO_PATTERNS) {
        if (pattern.pattern.test(cleanedFilename)) {
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
    for (const tech of COMPREHENSIVE_TECH_PATTERNS) {
        if (tech.pattern.test(cleanedFilename) && !techDetails.some(detail => detail.includes(tech.display))) {
            techDetails.push(tech.display);
        }
    }
    
    // Combine all details with EXACT working addon ordering: Languages, Sources, Codecs, Audio, Tech
    const detectedDetails = [
        ...languageDetails,
        ...sourceDetails, 
        ...codecDetails,
        ...audioDetails,
        ...techDetails
    ];
    
    // 6. Remove duplicates while preserving order
    const uniqueDetails = [];
    const finalSeenDetails = new Set();
    
    for (const detail of detectedDetails) {
        const normalized = detail.toLowerCase().replace(/[^\w]/g, '');
        if (!finalSeenDetails.has(normalized)) {
            finalSeenDetails.add(normalized);
            uniqueDetails.push(detail);
        }
    }
    
    // Log the final result to match working addon logging
    logger.debug(`[extractTechnicalDetails] Languages: [${languageDetails.join(', ')}]`);
    logger.debug(`[extractTechnicalDetails] Sources: [${sourceDetails.join(', ')}]`);
    logger.debug(`[extractTechnicalDetails] Codecs: [${codecDetails.join(', ')}]`);
    logger.debug(`[extractTechnicalDetails] Audio: [${audioDetails.join(', ')}]`);
    logger.debug(`[extractTechnicalDetails] Tech: [${techDetails.join(', ')}]`);
    
    logger.debug(`[extractTechnicalDetails] Final details: [${uniqueDetails.join(', ')}]`);
    return uniqueDetails.join(' • ');
}

/**
 * Filter torrents by season
 */
export function filterSeason(torrent, season) {
    const torrentSeason = torrent?.info?.season;
    const torrentSeasons = torrent?.info?.seasons;
    const seasonMatch = torrentSeason == season || torrentSeasons?.includes(Number(season));
    
    logger.debug(`[filterSeason] Checking torrent: "${torrent?.name || 'UNKNOWN'}" | Target season: ${season} | Torrent season: ${torrentSeason} | Torrent seasons: ${JSON.stringify(torrentSeasons)} | Match: ${seasonMatch}`);
    
    return seasonMatch;
}

/**
 * Filter torrents by episode - EXACT working function from working addon
 */
export function filterEpisode(torrentDetails, season, episode, absoluteEpisode = null) {
    // Enhanced episode filtering to handle both classic and absolute episode numbering
    // Two-pass approach: first check for classic matches, only try absolute if no classic found
    
    let classicMatches = [];
    let potentialAbsoluteMatches = [];
    
    // PASS 1: Find all classic S##E## matches
    torrentDetails.videos.forEach(video => {
        const videoSeason = video.info.season;
        const videoEpisode = video.info.episode;
        
        if (season == videoSeason && episode == videoEpisode) {
            logger.debug(`[filterEpisode] ✅ Classic match: S${videoSeason}E${videoEpisode} matches S${season}E${episode}`);
            classicMatches.push(video);
        }
    });
    
    // If we found classic matches, use only those and skip absolute matching
    if (classicMatches.length > 0) {
        logger.debug(`[filterEpisode] Using ${classicMatches.length} classic matches, skipping absolute matching`);
        torrentDetails.videos = classicMatches;
        return true;
    }
    
    // PASS 2: Only try absolute episode matching if no classic matches were found
    if (typeof absoluteEpisode === 'number') {
        logger.debug(`[filterEpisode] No classic matches found, trying absolute episode matching for ${absoluteEpisode}`);
        
        torrentDetails.videos.forEach(video => {
            const videoSeason = video.info.season;
            
            // First check: if we have season info and it doesn't match, skip absolute matching
            if (videoSeason && videoSeason != season) {
                logger.debug(`[filterEpisode] ❌ Skipping absolute matching: video is S${videoSeason}, looking for S${season}`);
                return;
            }
            
            // Only proceed with absolute matching if:
            // 1. No season info (videoSeason is null/undefined), OR
            // 2. Season matches what we're looking for
            
            // Pattern matching for absolute episodes in filename (more restrictive)
            const absolutePattern = new RegExp(`\\b0*${absoluteEpisode}\\b`);
            if (absolutePattern.test(video.name)) {
                // Extra validation: make sure it's not just matching episode numbers in wrong season
                const seasonPattern = new RegExp(`[Ss]0*(\\d+)`, 'i');
                const seasonMatch = video.name.match(seasonPattern);
                
                if (seasonMatch) {
                    const fileSeason = parseInt(seasonMatch[1], 10);
                    if (fileSeason !== parseInt(season, 10)) {
                        logger.debug(`[filterEpisode] ❌ Absolute pattern matched but wrong season: file has S${fileSeason}, looking for S${season}`);
                        return;
                    }
                }
                
                logger.debug(`[filterEpisode] ✅ Absolute match: episode ${absoluteEpisode} in "${video.name}"`);
                potentialAbsoluteMatches.push(video);
                return;
            }
            
            // Check if video has absolute episode info that matches
            if (video.info.absoluteEpisode && 
                parseInt(video.info.absoluteEpisode, 10) === parseInt(absoluteEpisode, 10)) {
                logger.debug(`[filterEpisode] ✅ Absolute info match: ${video.info.absoluteEpisode} = ${absoluteEpisode}`);
                potentialAbsoluteMatches.push(video);
                return;
            }
        });
        
        if (potentialAbsoluteMatches.length > 0) {
            logger.debug(`[filterEpisode] Using ${potentialAbsoluteMatches.length} absolute matches`);
            torrentDetails.videos = potentialAbsoluteMatches;
            return true;
        }
    }
    
    // No matches found
    logger.debug(`[filterEpisode] ❌ No matches found for S${season}E${episode} (abs: ${absoluteEpisode})`);
    torrentDetails.videos = [];
    return false;
}

/**
 * Filter torrents by year for movies
 */
export function filterYear(torrent, cinemetaDetails) {
    if (!cinemetaDetails?.year) return true; // No year to filter against
    
    const torrentYear = torrent?.info?.year;
    if (!torrentYear) return true; // No year info in torrent
    
    return Math.abs(torrentYear - cinemetaDetails.year) <= 1; // Allow 1 year difference
}
