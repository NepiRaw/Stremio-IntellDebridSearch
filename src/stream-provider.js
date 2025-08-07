/**
 * Provides movie and series streams
 */
import { coordinateSearch } from './search/coordinator.js';
import { toStream, filterSeason, filterEpisode, filterYear } from './stream/stream-builder.js';
import { sortMovieStreamsByQuality, deduplicateStreams } from './stream/quality-processor.js';
import { batchExtractTechnicalDetails, parallelStreamFormatting } from './stream/performance-optimizer.js';
import { logger } from './utils/logger.js';
import { ValidationError } from './utils/error-handler.js';
import { getApiConfig } from './utils/configuration.js';
import Cinemeta from './api/cinemeta.js';
import AllDebrid from './providers/all-debrid.js';
import RealDebrid from './providers/real-debrid.js';
import DebridLink from './providers/debrid-link.js';
import Premiumize from './providers/premiumize.js';
import TorBox from './providers/torbox.js';
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

            const providers = { AllDebrid, RealDebrid, DebridLink, Premiumize, TorBox };
            
            const apiConfig = getApiConfig(config);
            
            const searchResponse = await coordinateSearch({
                apiKey: config.DebridApiKey,
                provider: config.DebridProvider,
                searchKey: cinemetaDetails.name,
                type: 'movie',
                imdbId,
                season: null,
                episode: null,
                threshold: 0.3,
                providers,
                tmdbApiKey: apiConfig.tmdbApiKey,
                traktApiKey: apiConfig.traktApiKey
            });

            const searchResults = searchResponse?.results || searchResponse || [];
            const searchContext = searchResponse?.searchContext || null;

            logger.debug(`[stream-provider] Search found ${searchResults?.length || 0} results for movie ${imdbId}`);

            const seenTorrentIds = new Set();
            const deduplicatedResults = searchResults.filter(result => {
                if (seenTorrentIds.has(result.id)) {
                    logger.debug(`[stream-provider] ⚡ Skipping duplicate torrent ID: ${result.id} (${result.name?.substring(0, 50)}...)`);
                    return false;
                }
                seenTorrentIds.add(result.id);
                return true;
            });

            if (deduplicatedResults.length !== searchResults.length) {
                logger.info(`[stream-provider] ⚡ Deduplicated ${searchResults.length} → ${deduplicatedResults.length} results (eliminated ${searchResults.length - deduplicatedResults.length} duplicate torrent IDs)`);
            }

            if (!deduplicatedResults || deduplicatedResults.length === 0) {
                logger.info(`[stream-provider] No streams found for movie ${imdbId}`);
                return [];
            }

            logger.debug(`[stream-provider] Starting parallel stream processing for ${deduplicatedResults.length} results`);
            const streamProcessingStart = Date.now();
            
            const streamData = [];
            for (const result of deduplicatedResults) {
                try {
                    const provider = providers[config.DebridProvider];
                    if (!provider || !provider.getTorrentDetails) {
                        logger.warn(`[stream-provider] Provider ${config.DebridProvider} doesn't have getTorrentDetails method`);
                        continue;
                    }

                    const torrentDetails = await provider.getTorrentDetails(config.DebridApiKey, result.id);
                    
                    if (!torrentDetails || !torrentDetails.videos || torrentDetails.videos.length === 0) {
                        logger.debug(`[stream-provider] No videos found in torrent ${result.id} (${result.name})`);
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

            const streams = await parallelStreamFormatting(streamData, 4);
            
            const streamProcessingEnd = Date.now();
            logger.debug(`[stream-provider] Stream processing completed in ${streamProcessingEnd - streamProcessingStart}ms`);

            const sortedStreams = sortMovieStreamsByQuality(streams);
            
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

            const providers = { AllDebrid, RealDebrid, DebridLink, Premiumize, TorBox };

            const apiConfig = getApiConfig(config);

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

            const seenTorrentIds = new Set();
            const deduplicatedResults = searchResults.filter(result => {
                if (seenTorrentIds.has(result.id)) {
                    logger.debug(`[stream-provider] ⚡ Skipping duplicate torrent ID: ${result.id} (${result.name?.substring(0, 50)}...)`);
                    return false;
                }
                seenTorrentIds.add(result.id);
                return true;
            });

            if (deduplicatedResults.length !== searchResults.length) {
                logger.info(`[stream-provider] ⚡ Deduplicated ${searchResults.length} → ${deduplicatedResults.length} results (eliminated ${searchResults.length - deduplicatedResults.length} duplicate torrent IDs)`);
            }

            const filterSeason = searchResponse.animeMapping ? searchResponse.mappedSeason : season;
            const targetEpisode = searchResponse.animeMapping ? searchResponse.mappedEpisode : episode;
            
            if (searchResponse.animeMapping) {
                logger.info(`[stream-provider] Using anime mapping: S${season}E${episode} → S${filterSeason}E${targetEpisode}`);
            }

            if (!deduplicatedResults || deduplicatedResults.length === 0) {
                logger.info(`[stream-provider] No streams found for series ${imdbId} S${season}E${episode}`);
                return [];
            }

            logger.debug(`[stream-provider] Starting parallel stream processing for ${deduplicatedResults.length} series results`);
            const streamProcessingStart = Date.now();
            
            const streamData = [];
            for (const result of deduplicatedResults) {
                try {
                    const provider = providers[config.DebridProvider];
                    if (!provider || !provider.getTorrentDetails) {
                        logger.warn(`[stream-provider] Provider ${config.DebridProvider} doesn't have getTorrentDetails method`);
                        continue;
                    }

                    const torrentDetails = await provider.getTorrentDetails(config.DebridApiKey, result.id);
                    
                    if (!torrentDetails || !torrentDetails.videos || torrentDetails.videos.length === 0) {
                        logger.debug(`[stream-provider] No videos found in torrent ${result.id} (${result.name})`);
                        continue;
                    }
                    const absoluteEpisodeNumber = searchResponse.absoluteEpisode && typeof searchResponse.absoluteEpisode === 'object' 
                        ? searchResponse.absoluteEpisode.absoluteEpisode 
                        : searchResponse.absoluteEpisode;
                    const episodeFilterSuccess = filterEpisode(torrentDetails, filterSeason, targetEpisode, absoluteEpisodeNumber);
                    if (!episodeFilterSuccess || !torrentDetails.videos || torrentDetails.videos.length === 0) {
                        logger.debug(`[stream-provider] No matching episodes found in torrent ${result.id} for S${filterSeason}E${targetEpisode}${searchResponse.animeMapping ? ` (mapped from S${season}E${episode})` : ''}`);
                        continue;
                    }

                    const knownSeasonEpisode = {
                        season,
                        episode,
                        absoluteEpisode: searchResponse.absoluteEpisode
                    };

                    streamData.push({
                        details: torrentDetails,
                        type: 'series',
                        knownSeasonEpisode,
                        variantInfo: result.variantInfo,
                        searchContext: searchContext,
                        animeMapping: searchResponse.animeMapping
                    });
                } catch (error) {
                    logger.warn(`[stream-provider] Failed to prepare stream data: ${error.message}`);
                }
            }

            let streams = await parallelStreamFormatting(streamData, 4);
            
            if (searchResponse.animeMapping) {
                streams = streams.map(stream => {
                    if (stream && stream.url) {
                        const mapping = searchResponse.animeMapping;
                        stream.name = `${stream.name}\n🎌 Anime S${mapping.originalSeason}E${mapping.originalEpisode}→S${mapping.mappedSeason}E${mapping.mappedEpisode}`;
                    }
                    return stream;
                });
            }
            
            const streamProcessingEnd = Date.now();
            logger.debug(`[stream-provider] Stream processing completed in ${streamProcessingEnd - streamProcessingStart}ms`);

            const deduplicatedStreams = deduplicateStreams(streams);
            const sortedStreams = sortMovieStreamsByQuality(deduplicatedStreams);
            
            const duration = Date.now() - startTime;
            logger.info(`[stream-provider] Series search completed in ${duration}ms. Found ${sortedStreams.length} streams for ${imdbId} S${season}E${episode}`);

            return sortedStreams;

        } catch (error) {
            const duration = Date.now() - startTime;
            logger.error(`[stream-provider] Series search failed in ${duration}ms for ${id}:`, error);
            
            return [];
        }
    }
}

export default StreamProvider;
