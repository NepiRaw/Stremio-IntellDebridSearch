import { isVideo } from '../stream/metadata-extractor.js';
import PTT from './parse-torrent-title.js';
import { romanToNumber, parseRomanSeasons } from './roman-numeral-utils.js';
import { parseSeasonFromTitle, parseEpisodeFromTitle } from './episode-patterns.js';
import { logger } from './logger.js';

function parseVideoInfo(filename) {
    const basicInfo = PTT.parse(filename);
    if (!basicInfo.season) {
        const romanSeason = parseRomanSeasons(filename);
        if (romanSeason) {
            basicInfo.season = romanSeason.season;
            
            const episodeInfo = parseEpisodeFromTitle(filename);
            if (episodeInfo && episodeInfo.episode) {
                basicInfo.episode = episodeInfo.episode;
            }
        }
    }
    if ((basicInfo.season === null || basicInfo.season === undefined) && basicInfo.episode) {
        basicInfo.season = 1;
    }
    
    if (!basicInfo.season && !basicInfo.episode) {
        const episodeMatch = filename.match(/\s-\s(\d{1,3})(?:\.|$)/);
        if (episodeMatch) {
            const episode = parseInt(episodeMatch[1], 10);
            if (episode && episode <= 999) {
                basicInfo.season = 1;
                basicInfo.episode = episode;
            }
        }
    }
    
    return basicInfo;
}

export function processTorrentDetails({ apiKey, rawResponse, item, source, urlBuilder }) {
    if (Array.isArray(item)) {
        item = item[0];
    }

    if (!item) {
        logger.error(`[${source}] No valid torrent/magnet item`);
        return { videos: [] };
    }

    const allFiles = [];
    
    const possibleFileLists = [
        item.links,
        item.files,
        rawResponse?.links,
        rawResponse?.files,
        item.magnets?.links,
        item.magnets?.files
    ];
    for (const fileList of possibleFileLists) {
        if (Array.isArray(fileList)) {
            allFiles.push(...fileList);
        }
    }

    if (!allFiles.length) {
        logger.error(`[${source}] No files found in any data source`);
        return { videos: [] };
    }

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
                info: parseVideoInfo(filename)
            }
        });

    logger.debug(`[${source}] Processed ${videos.length} video files for torrent: ${item.filename || item.name}`);

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
        _rawData: rawResponse,
        _originalItem: item,
        _allFiles: allFiles,
        statusCode: item.statusCode || rawResponse?.statusCode,
        status: item.status || rawResponse?.status
    };
}

export default { processTorrentDetails };
