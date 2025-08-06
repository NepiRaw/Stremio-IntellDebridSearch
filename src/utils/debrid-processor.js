import { isVideo } from '../stream/metadata-extractor.js';
import PTT from './parse-torrent-title.js';
import { romanToNumber, parseRomanSeasons } from './roman-numeral-utils.js';
import { parseSeasonFromTitle, parseEpisodeFromTitle } from './episode-patterns.js';
import { logger } from './logger.js';

/**
 * Enhanced parsing that handles roman numerals and missing seasons
 */
function parseVideoInfo(filename) {
    const basicInfo = PTT.parse(filename);
    // Handle roman numeral seasons using centralized utility
    if (!basicInfo.season) {
        const romanSeason = parseRomanSeasons(filename);
        if (romanSeason) {
            basicInfo.season = romanSeason.season;
            
            // Try to extract episode number from the context
            const episodeInfo = parseEpisodeFromTitle(filename);
            if (episodeInfo && episodeInfo.episode) {
                basicInfo.episode = episodeInfo.episode;
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
        // Pattern for "SeriesName - 07.mkv" format
        const episodeMatch = filename.match(/\s-\s(\d{1,3})(?:\.|$)/);
        if (episodeMatch) {
            const episode = parseInt(episodeMatch[1], 10);            if (episode && episode <= 999) { // Reasonable episode number
                basicInfo.season = 1;
                basicInfo.episode = episode;
            }
        }
    }
    
    return basicInfo;
}

/**
 * Process and enrich torrent details from any debrid provider
 * @param {Object} params - Processing parameters
 * @param {string} params.apiKey - The debrid provider API key
 * @param {Object} params.rawResponse - The complete API response
 * @param {Object} params.item - The main torrent/magnet item
 * @param {string} params.source - The debrid provider name (alldebrid, realdebrid, etc)
 * @param {Function} params.urlBuilder - Function to build stream URLs for the specific provider
 * @returns {Object} Processed torrent details with complete data
 */
export function processTorrentDetails({ apiKey, rawResponse, item, source, urlBuilder }) {
    // Handle if item is an array
    if (Array.isArray(item)) {
        item = item[0];
    }

    if (!item) {
        logger.error(`[${source}] No valid torrent/magnet item`);
        return { videos: [] };
    }

    // Store all available files from various possible sources
    const allFiles = [];
    
    // Common file locations in debrid provider responses
    const possibleFileLists = [
        item.links,
        item.files,
        rawResponse?.links,
        rawResponse?.files,
        item.magnets?.links,
        item.magnets?.files
    ];    // Collect files from all possible sources
    for (const fileList of possibleFileLists) {
        if (Array.isArray(fileList)) {
            allFiles.push(...fileList);
        }
    }

    if (!allFiles.length) {
        logger.error(`[${source}] No files found in any data source`);
        return { videos: [] };
    }

    // Process video files
    const videos = allFiles
        .filter(file => {
            const filename = file.filename || file.name;
            const isVideoFile = isVideo(filename);
            return isVideoFile;
        })
        .map((file, index) => {
            const filename = file.filename || file.name;
            const url = urlBuilder(apiKey, item.id, file);

            return {
                id: `${item.id}:${index}`,
                name: filename,
                url: url,
                size: file.size,
                created: new Date(item.completionDate || item.created || Date.now()),
                info: parseVideoInfo(filename) // Use enhanced parsing
            }
        });

    logger.debug(`[${source}] Processed ${videos.length} video files for torrent: ${item.filename || item.name}`);

    // Return enriched object with complete data
    return {
        source: source,
        id: item.id,
        name: item.filename || item.name,
        type: 'other',
        hash: item.hash,
        info: PTT.parse(item.filename || item.name),
        size: item.size,
        created: new Date(item.completionDate || item.created || Date.now()),
        videos: videos,
        // Store complete data for advanced search
        _rawData: rawResponse,
        _originalItem: item,
        _allFiles: allFiles,
        statusCode: item.statusCode || rawResponse?.statusCode,
        status: item.status || rawResponse?.status
    };
}

export default { processTorrentDetails };
