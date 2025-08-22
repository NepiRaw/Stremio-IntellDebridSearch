/**
 * Metadata extractor module - extracts metadata (title, season, quality) from filenames
 * Provides consistent metadata extraction for stream formatting
 */

import { extractReleaseGroup, isValidReleaseGroup } from '../utils/groups-util.js';
import { parseUnified } from '../utils/unified-torrent-parser.js';
import { logger } from '../utils/logger.js';
import { FILE_EXTENSIONS, detectContentType as detectContentTypeUtil, extractLanguageFromFilename } from '../utils/media-patterns.js';
import { extractEpisodeTitleFromFilename } from '../utils/episode-patterns.js';
import { configManager } from '../config/configuration.js';

export const FILE_TYPES = Object.freeze({
    TORRENTS: Symbol("torrents"),
    DOWNLOADS: Symbol("downloads")
});

const VIDEO_EXTENSIONS = FILE_EXTENSIONS.video;
const SUBTITLE_EXTENSIONS = FILE_EXTENSIONS.subtitle;
const DISK_EXTENSIONS = FILE_EXTENSIONS.disk;
const ARCHIVE_EXTENSIONS = FILE_EXTENSIONS.archive;

export function isVideo(filename) {
    return isExtension(filename, VIDEO_EXTENSIONS);
}

export function isSubtitle(filename) {
    return isExtension(filename, SUBTITLE_EXTENSIONS);
}

export function isDisk(filename) {
    return isExtension(filename, DISK_EXTENSIONS);
}

export function isArchive(filename) {
    return isExtension(filename, ARCHIVE_EXTENSIONS);
}

export function isExtension(filename, extensions) {
    if (!filename || typeof filename !== 'string') return false;
    const extensionMatch = filename.match(/\.(\w{2,4})$/);
    return extensionMatch && extensions.includes(extensionMatch[1].toLowerCase());
}

export function parseVideoInfoEnhanced(filename) {
    const unifiedResult = parseUnified(filename);
    
    if (unifiedResult.episode) {
        return {
            title: unifiedResult.title,
            season: unifiedResult.season !== null ? unifiedResult.season : 1, // Default season 1 only if null, preserve 0 for specials
            episode: unifiedResult.episode,
            year: unifiedResult.year,
            quality: unifiedResult.quality,
            source: unifiedResult.source,
            codec: unifiedResult.codec,
            audio: unifiedResult.audio,
            group: unifiedResult.group
        };
    }
    
    const basicInfo = parseUnified(filename);
    
    if ((basicInfo.season === null || basicInfo.season === undefined) && basicInfo.episode) {
        basicInfo.season = 1;
    }
    
    if (!basicInfo.season && !basicInfo.episode) {
        const episodeMatch = filename.match(/(?:^|[^\d])(\d{1,3})(?:[^\d]|$)/);
        if (episodeMatch) {
            const episode = parseInt(episodeMatch[1], 10);
            if (episode > 0 && episode <= 999) {
                basicInfo.season = 1;
                basicInfo.episode = episode;
            }
        }
    }
    
    return basicInfo;
}

export function extractSeriesInfo(videoName, containerName = '') {
    if (!videoName || typeof videoName !== 'string') {
        logger.warn('[metadata-extractor] Invalid video name provided');
        return {
            title: 'Unknown',
            season: null,
            episode: null,
            episodeTitle: null,
            seasonEpisode: 'Unknown Episode',
            quality: {},
            releaseGroup: null,
            language: null,
            year: null
        };
    }

    logger.debug(`[metadata-extractor] Extracting series info from: "${videoName}"`);

    const metadata = {
        title: 'Unknown',
        season: null,
        episode: null,
        episodeTitle: null,
        seasonEpisode: 'Unknown Episode',
        quality: {},
        releaseGroup: null,
        language: null,
        year: null,
        source: 'video'
    };

    try {
        const videoInfo = parseVideoInfoEnhanced(videoName);
        
        if (videoInfo) {
            metadata.title = videoInfo.title || extractTitleFromFilename(videoName);
            metadata.season = videoInfo.season;
            metadata.episode = videoInfo.episode;
            metadata.year = videoInfo.year;
        }

        const videoParseResult = parseUnified(videoName);
        const containerParseResult = containerName ? parseUnified(containerName) : { quality: null };
        
        metadata.quality = {
            resolution: videoParseResult.resolution || containerParseResult.resolution,
            source: videoParseResult.source || containerParseResult.source,
            codec: videoParseResult.codec || containerParseResult.codec,
            audio: videoParseResult.audio || containerParseResult.audio
        };
        metadata.releaseGroup = configManager.getIsReleaseGroupEnabled() ? extractReleaseGroup(videoName) : null;
        metadata.language = extractLanguage(videoName);
        metadata.episodeTitle = extractEpisodeTitle(videoName);

        if (metadata.season !== null && metadata.season !== undefined && 
            metadata.episode !== null && metadata.episode !== undefined) {
            const season = String(metadata.season).padStart(2, '0');
            const episode = String(metadata.episode).padStart(2, '0');
            metadata.seasonEpisode = `S${season}E${episode}`;
        } else {
            metadata.seasonEpisode = 'Unknown Episode';
        }

        if (containerName && containerName !== videoName) {
            const containerInfo = enhanceWithContainerInfo(metadata, containerName);
            metadata.title = containerInfo.title || metadata.title;
            if (configManager.getIsReleaseGroupEnabled()) {
                metadata.releaseGroup = containerInfo.releaseGroup || metadata.releaseGroup;
            }
        }

        logger.debug(`[metadata-extractor] Series extraction result:`, JSON.stringify(metadata, null, 2));
        return metadata;

    } catch (err) {
        logger.error(`[metadata-extractor] Error extracting series info: ${err.message}`);
        return metadata;
    }
}

export function extractMovieInfo(movieName) {
    if (!movieName || typeof movieName !== 'string') {
        logger.warn('[metadata-extractor] Invalid movie name provided');
        return {
            title: 'Unknown',
            year: null,
            quality: {},
            releaseGroup: null,
            language: null,
            source: 'video'
        };
    }

    logger.debug(`[metadata-extractor] Extracting movie info from: "${movieName}"`);

    const metadata = {
        title: 'Unknown',
        year: null,
        quality: {},
        releaseGroup: null,
        language: null,
        source: 'video'
    };

    try {
        const movieInfo = parseVideoInfoEnhanced(movieName);
        
        if (movieInfo) {
            metadata.title = movieInfo.title || extractTitleFromFilename(movieName);
            metadata.year = movieInfo.year;
        }

        const parseResult = parseUnified(movieName);
        metadata.quality = {
            resolution: parseResult.resolution,
            source: parseResult.source,
            codec: parseResult.codec,
            audio: parseResult.audio
        };
        metadata.releaseGroup = configManager.getIsReleaseGroupEnabled() ? extractReleaseGroup(movieName) : null;
        metadata.language = extractLanguage(movieName);// Extract language information

        logger.debug(`[metadata-extractor] Movie extraction result:`, metadata);
        return metadata;

    } catch (err) {
        logger.error(`[metadata-extractor] Error extracting movie info: ${err.message}`);
        return metadata;
    }
}

function extractTitleFromFilename(filename) {
    if (!filename) return 'Unknown';

    const unifiedResult = parseUnified(filename);
    if (unifiedResult.title && unifiedResult.title !== filename) {
        return unifiedResult.title;
    }

    let title = filename;
    if (title) {
        const videoExtPattern = new RegExp(`\\.(${FILE_EXTENSIONS.video.join('|')})$`, 'i');
        title = title.replace(videoExtPattern, '');
    }

    const cleanupPatterns = [
        /\b\d{4}\b.*$/, // Remove year and everything after
        /\b[Ss]\d{1,2}[Ee]\d{1,3}.*$/, // Remove season/episode and after
        /\b(720p|1080p|2160p|4K).*$/i, // Remove quality and after
        /\[.*?\]/g, // Remove bracketed content
        /\(.*?\)/g, // Remove parenthetical content (be careful with years)
    ];

    for (const pattern of cleanupPatterns) {
        title = title.replace(pattern, '');
    }

    title = title
        .replace(/[._-]/g, ' ') // Replace dots, underscores, dashes with spaces
        .replace(/\s+/g, ' ') // Collapse multiple spaces
        .trim();

    return title || 'Unknown';
}

function extractLanguage(filename) {
    const unifiedResult = parseUnified(filename);
    if (unifiedResult.languages && unifiedResult.languages.length > 0) {
        return unifiedResult.languages[0];
    }
    
    return extractLanguageFromFilename(filename);
}

function extractEpisodeTitle(filename) {
    return extractEpisodeTitleFromFilename(filename);
}

function enhanceWithContainerInfo(videoMetadata, containerName) {
    const enhancement = {
        title: videoMetadata.title,
        releaseGroup: videoMetadata.releaseGroup
    };

    try {
        const containerInfo = parseVideoInfoEnhanced(containerName);
        
        if (containerInfo?.title && 
            (videoMetadata.title === 'Unknown' || videoMetadata.title.length < 3)) {
            enhancement.title = containerInfo.title;
        }

        const containerReleaseGroup = configManager.getIsReleaseGroupEnabled() ? extractReleaseGroup(containerName) : null;
        if (containerReleaseGroup && !videoMetadata.releaseGroup) {
            enhancement.releaseGroup = containerReleaseGroup;
        }

        return enhancement;

    } catch (err) {
        logger.warn(`[metadata-extractor] Error enhancing with container info: ${err.message}`);
        return enhancement;
    }
}

export function extractVideoMetadata(filename, type = 'auto', containerName = '') {
    if (!filename) {
        logger.warn('[metadata-extractor] No filename provided for metadata extraction');
        return { error: 'No filename provided' };
    }

    logger.debug(`[metadata-extractor] Extracting ${type} metadata from: "${filename}"`);

    if (type === 'auto') {
        type = detectContentType(filename);
        logger.debug(`[metadata-extractor] Auto-detected content type: ${type}`);
    }

    switch (type.toLowerCase()) {
        case 'series':
        case 'tv':
        case 'anime':
            return extractSeriesInfo(filename, containerName);
        
        case 'movie':
        case 'film':
            return extractMovieInfo(filename);
        
        default:
            logger.warn(`[metadata-extractor] Unknown content type: ${type}, defaulting to series`);
            return extractSeriesInfo(filename, containerName);
    }
}

function detectContentType(filename) {
    return detectContentTypeUtil(filename);
}

export function extractFileExtension(filename) {
    if (!filename || typeof filename !== 'string') return '';
    
    const match = filename.match(/\.([^.]+)$/);
    return match ? match[1].toLowerCase() : '';
}

export function isVideoFile(filename) {
    const extension = extractFileExtension(filename);
    return FILE_EXTENSIONS.video.includes(extension);
}