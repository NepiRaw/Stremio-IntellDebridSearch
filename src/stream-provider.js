/**
 * Provides movie and series streams
 */
import { coordinateSearch } from './search/coordinator.js';
import { filterYear, optimizedStreamCreation } from './stream/stream-builder.js';
import { sortStreamsByRank, deduplicateStreams } from './stream/quality-processor.js';
import { logger } from './utils/logger.js';
import { ValidationError } from './utils/error-handler.js';
import { getApiConfig } from './config/configuration.js';
import { createTracker } from './utils/perf-tracker.js';
import { attachParse, movieParseContext } from './parsing/parser.js';
import Cinemeta from './api/cinemeta.js';
import { getProvider, fetchTorrentDetails } from './providers/index.js';
import { authErrorStreams } from './stream/error-stream.js';

import { getCacheRecorder } from './utils/cache-recorder.js';

const StreamHelpers = {
    logBulkProcessing(torrentCount, contentType) {
        logger.info(`[stream-provider] 🚀 Bulk fetching ${torrentCount} ${contentType} torrents`);
    },

    performDeduplication(searchResults, contentType) {
        // Deduplicate by torrent ID first, then by name + size as fallback
        const seenTorrents = new Set();
        const seenFiles = new Set();
        let duplicateCount = 0;
        
        const deduplicatedResults = searchResults.filter(result => {
            // Primary deduplication: by torrent ID
            if (result.id && seenTorrents.has(result.id)) {
                logger.info(`[stream-provider] 🔄 Filtered duplicate torrent: ${result.name} (ID: ${result.id}) - same torrent ID`);
                duplicateCount++;
                return false;
            }
            
            // Secondary deduplication: by name + size (for torrents without IDs)
            const fileKey = `${result.name || 'unknown'}|${result.size || 0}`;
            if (seenFiles.has(fileKey)) {
                logger.info(`[stream-provider] 🔄 Filtered duplicate file: ${result.name} (${result.size} bytes) - same name+size`);
                duplicateCount++;
                return false;
            }
            
            if (result.id) seenTorrents.add(result.id);
            seenFiles.add(fileKey);
            return true;
        });

        if (deduplicatedResults.length !== searchResults.length) {
            logger.info(`[stream-provider] 📊 Deduplication: ${searchResults.length} → ${deduplicatedResults.length} results (filtered ${duplicateCount} duplicates)`);
        }

        return deduplicatedResults;
    }
};

class StreamProvider {
    
    static async getMovieStreams(config, type, id) {
        const startTime = Date.now();
        const tracker = createTracker(id);
        logger.info(`[stream-provider] Starting movie stream search for ${id}`);

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
                logger.debug(`[stream-provider] No debrid configuration for ${id}, returning no streams`);
                return [];
            }

            const imdbId = id.startsWith('imdb:') ? id.replace('imdb:', '') : id;

            const cinemetaDetails = await tracker.span('meta', () => Cinemeta.getMeta(type, imdbId));
            if (!cinemetaDetails || !cinemetaDetails.name) {
                logger.warn(`[stream-provider] No metadata found for ${imdbId}`);
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

            logger.debug(`[stream-provider] Search found ${searchResults?.length || 0} results for movie ${imdbId}`);

            const deduplicatedResults = StreamHelpers.performDeduplication(searchResults, 'movie');

            if (!deduplicatedResults || deduplicatedResults.length === 0) {
                logger.info(`[stream-provider] No streams found for movie ${imdbId}`);
                return [];
            }

            logger.debug(`[stream-provider] Starting parallel stream processing for ${deduplicatedResults.length} results`);

            const streamData = [];

            // The same corroboration the movie filter used, so what is displayed agrees with what
            // was kept: a film the filter recognised is not then titled as an episode.
            const parseContext = movieParseContext(cinemetaDetails.name);

            StreamHelpers.logBulkProcessing(deduplicatedResults.length, 'movie');

            const bulkDetails = await tracker.span('fetch', () =>
                fetchTorrentDetails(config.DebridProvider, config.DebridApiKey, deduplicatedResults));

            for (const result of deduplicatedResults) {
                try {
                    const torrentDetails = attachParse(bulkDetails.get(result.id), parseContext);

                    if (!torrentDetails || !torrentDetails.videos || torrentDetails.videos.length === 0) {
                        logger.debug(`[stream-provider] No videos found in torrent ${result.id} (${result.name})`);
                        continue;
                    }

                    if (!filterYear(torrentDetails, cinemetaDetails)) {
                        const torrentYear = torrentDetails?.parsed?.year;
                        const movieYear = cinemetaDetails?.year;
                        logger.debug(`[stream-provider] 📅 Year filter rejected torrent: ${result.name?.substring(0, 50)}... (torrent year: ${torrentYear}, movie year: ${movieYear})`);
                        continue;
                    }

                    streamData.push({
                        details: torrentDetails,
                        type: 'movie',
                        knownSeasonEpisode: null,
                        searchContext: searchContext
                    });
                } catch (error) {
                    logger.warn(`[stream-provider] Failed to prepare stream data: ${error.message}`);
                }
            }

            const streams = await tracker.span('build', () => streamData.flatMap(data => {
                try {
                    return optimizedStreamCreation(data.details, data.type, data.knownSeasonEpisode, data.searchContext);
                } catch (error) {
                    logger.warn(`[stream-provider] Failed to build streams for ${data.details?.name}: ${error.message}`);
                    return [];
                }
            }).filter(Boolean));

            logger.debug(`[stream-provider] Applying stream-level deduplication to ${streams.length} streams`);
            const deduplicatedStreams = deduplicateStreams(streams);

            const sortedStreams = sortStreamsByRank(deduplicatedStreams);
            tracker.note('streams', sortedStreams.length);

            const duration = Date.now() - startTime;
            logger.info(`[stream-provider] Movie search completed in ${duration}ms. Found ${sortedStreams.length} streams for ${imdbId}`);

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
                logger.debug(`[stream-provider] Cache recording skipped: ${recErr.message}`);
            }

            return sortedStreams;

        } catch (error) {
            const duration = Date.now() - startTime;
            logger.error(`[stream-provider] Movie search failed in ${duration}ms for ${id}: ${error.name}: ${error.message}`);

            // A rejected key is the one failure a user can act on, so it gets a row of its own.
            return authErrorStreams(error);
        } finally {
            logger.debug(`[perf] ${tracker.summary()}`);
        }
    }

    static async getSeriesStreams(config, type, id) {
        const startTime = Date.now();
        const tracker = createTracker(id);
        logger.info(`[stream-provider] Starting series stream search for ${id}`);

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
                logger.debug(`[stream-provider] No debrid configuration for ${id}, returning no streams`);
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
                logger.warn(`[stream-provider] No metadata found for ${imdbId}`);
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

            logger.debug(`[stream-provider] Search found ${searchResults.length} results for series ${imdbId} S${season}E${episode}`);
            
            // Check for duplicate torrent IDs in search results
            const torrentIdCounts = {};
            searchResults.forEach(result => {
                const id = result.id;
                torrentIdCounts[id] = (torrentIdCounts[id] || 0) + 1;
            });
            
            const duplicateIds = Object.entries(torrentIdCounts).filter(([id, count]) => count > 1);
            if (duplicateIds.length > 0) {
                logger.warn(`[stream-provider] 🔍 Found duplicate torrents in search results:`);
                duplicateIds.forEach(([id, count]) => {
                    logger.warn(`[stream-provider] 🔍 Torrent ${id}: appears ${count} times`);
                });
            }

            const deduplicatedResults = StreamHelpers.performDeduplication(searchResults, 'series');

            if (!deduplicatedResults || deduplicatedResults.length === 0) {
                logger.info(`[stream-provider] No streams found for series ${imdbId} S${season}E${episode}`);
                return [];
            }

            logger.debug(`[stream-provider] Starting controlled concurrent stream processing for ${deduplicatedResults.length} series results`);

            let streamTasks = [];
            const collectedTorrents = []; // Collect torrent details for cache recording

            StreamHelpers.logBulkProcessing(deduplicatedResults.length, 'series');

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

            logger.debug(`[stream-provider] Applying stream-level deduplication to ${streamTasks.length} streams`);
            const deduplicatedStreamTasks = deduplicateStreams(streamTasks);

            const sortedStreams = sortStreamsByRank(deduplicatedStreamTasks);
            tracker.note('streams', sortedStreams.length);

            const duration = Date.now() - startTime;
            logger.info(`[stream-provider] Series search completed in ${duration}ms. Found ${sortedStreams.length} streams for ${imdbId} S${season}E${episode}`);

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
                logger.debug(`[stream-provider] Cache recording skipped: ${recErr.message}`);
            }

            const { formatStreamsForDisplay } = await import('./stream/stream-builder.js');
            const formattedOutput = formatStreamsForDisplay(sortedStreams);
            return sortedStreams;

        } catch (error) {
            const duration = Date.now() - startTime;
            logger.error(`[stream-provider] Series search failed in ${duration}ms for ${id}: ${error.name}: ${error.message}`);

            // A rejected key is the one failure a user can act on, so it gets a row of its own.
            return authErrorStreams(error);
        } finally {
            logger.debug(`[perf] ${tracker.summary()}`);
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
        logger.info(`[stream-provider] Resolving URL for ${debridProvider}: ${hostUrl}`);
        
        try {
            const provider = getProvider(debridProvider);
            if (!provider) throw new Error(`Unsupported debrid provider: ${debridProvider}`);

            const url = await provider.resolveStream(debridApiKey, { link: hostUrl, torrentId: itemId }, clientIp);
            logger.info(`[stream-provider] Successfully resolved URL for ${debridProvider}`);
            return url;
        } catch (error) {
            logger.error(`[stream-provider] Failed to resolve URL for ${debridProvider}:`, error);
            throw error;
        }
    }
}

export default StreamProvider;