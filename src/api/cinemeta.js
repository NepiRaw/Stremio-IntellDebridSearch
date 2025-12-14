import fetch from 'node-fetch';
import { logger } from '../utils/logger.js';
import cache from '../utils/cache-manager.js';

/**
 * Cinemeta API client - fetches metadata from Stremio's Cinemeta service
 * Handles movie and series metadata with caching support
 */

/**
 * Get metadata from Cinemeta service
 * @param {string} type - Content type ('movie' or 'series')
 * @param {string} imdbId - IMDb ID
 * @returns {Promise<object>} - Metadata object
 */
async function getMeta(type, imdbId) {
    if (!type || !imdbId) {
        logger.error('[cinemeta] Missing required parameters: type or imdbId');
        throw new Error('Missing required parameters: type or imdbId');
    }

    // Check cache first
    const cacheKey = `cinemeta:${type}:${imdbId}`;
    const cached = cache.get(cacheKey);
    if (cached) {
        logger.debug(`[cinemeta] Cache hit for ${type}/${imdbId}`);
        return cached;
    }

    logger.debug(`[cinemeta] Fetching metadata for ${type}/${imdbId}`);

    try {
        const url = `https://v3-cinemeta.strem.io/meta/${type}/${imdbId}.json`;
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const body = await response.json();
        const meta = body && body.meta;

        if (!meta) {
            logger.warn(`[cinemeta] No metadata found for ${type}/${imdbId}`);
            return null;
        }

        // Cache the result for 1 hour
        cache.set(cacheKey, meta, 3600);
        
        logger.success(`[cinemeta] Successfully fetched metadata for "${meta.name}" (${type})`);
        return meta;

    } catch (err) {
        logger.error(`[cinemeta] Error fetching metadata for ${type}/${imdbId}: ${err.message}`);
        throw new Error(`Error from Cinemeta: ${err.message}`);
    }
}

/**
 * Get episode count per season from Cinemeta
 * Used for calculating absolute episode numbers when Trakt uses different numbering
 * @param {string} imdbId - IMDb ID
 * @returns {Promise<object|null>} Map of season number → episode count info
 */
async function getSeasonEpisodeCounts(imdbId) {
    if (!imdbId) {
        logger.warn('[cinemeta] getSeasonEpisodeCounts: Missing imdbId');
        return null;
    }
    
    try {
        const meta = await getMeta('series', imdbId);
        
        if (!meta || !meta.videos) {
            logger.warn(`[cinemeta] No videos found for ${imdbId}`);
            return null;
        }
        
        const seasonMap = {};
        
        meta.videos.forEach(video => {
            const season = video.season;
            const episode = video.episode;
            
            // Skip entries without season or episode numbers
            if (season === undefined || season === null) return;
            if (episode === undefined || episode === null) return;
            
            if (!seasonMap[season]) {
                seasonMap[season] = {
                    count: 0,
                    firstEpisode: Infinity,
                    lastEpisode: 0,
                    episodes: []
                };
            }
            
            seasonMap[season].count++;
            seasonMap[season].firstEpisode = Math.min(seasonMap[season].firstEpisode, episode);
            seasonMap[season].lastEpisode = Math.max(seasonMap[season].lastEpisode, episode);
            seasonMap[season].episodes.push(episode);
        });
        
        Object.keys(seasonMap).forEach(season => {
            if (seasonMap[season].firstEpisode === Infinity) {
                seasonMap[season].firstEpisode = 0;
            }
        });
        
        logger.debug(`[cinemeta] Season structure for ${imdbId}:`, 
            Object.entries(seasonMap)
                .map(([s, data]) => `S${s}: ${data.count} eps`)
                .join(', ')
        );
        
        return seasonMap;
        
    } catch (err) {
        logger.warn(`[cinemeta] Failed to get season episode counts for ${imdbId}: ${err.message}`);
        return null;
    }
}

export default { 
    getMeta,
    getSeasonEpisodeCounts
};
