import cache from '../utils/cache-manager.js';
import { logger } from '../utils/logger.js';
import { extractKeywords } from '../search/keyword-extractor.js';

/**
 * TMDb API client with caching
 * Handles all TMDb API requests for movie/series metadata
 */

/**
 * Fetch alternative titles for a movie or series using TMDb API with caching
 * @param {string|null} tmdbId - The TMDb ID of the movie/series
 * @param {string} type - 'movie' or 'series'
 * @param {string} tmdbApiKey - The TMDb API key
 * @param {string|null} imdbId - The IMDb ID (optional, used if tmdbId is not provided)
 * @returns {Promise<string[]>} - List of normalized alternative titles
 */
export async function fetchTMDbAlternativeTitles(tmdbId, type, tmdbApiKey, imdbId = null) {
    if (!tmdbApiKey) {
        logger.warn('[tmdb-api] No TMDb API key provided');
        return [];
    }

    // Create cache key
    const cacheKey = `tmdb_alt_titles_${tmdbId || imdbId}_${type}`;
    
    // Check cache first
    const cachedResult = cache.get(cacheKey);
    if (cachedResult) {
        logger.info(`[tmdb-api] Cache hit for alternative titles: ${cacheKey}`);
        return cachedResult;
    }

    try {
        // Always use imdbId for TMDb lookup if present and tmdbId is not provided
        let resolvedTmdbId = tmdbId;
        
        if (!resolvedTmdbId && imdbId && tmdbApiKey) {
            const findUrl = `https://api.themoviedb.org/3/find/${imdbId}?api_key=${tmdbApiKey}&external_source=imdb_id`;
            try {
                const resp = await fetch(findUrl);
                const data = await resp.json();
                if (type === 'movie' && data.movie_results && data.movie_results.length) {
                    resolvedTmdbId = data.movie_results[0].id;
                } else if (type === 'series' && data.tv_results && data.tv_results.length) {
                    resolvedTmdbId = data.tv_results[0].id;
                }
            } catch (err) {
                logger.warn(`[tmdb-api] Failed to resolve TMDb ID from IMDb ID ${imdbId}:`, err.message);
            }
        }

        if (!resolvedTmdbId) {
            logger.warn(`[tmdb-api] No TMDb ID available for ${type} ${imdbId}`);
            cache.set(cacheKey, [], 1800); // Cache empty result for 30 minutes
            return [];
        }

        const url = type === 'movie'
            ? `https://api.themoviedb.org/3/movie/${resolvedTmdbId}/alternative_titles?api_key=${tmdbApiKey}`
            : `https://api.themoviedb.org/3/tv/${resolvedTmdbId}/alternative_titles?api_key=${tmdbApiKey}`;

        const resp = await fetch(url);
        const data = await resp.json();
        if (!data.results) return [];
        
        // Extract titles with country information
        const titlesWithCountry = data.results
            .filter(t => t.title && t.title.trim()) // Filter out empty titles
            .map(t => ({
                title: t.title,
                country: t.iso_3166_1 || 'XX', // Use 'XX' for unknown countries
                normalizedTitle: extractKeywords(t.title)
            }))
            .filter(t => t.normalizedTitle.length > 0); // Remove titles that normalize to empty
        
        logger.info(`[tmdb-api] Found ${titlesWithCountry.length} alternative titles with countries:`, 
            titlesWithCountry.map(t => `"${t.title}" (${t.country})`));
        
        // Cache result for 24 hours
        cache.set(cacheKey, titlesWithCountry, 24 * 3600);
        return titlesWithCountry;

    } catch (err) {
        logger.error(`[tmdb-api] Failed to fetch alternative titles for ${type} ${tmdbId || imdbId}:`, err.message);
        // Cache empty result for 30 minutes to avoid repeated failures
        cache.set(cacheKey, [], 1800);
        return [];
    }
}

/**
 * Search TMDb by title with caching
 * @param {string} searchTitle - Title to search for
 * @param {string} tmdbApiKey - TMDb API key
 * @returns {Promise<object|null>} - TMDb search result or null
 */
export async function searchTMDbByTitle(searchTitle, tmdbApiKey) {
    if (!tmdbApiKey || !searchTitle) {
        logger.warn('[tmdb-api] Missing TMDb API key or search title');
        return null;
    }

    // Create cache key
    const cacheKey = `tmdb_search_${searchTitle.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
    
    // Check cache first
    const cachedResult = cache.get(cacheKey);
    if (cachedResult) {
        logger.info(`[tmdb-api] Cache hit for search: ${searchTitle}`);
        return cachedResult;
    }

    try {
        // Search TV series first (most likely for our use case)
        const searchUrl = `https://api.themoviedb.org/3/search/tv?api_key=${tmdbApiKey}&query=${encodeURIComponent(searchTitle)}`;
        const searchResp = await fetch(searchUrl);
        const searchData = await searchResp.json();

        let result = null;

        if (searchData.results && searchData.results.length > 0) {
            const firstResult = searchData.results[0];
            result = {
                id: firstResult.id,
                name: firstResult.name,
                original_name: firstResult.original_name,
                first_air_date: firstResult.first_air_date,
                type: 'tv'
            };
        }

        logger.info(`[tmdb-api] Search result for "${searchTitle}":`, result ? `Found TV series ${result.name}` : 'No results');
        
        // Cache result for 6 hours
        cache.set(cacheKey, result, 6 * 3600);
        return result;

    } catch (err) {
        logger.error(`[tmdb-api] Failed to search TMDb for "${searchTitle}":`, err.message);
        // Cache null result for 1 hour to avoid repeated failures
        cache.set(cacheKey, null, 3600);
        return null;
    }
}

/**
 * Get cache statistics for monitoring
 * @returns {object}
 */
export function getCacheStats() {
    return cache.getStats();
}

/**
 * Clear TMDb cache
 */
export function clearCache() {
    const stats = cache.getStats();
    const tmdbKeys = stats.keys.filter(key => key.startsWith('tmdb_'));
    tmdbKeys.forEach(key => cache.delete(key));
    logger.info(`[tmdb-api] Cleared ${tmdbKeys.length} cached entries`);
}
