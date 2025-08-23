/**
 * Provides movie and series streams
 */
import { coordinateSearch } from './search/coordinator.js';
import { filterEpisode, filterYear } from './stream/stream-builder.js';
import { sortMovieStreamsByQuality, deduplicateStreams } from './stream/quality-processor.js';
import { sequentialStreamFormatting } from './stream/performance-optimizer.js';
import { logger } from './utils/logger.js';
import { ValidationError } from './utils/error-handler.js';
import { getApiConfig } from './config/configuration.js';
import Cinemeta from './api/cinemeta.js';
import { AllDebridProvider } from './providers/all-debrid.js';
import { RealDebridProvider } from './providers/real-debrid.js';
import { DebridLinkProvider } from './providers/debrid-link.js';
import { TorBoxProvider } from './providers/torbox.js';
import { PremiumizeProvider } from './providers/premiumize.js';

// Create provider instances once to avoid duplicate initialization logging
const sharedProviders = { 
    // Migrated to clean class architecture (tested with API keys)
    AllDebrid: new AllDebridProvider(), 
    RealDebrid: new RealDebridProvider(), 
    DebridLink: new DebridLinkProvider(),
    TorBox: new TorBoxProvider(),
    Premiumize: PremiumizeProvider  // Now using standard provider instance
};

const StreamHelpers = {
    logBulkProcessing(provider, torrentCount, contentType) {
        if (provider.bulkGetTorrentDetails) {
            logger.info(`[stream-provider] 🚀 Using BULK OPTIMIZATION for ${torrentCount} ${contentType} torrents`);
        } else {
            logger.info(`[stream-provider] ⚠️ Using INDIVIDUAL CALLS for ${torrentCount} ${contentType} torrents (no bulk support)`);
        }
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

            const imdbId = id.startsWith('imdb:') ? id.replace('imdb:', '') : id;
            
            const cinemetaDetails = await Cinemeta.getMeta(type, imdbId);
            if (!cinemetaDetails || !cinemetaDetails.name) {
                logger.warn(`[stream-provider] No metadata found for ${imdbId}`);
                return [];
            }

            const providers = sharedProviders;
            
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
                providers,
                tmdbApiKey: apiConfig.tmdbApiKey,
                traktApiKey: apiConfig.traktApiKey
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
            const streamProcessingStart = Date.now();
            
            const provider = providers[config.DebridProvider];
            if (!provider || !provider.getTorrentDetails) {
                logger.warn(`[stream-provider] Provider ${config.DebridProvider} doesn't have getTorrentDetails method`);
                return [];
            }

            const streamData = [];

            StreamHelpers.logBulkProcessing(provider, deduplicatedResults.length, 'movie');

            if (provider.bulkGetTorrentDetails) {
                
                const torrentIds = deduplicatedResults.map(result => result.id);
                const bulkDetails = await provider.bulkGetTorrentDetails(config.DebridApiKey, torrentIds);
                
                for (const result of deduplicatedResults) {
                    try {
                        const torrentDetails = bulkDetails.get(result.id);
                        
                        if (!torrentDetails || !torrentDetails.videos || torrentDetails.videos.length === 0) {
                            logger.debug(`[stream-provider] No videos found in torrent ${result.id} (${result.name})`);
                            continue;
                        }

                        if (!filterYear(torrentDetails, cinemetaDetails)) {
                            const torrentYear = torrentDetails?.info?.year;
                            const movieYear = cinemetaDetails?.year;
                            logger.debug(`[stream-provider] 📅 Year filter rejected torrent: ${result.name?.substring(0, 50)}... (torrent year: ${torrentYear}, movie year: ${movieYear})`);
                            continue;
                        }

                        streamData.push({
                            details: torrentDetails,
                            type: 'movie',
                            knownSeasonEpisode: null,
                            variantInfo: result.variantInfo,
                            searchContext: searchContext
                        });
                    } catch (error) {
                        logger.warn(`[stream-provider] Failed to prepare stream data: ${error.message}`);
                    }
                }
            } else {
                
                for (const result of deduplicatedResults) {
                    try {
                        const torrentDetails = await provider.getTorrentDetails(config.DebridApiKey, result.id, 'stream');
                        
                        if (!torrentDetails || !torrentDetails.videos || torrentDetails.videos.length === 0) {
                            logger.debug(`[stream-provider] No videos found in torrent ${result.id} (${result.name})`);
                            continue;
                        }

                        if (!filterYear(torrentDetails, cinemetaDetails)) {
                            const torrentYear = torrentDetails?.info?.year;
                            const movieYear = cinemetaDetails?.year;
                            logger.debug(`[stream-provider] 📅 Year filter rejected torrent: ${result.name?.substring(0, 50)}... (torrent year: ${torrentYear}, movie year: ${movieYear})`);
                            continue;
                        }

                        streamData.push({
                            details: torrentDetails,
                            type: 'movie',
                            knownSeasonEpisode: null,
                            variantInfo: result.variantInfo,
                            searchContext: searchContext
                        });
                    } catch (error) {
                        logger.warn(`[stream-provider] Failed to prepare stream data: ${error.message}`);
                    }
                }
            }

            const streams = await sequentialStreamFormatting(streamData);
            
            const streamProcessingEnd = Date.now();
            logger.debug(`[stream-provider] Stream processing completed in ${streamProcessingEnd - streamProcessingStart}ms`);

            logger.debug(`[stream-provider] Applying stream-level deduplication to ${streams.length} streams`);
            const deduplicatedStreams = deduplicateStreams(streams);

            const sortedStreams = sortMovieStreamsByQuality(deduplicatedStreams);
            
            const duration = Date.now() - startTime;
            logger.info(`[stream-provider] Movie search completed in ${duration}ms. Found ${sortedStreams.length} streams for ${imdbId}`);

            return sortedStreams;

        } catch (error) {
            const duration = Date.now() - startTime;
            logger.error(`[stream-provider] Movie search failed in ${duration}ms for ${id}:`, error);
            
            return [];
        }
    }

    static async getSeriesStreams(config, type, id) {
        const startTime = Date.now();
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

            const cinemetaDetails = await Cinemeta.getMeta(type, imdbId);
            if (!cinemetaDetails || !cinemetaDetails.name) {
                logger.warn(`[stream-provider] No metadata found for ${imdbId}`);
                return [];
            }

            const providers = sharedProviders;

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
                providers,
                tmdbApiKey: apiConfig.tmdbApiKey,
                traktApiKey: apiConfig.traktApiKey
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

            const filterSeason = searchResponse.animeMapping ? searchResponse.mappedSeason : season;
            const targetEpisode = searchResponse.animeMapping ? searchResponse.mappedEpisode : episode;
            
            if (searchResponse.animeMapping) {
                logger.info(`[stream-provider] Using anime mapping: S${season}E${episode} → S${filterSeason}E${targetEpisode}`);
            }

            if (!deduplicatedResults || deduplicatedResults.length === 0) {
                logger.info(`[stream-provider] No streams found for series ${imdbId} S${season}E${episode}`);
                return [];
            }

            logger.debug(`[stream-provider] Starting controlled concurrent stream processing for ${deduplicatedResults.length} series results`);
            const streamProcessingStart = Date.now();
            
            // Use controlled concurrency to prevent debrid API overwhelm
            // Limit concurrent debrid API calls to prevent rate limiting issues
            const { executeWithControlledConcurrency } = await import('./utils/debrid-processor.js');
            
            const provider = providers[config.DebridProvider];
            if (!provider || !provider.getTorrentDetails) {
                logger.warn(`[stream-provider] Provider ${config.DebridProvider} doesn't have getTorrentDetails method`);
                return [];
            }

            let streamTasks = [];

            StreamHelpers.logBulkProcessing(provider, deduplicatedResults.length, 'series');

            if (provider.bulkGetTorrentDetails) {
                
                const torrentIds = deduplicatedResults.map(result => result.id);
                const bulkDetails = await provider.bulkGetTorrentDetails(config.DebridApiKey, torrentIds);
                
                const streamPromises = deduplicatedResults.map(async (result) => {
                    try {
                        const torrentDetails = bulkDetails.get(result.id);
                        
                        if (!torrentDetails || !torrentDetails.videos || torrentDetails.videos.length === 0) {
                            return null;
                        }

                        const episodeFilterSuccess = filterEpisode(torrentDetails, filterSeason, targetEpisode);
                        if (!episodeFilterSuccess || !torrentDetails.videos || torrentDetails.videos.length === 0) {
                            return null;
                        }

                        const knownSeasonEpisode = {
                            season: searchResponse.animeMapping ? filterSeason : season,
                            episode: searchResponse.animeMapping ? targetEpisode : episode,
                            absoluteEpisode: searchResponse.absoluteEpisode
                        };

                        const streamData = {
                            details: {
                                ...torrentDetails,
                                matchedTerm: result.matchedTerm
                            },
                            type: 'series',
                            knownSeasonEpisode,
                            variantInfo: result.variantInfo,
                            searchContext: searchContext,
                            animeMapping: searchResponse.animeMapping
                        };

                        const { optimizedStreamCreation } = await import('./stream/stream-builder.js');
                        const streams = optimizedStreamCreation(streamData.details, streamData.type, null, streamData.knownSeasonEpisode, streamData.variantInfo, streamData.searchContext);
                        
                        if (searchResponse.animeMapping && streams && streams.length > 0) {
                            const mapping = searchResponse.animeMapping;
                            streams.forEach(stream => {
                                if (stream && stream.url) {
                                    stream.name = `${stream.name}\n🎌 Anime S${mapping.originalSeason}E${mapping.originalEpisode}→S${mapping.mappedSeason}E${mapping.mappedEpisode}`;
                                }
                            });
                        }

                        return streams;

                    } catch (error) {
                        return null;
                    }
                });
                
                const allStreamResults = await Promise.all(streamPromises);
                streamTasks = allStreamResults.filter(result => result !== null).flat();
            } else {
                streamTasks = deduplicatedResults.map(result => async () => {
                    try {
                        const torrentDetails = await provider.getTorrentDetails(config.DebridApiKey, result.id, 'stream');
                        
                        if (!torrentDetails || !torrentDetails.videos || torrentDetails.videos.length === 0) {
                            logger.debug(`[stream-provider] No videos found in torrent ${result.id} (${result.name})`);
                            return null;
                        }

                        const episodeFilterSuccess = filterEpisode(torrentDetails, filterSeason, targetEpisode);
                        if (!episodeFilterSuccess || !torrentDetails.videos || torrentDetails.videos.length === 0) {
                            logger.debug(`[stream-provider] No matching episodes found in torrent ${result.id} for S${filterSeason}E${targetEpisode}${searchResponse.animeMapping ? ` (mapped from S${season}E${episode})` : ''}`);
                            return null;
                        }

                        // Use mapped values for knownSeasonEpisode when anime mapping is active
                        const knownSeasonEpisode = {
                            season: searchResponse.animeMapping ? filterSeason : season,
                            episode: searchResponse.animeMapping ? targetEpisode : episode,
                            absoluteEpisode: searchResponse.absoluteEpisode
                        };

                        const streamData = {
                            details: {
                                ...torrentDetails,
                                matchedTerm: result.matchedTerm // Preserve the matched term from search
                            },
                            type: 'series',
                            knownSeasonEpisode,
                            variantInfo: result.variantInfo,
                            searchContext: searchContext,
                            animeMapping: searchResponse.animeMapping
                        };

                        const { optimizedStreamCreation } = await import('./stream/stream-builder.js');
                        const streams = optimizedStreamCreation(streamData.details, streamData.type, null, streamData.knownSeasonEpisode, streamData.variantInfo, streamData.searchContext);
                        
                        // Add anime mapping annotation if applicable
                        if (searchResponse.animeMapping && streams && streams.length > 0) {
                            const mapping = searchResponse.animeMapping;
                            streams.forEach(stream => {
                                if (stream && stream.url) {
                                    stream.name = `${stream.name}\n🎌 Anime S${mapping.originalSeason}E${mapping.originalEpisode}→S${mapping.mappedSeason}E${mapping.mappedEpisode}`;
                                }
                            });
                        }

                        return streams; // Return array of streams instead of single stream

                    } catch (error) {
                        logger.warn(`[stream-provider] Failed to build stream for ${result.id}: ${error.message}`);
                        return null;
                    }
                });
                
                const concurrencyLimit = config.ConcurrencyLimit || 6;
                logger.info(`[stream-provider] Processing ${streamTasks.length} streams with max ${concurrencyLimit} concurrent individual operations`);
                
                const streamResults = await executeWithControlledConcurrency(streamTasks, concurrencyLimit);
                
                streamTasks = streamResults
                    .filter(result => result.status === 'fulfilled' && result.value !== null)
                    .map(result => result.value)
                    .flat();
            }
            
            const streamProcessingEnd = Date.now();
            logger.debug(`[stream-provider] Stream processing completed in ${streamProcessingEnd - streamProcessingStart}ms`);

            logger.debug(`[stream-provider] Applying stream-level deduplication to ${streamTasks.length} streams`);
            const deduplicatedStreamTasks = deduplicateStreams(streamTasks);

            const sortedStreams = sortMovieStreamsByQuality(deduplicatedStreamTasks);
            
            const duration = Date.now() - startTime;
            logger.info(`[stream-provider] Series search completed in ${duration}ms. Found ${sortedStreams.length} streams for ${imdbId} S${season}E${episode}`);

            const { formatStreamsForDisplay } = await import('./stream/stream-builder.js');
            const formattedOutput = formatStreamsForDisplay(sortedStreams);
            return sortedStreams;

        } catch (error) {
            const duration = Date.now() - startTime;
            logger.error(`[stream-provider] Series search failed in ${duration}ms for ${id}:`, error);
            
            return [];
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
            let unrestricted;
            
            switch (debridProvider) {
                case 'AllDebrid':
                    unrestricted = await sharedProviders.AllDebrid.unrestrictUrl(debridApiKey, hostUrl);
                    break;
                case 'RealDebrid':
                    unrestricted = await sharedProviders.RealDebrid.unrestrictUrl(debridApiKey, hostUrl, clientIp);
                    break;
                case 'DebridLink':
                case 'Premiumize':
                    // These providers return direct URLs, no unrestricting needed
                    unrestricted = hostUrl;
                    break;
                case 'TorBox':
                    unrestricted = await sharedProviders.TorBox.unrestrictUrl(debridApiKey, itemId, hostUrl, clientIp);
                    break;
                default:
                    throw new Error(`Unsupported debrid provider: ${debridProvider}`);
            }
            
            logger.info(`[stream-provider] Successfully resolved URL for ${debridProvider}`);
            return unrestricted;
        } catch (error) {
            logger.error(`[stream-provider] Failed to resolve URL for ${debridProvider}:`, error);
            throw error;
        }
    }
}

export default StreamProvider;