import { isVideo } from '../stream/metadata-extractor.js';
import PTT, { romanToNumber } from './parse-torrent-title.js';

/**
 * Enhanced parsing that handles roman numerals and missing seasons
 */
function parseVideoInfo(filename) {
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
        console.error(`[${source}] No valid torrent/magnet item`);
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
        console.error(`[${source}] No files found in any data source`);
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

    console.log(`[${source}] Processed ${videos.length} video files for torrent: ${item.filename || item.name}`);

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
