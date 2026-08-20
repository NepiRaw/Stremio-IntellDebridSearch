import cache from '../utils/cache-manager.js';
import { fetchWithRetry } from './http.js';
import { logger } from '../utils/logger.js';

/**
 * TheTVDB v4 client for absolute episode numbering.
 *
 * Resolves an IMDb id to a series, then maps between a season/episode address and the
 * published absolute number in both directions. Absolute numbers are curated per series
 * and cannot be derived by summing season lengths, so they are always read from here.
 *
 * Only public catalogue metadata is cached, keyed by IMDb id.
 */

const API = 'https://api4.thetvdb.com/v4';
const TOKEN_KEY = 'tvdb_token';
const PAGE_SIZE = 500;
const MAX_PAGES = 20;

// TVDB tokens are valid for a month; this refreshes well inside that, and on any 401.
const TOKEN_TTL = 24 * 3600;
const EPISODES_TTL = 24 * 3600;
const UNKNOWN_SERIES_TTL = 3600;

let warnedAboutMissingKey = false;

function getApiKey() {
    const apiKey = process.env.TVDB_API_KEY;

    if (!apiKey) {
        if (!warnedAboutMissingKey) {
            logger.warn('[tvdb-api] TVDB_API_KEY is not set. Absolute episode mapping will be disabled.');
            warnedAboutMissingKey = true;
        }
        return null;
    }

    return apiKey;
}

export function isTvdbEnabled() {
    return !!process.env.TVDB_API_KEY;
}

async function login(apiKey) {
    const response = await fetchWithRetry(`${API}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apikey: apiKey })
    }, 'tvdb-api');

    if (!response.ok) {
        throw new Error(`login failed: HTTP ${response.status}`);
    }

    const token = (await response.json())?.data?.token;
    if (!token) {
        throw new Error('login returned no token');
    }

    cache.set(TOKEN_KEY, token, TOKEN_TTL, { type: 'tvdb-token' });
    return token;
}

// Re-authenticates once if the cached token has been revoked before its TTL.
async function authorizedGet(path, apiKey) {
    let token = cache.get(TOKEN_KEY) || await login(apiKey);
    let response = await fetchWithRetry(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });

    if (response.status === 401) {
        cache.delete(TOKEN_KEY);
        token = await login(apiKey);
        response = await fetchWithRetry(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    }

    if (!response.ok) {
        throw new Error(`HTTP ${response.status} for ${path}`);
    }

    return response.json();
}

async function resolveSeriesId(imdbId, apiKey) {
    const data = await authorizedGet(`/search/remoteid/${imdbId}`, apiKey);
    const hit = data?.data?.find(entry => entry.series) || data?.data?.[0];
    return hit?.series?.id ?? null;
}

function toEpisodeAddress(episode) {
    const absolute = episode.absoluteNumber;

    return {
        season: episode.seasonNumber,
        episode: episode.number,
        absoluteEpisode: Number.isInteger(absolute) && absolute > 0 ? absolute : null,
        title: episode.name || null
    };
}

async function fetchEpisodes(seriesId, apiKey) {
    const episodes = [];

    for (let page = 0; page < MAX_PAGES; page++) {
        const data = await authorizedGet(`/series/${seriesId}/episodes/default?page=${page}`, apiKey);
        const batch = data?.data?.episodes || [];

        episodes.push(...batch.map(toEpisodeAddress));
        if (batch.length < PAGE_SIZE) break;
    }

    return episodes;
}

/**
 * Aired-order episode list for a series. One fetch serves every episode of that show,
 * in either direction. Returns an empty list when the series cannot be resolved.
 */
async function getEpisodes(imdbId) {
    const apiKey = getApiKey();
    if (!apiKey || !imdbId) {
        return [];
    }

    const cacheKey = `tvdb_episodes_${imdbId}`;
    const cached = cache.get(cacheKey);
    if (cached) {
        return cached;
    }

    try {
        const seriesId = await resolveSeriesId(imdbId, apiKey);

        if (!seriesId) {
            logger.warn(`[tvdb-api] No TVDB series found for IMDb ID: ${imdbId}`);
            cache.set(cacheKey, [], UNKNOWN_SERIES_TTL, { type: 'tvdb-episodes' });
            return [];
        }

        const episodes = await fetchEpisodes(seriesId, apiKey);
        logger.info(`[tvdb-api] Found TVDB ID: ${seriesId} for IMDb ID: ${imdbId} (${episodes.length} episodes)`);

        cache.set(cacheKey, episodes, EPISODES_TTL, { type: 'tvdb-episodes' });
        return episodes;
    } catch (error) {
        // Deliberately not cached: a transient outage must not disable mapping for the whole TTL.
        logger.error(`[tvdb-api] Failed to load episodes for ${imdbId}: ${error.message}`);
        return [];
    }
}

/**
 * Season and episode to the absolute number.
 * @returns {Promise<{season: number, episode: number, absoluteEpisode: number|null, title: string|null}|null>}
 */
export async function getEpisodeMapping(imdbId, season, episode) {
    const wantedSeason = Number(season);
    const wantedEpisode = Number(episode);

    if (!Number.isInteger(wantedSeason) || !Number.isInteger(wantedEpisode)) {
        return null;
    }

    const episodes = await getEpisodes(imdbId);
    const match = episodes.find(e => e.season === wantedSeason && e.episode === wantedEpisode);

    if (!match) {
        logger.warn(`[tvdb-api] No episode mapping found for ${imdbId} S${season}E${episode}`);
        return null;
    }

    // A fresh object per call: callers write their own fields onto the result.
    return { ...match };
}

/**
 * Absolute number back to its season and episode.
 * @returns {Promise<{season: number, episode: number, absoluteEpisode: number|null, title: string|null}|null>}
 */
export async function getEpisodeByAbsolute(imdbId, absoluteEpisode) {
    const wanted = Number(absoluteEpisode);

    if (!Number.isInteger(wanted) || wanted <= 0) {
        return null;
    }

    const episodes = await getEpisodes(imdbId);
    const match = episodes.find(e => e.absoluteEpisode === wanted);

    if (!match) {
        logger.warn(`[tvdb-api] Absolute episode ${wanted} not found for ${imdbId}`);
        return null;
    }

    return { ...match };
}

/** Episode count for a season, which tells an absolute number from that season's own episode. */
export async function getSeasonLength(imdbId, season) {
    const wanted = Number(season);
    const episodes = await getEpisodes(imdbId);

    return episodes.filter(episode => episode.season === wanted).length;
}

export function clearCache() {
    const entries = cache.getByPattern('^tvdb_');
    entries.forEach(entry => cache.delete(entry.key));
    logger.debug(`[tvdb-api] Cleared ${entries.length} cached entries`);
    return entries.length;
}
