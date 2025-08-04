import { extractReleaseGroup, isValidReleaseGroup } from '../utils/groups-util.js';
import PTT, { romanToNumber } from '../utils/parse-torrent-title.js';
import { extractQuality } from './quality-processor.js';
import { logger } from '../utils/logger.js';
import { FILE_EXTENSIONS } from '../utils/media-patterns.js';

/**
 * Metadata extractor module - extracts metadata (title, season, quality) from filenames
 * Provides consistent metadata extraction for stream formatting
 */

// File Type Constants
export const FILE_TYPES = Object.freeze({
    TORRENTS: Symbol("torrents"),
    DOWNLOADS: Symbol("downloads")
});

// File Extension Utilities
const VIDEO_EXTENSIONS = FILE_EXTENSIONS.video;
const SUBTITLE_EXTENSIONS = FILE_EXTENSIONS.subtitle;
const DISK_EXTENSIONS = FILE_EXTENSIONS.disk;
const ARCHIVE_EXTENSIONS = FILE_EXTENSIONS.archive;

/**
 * Check if filename has video extension
 * @param {string} filename - Filename to check
 * @returns {boolean} - True if video file
 */
export function isVideo(filename) {
    return isExtension(filename, VIDEO_EXTENSIONS);
}

/**
 * Check if filename has subtitle extension
 * @param {string} filename - Filename to check
 * @returns {boolean} - True if subtitle file
 */
export function isSubtitle(filename) {
    return isExtension(filename, SUBTITLE_EXTENSIONS);
}

/**
 * Check if filename has disk extension
 * @param {string} filename - Filename to check
 * @returns {boolean} - True if disk file
 */
export function isDisk(filename) {
    return isExtension(filename, DISK_EXTENSIONS);
}

/**
 * Check if filename has archive extension
 * @param {string} filename - Filename to check
 * @returns {boolean} - True if archive file
 */
export function isArchive(filename) {
    return isExtension(filename, ARCHIVE_EXTENSIONS);
}

/**
 * Check if filename has specific extension type
 * @param {string} filename - Filename to check
 * @param {Array} extensions - Array of extensions to check against
 * @returns {boolean} - True if file has matching extension
 */
export function isExtension(filename, extensions) {
    const extensionMatch = filename && filename.match(/\.(\w{2,4})$/);
    return extensionMatch && extensions.includes(extensionMatch[1].toLowerCase());
}

/**
 * Enhanced parsing that handles roman numerals and missing seasons
 * @param {string} filename - Filename to parse
 * @returns {object} - Parsed video information
 */
export function parseVideoInfoEnhanced(filename) {
    const basicInfo = PTT.parse(filename);
    
    // Handle roman numeral seasons with multiple patterns
    if (!basicInfo.season) {
        // Multiple roman numeral patterns for different torrent naming conventions
        const romanPatterns = [
            // Pattern 1: "Series Title III - Episode" (DanMachi III - 06.mkv)
            /\b([IVX]+)\s*[-_]\s*(\d+)/i,
            
            // Pattern 2: "Series Title Season III Episode N"
            /season\s+([IVX]+)\s+(?:episode\s+)?(\d+)/i,
            
            // Pattern 3: "Series Title III E/EP N" (Show Title III.E04.mkv)
            /\b([IVX]+)\s*[._]?e(?:p(?:isode)?)?\s*(\d+)/i,
            
            // Pattern 4: "Series Title S3 Season III EN"
            /season\s+([IVX]+)\s+e(\d+)/i,
            
            // Pattern 5: Just roman numeral followed by episode number (Series Name II 03.mkv)
            /\b([IVX]+)\s+(\d+)\b/i,
        ];
        
        for (const pattern of romanPatterns) {
            const match = filename.match(pattern);
            if (match) {
                const romanSeason = romanToNumber(match[1].toUpperCase());
                const episode = parseInt(match[2], 10);
                // Validate reasonable season/episode numbers to avoid false positives
                if (romanSeason && episode && romanSeason <= 20 && episode <= 999) {
                    basicInfo.season = romanSeason;
                    basicInfo.episode = episode;
                    break; // Stop at first valid match
                }
            }
        }
    }
    
    // Handle missing seasons - default to season 1 if episode is found but season is not
    // Note: Check for null/undefined explicitly since season 0 is valid (for OVAs/specials)
    if ((basicInfo.season === null || basicInfo.season === undefined) && basicInfo.episode) {
        basicInfo.season = 1;
    }
    
    // Additional fallback: look for standalone episode numbers
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

/**
 * Extract comprehensive metadata from series video filename
 * @param {string} videoName - Video filename
 * @param {string} containerName - Container/torrent name (optional)
 * @returns {object} - Extracted series metadata
 */
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
        // Parse video information using the enhanced torrent parser
        const videoInfo = parseVideoInfoEnhanced(videoName);
        
        if (videoInfo) {
            metadata.title = videoInfo.title || extractTitleFromFilename(videoName);
            metadata.season = videoInfo.season;
            metadata.episode = videoInfo.episode;
            metadata.year = videoInfo.year;
        }

        // Extract quality information
        metadata.quality = extractQualityInfo(videoName);

        // Extract release group
        metadata.releaseGroup = extractReleaseGroup(videoName);

        // Extract language information
        metadata.language = extractLanguage(videoName);

        // Try to extract episode title if present
        metadata.episodeTitle = extractEpisodeTitle(videoName);

        // If we have container name, try to enhance metadata
        if (containerName && containerName !== videoName) {
            const containerInfo = enhanceWithContainerInfo(metadata, containerName);
            metadata.title = containerInfo.title || metadata.title;
            metadata.releaseGroup = containerInfo.releaseGroup || metadata.releaseGroup;
        }

        logger.debug(`[metadata-extractor] Series extraction result:`, metadata);
        return metadata;

    } catch (err) {
        logger.error(`[metadata-extractor] Error extracting series info: ${err.message}`);
        return metadata; // Return partial metadata
    }
}

/**
 * Extract comprehensive metadata from movie video filename
 * @param {string} movieName - Movie filename
 * @returns {object} - Extracted movie metadata
 */
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
        // Parse movie information using the torrent parser
        const movieInfo = parseVideoInfo(movieName);
        
        if (movieInfo) {
            metadata.title = movieInfo.title || extractTitleFromFilename(movieName);
            metadata.year = movieInfo.year;
        }

        // Extract quality information
        metadata.quality = extractQualityInfo(movieName);

        // Extract release group
        metadata.releaseGroup = extractReleaseGroup(movieName);

        // Extract language information
        metadata.language = extractLanguage(movieName);

        logger.debug(`[metadata-extractor] Movie extraction result:`, metadata);
        return metadata;

    } catch (err) {
        logger.error(`[metadata-extractor] Error extracting movie info: ${err.message}`);
        return metadata; // Return partial metadata
    }
}

/**
 * Extract title from filename when parser fails
 * @param {string} filename - Filename to extract title from
 * @returns {string} - Extracted title
 */
function extractTitleFromFilename(filename) {
    if (!filename) return 'Unknown';

    // Remove file extension
    let title = filename.replace(/\.(mkv|mp4|avi|m4v|mov|wmv|flv|webm)$/i, '');

    // Remove common patterns that aren't part of the title
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

    // Clean up spacing and formatting
    title = title
        .replace(/[._-]/g, ' ') // Replace dots, underscores, dashes with spaces
        .replace(/\s+/g, ' ') // Collapse multiple spaces
        .trim();

    return title || 'Unknown';
}

/**
 * Extract language information from filename
 * @param {string} filename - Filename
 * @returns {string|null} - Detected language or null
 */
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

/**
 * Extract episode title from filename (if present)
 * @param {string} filename - Video filename
 * @returns {string|null} - Episode title or null
 */
function extractEpisodeTitle(filename) {
    // Pattern to match episode titles after season/episode info
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
            
            // Clean up common suffixes
            title = title.replace(/\b(720p|1080p|2160p|4K|BluRay|WEBRip|x264|x265).*$/i, '').trim();
            
            if (title.length > 2) {
                return title;
            }
        }
    }

    return null;
}

/**
 * Enhance metadata using container/torrent name
 * @param {object} videoMetadata - Existing video metadata
 * @param {string} containerName - Container/torrent name
 * @returns {object} - Enhanced metadata
 */
function enhanceWithContainerInfo(videoMetadata, containerName) {
    const enhancement = {
        title: videoMetadata.title,
        releaseGroup: videoMetadata.releaseGroup
    };

    try {
        // Parse container info
        const containerInfo = parseVideoInfo(containerName);
        
        // Use container title if video title is generic or unclear
        if (containerInfo?.title && 
            (videoMetadata.title === 'Unknown' || videoMetadata.title.length < 3)) {
            enhancement.title = containerInfo.title;
        }

        // Use container release group if not found in video name
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

/**
 * Extract metadata from any video file
 * @param {string} filename - Video filename
 * @param {string} type - Content type ('movie', 'series', 'auto')
 * @param {string} containerName - Container name (optional)
 * @returns {object} - Extracted metadata
 */
export function extractVideoMetadata(filename, type = 'auto', containerName = '') {
    if (!filename) {
        logger.warn('[metadata-extractor] No filename provided for metadata extraction');
        return { error: 'No filename provided' };
    }

    logger.debug(`[metadata-extractor] Extracting ${type} metadata from: "${filename}"`);

    // Auto-detect type if not specified
    if (type === 'auto') {
        type = detectContentType(filename);
        logger.debug(`[metadata-extractor] Auto-detected content type: ${type}`);
    }

    // Extract based on detected/specified type
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

/**
 * Detect content type from filename
 * @param {string} filename - Filename to analyze
 * @returns {string} - Detected type ('movie' or 'series')
 */
function detectContentType(filename) {
    // Series indicators
    const seriesIndicators = [
        /[Ss]\d{1,2}[Ee]\d{1,3}/, // S01E01 format
        /\d{1,2}x\d{1,3}/, // 1x01 format
        /Episode\s*\d+/i, // Episode 1
        /[Ee]p\d+/i, // Ep1, EP01
        /Season\s*\d+/i, // Season 1
    ];

    // Movie indicators
    const movieIndicators = [
        /\b\d{4}\b/, // Year (common in movie names)
        /\b(Part|Pt)\s*[I1-9]/i, // Part I, Part 1
    ];

    // Check for series indicators first (more specific)
    for (const pattern of seriesIndicators) {
        if (pattern.test(filename)) {
            return 'series';
        }
    }

    // Check for movie indicators
    for (const pattern of movieIndicators) {
        if (pattern.test(filename)) {
            return 'movie';
        }
    }

    // Default to series if uncertain
    return 'series';
}

/**
 * Extract file extension from filename
 * @param {string} filename - Filename
 * @returns {string} - File extension (without dot)
 */
export function extractFileExtension(filename) {
    if (!filename || typeof filename !== 'string') return '';
    
    const match = filename.match(/\.([^.]+)$/);
    return match ? match[1].toLowerCase() : '';
}

/**
 * Check if filename represents a video file
 * @param {string} filename - Filename to check
 * @returns {boolean} - Whether file is a video
 */
export function isVideoFile(filename) {
    const videoExtensions = [
        'mp4', 'mkv', 'avi', 'm4v', 'mov', 'wmv', 'flv', 'webm', 
        'mpg', 'mpeg', 'ts', 'vob', 'rm', 'rmvb', '3gp', 'f4v'
    ];
    
    const extension = extractFileExtension(filename);
    return videoExtensions.includes(extension);
}

/**
 * Extract clean filename without path and extension
 * @param {string} filePath - Full file path
 * @returns {string} - Clean filename
 */
export function extractCleanFilename(filePath) {
    if (!filePath) return '';
    
    // Remove path
    const filename = filePath.split(/[/\\]/).pop() || '';
    
    // Remove extension
    return filename.replace(/\.[^.]+$/, '');
}

/**
 * Validate extracted metadata
 * @param {object} metadata - Metadata object to validate
 * @returns {object} - Validation result
 */
export function validateMetadata(metadata) {
    const validation = {
        isValid: true,
        errors: [],
        warnings: []
    };

    if (!metadata) {
        validation.isValid = false;
        validation.errors.push('Metadata object is null or undefined');
        return validation;
    }

    // Check required fields
    if (!metadata.title || metadata.title === 'Unknown') {
        validation.warnings.push('Title is missing or unknown');
    }

    // Validate series-specific fields
    if (metadata.season !== null && metadata.season !== undefined) {
        if (typeof metadata.season !== 'number' || metadata.season < 1) {
            validation.errors.push('Invalid season number');
            validation.isValid = false;
        }
    }

    if (metadata.episode !== null && metadata.episode !== undefined) {
        if (typeof metadata.episode !== 'number' || metadata.episode < 1) {
            validation.errors.push('Invalid episode number');
            validation.isValid = false;
        }
    }

    // Validate year
    if (metadata.year !== null && metadata.year !== undefined) {
        const currentYear = new Date().getFullYear();
        if (typeof metadata.year !== 'number' || metadata.year < 1900 || metadata.year > currentYear + 2) {
            validation.warnings.push('Year seems invalid or out of range');
        }
    }

    return validation;
}
