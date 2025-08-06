import { extractReleaseGroup, isValidReleaseGroup } from '../utils/groups-util.js';
import PTT, { romanToNumber } from '../utils/parse-torrent-title.js';
import { extractQuality } from './quality-processor.js';
import { logger } from '../utils/logger.js';
import { FILE_EXTENSIONS } from '../utils/media-patterns.js';

/**
 * Metadata extractor module - extracts metadata (title, season, quality) from filenames
 * Provides consistent metadata extraction for stream formatting
 */

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
    const extensionMatch = filename && filename.match(/\.(\w{2,4})$/);
    return extensionMatch && extensions.includes(extensionMatch[1].toLowerCase());
}

export function parseVideoInfoEnhanced(filename) {
    const basicInfo = PTT.parse(filename);
    
    if (!basicInfo.season) {
        const romanPatterns = [
            /\b([IVX]+)\s*[-_]\s*(\d+)/i,
            
            /season\s+([IVX]+)\s+(?:episode\s+)?(\d+)/i,
            
            /\b([IVX]+)\s*[._]?e(?:p(?:isode)?)?\s*(\d+)/i,
            
            /season\s+([IVX]+)\s+e(\d+)/i,
            
            /\b([IVX]+)\s+(\d+)\b/i,
        ];
        
        for (const pattern of romanPatterns) {
            const match = filename.match(pattern);
            if (match) {
                const romanSeason = romanToNumber(match[1].toUpperCase());
                const episode = parseInt(match[2], 10);
                if (romanSeason && episode && romanSeason <= 20 && episode <= 999) {
                    basicInfo.season = romanSeason;
                    basicInfo.episode = episode;
                    break;
                }
            }
        }
    }
    
    // Note: Check for null/undefined explicitly since season 0 is valid (for OVAs/specials)
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

        metadata.quality = extractQualityInfo(videoName);// Extract quality information
        metadata.releaseGroup = extractReleaseGroup(videoName);// Extract release group
        metadata.language = extractLanguage(videoName);// Extract language information
        metadata.episodeTitle = extractEpisodeTitle(videoName);// Try to extract episode title if present

        if (containerName && containerName !== videoName) {
            const containerInfo = enhanceWithContainerInfo(metadata, containerName);
            metadata.title = containerInfo.title || metadata.title;
            metadata.releaseGroup = containerInfo.releaseGroup || metadata.releaseGroup;
        }

        logger.debug(`[metadata-extractor] Series extraction result:`, metadata);
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
        const movieInfo = parseVideoInfo(movieName);
        
        if (movieInfo) {
            metadata.title = movieInfo.title || extractTitleFromFilename(movieName);
            metadata.year = movieInfo.year;
        }

        metadata.quality = extractQualityInfo(movieName);// Extract quality information
        metadata.releaseGroup = extractReleaseGroup(movieName); // Extract release group
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

    let title = filename;
    if (title) {
        const videoExtPattern = new RegExp(`\\.(${FILE_EXTENSIONS.video.join('|')})$`, 'i');
        title = title.replace(videoExtPattern, '');
    }

    const cleanupPatterns = [
        /\b\d{4}\b.*$/, // Remove year and everything after
        /\b[Ss]\d{1,2}[Ee]\d{1,3}.*$/, // Remove season/episode and after
        /\b(720p|1080p|2160p|4K).*$/i, // Remove quality and after
        /\b(BluRay|WEBRip|DVDRip|HDTV).*$/i, // Remove source and after
        /\b(x264|x265|h264|h265).*$/i, // Remove codec and after
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
    const languagePatterns = [
        { pattern: /\b(MULTI|MULTi)\b/i, value: 'Multi' },
        { pattern: /\b(DUAL)\b/i, value: 'Dual' },
        { pattern: /\b(ENGLISH|ENG)\b/i, value: 'English' },
        { pattern: /\b(FRENCH|FRE|FR)\b/i, value: 'French' },
        { pattern: /\b(SPANISH|SPA|ES)\b/i, value: 'Spanish' },
        { pattern: /\b(GERMAN|GER|DE)\b/i, value: 'German' },
        { pattern: /\b(ITALIAN|ITA|IT)\b/i, value: 'Italian' },
        { pattern: /\b(JAPANESE|JAP|JP)\b/i, value: 'Japanese' },
        { pattern: /\b(KOREAN|KOR|KR)\b/i, value: 'Korean' },
        { pattern: /\b(CHINESE|CHI|CN)\b/i, value: 'Chinese' },
        { pattern: /\b(RUSSIAN|RUS|RU)\b/i, value: 'Russian' },
        { pattern: /\b(PORTUGUESE|POR|PT)\b/i, value: 'Portuguese' },
        { pattern: /\b(DUTCH|DUT|NL)\b/i, value: 'Dutch' },
        { pattern: /\b(SWEDISH|SWE|SE)\b/i, value: 'Swedish' },
        { pattern: /\b(NORWEGIAN|NOR|NO)\b/i, value: 'Norwegian' },
        { pattern: /\b(DANISH|DAN|DK)\b/i, value: 'Danish' },
        { pattern: /\b(POLISH|POL|PL)\b/i, value: 'Polish' },
        { pattern: /\b(HINDI|HIN)\b/i, value: 'Hindi' },
        { pattern: /\b(THAI|THA|TH)\b/i, value: 'Thai' },
    ];

    for (const { pattern, value } of languagePatterns) {
        if (pattern.test(filename)) {
            return value;
        }
    }

    return null;
}

function extractEpisodeTitle(filename) {
    const episodeTitlePatterns = [
        /[Ss]\d{1,2}[Ee]\d{1,3}\s*-\s*(.+?)(?:\.|$)/i, // S01E01 - Title
        /[Ss]\d{1,2}[Ee]\d{1,3}\s+(.+?)(?:\s*\d{4}p|\s*BluRay|\s*WEBRip|$)/i, // S01E01 Title
        /Episode\s*\d+\s*-\s*(.+?)(?:\.|$)/i, // Episode 1 - Title
    ];

    for (const pattern of episodeTitlePatterns) {
        const match = filename.match(pattern);
        if (match && match[1]) {
            let title = match[1]
                .replace(/[._-]/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            
            title = title.replace(/\b(720p|1080p|2160p|4K|BluRay|WEBRip|x264|x265).*$/i, '').trim();
            
            if (title.length > 2) {
                return title;
            }
        }
    }

    return null;
}

function enhanceWithContainerInfo(videoMetadata, containerName) {
    const enhancement = {
        title: videoMetadata.title,
        releaseGroup: videoMetadata.releaseGroup
    };

    try {
        const containerInfo = parseVideoInfo(containerName);
        
        if (containerInfo?.title && 
            (videoMetadata.title === 'Unknown' || videoMetadata.title.length < 3)) {
            enhancement.title = containerInfo.title;
        }

        const containerReleaseGroup = extractReleaseGroup(containerName);
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
    const seriesIndicators = [
        /[Ss]\d{1,2}[Ee]\d{1,3}/, // S01E01 format
        /\d{1,2}x\d{1,3}/, // 1x01 format
        /Episode\s*\d+/i, // Episode 1
        /[Ee]p\d+/i, // Ep1, EP01
        /Season\s*\d+/i, // Season 1
    ];

    const movieIndicators = [
        /\b\d{4}\b/, // Year (common in movie names)
        /\b(Part|Pt)\s*[I1-9]/i, // Part I, Part 1
    ];

    for (const pattern of seriesIndicators) {
        if (pattern.test(filename)) {
            return 'series';
        }
    }

    for (const pattern of movieIndicators) {
        if (pattern.test(filename)) {
            return 'movie';
        }
    }

    return 'series';
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