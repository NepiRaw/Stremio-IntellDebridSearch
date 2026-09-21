import { logger } from '../utils/logger.js';

const fetchLog = logger.for('CINEMETA').at('fetch');
import cache from '../utils/cache-manager.js';
import { fetchWithRetry, isTransientNetworkError } from './http.js';

/**
 * Cinemeta API client - fetches metadata from Stremio's Cinemeta service
 * Handles movie and series metadata with caching support
 */

export { isTransientNetworkError };

/** Fetches JSON, retrying only what a retry can fix. An HTTP status is an answer, not a failure. */
export async function fetchJson(url) {
    const response = await fetchWithRetry(url, {}, 'cinemeta');
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return response.json();
}

/**
 * Get metadata from Cinemeta service
 * @param {string} type - Content type ('movie' or 'series')
 * @param {string} imdbId - IMDb ID
 * @returns {Promise<object>} - Metadata object
 */
async function getMeta(type, imdbId) {
    if (!type || !imdbId) {
        throw new Error('Missing required parameters: type or imdbId');
    }

    // Check cache first
    const cacheKey = `cinemeta:${type}:${imdbId}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    try {
        const url = `https://v3-cinemeta.strem.io/meta/${type}/${imdbId}.json`;
        const body = await fetchJson(url);
        const meta = body && body.meta;

        if (!meta) {
            fetchLog.warn('No metadata', { type, id: imdbId, found: false });
            return null;
        }

        // Cache the result for 1 hour
        cache.set(cacheKey, meta, 3600);
        
        fetchLog.debug('Metadata fetched', { type, id: imdbId, found: Boolean(meta.name) });
        return meta;

    } catch (err) {
        fetchLog.warn('Fetch failed', { type, id: imdbId, error: err.name, code: err.code });
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
    if (!imdbId) return null;
    
    try {
        const meta = await getMeta('series', imdbId);
        
        if (!meta || !meta.videos) return null;
        
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
        
        return seasonMap;
        
    } catch (err) {
        fetchLog.warn('Season counts failed', { type: 'series', id: imdbId, error: err.name });
        return null;
    }
}

export default { 
    getMeta,
    getSeasonEpisodeCounts
};
