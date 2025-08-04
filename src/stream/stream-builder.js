/**
 * Stream builder module - EXACT WORKING FUNCTIONS from working addon
 * Contains toStream() and related functions extracted from working stream-provider.js
 */

import { FILE_TYPES } from '../utils/file-types.js';
import { extractQualityDisplay } from '../utils/media-patterns.js';

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

    console.log(`[toStream] Processing ${type} with details.name="${details.name}"`);
    console.log(`[toStream] knownSeasonEpisode:`, knownSeasonEpisode);
    console.log(`[toStream] details.videos length:`, details.videos?.length || 0);

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
        
        console.log(`[toStream] Selected video: "${video.name}" (S${video.info?.season}E${video.info?.episode})`);
        
        // Only sort by size if there are multiple videos of the same episode
        if (details.videos.length > 1) {
            // Check if all videos are for the same episode
            const firstEpisodeId = `${details.videos[0].info?.season}x${details.videos[0].info?.episode}`;
            const allSameEpisode = details.videos.every(v => 
                `${v.info?.season}x${v.info?.episode}` === firstEpisodeId
            );
            
            console.log(`[toStream] Multiple videos (${details.videos.length}), all same episode: ${allSameEpisode}`);
            
            if (allSameEpisode) {
                // All videos are same episode, pick largest
                details.videos.sort((a, b) => b.size - a.size);
                video = details.videos[0];
                console.log(`[toStream] After size sorting, selected: "${video.name}"`);
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
    
    console.log(`[extractQuality] Analyzing: "${combinedName}"`);
    
    // Use centralized quality extraction with fallback support
    const fallbackInfo = {
        resolution: video.info?.resolution || details.info?.resolution
    };
    
    const quality = extractQualityDisplay(combinedName, fallbackInfo);
    console.log(`[extractQuality] Found quality: ${quality}`);
    
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
                console.log(`[formatStreamTitle] Using advanced search season/episode: ${knownSeasonEpisodeStr} (filename had: ${seriesInfo.seasonEpisode})`);
            } else {
                console.log(`[formatStreamTitle] Keeping filename season/episode: ${seriesInfo.seasonEpisode} (advanced search: ${knownSeasonEpisodeStr})`);
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
    
    console.log(`[extractSeriesInfo] Checking for episode names in: "${name}"`);
    console.log(`[extractSeriesInfo] Series title: "${title}"`);
    
    for (const pattern of episodePatterns) {
        const match = name.match(pattern);
        if (match && match[1] && match[1].trim().length > 2) {
            const content = match[1].trim();
            console.log(`[extractSeriesInfo] Found episode name pattern: "${content}"`);
            
            // Skip technical patterns
            if (content.match(/^\d+p$|^x26[45]$|^hevc$|^avc$|^10bits?$/i) || 
                content.match(/^[A-Z0-9]{8}$/i) || // Skip hashes
                content.match(/^(VRV|Multiple Subtitle|1080p|720p|480p)$/i)) {
                console.log(`[extractSeriesInfo] Skipping technical pattern: "${content}"`);
                continue;
            }
            
            // For redundancy check, use only the clean series title, not the whole filename
            // This fixes the issue where "DanMachi 031 MULTI..." was being used as the title
            const cleanTitleForComparison = title.replace(/\d+/g, '').replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
            const normalizedTitle = cleanTitleForComparison.toLowerCase();
            const normalizedContent = content.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
            
            console.log(`[extractSeriesInfo] Normalized title for comparison: "${normalizedTitle}"`);
            console.log(`[extractSeriesInfo] Normalized content: "${normalizedContent}"`);
            
            // Check if the episode name is too similar to the series title
            const titleWords = normalizedTitle.split(' ').filter(word => word.length > 3);
            const isRedundant = titleWords.some(word => {
                if (word.length > 4 && normalizedContent.includes(word)) {
                    console.log(`[extractSeriesInfo] Found redundant word: "${word}" in "${normalizedContent}"`);
                    return true;
                }
                return false;
            });
            
            // Also skip if episode name is just the series title or contains too much of it
            const similarity = calculateStringSimilarity(normalizedTitle, normalizedContent);
            console.log(`[extractSeriesInfo] Similarity: ${similarity}, Redundant: ${isRedundant}`);
            
            if (!isRedundant && similarity < 0.7 && content.length > 3) {
                console.log(`[extractSeriesInfo] ✅ Using episode name: "${content}"`);
                episodeName = content;
                break;
            } else {
                console.log(`[extractSeriesInfo] ❌ Rejecting episode name: "${content}" (redundant: ${isRedundant}, similarity: ${similarity})`);
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
 * Extract release group from filename
 */
function extractReleaseGroup(filename) {
    if (!filename) return '';
    
    // Look for release group patterns: [Group], -Group, (Group)
    const patterns = [
        /\[([^\]]+)\]$/,     // [Group] at end
        /-([A-Za-z0-9]+)$/,  // -Group at end
        /\(([^\)]+)\)$/      // (Group) at end
    ];
    
    for (const pattern of patterns) {
        const match = filename.match(pattern);
        if (match && match[1] && match[1].length > 1 && match[1].length < 20) {
            return match[1].trim();
        }
    }
    
    return '';
}

/**
 * Check if release group is valid
 */
function isValidReleaseGroup(group) {
    if (!group || group.length < 2 || group.length > 20) return false;
    
    // Skip common technical terms that aren't real groups
    const skipPatterns = [
        /^(1080p|720p|480p|2160p|4K|UHD)$/i,
        /^(BluRay|BDRip|DVDRip|WEBRip|HDTV)$/i,
        /^(x264|x265|HEVC|AVC|H264|H265)$/i,
        /^(AAC|MP3|AC3|DTS|FLAC)$/i,
        /^(MULTI|FRENCH|ENGLISH|VOSTFR)$/i,
        /^\d+$/  // Pure numbers
    ];
    
    return !skipPatterns.some(pattern => pattern.test(group));
}

/**
 * Extract technical details from filename
 */
function extractTechnicalDetails(filename, seriesTitle, releaseGroup, episodeName) {
    if (!filename) return '';
    
    const details = [];
    
    // Extract source
    const sourceMatch = filename.match(/\b(BluRay|BDRip|DVDRip|WEBRip|HDTV|CAM|TS|REMUX)\b/i);
    if (sourceMatch) {
        details.push(`💿 ${sourceMatch[1].toUpperCase()}`);
    }
    
    // Extract video codec
    const codecMatch = filename.match(/\b(x264|x265|HEVC|AVC|H264|H265|XviD|DivX)\b/i);
    if (codecMatch) {
        let codec = codecMatch[1].toUpperCase();
        if (codec === 'X264') codec = 'x264';
        if (codec === 'X265' || codec === 'HEVC') codec = 'HEVC';
        details.push(`📺 ${codec}`);
    }
    
    // Extract audio codec
    const audioMatch = filename.match(/\b(AAC|MP3|AC3|DTS|FLAC|Atmos)\b/i);
    if (audioMatch) {
        details.push(`🎵 ${audioMatch[1].toUpperCase()}`);
    }
    
    // Extract special notes
    const specialMatch = filename.match(/\b(REMUX|REPACK|PROPER|INTERNAL|LIMITED)\b/i);
    if (specialMatch) {
        details.push(`🎯 ${specialMatch[1].toUpperCase()}`);
    }
    
    return details.join(' • ');
}

/**
 * Filter torrents by season
 */
export function filterSeason(torrent, season) {
    const torrentSeason = torrent?.info?.season;
    const torrentSeasons = torrent?.info?.seasons;
    const seasonMatch = torrentSeason == season || torrentSeasons?.includes(Number(season));
    
    console.log(`[filterSeason] Checking torrent: "${torrent?.name || 'UNKNOWN'}" | Target season: ${season} | Torrent season: ${torrentSeason} | Torrent seasons: ${JSON.stringify(torrentSeasons)} | Match: ${seasonMatch}`);
    
    return seasonMatch;
}

/**
 * Filter torrents by episode
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
        
        // Special case: if video has no season info but we're looking for S01, 
        // and the video has the right episode number, consider it a match
        if (!videoSeason && season == 1 && episode == videoEpisode) {
            console.log(`[filterEpisode] ✅ Classic S01 match (no season info, defaulting to S01): E${videoEpisode} matches S${season}E${episode}`);
            classicMatches.push(video);
            return;
        }
        
        if (season == videoSeason && episode == videoEpisode) {
            console.log(`[filterEpisode] ✅ Classic match: S${videoSeason}E${videoEpisode} matches S${season}E${episode}`);
            classicMatches.push(video);
        }
    });
    
    // If we found classic matches, use only those and skip absolute matching
    if (classicMatches.length > 0) {
        console.log(`[filterEpisode] Using ${classicMatches.length} classic matches, skipping absolute matching`);
        torrentDetails.videos = classicMatches;
        return true;
    }
    
    // PASS 2: Only try absolute episode matching if no classic matches were found
    if (typeof absoluteEpisode === 'number') {
        console.log(`[filterEpisode] No classic matches found, trying absolute episode matching for ${absoluteEpisode}`);
        
        torrentDetails.videos.forEach(video => {
            const videoSeason = video.info.season;
            
            // First check: if we have season info and it doesn't match, skip absolute matching
            if (videoSeason && videoSeason != season) {
                console.log(`[filterEpisode] ❌ Skipping absolute matching: video is S${videoSeason}, looking for S${season}`);
                return;
            }
            
            // Pattern matching for absolute episodes in filename (more restrictive)
            const absolutePattern = new RegExp(`\\b0*${absoluteEpisode}\\b`);
            if (absolutePattern.test(video.name)) {
                console.log(`[filterEpisode] ✅ Absolute match: found episode ${absoluteEpisode} in "${video.name}"`);
                potentialAbsoluteMatches.push(video);
            }
        });
        
        if (potentialAbsoluteMatches.length > 0) {
            console.log(`[filterEpisode] Using ${potentialAbsoluteMatches.length} absolute matches`);
            torrentDetails.videos = potentialAbsoluteMatches;
            return true;
        }
    }
    
    console.log(`[filterEpisode] ❌ No matches found for S${season}E${episode}${absoluteEpisode ? ` (absolute: ${absoluteEpisode})` : ''}`);
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
