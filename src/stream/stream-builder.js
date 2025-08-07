/**
 * Stream builder module - constructs stream objects with detailed titles and quality info
 */

import { FILE_TYPES } from '../utils/file-types.js';
import { 
    extractQualityDisplay, 
    LANGUAGE_PATTERNS, 
    AUDIO_PATTERNS, 
    CODEC_PATTERNS, 
    SOURCE_PATTERNS, 
    COMPREHENSIVE_TECH_PATTERNS,
    FILE_EXTENSIONS,
    TECHNICAL_PATTERNS
} from '../utils/media-patterns.js';
import { extractReleaseGroup, isValidReleaseGroup } from '../utils/groups-util.js';
import { parseUnified, extractTechnicalDetailsLegacy } from '../utils/unified-torrent-parser.js';
import { extractQuality } from './quality-processor.js';
import { detectSimpleVariant } from '../utils/variant-detector.js';
import { romanToNumber } from '../utils/roman-numeral-utils.js';
import { logger } from '../utils/logger.js';

const STREAM_NAME_MAP = {
    debridlink: "[DL+] DebridSearch",
    realdebrid: "[RD+] DebridSearch",
    alldebrid: "[AD⚡] DebridSearch",
    premiumize: "[PM+] DebridSearch",
    torbox: "[TB+] DebridSearch"
};

/**
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
        if (!details.videos?.length) return null;
        
        video = details.videos[0];
        
        logger.debug(`[toStream] Selected video: "${video.name}" (S${video.info?.season}E${video.info?.episode})`);
        
        // Only sort by size if there are multiple videos of the same episode
        if (details.videos.length > 1) {
            const firstEpisodeId = `${details.videos[0].info?.season}x${details.videos[0].info?.episode}`;
            const allSameEpisode = details.videos.every(v => 
                `${v.info?.season}x${v.info?.episode}` === firstEpisodeId
            );
            
            logger.debug(`[toStream] Multiple videos (${details.videos.length}), all same episode: ${allSameEpisode}`);
            
            if (allSameEpisode) { // All videos are same episode, pick largest
                details.videos.sort((a, b) => b.size - a.size);
                video = details.videos[0];
                logger.debug(`[toStream] After size sorting, selected: "${video.name}"`);
            }
        }
    }

    if (!video) return null;

    const quality = extractQuality(video, details);
    
    let name = STREAM_NAME_MAP[details.source] || 'Unknown'
    name = name + '\n' + quality

    let title = formatStreamTitle(details, video, type, icon, knownSeasonEpisode, variantInfo, searchContext); // Enhanced title formatting - pass known season/episode info and variant info if available

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
 * Extract quality information from video and torrent details with emoji indicators
 */
/**
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
 * This function creates the multi-line stream title format
 */
function formatStreamTitle(details, video, type, icon, knownSeasonEpisode = null, variantInfo = null, searchContext = null) {
    const containerName = details.containerName || details.name || 'Unknown';
    const videoName = video.name || '';
    const size = formatSize(video?.size || 0);
    
    if (type === 'series') {
        const seriesInfo = extractSeriesInfo(videoName, containerName);
        const releaseGroup = extractReleaseGroup(videoName || containerName);
        
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
        
        let seasonEpisode = seriesInfo.seasonEpisode;
        if (knownSeasonEpisode && knownSeasonEpisode.season && knownSeasonEpisode.episode) {
            const season = String(knownSeasonEpisode.season).padStart(2, '0');
            const episode = String(knownSeasonEpisode.episode).padStart(2, '0');
            const knownSeasonEpisodeStr = `S${season}E${episode}`;
            
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
        
        // Line 1: Original video torrent name as it comes from debrid provider
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
        const episodePart = seasonEpisode.substring(3);   // E04
        let sizeLine = `${seasonPart} - ${episodePart} • ${icon} ${size}`;
        if (releaseGroup && releaseGroup.trim().length > 0 && isValidReleaseGroup(releaseGroup)) {
            sizeLine += ` • 👥 [${releaseGroup}]`;
        }
        lines.push(sizeLine);
        
        return lines.join('\n');
        
    } else {
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
 * Remove file extension from filename using centralized patterns
 */
function removeExtension(filename) {
    if (!filename) return filename;
    const videoExtensionPattern = new RegExp(`\\.(${FILE_EXTENSIONS.video.join('|')})$`, 'i');
    return filename.replace(videoExtensionPattern, '');
}

/**
 * Extract series information (title, season, episode) from filename
 */
function extractSeriesInfo(videoName, containerName) {
    const name = videoName || containerName || '';
    
    // Use unified parser for consistent results
    const parseResult = parseUnified(name);
    
    // Build season/episode string in standard format
    let seasonEpisode = 'Unknown Episode';
    if (parseResult.season !== null && parseResult.episode !== null) {
        seasonEpisode = `S${parseResult.season.toString().padStart(2, '0')}E${parseResult.episode.toString().padStart(2, '0')}`;
    }
    
    // Use title from parser or fallback
    let title = parseResult.title || 'Unknown Series';
    
    // If title is empty or too short, try containerName as fallback
    if (!title || title.length < 3) {
        title = (containerName || 'Unknown Series')
            .replace(/^[\[\(][^\]\)]*[\]\)]\s*/, '')
            .replace(/[\._]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim() || 'Unknown Series';
    }
    
    // Extract episode name using the same logic as before for compatibility
    let episodeName = null;
    const episodePatterns = [
        /"([^"]+)"/,                // Double quotes: "Episode Name"
        /'([^']+)'/,                // Single quotes: 'Episode Name'
        /''([^']+)''/,              // Double single quotes: ''Episode Name''
        /- [Ss]\d+[Ee]\d+ - ([^(]+?)(?:\s*\([^)]*\)|$)/ // Pattern for: Series - SxxExx - Episode Name (technical info)
    ];
    
    for (const pattern of episodePatterns) {
        const match = name.match(pattern);
        if (match && match[1] && match[1].trim().length > 2) {
            const content = match[1].trim();
            
            // Skip technical patterns
            if (content.match(/^\d+p$|^x26[45]$|^hevc$|^avc$|^10bits?$/i) || 
                content.match(/^[A-Z0-9]{8}$/i) || 
                content.match(/^(VRV|Multiple Subtitle|1080p|720p|480p)$/i)) {
                continue;
            }
            
            // Check similarity to title to avoid redundant episode names
            const normalizedTitle = title.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
            const normalizedContent = content.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
            
            // Check if episode name is too similar to title
            const titleWords = normalizedTitle.split(' ').filter(word => word.length > 3);
            const isRedundant = titleWords.some(word => {
                if (word.length > 4 && normalizedContent.includes(word)) {
                    return true;
                }
                return false;
            });
            
            const similarity = calculateStringSimilarity(normalizedTitle, normalizedContent);
            
            if (!isRedundant && similarity < 0.7 && content.length > 3) {
                episodeName = content;
                break;
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
 * Extract comprehensive technical details from filename with sophisticated pattern matching
 */
export function extractTechnicalDetails(filename, seriesTitle, releaseGroup, episodeName) {
    // Use unified parser for technical details extraction
    return extractTechnicalDetailsLegacy(filename);
}

export function filterSeason(torrent, season) {
    const torrentSeason = torrent?.info?.season;
    const torrentSeasons = torrent?.info?.seasons;
    const seasonMatch = torrentSeason == season || torrentSeasons?.includes(Number(season));
    
    logger.debug(`[filterSeason] Checking torrent: "${torrent?.name || 'UNKNOWN'}" | Target season: ${season} | Torrent season: ${torrentSeason} | Torrent seasons: ${JSON.stringify(torrentSeasons)} | Match: ${seasonMatch}`);
    
    return seasonMatch;
}

export function filterEpisode(torrentDetails, season, episode, absoluteEpisode = null) {
    
    let classicMatches = [];
    let potentialAbsoluteMatches = [];
    
    torrentDetails.videos.forEach(video => {
        const videoSeason = video.info.season;
        const videoEpisode = video.info.episode;
        
        if (season == videoSeason && episode == videoEpisode) {
            logger.debug(`[filterEpisode] ✅ Classic match: S${videoSeason}E${videoEpisode} matches S${season}E${episode}`);
            classicMatches.push(video);
        }
    });
    
    if (classicMatches.length > 0) {
        logger.debug(`[filterEpisode] Using ${classicMatches.length} classic matches, skipping absolute matching`);
        torrentDetails.videos = classicMatches;
        return true;
    }

    if (typeof absoluteEpisode === 'number') {
        logger.debug(`[filterEpisode] No classic matches found, trying absolute episode matching for ${absoluteEpisode}`);
        
        torrentDetails.videos.forEach(video => {
            const videoSeason = video.info.season;
            
            if (videoSeason && videoSeason != season) {
                logger.debug(`[filterEpisode] ❌ Skipping absolute matching: video is S${videoSeason}, looking for S${season}`);
                return;
            }
            
            const absolutePattern = new RegExp(`\\b0*${absoluteEpisode}\\b`);
            if (absolutePattern.test(video.name)) {
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
