import cache from '../utils/cache-manager.js';
import { logger } from '../utils/logger.js';
import { extractKeywords } from '../search/keyword-extractor.js';

/**
 * TMDb API client with caching and centralized API key management
 * Handles all TMDb API requests for movie/series metadata
 */

const startupWarnings = new Set();

function getTmdbApiKey(userProvidedKey = null) {
    const apiKey = process.env.TMDB_API_KEY;
    
    if (!apiKey) {
        if (!startupWarnings.has('tmdb_missing')) {
            logger.warn('[tmdb-api] TMDB_API_KEY is not set. TMDb-powered features will be disabled.');
            startupWarnings.add('tmdb_missing');
        }
        return null;
    }
    
    return apiKey;
}

export function isTmdbEnabled() {
    const tmdbApiKey = process.env.TMDB_API_KEY;
    const traktApiKey = process.env.TRAKT_API_KEY;
    
    return !!tmdbApiKey && (!!traktApiKey || !traktApiKey);
}

export async function fetchTMDbAlternativeTitles(tmdbId, type, tmdbApiKey = null, imdbId = null) {
    const resolvedApiKey = getTmdbApiKey();
    
    if (!resolvedApiKey) {
        logger.debug('[tmdb-api] TMDb API key not available, skipping alternative titles');
        return [];
    }

    const cacheKey = `tmdb_alt_titles_${tmdbId || imdbId}_${type}`;
    
    const cachedResult = cache.get(cacheKey);
    if (cachedResult) {
        logger.info(`[tmdb-api] Cache hit for alternative titles: ${cacheKey}`);
        return cachedResult;
    }

    try {
        let resolvedTmdbId = tmdbId;
        
        if (!resolvedTmdbId && imdbId && resolvedApiKey) {
            const findUrl = `https://api.themoviedb.org/3/find/${imdbId}?api_key=${resolvedApiKey}&external_source=imdb_id`;
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
            ? `https://api.themoviedb.org/3/movie/${resolvedTmdbId}/alternative_titles?api_key=${resolvedApiKey}`
            : `https://api.themoviedb.org/3/tv/${resolvedTmdbId}/alternative_titles?api_key=${resolvedApiKey}`;

        const resp = await fetch(url);
        const data = await resp.json();
        if (!data.results) return [];
        
        const titlesWithCountry = data.results
            .filter(t => t.title && t.title.trim()) 
            .map(t => ({
                title: t.title,
                country: t.iso_3166_1 || 'XX', // Use 'XX' for unknown countries
                normalizedTitle: extractKeywords(t.title)
            }))
            .filter(t => t.normalizedTitle.length > 0); // Remove titles that normalize to empty
        
    logger.info(`[tmdb-api] ✅ Found ${titlesWithCountry.length} alternative titles with countries.`);
    logger.debug(`[tmdb-api] Alternative titles list: [\n${titlesWithCountry.map(t => `"${t.title}" (${t.country})`).join(',\n')}\n]`);
        
        // Cache result for 24 hours
        cache.set(cacheKey, titlesWithCountry, 24 * 3600);
        return titlesWithCountry;

    } catch (err) {
        logger.error(`[tmdb-api] Failed to fetch alternative titles for ${type} ${tmdbId || imdbId}:`, err.message);
        cache.set(cacheKey, [], 1800); // Cache empty result for 30 minutes to avoid repeated failures
        return [];
    }
}

export async function searchTMDbByTitle(searchTitle, tmdbApiKey = null) {
    const resolvedApiKey = getTmdbApiKey();
    
    if (!resolvedApiKey || !searchTitle) {
        logger.debug('[tmdb-api] TMDb API key not available or missing search title, skipping search');
        return null;
    }

    const cacheKey = `tmdb_search_${searchTitle.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
    
    const cachedResult = cache.get(cacheKey);
    if (cachedResult) {
        logger.info(`[tmdb-api] Cache hit for search: ${searchTitle}`);
        return cachedResult;
    }

    try {
        const searchUrl = `https://api.themoviedb.org/3/search/tv?api_key=${resolvedApiKey}&query=${encodeURIComponent(searchTitle)}`;
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
        
        cache.set(cacheKey, result, 6 * 3600); // Cache result for 6 hours
        return result;

    } catch (err) {
        logger.error(`[tmdb-api] Failed to search TMDb for "${searchTitle}":`, err.message);
        cache.set(cacheKey, null, 3600); // Cache null result for 1 hour to avoid repeated failures
        return null;
    }
}

export function getCacheStats() {
    return cache.getStats();
}

export function clearCache() {
    const stats = cache.getStats();
    const tmdbKeys = stats.keys.filter(key => key.startsWith('tmdb_'));
    tmdbKeys.forEach(key => cache.delete(key));
    logger.info(`[tmdb-api] Cleared ${tmdbKeys.length} cached entries`);
}
