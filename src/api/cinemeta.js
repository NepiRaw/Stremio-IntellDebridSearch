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
export default { 
    getMeta
};
