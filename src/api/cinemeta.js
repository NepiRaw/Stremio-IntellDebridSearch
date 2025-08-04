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
 * Get detailed metadata with additional processing
 * @param {string} type - Content type
 * @param {string} imdbId - IMDb ID
 * @returns {Promise<object>} - Enhanced metadata
 */
async function getDetailedMeta(type, imdbId) {
    logger.debug(`[cinemeta] Getting detailed metadata for ${type}/${imdbId}`);

    const meta = await getMeta(type, imdbId);
    if (!meta) {
        return null;
    }

    // Add additional processing
    const enhancedMeta = {
        ...meta,
        fetchedAt: new Date().toISOString(),
        source: 'cinemeta'
    };

    // Normalize year from releaseInfo
    if (meta.releaseInfo && !meta.year) {
        const yearMatch = meta.releaseInfo.match(/(\d{4})/);
        if (yearMatch) {
            enhancedMeta.year = parseInt(yearMatch[1], 10);
        }
    }

    // Ensure genres is an array
    if (meta.genre && typeof meta.genre === 'string') {
        enhancedMeta.genres = meta.genre.split(',').map(g => g.trim());
    } else if (Array.isArray(meta.genre)) {
        enhancedMeta.genres = meta.genre;
    }

    return enhancedMeta;
}

/**
 * Validate metadata response
 * @param {object} meta - Metadata to validate
 * @returns {object} - Validation result
 */
function validateMeta(meta) {
    const validation = {
        isValid: true,
        errors: [],
        warnings: []
    };

    if (!meta) {
        validation.isValid = false;
        validation.errors.push('Metadata is null or undefined');
        return validation;
    }

    // Check required fields
    if (!meta.name) {
        validation.errors.push('Missing title/name');
        validation.isValid = false;
    }

    if (!meta.imdb_id && !meta.imdbId) {
        validation.warnings.push('Missing IMDb ID');
    }

    if (!meta.type) {
        validation.warnings.push('Missing content type');
    }

    return validation;
}

export default { 
    getMeta, 
    getDetailedMeta,
    validateMeta
};
