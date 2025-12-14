import cache from '../utils/cache-manager.js';
import { logger } from '../utils/logger.js';
import Cinemeta from './cinemeta.js';

/**
 * Trakt API client with caching and centralized API key management
 * Manages Trakt API calls for episode mappings
 */

const startupWarnings = new Set();

function getTraktApiKey(userProvidedKey = null) {
    const apiKey = process.env.TRAKT_API_KEY;
    
    if (!apiKey) {
        if (!startupWarnings.has('trakt_missing')) {
            logger.warn('[trakt-api] TRAKT_API_KEY is not set. Trakt-powered features will be disabled.');
            startupWarnings.add('trakt_missing');
        }
        return null;
    }
    
    return apiKey;
}

export function isTraktEnabled() {
    const tmdbApiKey = process.env.TMDB_API_KEY;
    const traktApiKey = process.env.TRAKT_API_KEY;
    
    // Trakt is enabled ONLY if:
    // 1. Both Trakt AND TMDb keys exist (Scenario 1)
    // All other scenarios disable Trakt (as without TMDb, Trakt features are limited):
    // 2. TMDb only (Scenario 2) - Trakt features disabled
    // 3. Trakt only (Scenario 3) - should disable Trakt (fallback to basic)
    // 4. Neither key (Scenario 4) - should disable Trakt
    
    if (tmdbApiKey && traktApiKey) {
        return true; // Scenario 1: Both APIs
    }
    
    return false; // All other scenarios: disable Trakt
}

/**
 * Calculate absolute episode number based on Cinemeta's season structure
 * @param {object} cinemetaSeasonMap - Season → episode count map from Cinemeta
 * @param {number} targetSeason - The requested season number
 * @param {number} targetEpisode - The requested episode number within that season
 * @returns {number} Calculated absolute episode number
 */
function calculateAbsoluteFromCinemeta(cinemetaSeasonMap, targetSeason, targetEpisode) {
    let absoluteEpisode = 0;
    
    for (let s = 1; s < targetSeason; s++) {
        if (cinemetaSeasonMap[s]) {
            absoluteEpisode += cinemetaSeasonMap[s].count;
        }
    }
    
    absoluteEpisode += targetEpisode;
    
    logger.debug(`[trakt-api] Calculated absolute from Cinemeta: S${targetSeason}E${targetEpisode} → Absolute ${absoluteEpisode}`);
    
    return absoluteEpisode;
}

/**
 * Detect if we need to use Cinemeta fallback due to season numbering mismatch
 * @param {Array} traktSeasonData - Episodes from Trakt for the requested season
 * @param {number} requestedEpisode - The episode number we're looking for
 * @returns {boolean} True if Cinemeta fallback should be triggered
 */
function shouldTriggerCinemetaFallback(traktSeasonData, requestedEpisode) {
    if (!traktSeasonData || traktSeasonData.length === 0) {
        return false; // Empty season, different issue
    }
    
    const directMatch = traktSeasonData.find(ep => ep.number === requestedEpisode);
    if (directMatch) {
        return false; // Found directly, no fallback needed
    }
    
    const episodeNumbers = traktSeasonData.map(ep => ep.number);
    const firstEpisodeNumber = Math.min(...episodeNumbers);
    const lastEpisodeNumber = Math.max(...episodeNumbers);
    
    if (firstEpisodeNumber > requestedEpisode + 10) {
        logger.info(`[trakt-api] Detected absolute numbering: Trakt season starts at E${firstEpisodeNumber}, requested E${requestedEpisode}`);
        return true;
    }
    
    return false;
}

/**
 * Find an episode across all Trakt seasons by absolute episode number
 * @param {string} traktApiKey - Trakt API key
 * @param {number} traktId - Trakt show ID
 * @param {number} absoluteEpisode - The absolute episode number to find
 * @returns {Promise<object|null>} Episode mapping if found
 */
async function findEpisodeByAbsolute(traktApiKey, traktId, absoluteEpisode) {
    const resolvedApiKey = getTraktApiKey(traktApiKey);
    
    const allSeasonsUrl = `https://api.trakt.tv/shows/${traktId}/seasons?extended=episodes`;
    
    try {
        const response = await fetch(allSeasonsUrl, {
            headers: {
                'Content-Type': 'application/json',
                'trakt-api-version': '2',
                'trakt-api-key': resolvedApiKey
            }
        });
        
        if (!response.ok) {
            logger.warn(`[trakt-api] Failed to fetch all seasons: ${response.status}`);
            return null;
        }
        
        const allSeasons = await response.json();
        
        // Search for the absolute episode number
        for (const season of allSeasons) {
            if (!season.episodes) continue;
            
            const foundEpisode = season.episodes.find(ep => ep.number_abs === absoluteEpisode);
            
            if (foundEpisode) {
                logger.info(`[trakt-api] ✅ Found absolute ${absoluteEpisode} → S${season.number}E${foundEpisode.number}`);
                return {
                    season: season.number,
                    episode: foundEpisode.number,
                    absoluteEpisode: foundEpisode.number_abs,
                    title: foundEpisode.title,
                    overview: foundEpisode.overview,
                    mappedFromCinemeta: true
                };
            }
        }
        
        logger.warn(`[trakt-api] Absolute episode ${absoluteEpisode} not found in any season`);
        return null;
    } catch (err) {
        logger.warn(`[trakt-api] Error finding episode by absolute:`, err.message);
        return null;
    }
}

export async function getEpisodeMapping(traktApiKey = null, imdbId, season, episode) {
    const resolvedApiKey = getTraktApiKey();
    
    if (!resolvedApiKey || !imdbId) {
        logger.debug('[trakt-api] Trakt API key not available or missing IMDb ID, skipping episode mapping');
        return null;
    }

    const cacheKey = `trakt_episode_${imdbId}_s${season}_e${episode}`;
    
    const cachedResult = cache.get(cacheKey);
    if (cachedResult) {
        logger.info(`[trakt-api] Cache hit for episode mapping: ${imdbId} S${season}E${episode}`);
        return cachedResult;
    }

    try {
        const searchUrl = `https://api.trakt.tv/search/imdb/${imdbId}`;
        
        const searchResponse = await fetch(searchUrl, {
            headers: {
                'Content-Type': 'application/json',
                'trakt-api-version': '2',
                'trakt-api-key': resolvedApiKey
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

        const seasonUrl = `https://api.trakt.tv/shows/${traktId}/seasons/${season}?extended=full`;
        
            const seasonResponse = await fetch(seasonUrl, {
                headers: {
                    'Content-Type': 'application/json',
                    'trakt-api-version': '2',
                    'trakt-api-key': resolvedApiKey
                }
            });        let episodeMapping = null;

        if (!seasonResponse.ok) {
            logger.warn(`[trakt-api] Season ${season} not found, trying to find absolute episode...`);
            
            const allSeasonsUrl = `https://api.trakt.tv/shows/${traktId}/seasons?extended=episodes`;
            
            try {
                const allSeasonsResponse = await fetch(allSeasonsUrl, {
                    headers: {
                        'Content-Type': 'application/json',
                        'trakt-api-version': '2',
                        'trakt-api-key': resolvedApiKey
                    }
                });

                if (allSeasonsResponse.ok) {
                    const allSeasonsData = await allSeasonsResponse.json();
                    
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
            const seasonData = await seasonResponse.json();
            
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
                
                // Check if we should trigger Cinemeta fallback
                // This handles cases where Trakt uses absolute numbering (e.g., anime)
                if (shouldTriggerCinemetaFallback(seasonData, episode)) {
                    logger.info(`[trakt-api] 🔄 Triggering Cinemeta fallback for S${season}E${episode}`);
                    
                    try {
                        const cinemetaSeasonMap = await Cinemeta.getSeasonEpisodeCounts(imdbId);
                        
                        if (cinemetaSeasonMap && cinemetaSeasonMap[season]) {
                            const calculatedAbsolute = calculateAbsoluteFromCinemeta(
                                cinemetaSeasonMap, 
                                parseInt(season), 
                                parseInt(episode)
                            );
                            
                            logger.info(`[trakt-api] Cinemeta calculated absolute: S${season}E${episode} → Absolute ${calculatedAbsolute}`);
                            
                            episodeMapping = await findEpisodeByAbsolute(
                                resolvedApiKey, 
                                traktId, 
                                calculatedAbsolute
                            );
                            
                            if (episodeMapping) {
                                logger.info(`[trakt-api] ✅ Cinemeta fallback successful: S${season}E${episode} → Absolute ${calculatedAbsolute} → S${episodeMapping.season}E${episodeMapping.episode}`);
                            }
                        } else {
                            logger.warn(`[trakt-api] Cinemeta season map not available for season ${season}`);
                        }
                    } catch (fallbackErr) {
                        logger.warn(`[trakt-api] Cinemeta fallback failed:`, fallbackErr.message);
                    }
                }
                
                if (!episodeMapping) {
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
        }

        if (episodeMapping) {
                logger.debug(`[trakt-api] Found episode mapping for ${imdbId} S${season}E${episode}:`, JSON.stringify(episodeMapping, null, 2));
        } else {
            logger.warn(`[trakt-api] No episode mapping found for ${imdbId} S${season}E${episode}`);
        }

        cache.set(cacheKey, episodeMapping, 24 * 3600); // Cache result for 24 hours
        return episodeMapping;

    } catch (err) {
        logger.error(`[trakt-api] Failed to get episode mapping for ${imdbId} S${season}E${episode}:`, err.message);
        cache.set(cacheKey, null, 3600);
        return null;
    }
}

export async function getShowInfo(traktApiKey = null, imdbId) {
    const resolvedApiKey = getTraktApiKey();
    
    if (!resolvedApiKey || !imdbId) {
        logger.debug('[trakt-api] Trakt API key not available or missing IMDb ID, skipping show info');
        return null;
    }

    const cacheKey = `trakt_show_${imdbId}`;
    
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
                'trakt-api-key': resolvedApiKey
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
        
        cache.set(cacheKey, showInfo, 24 * 3600); // Cache result for 24 hours
        return showInfo;

    } catch (err) {
        logger.error(`[trakt-api] Failed to get show info for ${imdbId}:`, err.message);
        cache.set(cacheKey, null, 3600);
        return null;
    }
}

export function getCacheStats() {
    return cache.getStats();
}

export function clearCache() {
    const stats = cache.getStats();
    const traktKeys = stats.keys.filter(key => key.startsWith('trakt_'));
    traktKeys.forEach(key => cache.delete(key));
    logger.info(`[trakt-api] Cleared ${traktKeys.length} cached entries`);
}