import cache from '../utils/cache-manager.js';
import { fetchWithRetry } from './http.js';
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
    return !!process.env.TMDB_API_KEY;
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
        let originalName = null;
        let originalLanguage = null;

        if (!resolvedTmdbId && imdbId && resolvedApiKey) {
            const findUrl = `https://api.themoviedb.org/3/find/${imdbId}?api_key=${resolvedApiKey}&external_source=imdb_id`;
            const resp = await fetchWithRetry(findUrl, {}, 'tmdb-api');
            const data = await resp.json();
            if (type === 'movie' && data.movie_results && data.movie_results.length) {
                const result = data.movie_results[0];
                resolvedTmdbId = result.id;
                originalName = result.original_title || null;
                originalLanguage = result.original_language || null;
            } else if (type === 'series' && data.tv_results && data.tv_results.length) {
                const result = data.tv_results[0];
                resolvedTmdbId = result.id;
                originalName = result.original_name || null;
                originalLanguage = result.original_language || null;
            }
        }

        if (!resolvedTmdbId) {
            logger.warn(`[tmdb-api] No TMDb ID available for ${type} ${imdbId}`);
            cache.set(cacheKey, [], 1800); // TMDb answered and knows nothing about it
            return [];
        }

        const url = type === 'movie'
            ? `https://api.themoviedb.org/3/movie/${resolvedTmdbId}/alternative_titles?api_key=${resolvedApiKey}`
            : `https://api.themoviedb.org/3/tv/${resolvedTmdbId}/alternative_titles?api_key=${resolvedApiKey}`;

        const resp = await fetchWithRetry(url, {}, 'tmdb-api');
        const data = await resp.json();
        const rawTitles = data.results || data.titles || [];
        
        const titlesWithCountry = rawTitles
            .filter(t => t.title && t.title.trim()) 
            .map(t => ({
                title: t.title,
                country: t.iso_3166_1 || 'XX', // Use 'XX' for unknown countries
                normalizedTitle: extractKeywords(t.title)
            }))
            .filter(t => t.normalizedTitle.length > 0); // Remove titles that normalize to empty
        
        if (originalName && originalName.trim()) {
            const normalizedOriginal = extractKeywords(originalName);
            const alreadyIncluded = titlesWithCountry.some(
                t => t.title.toLowerCase() === originalName.toLowerCase()
            );
            if (!alreadyIncluded && normalizedOriginal.length > 0) {
                const country = originalLanguage ? originalLanguage.toUpperCase() : 'XX';
                titlesWithCountry.unshift({
                    title: originalName,
                    country,
                    normalizedTitle: normalizedOriginal
                });
                logger.info(`[tmdb-api] Added original title "${originalName}" (${country}) to alternatives`);
            }
        }
        
    logger.info(`[tmdb-api] ✅ Found ${titlesWithCountry.length} alternative titles with countries.`);
    logger.debug(`[tmdb-api] Alternative titles list: [\n${titlesWithCountry.map(t => `"${t.title}" (${t.country})`).join(',\n')}\n]`);
        
        // Cache result for 24 hours
        cache.set(cacheKey, titlesWithCountry, 24 * 3600);
        return titlesWithCountry;

    } catch (err) {
        logger.error(`[tmdb-api] Failed to fetch alternative titles for ${type} ${tmdbId || imdbId}:`, err.message);
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
        const searchResp = await fetchWithRetry(searchUrl, {}, 'tmdb-api');
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
        return null;
    }
}

function normalizeSearchType(type) {
    return type === 'series' ? 'tv' : type;
}

export function buildTMDbPosterUrl(posterPath, size = 'w342') {
    if (!posterPath) {
        return null;
    }

    return `https://image.tmdb.org/t/p/${size}${posterPath}`;
}

export async function fetchTMDbExternalImdbId(tmdbId, mediaType) {
    const resolvedApiKey = getTmdbApiKey();
    const endpoint = normalizeSearchType(mediaType);

    if (!resolvedApiKey || !tmdbId || !endpoint) {
        logger.debug('[tmdb-api] Missing TMDb API key, tmdbId, or mediaType for external ID lookup');
        return null;
    }

    const cacheKey = `tmdb_external_ids_${endpoint}_${tmdbId}`;
    const cachedResult = cache.get(cacheKey);
    if (cachedResult !== null && cachedResult !== undefined) {
        return cachedResult;
    }

    try {
        const url = `https://api.themoviedb.org/3/${endpoint}/${tmdbId}/external_ids?api_key=${resolvedApiKey}`;
        const response = await fetchWithRetry(url, {
            headers: { accept: 'application/json' }
        }, 'tmdb-api');

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        const imdbId = data?.imdb_id || null;

        cache.set(cacheKey, imdbId, imdbId ? 24 * 3600 : 1800, {
            type: 'tmdb_external_ids',
            endpoint
        });

        return imdbId;
    } catch (err) {
        logger.error(`[tmdb-api] Failed to fetch external IDs for ${endpoint}/${tmdbId}:`, err.message);
        return null;
    }
}

export async function searchTMDbMedia({ title, type, year = null, limit = 5 } = {}) {
    const resolvedApiKey = getTmdbApiKey();
    const endpoint = normalizeSearchType(type);

    if (!resolvedApiKey || !title || !endpoint) {
        logger.debug('[tmdb-api] Missing TMDb API key, title, or endpoint for media search');
        return [];
    }

    const normalizedTitle = title.toLowerCase().replace(/[^a-z0-9]+/gi, '_');
    const cacheKey = `tmdb_media_search_${endpoint}_${normalizedTitle}_${year || 'none'}_${limit}`;
    const cachedResult = cache.get(cacheKey);
    if (cachedResult) {
        return cachedResult;
    }

    try {
        const params = new URLSearchParams({
            api_key: resolvedApiKey,
            query: title,
            include_adult: 'false'
        });

        if (year) {
            if (endpoint === 'movie') {
                params.set('year', String(year));
            } else {
                params.set('first_air_date_year', String(year));
            }
        }

        const url = `https://api.themoviedb.org/3/search/${endpoint}?${params.toString()}`;
        const response = await fetchWithRetry(url, {
            headers: { accept: 'application/json' }
        }, 'tmdb-api');

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        const results = (data.results || []).slice(0, limit).map(result => ({
            id: result.id,
            mediaType: endpoint === 'tv' ? 'series' : 'movie',
            displayTitle: result.title || result.name || result.original_title || result.original_name || null,
            originalTitle: result.original_title || result.original_name || null,
            displayDate: result.release_date || result.first_air_date || null,
            posterPath: result.poster_path || null,
            popularity: result.popularity ?? null,
            voteAverage: result.vote_average ?? null,
            voteCount: result.vote_count ?? null
        }));

        cache.set(cacheKey, results, 6 * 3600);
        return results;
    } catch (err) {
        logger.error(`[tmdb-api] Failed to search TMDb ${endpoint} for "${title}":`, err.message);
        return [];
    }
}

export async function fetchTMDbTVDetails(tmdbId) {
    const resolvedApiKey = getTmdbApiKey();

    if (!resolvedApiKey || !tmdbId) {
        return null;
    }

    const cacheKey = `tmdb_tv_details_${tmdbId}`;
    const cachedResult = cache.get(cacheKey);
    if (cachedResult) {
        return cachedResult;
    }

    try {
        const url = `https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${resolvedApiKey}&language=en-US`;
        const response = await fetchWithRetry(url, {
            headers: { accept: 'application/json' }
        }, 'tmdb-api');

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        const details = {
            number_of_seasons: data.number_of_seasons ?? null,
            number_of_episodes: data.number_of_episodes ?? null,
            status: data.status || null
        };

        cache.set(cacheKey, details, 24 * 3600);
        return details;
    } catch (err) {
        logger.error(`[tmdb-api] Failed to fetch TV details for ${tmdbId}:`, err.message);
        return null;
    }
}

export function clearCache() {
    const entries = cache.getByPattern('^tmdb_');
    entries.forEach(entry => cache.delete(entry.key));
    logger.info(`[tmdb-api] Cleared ${entries.length} cached entries`);
}
