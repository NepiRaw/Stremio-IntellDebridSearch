import { isVideo } from '../stream/metadata-extractor.js';
import { parseUnified } from './unified-torrent-parser.js';
import { parseRomanSeasons } from './roman-numeral-utils.js';
import { parseEpisodeFromTitle } from './episode-patterns.js';
import { logger } from './logger.js';

function parseVideoInfo(filename) {
    const basicInfo = parseUnified(filename);
    if (!basicInfo.season) {
        // Check if unified parser found Roman info
        if (basicInfo.romanSeason) {
            logger.debug(`[debrid-processor] Using Roman data from unified parser: S${basicInfo.romanSeason.season}E${basicInfo.romanSeason.episode} - ${filename}`);
            basicInfo.season = basicInfo.romanSeason.season;
            
            const episodeInfo = parseEpisodeFromTitle(filename);
            if (episodeInfo && episodeInfo.episode) {
                basicInfo.episode = episodeInfo.episode;
            } else if (basicInfo.romanSeason.episode) {
                basicInfo.episode = basicInfo.romanSeason.episode;
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
        info: parseUnified(item.filename || item.name),
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

/**
 * Debrid Provider Controlled Concurrency Utilities
 * Manages parallel execution with configurable concurrency limits
 * Works with any debrid provider to prevent API overwhelm
 * Allow to prevent overwhelming debrid provider APIs
 * by limiting the number of simultaneous requests.
 * 
 * PARAMETER EXPLANATIONS:
 * 
 * concurrency = 6 (OPTIMIZED)
 * - **BALANCED CHOICE**: concurrency=6 offers excellent speed with conservative safety margin
 * - **UNIVERSAL COMPATIBILITY**: Expected to work well with all debrid providers but could be adjusted if needed.
 * 
 * batchSize = 5 (OPTIMAL FOR LARGE DATASETS) 
 * - Number of tasks processed in each sequential batch
 * - Only used with executeInBatches() for very large datasets (100+ items)
 * - Smaller batches = more controlled memory usage, less API burst
 * - Value 5 provides good balance between throughput and resource control
 * 
 * concurrencyPerBatch = 6 (MATCHES OPTIMIZED CONCURRENCY)
 * - Concurrency limit within each batch (should match main concurrency)
 * - Ensures consistent behavior across batch and non-batch processing
 * - Prevents batch processing from accidentally becoming slower than direct processing
 */

/**
 * Execute an array of async functions with controlled concurrency
 * @param {Array<Function>} tasks - Array of async functions to execute
 * @param {number} concurrency - Maximum number of tasks to run in parallel (empirically optimized: 6)
 * @returns {Promise<Array>} Array of results in same order as input tasks
 */
export async function executeWithControlledConcurrency(tasks, concurrency = 6) {
    if (tasks.length === 0) return [];
    
    const results = new Array(tasks.length);
    const executing = [];
    let index = 0;

    async function executeTask(taskIndex) {
        try {
            const result = await tasks[taskIndex]();
            results[taskIndex] = { status: 'fulfilled', value: result };
        } catch (error) {
            results[taskIndex] = { status: 'rejected', reason: error };
        }
    }

    while (index < tasks.length) {
        while (executing.length < concurrency && index < tasks.length) {
            const taskPromise = executeTask(index);
            executing.push(taskPromise);
            index++;
        }

        if (executing.length > 0) {
            await Promise.race(executing);
            
            for (let i = executing.length - 1; i >= 0; i--) {
                const taskPromise = executing[i];
                if (await Promise.race([taskPromise, Promise.resolve('pending')]) !== 'pending') {
                    executing.splice(i, 1);
                }
            }
        }
    }

    await Promise.all(executing);
    
    return results;
}

/**
 * Create batches of tasks for batch processing
 * @param {Array} items - Items to process
 * @param {number} batchSize - Size of each batch (recommended: 5)
 * @returns {Array<Array>} Array of batches
 */
export function createBatches(items, batchSize) {
    const batches = [];
    for (let i = 0; i < items.length; i += batchSize) {
        batches.push(items.slice(i, i + batchSize));
    }
    return batches;
}

/**
 * Execute tasks in sequential batches with controlled concurrency within each batch
 * Use this for very large datasets (100+ items) to prevent memory issues
 * @param {Array<Function>} tasks - Array of async functions to execute
 * @param {number} batchSize - Number of tasks per batch (recommended: 5)
 * @param {number} concurrencyPerBatch - Concurrency limit within each batch (optimized: 6)
 * @returns {Promise<Array>} Array of results
 */
export async function executeInBatches(tasks, batchSize = 5, concurrencyPerBatch = 6) {
    const batches = createBatches(tasks, batchSize);
    const allResults = [];
    
    for (const batch of batches) {
        const batchResults = await executeWithControlledConcurrency(batch, concurrencyPerBatch);
        allResults.push(...batchResults);
    }
    
    return allResults;
}

export default { processTorrentDetails };
