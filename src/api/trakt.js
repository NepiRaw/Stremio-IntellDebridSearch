import cache from '../utils/cache-manager.js';
import { logger } from '../utils/logger.js';

/**
 * Trakt API client with caching
 * Manages Trakt API calls for episode mappings
 */

/**
 * Get episode mapping from Trakt API with caching
 * Maps season/episode to absolute numbers for accurate episode parsing
 * @param {string} traktApiKey - Trakt API key
 * @param {string} imdbId - IMDb ID of the series
 * @param {number} season - Target season number
 * @param {number} episode - Target episode number
 * @returns {Promise<object|null>} - Episode mapping data or null
 */
export async function getEpisodeMapping(traktApiKey, imdbId, season, episode) {
    if (!traktApiKey || !imdbId) {
        logger.warn('[trakt-api] Missing Trakt API key or IMDb ID');
        return null;
    }

    // Create cache key
    const cacheKey = `trakt_episode_${imdbId}_s${season}_e${episode}`;
    
    // Check cache first
    const cachedResult = cache.get(cacheKey);
    if (cachedResult) {
        logger.info(`[trakt-api] Cache hit for episode mapping: ${imdbId} S${season}E${episode}`);
        return cachedResult;
    }

    try {
        // First, search for the show using IMDb ID
        const searchUrl = `https://api.trakt.tv/search/imdb/${imdbId}`;
        
        const searchResponse = await fetch(searchUrl, {
            headers: {
                'Content-Type': 'application/json',
                'trakt-api-version': '2',
                'trakt-api-key': traktApiKey
            }
        });

        if (!searchResponse.ok) {
            throw new Error(`Trakt search failed: ${searchResponse.status} ${searchResponse.statusText}`);
        }

        const searchData = await searchResponse.json();

        if (!searchData || searchData.length === 0) {
            logger.warn(`[trakt-api] No Trakt results found for IMDb ID: ${imdbId}`);
            cache.set(cacheKey, null, 3600); // Cache null for 1 hour
            return null;
        }

        const traktId = searchData[0].show.ids.trakt;
        logger.info(`[trakt-api] Found Trakt ID: ${traktId} for IMDb ID: ${imdbId}`);

        // Get season data
        const seasonUrl = `https://api.trakt.tv/shows/${traktId}/seasons/${season}?extended=full`;
        
        const seasonResponse = await fetch(seasonUrl, {
            headers: {
                'Content-Type': 'application/json',
                'trakt-api-version': '2',
                'trakt-api-key': traktApiKey
            }
        });

        let episodeMapping = null;

        if (!seasonResponse.ok) {
            logger.warn(`[trakt-api] Season ${season} not found, trying to find absolute episode...`);
            
            // Try to find the episode in all seasons by absolute number
            const allSeasonsUrl = `https://api.trakt.tv/shows/${traktId}/seasons?extended=episodes`;
            
            try {
                const allSeasonsResponse = await fetch(allSeasonsUrl, {
                    headers: {
                        'Content-Type': 'application/json',
                        'trakt-api-version': '2',
                        'trakt-api-key': traktApiKey
                    }
                });

                if (allSeasonsResponse.ok) {
                    const allSeasonsData = await allSeasonsResponse.json();
                    
                    // Look for episode by absolute number
                    for (const seasonInfo of allSeasonsData) {
                        if (seasonInfo.episodes) {
                            const foundEpisode = seasonInfo.episodes.find(ep => 
                                ep.number_abs === episode || 
                                (seasonInfo.number === season && ep.number === episode)
                            );
                            
                            if (foundEpisode) {
                                episodeMapping = {
                                    season: seasonInfo.number,
                                    episode: foundEpisode.number,
                                    absoluteEpisode: foundEpisode.number_abs,
                                    title: foundEpisode.title,
                                    overview: foundEpisode.overview
                                };
                                break;
                            }
                        }
                    }
                }
            } catch (err) {
                logger.warn(`[trakt-api] Failed to search all seasons:`, err.message);
            }
        } else {
            // Parse season data
            const seasonData = await seasonResponse.json();
            
            // Find the target episode
            const targetEpisode = seasonData.find(ep => {
                return ep.number === episode;
            });

            if (targetEpisode) {
                episodeMapping = {
                    season: season,
                    episode: targetEpisode.number,
                    absoluteEpisode: targetEpisode.number_abs,
                    title: targetEpisode.title,
                    overview: targetEpisode.overview
                };
            } else {
                logger.warn(`[trakt-api] Episode ${episode} not found in season ${season}`);
                
                // Try to map to closest episode if exact match not found
                const maxEpisode = Math.max(...seasonData.map(ep => ep.number));
                if (episode > maxEpisode) {
                    logger.info(`[trakt-api] Episode ${episode} exceeds max episode ${maxEpisode}, using last episode`);
                    const lastEpisode = seasonData.find(ep => ep.number === maxEpisode);
                    if (lastEpisode) {
                        episodeMapping = {
                            season: season,
                            episode: lastEpisode.number,
                            absoluteEpisode: lastEpisode.number_abs,
                            title: lastEpisode.title,
                            overview: lastEpisode.overview,
                            fallback: true
                        };
                    }
                }
            }
        }

        if (episodeMapping) {
            logger.info(`[trakt-api] Found episode mapping for ${imdbId} S${season}E${episode}:`, episodeMapping);
        } else {
            logger.warn(`[trakt-api] No episode mapping found for ${imdbId} S${season}E${episode}`);
        }

        // Cache result for 24 hours
        cache.set(cacheKey, episodeMapping, 24 * 3600);
        return episodeMapping;

    } catch (err) {
        logger.error(`[trakt-api] Failed to get episode mapping for ${imdbId} S${season}E${episode}:`, err.message);
        // Cache null result for 1 hour to avoid repeated failures
        cache.set(cacheKey, null, 3600);
        return null;
    }
}

/**
 * Get show information from Trakt by IMDb ID with caching
 * @param {string} traktApiKey - Trakt API key
 * @param {string} imdbId - IMDb ID of the series
 * @returns {Promise<object|null>} - Show information or null
 */
export async function getShowInfo(traktApiKey, imdbId) {
    if (!traktApiKey || !imdbId) {
        logger.warn('[trakt-api] Missing Trakt API key or IMDb ID');
        return null;
    }

    // Create cache key
    const cacheKey = `trakt_show_${imdbId}`;
    
    // Check cache first
    const cachedResult = cache.get(cacheKey);
    if (cachedResult) {
        logger.info(`[trakt-api] Cache hit for show info: ${imdbId}`);
        return cachedResult;
    }

    try {
        const searchUrl = `https://api.trakt.tv/search/imdb/${imdbId}`;
        
        const response = await fetch(searchUrl, {
            headers: {
                'Content-Type': 'application/json',
                'trakt-api-version': '2',
                'trakt-api-key': traktApiKey
            }
        });

        if (!response.ok) {
            throw new Error(`Trakt search failed: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();

        let showInfo = null;
        if (data && data.length > 0) {
            const show = data[0].show;
            showInfo = {
                traktId: show.ids.trakt,
                imdbId: show.ids.imdb,
                tmdbId: show.ids.tmdb,
                title: show.title,
                year: show.year,
                status: show.status,
                type: data[0].type
            };
        }

        logger.info(`[trakt-api] Show info for ${imdbId}:`, showInfo ? `Found ${showInfo.title}` : 'Not found');
        
        // Cache result for 24 hours
        cache.set(cacheKey, showInfo, 24 * 3600);
        return showInfo;

    } catch (err) {
        logger.error(`[trakt-api] Failed to get show info for ${imdbId}:`, err.message);
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
 * Clear Trakt cache
 */
export function clearCache() {
    const stats = cache.getStats();
    const traktKeys = stats.keys.filter(key => key.startsWith('trakt_'));
    traktKeys.forEach(key => cache.delete(key));
    logger.info(`[trakt-api] Cleared ${traktKeys.length} cached entries`);
}
