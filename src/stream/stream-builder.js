/**
 * Stream builder module - constructs stream objects with detailed titles and quality info
 */
import { FILE_TYPES } from './metadata-extractor.js';
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
import { extractSeriesInfo, extractMovieInfo } from './metadata-extractor.js';
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
 * Create multiple stream objects from torrent details when it contains multiple valid videos
 * This function addresses Issue 1: ensuring all valid videos in a torrent container are returned as separate streams
 */
export function toStreams(details, type, parsedMetadataOrKnownSeasonEpisode = null, knownSeasonEpisode = null, variantInfo = null, searchContext = null) {
    if (!details) return [];

    let parsedMetadata = null;
    if (parsedMetadataOrKnownSeasonEpisode && typeof parsedMetadataOrKnownSeasonEpisode === 'object' && 
        (parsedMetadataOrKnownSeasonEpisode.seriesInfo || parsedMetadataOrKnownSeasonEpisode.movieInfo || parsedMetadataOrKnownSeasonEpisode.technicalDetails)) {
        parsedMetadata = parsedMetadataOrKnownSeasonEpisode;
    } else {
        knownSeasonEpisode = parsedMetadataOrKnownSeasonEpisode;
    }

    logger.debug(`[toStreams] Processing ${type} with details.name="${details.name}"`);
    logger.debug(`[toStreams] knownSeasonEpisode:`, JSON.stringify(knownSeasonEpisode, null, 2));
    logger.debug(`[toStreams] details.videos length:`, details.videos?.length || 0);
    logger.debug(`[toStreams] parsedMetadata provided:`, !!parsedMetadata);

    const streams = [];
    const icon = details.fileType == FILE_TYPES.DOWNLOADS ? '⬇️' : '💾';

    if (details.fileType == FILE_TYPES.DOWNLOADS) {
        // Direct download - create single stream
        const stream = createSingleStream(details, details, type, icon, parsedMetadata, knownSeasonEpisode, variantInfo, searchContext);
        if (stream) streams.push(stream);
    } else {
        // Torrent container - create stream for each valid video
        if (!details.videos?.length) return [];
        
        logger.debug(`[toStreams] Creating streams for ${details.videos.length} videos`);
        
        for (const video of details.videos) {
            logger.debug(`[toStreams] Processing video: "${video.name}" (S${video.info?.season}E${video.info?.episode})`);
            
            const stream = createSingleStream(details, video, type, icon, parsedMetadata, knownSeasonEpisode, variantInfo, searchContext);
            if (stream) {
                streams.push(stream);
                logger.debug(`[toStreams] ✅ Created stream for: "${video.name}"`);
            } else {
                logger.debug(`[toStreams] ❌ Failed to create stream for: "${video.name}"`);
            }
        }
    }

    logger.debug(`[toStreams] Generated ${streams.length} streams from ${details.videos?.length || 1} videos`);
    return streams;
}

/**
 * Create stream object from torrent details and video file
 * Updated to accept pre-parsed metadata for performance optimization
 * 
 * DEPRECATED: Use toStreams() instead for Issue 1 compliance
 * This function is kept for backwards compatibility only
 */
export function toStream(details, type, parsedMetadataOrKnownSeasonEpisode = null, knownSeasonEpisode = null, variantInfo = null, searchContext = null) {
    if (!details) return null;

    let parsedMetadata = null;
    if (parsedMetadataOrKnownSeasonEpisode && typeof parsedMetadataOrKnownSeasonEpisode === 'object' && 
        (parsedMetadataOrKnownSeasonEpisode.seriesInfo || parsedMetadataOrKnownSeasonEpisode.movieInfo || parsedMetadataOrKnownSeasonEpisode.technicalDetails)) {
        parsedMetadata = parsedMetadataOrKnownSeasonEpisode;
    } else {
        knownSeasonEpisode = parsedMetadataOrKnownSeasonEpisode;
    }

    logger.debug(`[toStream] Processing ${type} with details.name="${details.name}"`);
    logger.debug(`[toStream] knownSeasonEpisode:`, JSON.stringify(knownSeasonEpisode, null, 2));
    logger.debug(`[toStream] details.videos length:`, details.videos?.length || 0);
    logger.debug(`[toStream] parsedMetadata provided:`, !!parsedMetadata);

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

    return createSingleStream(details, video, type, icon, parsedMetadata, knownSeasonEpisode, variantInfo, searchContext);
}

/**
 * Helper function to create a single stream from container details and video
 * Extracted from original toStream to avoid code duplication
 */
function createSingleStream(details, video, type, icon, parsedMetadata, knownSeasonEpisode, variantInfo, searchContext) {
    if (!video) return null;

    const quality = extractQuality(video, details);
    
    let name = STREAM_NAME_MAP[details.source] || 'Unknown'
    name = name + '\n' + quality

    let title = formatStreamTitle(details, video, type, icon, parsedMetadata, knownSeasonEpisode, variantInfo, searchContext);

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

function formatSize(size) {
    if (!size) {
        return undefined
    }

    const i = size === 0 ? 0 : Math.floor(Math.log(size) / Math.log(1024))
    return Number((size / Math.pow(1024, i)).toFixed(2)) + ' ' + ['B', 'kB', 'MB', 'GB', 'TB'][i]
}

/**
 * This function creates the multi-line stream title format
 * Updated to use pre-parsed metadata for performance optimization
 */
function formatStreamTitle(details, video, type, icon, parsedMetadata = null, knownSeasonEpisode = null, variantInfo = null, searchContext = null) {
    const containerName = details.containerName || details.name || 'Unknown';
    const videoName = video.name || '';
    const size = formatSize(video?.size || 0);
    
    if (type === 'series') {
        const seriesInfo = parsedMetadata?.seriesInfo || extractSeriesInfo(videoName, containerName);
        const releaseGroup = extractReleaseGroup(videoName || containerName);
        
        let detectedVariant = null;
        const variantSystemEnabled = process.env.VARIANT_SYSTEM_ENABLED !== 'false'; // Default to true unless explicitly disabled
        
        if (variantSystemEnabled && searchContext && searchContext.searchTitle && searchContext.alternativeTitles) {
            // For variant detection, always use the individual video name, not the container series info
            // This ensures each video file is analyzed separately for variant detection
            const videoSeriesInfo = extractSeriesInfo(videoName, '');
            logger.debug(`[formatStreamTitle] Variant detection: videoSeriesInfo.title="${videoSeriesInfo.title}", searchContext.searchTitle="${searchContext.searchTitle}", alternativeTitles=${searchContext.alternativeTitles.length}`);
            detectedVariant = detectSimpleVariant(videoSeriesInfo.title, searchContext.searchTitle, searchContext.alternativeTitles);
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
        if (seriesInfo.episodeName || seriesInfo.episodeTitle) {
            const episodeName = seriesInfo.episodeName || seriesInfo.episodeTitle;
            lines.push(`📺 "${episodeName}"`);
        }
        
        // Line 4 or 5: Enhanced technical details with good emojis for easy reading
        const techDetails = parsedMetadata?.technicalDetails || extractTechnicalDetailsLegacy(removeExtension(videoName || containerName));
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
        // Use pre-parsed metadata if available, otherwise parse on demand (fallback for compatibility)
        const movieInfo = parsedMetadata?.movieInfo || extractMovieInfo(removeExtension(videoName || containerName));
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
        const techDetails = parsedMetadata?.technicalDetails || extractTechnicalDetailsLegacy(removeExtension(videoName || containerName));
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
 * Remove file extension from filename using centralized patterns
 */
function removeExtension(filename) {
    if (!filename) return filename;
    const videoExtensionPattern = new RegExp(`\\.(${FILE_EXTENSIONS.video.join('|')})$`, 'i');
    return filename.replace(videoExtensionPattern, '');
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
    
    if (typeof absoluteEpisode === 'number') {
        const logPrefix = classicMatches.length > 0 ? 
            `[filterEpisode] Found ${classicMatches.length} classic matches, also checking absolute episode matching for ${absoluteEpisode}` :
            `[filterEpisode] No classic matches found, trying absolute episode matching for ${absoluteEpisode}`;
        logger.debug(logPrefix);
        
        torrentDetails.videos.forEach(video => {
            const videoSeason = video.info.season;
            
            if (videoSeason !== null && videoSeason != season && !absoluteEpisode) {
                return;
            }
            const absolutePattern = new RegExp(`\\b0*${absoluteEpisode}\\b`);
            const patternMatches = absolutePattern.test(video.name);

            if (patternMatches) {
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
            
            const hasAbsoluteInfo = video.info.absoluteEpisode && 
                parseInt(video.info.absoluteEpisode, 10) === parseInt(absoluteEpisode, 10);
            if (hasAbsoluteInfo) {
                logger.debug(`[filterEpisode] ✅ Absolute info match: ${video.info.absoluteEpisode} = ${absoluteEpisode}`);
                potentialAbsoluteMatches.push(video);
                return;
            }
            
        });
    }
    
    const allMatches = [...classicMatches];
        
        if (potentialAbsoluteMatches.length > 0) {
        potentialAbsoluteMatches.forEach(absoluteMatch => {
            const isDuplicate = classicMatches.some(classicMatch => classicMatch.name === absoluteMatch.name);
            if (!isDuplicate) {
                allMatches.push(absoluteMatch);
            }
        });
    }
    
    if (allMatches.length > 0) {
        const classicCount = classicMatches.length;
        const absoluteCount = potentialAbsoluteMatches.length;
        const uniqueAbsoluteCount = allMatches.length - classicCount;
        
        if (classicCount > 0 && uniqueAbsoluteCount > 0) {
            logger.debug(`[filterEpisode] ✅ Combined matches: ${classicCount} classic + ${uniqueAbsoluteCount} absolute = ${allMatches.length} total`);
        } else if (classicCount > 0) {
            logger.debug(`[filterEpisode] ✅ Using ${classicCount} classic matches only`);
        } else {
            logger.debug(`[filterEpisode] ✅ Using ${uniqueAbsoluteCount} absolute matches only`);
        }
        
        torrentDetails.videos = allMatches;
            return true;
        }
    
    logger.debug(`[filterEpisode] ❌ No matches found for S${season}E${episode} (abs: ${absoluteEpisode})`);
    torrentDetails.videos = [];
    return false;
}