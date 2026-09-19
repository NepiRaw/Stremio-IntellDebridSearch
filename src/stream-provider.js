/**
 * Provides movie and series streams
 */
import { coordinateSearch } from './search/coordinator.js';
import { filterYear, optimizedStreamCreation } from './stream/stream-builder.js';
import { sortStreamsByRank, deduplicateStreams } from './stream/quality-processor.js';
import { logger, setLogOutcome } from './utils/logger.js';

const stream = logger.for('STREAM');
import { ValidationError, BadRequestError } from './utils/error-handler.js';
import { getApiConfig } from './config/configuration.js';
import { createTracker } from './utils/perf-tracker.js';
import { attachParse, movieParseContext } from './parsing/parser.js';
import Cinemeta from './api/cinemeta.js';
import { getProvider, fetchTorrentDetails } from './providers/index.js';
import { isProviderError } from './providers/errors.js';
import { authErrorStreams } from './stream/error-stream.js';

import { getCacheRecorder } from './utils/cache-recorder.js';

const StreamHelpers = {
    performDeduplication(searchResults) {
        // Deduplicate by torrent ID first, then by name + size as fallback
        const seenTorrents = new Set();
        const seenFiles = new Set();
        let duplicateCount = 0;
        
        const deduplicatedResults = searchResults.filter(result => {
            // Primary deduplication: by torrent ID
            if (result.id && seenTorrents.has(result.id)) {
                duplicateCount++;
                return false;
            }
            
            // Secondary deduplication: by name + size (for torrents without IDs)
            const fileKey = `${result.name || 'unknown'}|${result.size || 0}`;
            if (seenFiles.has(fileKey)) {
                duplicateCount++;
                return false;
            }
            
            if (result.id) seenTorrents.add(result.id);
            seenFiles.add(fileKey);
            return true;
        });

        if (duplicateCount > 0) {
            stream.at('dedupe').debug('Duplicate torrents dropped', { input: searchResults.length, duplicates: duplicateCount, remaining: deduplicatedResults.length });
        }

        return deduplicatedResults;
    }
};

class StreamProvider {
    
    static async getMovieStreams(config, type, id) {
        const startTime = Date.now();
        const tracker = createTracker(id);

        try {
            if (!config || !type || !id) {
                throw new ValidationError('Missing required parameters', null, 'MISSING_PARAMS');
            }

            if (type !== 'movie') {
                throw new ValidationError(`Invalid content type: ${type}`, 'type', 'INVALID_TYPE');
            }

            if (!id.startsWith('tt')) {
                throw new ValidationError(`Invalid movie ID format: ${id}`, 'id', 'INVALID_ID');
            }

            if (!config.DebridProvider || !config.DebridApiKey) {
                setLogOutcome({ code: 'UNCONFIGURED' });
                return [];
            }

            const imdbId = id.startsWith('imdb:') ? id.replace('imdb:', '') : id;

            const cinemetaDetails = await tracker.span('meta', () => Cinemeta.getMeta(type, imdbId));
            if (!cinemetaDetails || !cinemetaDetails.name) {
                setLogOutcome({ degraded: true, failedAt: 'cinemeta.fetch', code: 'NO_METADATA' });
                return [];
            }

            const apiConfig = getApiConfig();
            
            const searchResponse = await coordinateSearch({
                apiKey: config.DebridApiKey,
                provider: config.DebridProvider,
                searchKey: cinemetaDetails.name,
                type: 'movie',
                imdbId,
                season: null,
                episode: null,
                threshold: 0.4,
                tmdbApiKey: apiConfig.tmdbApiKey,
                tvdbApiKey: apiConfig.tvdbApiKey,
                tracker
            });

            const searchResults = searchResponse?.results || searchResponse || [];
            const searchContext = searchResponse?.searchContext || null;


            const deduplicatedResults = StreamHelpers.performDeduplication(searchResults);

            if (!deduplicatedResults || deduplicatedResults.length === 0) {
                return [];
            }


            const streamData = [];
            let noVideo = 0;
            let yearRejected = 0;

            // The same corroboration the movie filter used, so what is displayed agrees with what
            // was kept: a film the filter recognised is not then titled as an episode.
            const parseContext = movieParseContext(cinemetaDetails.name);


            const bulkDetails = await tracker.span('fetch', () =>
                fetchTorrentDetails(config.DebridProvider, config.DebridApiKey, deduplicatedResults));

            for (const result of deduplicatedResults) {
                try {
                    const torrentDetails = attachParse(bulkDetails.get(result.id), parseContext);

                    if (!torrentDetails || !torrentDetails.videos || torrentDetails.videos.length === 0) {
                        noVideo++;
                        continue;
                    }

                    if (!filterYear(torrentDetails, cinemetaDetails)) {
                        yearRejected++;
                        continue;
                    }

                    streamData.push({
                        details: torrentDetails,
                        type: 'movie',
                        knownSeasonEpisode: null,
                        searchContext: searchContext
                    });
                } catch (error) {
                    stream.at('prepare').warn('Torrent unusable', { id: result.id, error: error.name });
                }
            }
            stream.at('prepare').debug('Torrents prepared', { input: deduplicatedResults.length, usable: streamData.length, noVideo, yearRejected });

            const streams = await tracker.span('build', () => streamData.flatMap(data => {
                try {
                    return optimizedStreamCreation(data.details, data.type, data.knownSeasonEpisode, data.searchContext);
                } catch (error) {
                    stream.at('build').warn('Stream build failed', { id: data.details?.id, error: error.name });
                    return [];
                }
            }).filter(Boolean));

            const deduplicatedStreams = deduplicateStreams(streams);

            const sortedStreams = sortStreamsByRank(deduplicatedStreams);
            tracker.note('streams', sortedStreams.length);


            // Record cache data
            try {
                const recorder = getCacheRecorder();
                recorder.recordStreamData({
                    imdbId,
                    season: null,
                    episode: null,
                    provider: config.DebridProvider,
                    torrents: streamData.map(sd => sd.details)
                });
            } catch (recErr) {
                logger.for('CACHE').at('record').debug('Recording skipped', { error: recErr.name });
            }

            return sortedStreams;

        } catch (error) {
            reportFailure('Movie search failed', { provider: config.DebridProvider, type, id, error, duration: Date.now() - startTime });

            // A rejected key is the one failure a user can act on, so it gets a row of its own.
            return authErrorStreams(error);
        } finally {
            setLogOutcome(tracker.funnel());
            tracker.report();
        }
    }

    static async getSeriesStreams(config, type, id) {
        const startTime = Date.now();
        const tracker = createTracker(id);

        try {
            if (!config || !type || !id) {
                throw new ValidationError('Missing required parameters', null, 'MISSING_PARAMS');
            }

            if (type !== 'series') {
                throw new ValidationError(`Invalid content type: ${type}`, 'type', 'INVALID_TYPE');
            }

            const idParts = id.split(':');
            if (idParts.length !== 3) {
                throw new ValidationError(`Invalid series ID format: ${id}`, 'id', 'INVALID_ID');
            }

            // An install without a configuration reaches here with an empty config object, which is
            // truthy. Answering empty is correct; letting it fall through raises deep in the search.
            if (!config.DebridProvider || !config.DebridApiKey) {
                setLogOutcome({ code: 'UNCONFIGURED' });
                return [];
            }

            const [imdbId, seasonStr, episodeStr] = idParts;
            const season = parseInt(seasonStr, 10);
            const episode = parseInt(episodeStr, 10);

            if (!imdbId.startsWith('tt')) {
                throw new ValidationError(`Invalid IMDB ID: ${imdbId}`, 'imdbId', 'INVALID_IMDB_ID');
            }

            if (isNaN(season) || season < 0) {
                throw new ValidationError(`Invalid season: ${seasonStr}`, 'season', 'INVALID_SEASON');
            }

            if (isNaN(episode) || episode < 0) {
                throw new ValidationError(`Invalid episode: ${episodeStr}`, 'episode', 'INVALID_EPISODE');
            }

            const cinemetaDetails = await tracker.span('meta', () => Cinemeta.getMeta(type, imdbId));
            if (!cinemetaDetails || !cinemetaDetails.name) {
                setLogOutcome({ degraded: true, failedAt: 'cinemeta.fetch', code: 'NO_METADATA' });
                return [];
            }

            const apiConfig = getApiConfig();

            const searchResponse = await coordinateSearch({
                apiKey: config.DebridApiKey,
                provider: config.DebridProvider,
                searchKey: cinemetaDetails.name,
                type: 'series',
                imdbId,
                season,
                episode,
                threshold: 0.3,
                tmdbApiKey: apiConfig.tmdbApiKey,
                tvdbApiKey: apiConfig.tvdbApiKey,
                tracker
            });

            const searchResults = searchResponse.results || [];
            const searchContext = searchResponse?.searchContext || null;

            const deduplicatedResults = StreamHelpers.performDeduplication(searchResults);

            if (!deduplicatedResults || deduplicatedResults.length === 0) {
                return [];
            }


            let streamTasks = [];
            const collectedTorrents = []; // Collect torrent details for cache recording


            const missing = deduplicatedResults.filter(result => !result.torrentDetails);
            const bulkDetails = missing.length
                ? await fetchTorrentDetails(config.DebridProvider, config.DebridApiKey, missing)
                : new Map();

            const streamPromises = deduplicatedResults.map(async (result) => {
                    try {
                        const torrentDetails = result.torrentDetails ?? attachParse(bulkDetails.get(result.id));

                        if (!torrentDetails || !torrentDetails.videos || torrentDetails.videos.length === 0) {
                            return null;
                        }

                        collectedTorrents.push(torrentDetails);

                        const knownSeasonEpisode = {
                            season,
                            episode,
                            absoluteEpisode: searchResponse.absoluteEpisode
                        };

                        const streamData = {
                            details: {
                                ...torrentDetails,
                                matchedTerm: result.matchedTerm
                            },
                            type: 'series',
                            knownSeasonEpisode,
                            searchContext: searchContext
                        };

                        return optimizedStreamCreation(streamData.details, streamData.type, streamData.knownSeasonEpisode, streamData.searchContext);

                    } catch (error) {
                        return null;
                    }
                });
                
            const allStreamResults = await tracker.span('build', () => Promise.all(streamPromises));
            streamTasks = allStreamResults.filter(result => result !== null).flat();

            const deduplicatedStreamTasks = deduplicateStreams(streamTasks);

            const sortedStreams = sortStreamsByRank(deduplicatedStreamTasks);
            tracker.note('streams', sortedStreams.length);


            // Fire-and-forget: record cache data
            try {
                const recorder = getCacheRecorder();
                recorder.recordStreamData({
                    imdbId,
                    season,
                    episode,
                    provider: config.DebridProvider,
                    torrents: collectedTorrents
                });
            } catch (recErr) {
                logger.for('CACHE').at('record').debug('Recording skipped', { error: recErr.name });
            }

            return sortedStreams;

        } catch (error) {
            reportFailure('Series search failed', { provider: config.DebridProvider, type, id, error, duration: Date.now() - startTime });

            // A rejected key is the one failure a user can act on, so it gets a row of its own.
            return authErrorStreams(error);
        } finally {
            setLogOutcome(tracker.funnel());
            tracker.report();
        }
    }

    /**
     * Resolves a debrid URL to the actual download link
     * @param {string} debridProvider - The debrid provider name
     * @param {string} debridApiKey - The API key for the provider
     * @param {string} itemId - The torrent/item ID
     * @param {string} hostUrl - The encoded host URL to unrestrict
     * @param {string} clientIp - The client IP address
     * @returns {Promise<string>} The direct download URL
     */
    static async resolveUrl(debridProvider, debridApiKey, itemId, hostUrl, clientIp) {
        // The route logs the failure with the request that caused it, so nothing is caught here.
        const provider = getProvider(debridProvider);
        if (!provider) throw new Error(`Unsupported debrid provider: ${debridProvider}`);

        // Clients rewrite this segment hunting for sidecar subtitles, and DebridLink redirects to
        // whatever it is handed, so a reference the provider could not have issued never gets sent.
        if (!provider.ownsLink(hostUrl, itemId, debridApiKey)) {
            throw new BadRequestError(`[${debridProvider}] resolveStream: the reference was not issued by this provider`, 'hostUrl');
        }

        const url = await provider.resolveStream(debridApiKey, { link: hostUrl, torrentId: itemId }, clientIp);
        return url;
    }
}

/** The one terminal line of a failed search: handled provider failures are WARN, the rest ERROR. */
function reportFailure(message, { provider, type, id, error, duration }) {
    const handled = isProviderError(error) || error instanceof ValidationError;
    const fields = { provider, type, id, failedAt: 'search', error: error.name, code: error.code ?? error.value, reason: handled ? error.message : undefined, duration: `${duration}ms` };
    if (handled) stream.at('complete').warn(message, fields);
    else stream.at('failed').error(message, fields);
    setLogOutcome({ terminal: true });
}

export default StreamProvider;