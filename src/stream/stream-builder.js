/**
 * Stream Builder Module - Constructs stream objects with detailed titles and quality information.
 */

import { extractSeriesInfo, extractMovieInfo, FILE_TYPES } from './metadata-extractor.js';
import { FILE_EXTENSIONS} from '../utils/media-patterns.js';
import { extractReleaseGroup, isValidReleaseGroup } from '../utils/groups-util.js';
import { extractTechnicalDetailsLegacy } from '../utils/unified-torrent-parser.js';
import { extractQuality } from './quality-processor.js';
import { detectSimpleVariant } from '../utils/variant-detector.js';
import { AVOID_EPISODE_PATTERNS } from '../utils/episode-patterns.js';
import { logger } from '../utils/logger.js';
import cache from '../utils/cache-manager.js';
import { configManager } from '../config/configuration.js';

// ================================================================================================
// CONFIGURATION
// ================================================================================================

/**
 * Configuration flag to control multi-stream per torrent behavior
 * When true: Allows multiple streams per torrent container (slower but comprehensive)
 * When false: Forces single stream per torrent (ultra-fast performance)
 */
const ENABLE_MULTI_STREAM_PER_TORRENT = process.env.ENABLE_MULTI_STREAM_PER_TORRENT === 'true';

const STREAM_NAME_MAP = {
    DebridLink: "[DL⚡] Intell DebridSearch",
    RealDebrid: "[RD⚡] Intell DebridSearch",
    AllDebrid: "[AD⚡] Intell DebridSearch",
    Premiumize: "[PM⚡] Intell DebridSearch",
    TorBox: "[TB⚡] Intell DebridSearch"
};

// ================================================================================================
// UTILITY FUNCTIONS
// ================================================================================================

/**
 * Parses the overloaded parsedMetadataOrKnownSeasonEpisode parameter
 */
function parseMetadataParams(parsedMetadataOrKnownSeasonEpisode) {
    if (parsedMetadataOrKnownSeasonEpisode && typeof parsedMetadataOrKnownSeasonEpisode === 'object' && 
        (parsedMetadataOrKnownSeasonEpisode.seriesInfo || parsedMetadataOrKnownSeasonEpisode.movieInfo || parsedMetadataOrKnownSeasonEpisode.technicalDetails)) {
        return { parsedMetadata: parsedMetadataOrKnownSeasonEpisode, knownSeasonEpisode: null };
    }
    return { parsedMetadata: null, knownSeasonEpisode: parsedMetadataOrKnownSeasonEpisode };
}

// ================================================================================================
// MAIN STREAM CREATION ENTRY POINTS  
// ================================================================================================

/** Main entry point with intelligent routing for optimal performance */
export function optimizedStreamCreation(details, type, parsedMetadataOrKnownSeasonEpisode = null, knownSeasonEpisode = null, variantInfo = null, searchContext = null) {
    if (!details) return [];
    
    logger.debug(`[optimizedStreamCreation] Processing ${type} content with ${details.videos?.length || 1} video(s), multi-stream enabled: ${ENABLE_MULTI_STREAM_PER_TORRENT}`);
    
    // Environment variable control: force single-stream for ultra-fast performance
    if (!ENABLE_MULTI_STREAM_PER_TORRENT) {
        logger.debug(`[optimizedStreamCreation] 🚀 Single-stream mode enforced by ENABLE_MULTI_STREAM_PER_TORRENT=false - using first video for ultra-fast performance`);
        const singleStream = toStreamSingle(details, type, parsedMetadataOrKnownSeasonEpisode, knownSeasonEpisode, variantInfo, searchContext);
        return singleStream ? [singleStream] : [];
    }
    
    // Single video scenarios (existing logic)
    if (details.fileType === FILE_TYPES.DOWNLOADS || !details.videos?.length || details.videos.length === 1) {
        const singleStream = toStreamSingle(details, type, parsedMetadataOrKnownSeasonEpisode, knownSeasonEpisode, variantInfo, searchContext);
        return singleStream ? [singleStream] : [];
    }
    
    // Multi-video scenarios - use comprehensive processing when enabled
    logger.debug(`[optimizedStreamCreation] 🔄 Multi-stream mode enabled - processing all ${details.videos.length} videos`);
    return toStreams(details, type, parsedMetadataOrKnownSeasonEpisode, knownSeasonEpisode, variantInfo, searchContext);
}

// ================================================================================================
// OPTIMIZED PATH FUNCTIONS
// ================================================================================================

/** Optimized single video stream creation */
export function toStreamSingle(details, type, parsedMetadataOrKnownSeasonEpisode = null, knownSeasonEpisode = null, variantInfo = null, searchContext = null) {
    if (!details) return null;

    const { parsedMetadata, knownSeasonEpisode: resolvedKnownSeasonEpisode } = parseMetadataParams(parsedMetadataOrKnownSeasonEpisode);
    const finalKnownSeasonEpisode = knownSeasonEpisode || resolvedKnownSeasonEpisode;

    let video, icon;
    if (details.fileType === FILE_TYPES.DOWNLOADS) {
        icon = '⬇️';
        video = details;
    } else {
        icon = '💾';
        
        // For series content with episode filtering, apply pattern priority sorting
        if (type === 'series' && finalKnownSeasonEpisode?.season && finalKnownSeasonEpisode?.episode) {
            const season = finalKnownSeasonEpisode.season;
            const episode = finalKnownSeasonEpisode.episode;
            
            // Apply episode filtering with pattern priority sorting
            const filteredResult = filterEpisode(details, season, episode);
            if (filteredResult && details.videos?.length > 0) {
                video = details.videos[0]; // filterEpisode sorts videos by priority, so take first
                logger.debug(`[toStreamSingle] Selected video after pattern priority filtering: "${video.name}"`);
            } else {
                logger.debug(`[toStreamSingle] No episode matches found, falling back to first video`);
                video = details.videos?.[0];
            }
        } else {
            // For non-series or when no episode info, use first video
            video = details.videos?.[0];
        }
        
        if (!video) {
            logger.debug(`[toStreamSingle] No video found in torrent details`);
            return null;
        }
    }

    return createSingleStreamFast(details, video, type, icon, parsedMetadata, finalKnownSeasonEpisode, variantInfo, searchContext);
}

/** Optimized single stream creation */
function createSingleStreamFast(details, video, type, icon, parsedMetadata, knownSeasonEpisode, variantInfo, searchContext) {
    if (!video) return null;
    
    if (!video.name || !video.url) {
        return null;
    }

    const quality = extractQuality(video, details);
    const sourceName = STREAM_NAME_MAP[details.source] || 'Unknown';
    
    const title = formatStreamTitle(details, video, type, icon, parsedMetadata, knownSeasonEpisode, variantInfo, searchContext);

    return {
        name: sourceName + '\n' + quality,
        title,
        url: video.url,
        behaviorHints: {
            bingeGroup: details.source + '|' + details.id,
            filename: video.name || null,
            videoSize: video.size || null,
        }
    };
}

// ================================================================================================
// STANDARD PATH FUNCTIONS
// ================================================================================================

/** Multi-video stream creation for torrent containers */
export function toStreams(details, type, parsedMetadataOrKnownSeasonEpisode = null, knownSeasonEpisode = null, variantInfo = null, searchContext = null) {
    if (!details) return [];

    const { parsedMetadata, knownSeasonEpisode: resolvedKnownSeasonEpisode } = parseMetadataParams(parsedMetadataOrKnownSeasonEpisode);
    const finalKnownSeasonEpisode = knownSeasonEpisode || resolvedKnownSeasonEpisode;
    
    logger.debug(`[toStreams] Processing ${details.videos?.length || 0} videos for ${type} content`);

    const streams = [];
    const icon = details.fileType == FILE_TYPES.DOWNLOADS ? '⬇️' : '💾';

    if (details.fileType == FILE_TYPES.DOWNLOADS) {
        // Direct download - create single stream
        const stream = createSingleStream(details, details, type, icon, parsedMetadata, finalKnownSeasonEpisode, variantInfo, searchContext);
        if (stream) streams.push(stream);
    } else {
        // Torrent container - create stream for each valid video
        if (!details.videos?.length) return [];
        
        for (const video of details.videos) {
            if (!video) continue;
            
            const stream = createSingleStream(details, video, type, icon, parsedMetadata, finalKnownSeasonEpisode, variantInfo, searchContext);
            if (stream) streams.push(stream);
        }
    }

    return streams;
}

/**
 * Helper function to create a single stream from container details and video.
 */
function createSingleStream(details, video, type, icon, parsedMetadata, knownSeasonEpisode, variantInfo, searchContext) {
    if (!video) return null;
    
    if (!video.name || !video.url) {
        return null;
    }

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
            bingeGroup: bingeGroup,
            filename: video.name || null,
            videoSize: video.size || null,
        }
    }
}

// ================================================================================================
// UTILITY FUNCTIONS
// ================================================================================================

/** Format file size for display */
function formatSize(size) {
    if (!size) return undefined;
    const i = size === 0 ? 0 : Math.floor(Math.log(size) / Math.log(1024));
    return Number((size / Math.pow(1024, i)).toFixed(2)) + ' ' + ['B', 'kB', 'MB', 'GB', 'TB'][i];
}

/** Remove file extension from filename */
function removeExtension(filename) {
    if (!filename) return '';
    const allExtensions = Object.values(FILE_EXTENSIONS).flat();
    const videoExtensionPattern = new RegExp(`\\.(${allExtensions.join('|')})$`, 'i');
    return filename.replace(videoExtensionPattern, '');
}

// ================================================================================================
// TITLE FORMATTING
// ================================================================================================

/**
 * Extracts basic title information (container name, video name, size)
 */
function extractBasicInfo(details, video) {
    return {
        containerName: details.containerName || details.name || 'Unknown',
        videoName: video.name || '',
        size: formatSize(video?.size || 0),
        matchedTerm: details.matchedTerm || null // Preserve the search term that matched this torrent
    };
}

// ================================================================================================
// PERFORMANCE OPTIMIZATION: Technical Details Caching
// ================================================================================================

/**
 * Cache key prefix for technical details to avoid conflicts with other cached data
 */
const TECH_DETAILS_CACHE_PREFIX = 'tech_details_';
const TECH_DETAILS_TTL = 24 * 3600; // 24 hours

/**
 * Gets technical details from metadata, unified cache, or extracts them fresh
 */
function getTechnicalDetails(parsedMetadata, videoName) {
    if (parsedMetadata?.technicalDetails) {
        return parsedMetadata.technicalDetails;
    }
    
    const cacheKey = TECH_DETAILS_CACHE_PREFIX + removeExtension(videoName);
    const cachedDetails = cache.get(cacheKey);
    
    if (cachedDetails !== null) {
        logger.debug(`[getTechnicalDetails] Cache hit for: ${videoName}`);
        return cachedDetails;
    }
    
    const cleanedFilename = removeExtension(videoName);
    const techDetails = extractTechnicalDetailsLegacy(cleanedFilename);
    
    cache.set(cacheKey, techDetails, TECH_DETAILS_TTL, {
        type: 'technical_details',
        filename: cleanedFilename,
        extractedAt: Date.now()
    });
    
    return techDetails;
}

/** Gets cache statistics for performance monitoring */
function getCacheStats() {
    const unifiedStats = cache.getStats();
    const techDetailsEntries = cache.getByPattern(`^${TECH_DETAILS_CACHE_PREFIX}`);
    
    return {
        hits: unifiedStats.stats.hits,
        misses: unifiedStats.stats.misses,
        hitRate: unifiedStats.hitRate * 100,
        cacheSize: techDetailsEntries.length,
        totalCacheSize: unifiedStats.size,
        maxCacheSize: unifiedStats.maxSize,
        techDetailsCacheContents: techDetailsEntries.reduce((acc, entry) => {
            acc[entry.key.replace(TECH_DETAILS_CACHE_PREFIX, '')] = entry.value;
            return acc;
        }, {})
    };
}

/**
 * Clears technical details from unified cache (useful for testing)
 */
function clearTechnicalDetailsCache() {
    const techDetailsEntries = cache.getByPattern(`^${TECH_DETAILS_CACHE_PREFIX}`);
    techDetailsEntries.forEach(entry => {
        cache.delete(entry.key);
    });
}

/**
 * Detects variant information for series content
 */
function detectVariantForSeries(searchContext, seriesInfo, containerName) {
    const variantSystemEnabled = process.env.VARIANT_SYSTEM_ENABLED !== 'false';
    
    if (!variantSystemEnabled || !searchContext?.searchTitle || !searchContext?.alternativeTitles) {
        return null;
    }
    
    return detectSimpleVariant(
        seriesInfo.title,
        searchContext.searchTitle, 
        searchContext.alternativeTitles, 
        seriesInfo.episodeTitle || seriesInfo.episodeName
    );
}

/**
 * Formats season/episode identifier
 */
function formatSeasonEpisode(knownSeasonEpisode, seriesInfo) {
    if (knownSeasonEpisode) {
        return `S${String(knownSeasonEpisode.season).padStart(2, '0')}E${String(knownSeasonEpisode.episode).padStart(2, '0')}`;
    }
    return `S${String(seriesInfo.season).padStart(2, '0')}E${String(seriesInfo.episode).padStart(2, '0')}`;
}

/**
 * Adds variant line if variant is detected
 */
function addVariantLine(lines, detectedVariant, variantInfo) {
    if (detectedVariant?.isVariant && detectedVariant.variantName) {
        lines.push(`🔄 Variant: ${detectedVariant.variantName}`);
    } else if (variantInfo?.isVariant && variantInfo.variantName) {
        lines.push(`🔄 Variant: ${variantInfo.variantName}`);
    }
}

/**
 * Builds size line with icon and release group
 * @param {string} icon - Quality icon
 * @param {string} size - Formatted size
 * @param {string} releaseGroup - Release group name
 * @param {string} seasonEpisode - Season/episode string (for series only)
 * @returns {string} Complete size line
 */
function buildSizeLine(icon, size, releaseGroup, seasonEpisode = null) {
    let sizeLine;
    
    if (seasonEpisode) {
        // Series: "S01 - E04 • icon size"
        const seasonPart = seasonEpisode.substring(0, 3); // S01
        const episodePart = seasonEpisode.substring(3);   // E04
        sizeLine = `${seasonPart} - ${episodePart} • ${icon} ${size}`;
    } else {
        sizeLine = `${icon} ${size}`;
    }
    
    if (configManager.getIsReleaseGroupEnabled() && releaseGroup && releaseGroup.trim().length > 0 && isValidReleaseGroup(releaseGroup)) {
        sizeLine += ` • 👥 [${releaseGroup}]`;
    }
    
    return sizeLine;
}

/**
 * Formats stream title for series content
 * @param {Object} basicInfo - Basic info { containerName, videoName, size }
 * @param {string} icon - Quality icon
 * @param {Object} parsedMetadata - Pre-parsed metadata
 * @param {Object} knownSeasonEpisode - Known season/episode info
 * @param {Object} variantInfo - Variant information
 * @param {Object} searchContext - Search context
 * @returns {string} Formatted series title
 */
function formatSeriesStreamTitle(basicInfo, icon, parsedMetadata, knownSeasonEpisode, variantInfo, searchContext) {
    const { containerName, videoName, size, matchedTerm } = basicInfo;
    const seriesInfo = parsedMetadata?.seriesInfo || extractSeriesInfo(videoName, containerName);
    const releaseGroup = configManager.getIsReleaseGroupEnabled() ? 
        (parsedMetadata?.releaseGroup || extractReleaseGroup(videoName || containerName)) : null;
    
    const detectedVariant = detectVariantForSeries(searchContext, seriesInfo, containerName);
    const seasonEpisode = formatSeasonEpisode(knownSeasonEpisode, seriesInfo);
    
    const lines = [];
    
    // Line 1: Original video torrent name (escape commas to prevent Stremio display issues)
    const safeVideoName = (videoName || containerName).replace(/,/g, '，'); // Full-width comma (U+FF0C) looks identical but different character (prevent Stremio display issues)
    lines.push(`📁 ${safeVideoName}`);
    
    // Line 2: Clean series title - prioritize matchedTerm over PTT-extracted title
    const displayTitle = (matchedTerm && matchedTerm.trim()) ? matchedTerm : seriesInfo.title;
    const safedisplayTitle = displayTitle.replace(/,/g, '，'); // Full-width comma (U+FF0C) looks identical but different character (prevent Stremio display issues)
    lines.push(safedisplayTitle);
    
    // Line 3: Variant information (if applicable)
    addVariantLine(lines, detectedVariant, variantInfo);
    
    // Line 3 or 4: Episode name (if found)
    if (seriesInfo.episodeName || seriesInfo.episodeTitle) {
        const episodeName = seriesInfo.episodeName || seriesInfo.episodeTitle;
        const safeEpisodeName = episodeName.replace(/,/g, '，'); // Full-width comma (U+FF0C) looks identical but different character (prevent Stremio display issues)
        lines.push(`📺 "${safeEpisodeName}"`);
    }
    
    // Line 4 or 5: Technical details
    const techDetails = getTechnicalDetails(parsedMetadata, videoName || containerName);
    if (techDetails && techDetails.length > 0) {
        lines.push(`⚙️ ${techDetails}`);
    }
    
    // Final line: Season/Episode + Size + Release Group
    lines.push(buildSizeLine(icon, size, releaseGroup, seasonEpisode));
    
    return lines.join('\n');
}

/** Formats stream title for movie content */
function formatMovieStreamTitle(basicInfo, icon, parsedMetadata, variantInfo) {
    const { containerName, videoName, size } = basicInfo;
    const movieInfo = parsedMetadata?.movieInfo || extractMovieInfo(removeExtension(videoName || containerName));
    const releaseGroup = configManager.getIsReleaseGroupEnabled() ? 
        (parsedMetadata?.releaseGroup || extractReleaseGroup(videoName || containerName)) : null;
    
    const lines = [];
    
    // Line 1: Original video torrent name (escape commas to prevent Stremio display issues)
    const safeVideoName = (videoName || containerName).replace(/,/g, '，'); // Full-width comma (U+FF0C) looks identical but different character
    lines.push(`📁 ${safeVideoName}`);
    
    // Line 2: Clean movie title with year
    const titleWithYear = movieInfo.year ? `${movieInfo.title} (${movieInfo.year})` : movieInfo.title;
    lines.push(titleWithYear);
    
    // Line 3: Variant information (if applicable)
    addVariantLine(lines, null, variantInfo);
    
    // Line 3 or 4: Technical details
    const techDetails = getTechnicalDetails(parsedMetadata, videoName || containerName);
    if (techDetails && techDetails.length > 0) {
        lines.push(`⚙️ ${techDetails}`);
    }
    
    // Final line: Size + Release Group
    lines.push(buildSizeLine(icon, size, releaseGroup));
    
    return lines.join('\n');
}

/**
 * Creates the multi-line stream title format with enhanced technical details.
 * 
 * @param {Object} details - Container details
 * @param {Object} video - Video file details
 * @param {string} type - Content type
 * @param {string} icon - Stream icon
 * @param {Object} parsedMetadata - Pre-parsed metadata
 * @param {Object} knownSeasonEpisode - Season/episode information
 * @param {Object} variantInfo - Variant information
 * @param {Object} searchContext - Search context
 * @returns {string} Formatted multi-line title
 */
function formatStreamTitle(details, video, type, icon, parsedMetadata = null, knownSeasonEpisode = null, variantInfo = null, searchContext = null) {
    const basicInfo = extractBasicInfo(details, video);
    
    if (type === 'series') {
        return formatSeriesStreamTitle(basicInfo, icon, parsedMetadata, knownSeasonEpisode, variantInfo, searchContext);
    } else {
        return formatMovieStreamTitle(basicInfo, icon, parsedMetadata, variantInfo);
    }
}

// ================================================================================================
// FILTERING FUNCTIONS
// ================================================================================================

/**
 * Filter torrents by year for movies.
 */
export function filterYear(torrent, cinemetaDetails) {
    if (!cinemetaDetails?.year) return true; // No year to filter against
    
    const torrentYear = torrent?.info?.year;
    if (!torrentYear) return true; // No year info in torrent
    
    return Math.abs(torrentYear - cinemetaDetails.year) <= 1; // Allow 1 year difference
}

/**
 * Filter videos for a specific episode.
 * 
 * Uses pre-processed absolute episode matches from AbsoluteEpisodeProcessor.
 * Also applies AVOID_EPISODE_PATTERNS to filter out false positives like (1).mkv files.
 */
export function filterEpisode(torrentDetails, season, episode) {
    if (!torrentDetails || !torrentDetails.videos) {
        torrentDetails.videos = [];
        return false;
    }
    
    const matches = [];
    
    torrentDetails.videos.forEach(video => {
        const shouldAvoid = AVOID_EPISODE_PATTERNS.some(pattern => pattern.test(video.name));
        if (shouldAvoid) {
            logger.debug(`[filterEpisode] ❌ Avoided file matching avoidance pattern "...(1)": "${video.name}"`);
            return; 
        }
        
        if (video.isAbsoluteMatch) {
            logger.debug(`[filterEpisode] ✅ Pre-processed absolute match: "${video.name}"`);
            matches.push(video);
            return;
        }
        
        const videoSeason = video.info?.season;
        const videoEpisode = video.info?.episode;

        if (season == videoSeason && episode == videoEpisode) {
            logger.debug(`[filterEpisode] ✅ Classic match: S${videoSeason}E${videoEpisode} matches S${season}E${episode}`);
            matches.push(video);
        }
    });
    
    if (matches.length > 0) {
        // Sort matches by pattern priority: classic patterns before absolute/converted patterns
        if (matches.length > 1) {
            matches.sort((a, b) => {
                const aNative = !a.isAbsoluteMatch && !a.info?.traktMapped;
                const bNative = !b.isAbsoluteMatch && !b.info?.traktMapped;
                
                if (aNative !== bNative) {
                    return aNative ? -1 : 1; // Native classic patterns first
                }
                return (a.isAbsoluteMatch ? 1 : 0) - (b.isAbsoluteMatch ? 1 : 0);
            });
            logger.debug(`[filterEpisode] 🔄 Sorted ${matches.length} matches by pattern priority (native classic first, then converted absolute)`);
        }
        
        const absoluteMatches = matches.filter(v => v.isAbsoluteMatch).length;
        const traktMappedMatches = matches.filter(v => v.info?.traktMapped).length;
        const nativeClassicMatches = matches.filter(v => !v.isAbsoluteMatch && !v.info?.traktMapped).length;
        
        if (nativeClassicMatches > 0 && (absoluteMatches > 0 || traktMappedMatches > 0)) {
            logger.debug(`[filterEpisode] ✅ Mixed matches: ${nativeClassicMatches} native classic + ${traktMappedMatches} Trakt converted + ${absoluteMatches} absolute = ${matches.length} total`);
        } else if (nativeClassicMatches > 0) {
            logger.debug(`[filterEpisode] ✅ Using ${nativeClassicMatches} native classic matches only`);
        } else if (traktMappedMatches > 0) {
            logger.debug(`[filterEpisode] ✅ Using ${traktMappedMatches} Trakt-converted matches only`);
        } else {
            logger.debug(`[filterEpisode] ✅ Using ${absoluteMatches} absolute matches only`);
        }
        
        torrentDetails.videos = matches;
        return true;
    } else {
        logger.debug(`[filterEpisode] ❌ No matches found for S${season}E${episode}`);
        torrentDetails.videos = [];
        return false;
    }
}

// ================================================================================================
// DISPLAY UTILITIES
// ================================================================================================

/**
 * Format an array of stream objects for display - for terminal output only.
 */
export function formatStreamsForDisplay(streams) {
    if (!Array.isArray(streams)) return '';
    return streams.map(stream => {
        const nameLines = (stream.name || '').split('\n');
        const titleLines = (stream.title || '').split('\n').map(line => '\t' + line);
        //const urlLine = 'URL: ' + (stream.url || ''); //Uncomment this line to include URL for debug purpose
        const hintsLine = 'behaviorHints: ' + JSON.stringify(stream.behaviorHints || {});
        
        // Display both lines of stream.name: provider tag and quality information
        const nameDisplay = nameLines.length > 1 ? 
            nameLines[0] + '\n' + nameLines[1] : // Provider tag + quality with indentation
            nameLines[0]; // Just provider tag if no quality line
            
        return [nameDisplay, ...titleLines, hintsLine].join('\n');
    }).join('\n\n');
}

export { getCacheStats, clearTechnicalDetailsCache };