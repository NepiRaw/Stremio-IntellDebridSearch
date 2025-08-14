/**
 * Provides movie and series streams
 */
import { coordinateSearch } from './search/coordinator.js';
import { filterEpisode } from './stream/stream-builder.js';
import { sortMovieStreamsByQuality } from './stream/quality-processor.js';
import { sequentialStreamFormatting } from './stream/performance-optimizer.js';
import { logger } from './utils/logger.js';
import { ValidationError } from './utils/error-handler.js';
import { getApiConfig } from './config/configuration.js';
import Cinemeta from './api/cinemeta.js';
import { AllDebridProvider } from './providers/all-debrid.js';
import { RealDebridProvider } from './providers/real-debrid.js';
// TODO: Migrate to class imports when these providers are confirmed working with API keys
import DebridLink from './providers/debrid-link.js';
import Premiumize from './providers/premiumize.js';
import TorBox from './providers/torbox.js';

// Create provider instances once to avoid duplicate initialization logging
const sharedProviders = { 
    // Migrated to clean class architecture (tested with API keys)
    AllDebrid: new AllDebridProvider(), 
    RealDebrid: new RealDebridProvider(), 
    // TODO: Migrate these to class instances when API testing is available
    DebridLink: DebridLink,  // Using legacy export pattern
    Premiumize: Premiumize,  // Using legacy export pattern
    TorBox: TorBox           // Using legacy export pattern
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

            // Deduplicate by exact name + size (allow multiple files from same torrent)
            const seenFiles = new Set();
            const deduplicatedResults = searchResults.filter(result => {
                const fileKey = `${result.name || 'unknown'}|${result.size || 0}`;
                if (seenFiles.has(fileKey)) {
                    logger.debug(`[stream-provider] ⚡ Skipping duplicate file: ${result.name?.substring(0, 50)}... (${result.size} bytes)`);
                    return false;
                }
                seenFiles.add(fileKey);
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

            const streams = await sequentialStreamFormatting(streamData);
            
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

            // Deduplicate by torrent ID first, then by name + size (prevent duplicate torrent processing)
            const seenTorrents = new Set();
            const seenFiles = new Set();
            const deduplicatedResults = searchResults.filter(result => {
                const torrentId = result.id;
                const fileKey = `${result.name || 'unknown'}|${result.size || 0}`;
                
                // First check if we've already processed this exact torrent
                if (seenTorrents.has(torrentId)) {
                    logger.debug(`[stream-provider] ⚡ Skipping duplicate torrent: ${torrentId} (${result.name?.substring(0, 50)}...)`);
                    return false;
                }
                
                // Then check for duplicate files (different torrents with same content)
                if (seenFiles.has(fileKey)) {
                    logger.debug(`[stream-provider] ⚡ Skipping duplicate file: ${result.name?.substring(0, 50)}... (${result.size} bytes)`);
                    return false;
                }
                
                seenTorrents.add(torrentId);
                seenFiles.add(fileKey);
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

            const streamTasks = deduplicatedResults.map(result => async () => {
                try {
                    const torrentDetails = await provider.getTorrentDetails(config.DebridApiKey, result.id);
                    
                    if (!torrentDetails || !torrentDetails.videos || torrentDetails.videos.length === 0) {
                        logger.debug(`[stream-provider] No videos found in torrent ${result.id} (${result.name})`);
                        return null;
                    }

                    const episodeFilterSuccess = filterEpisode(torrentDetails, filterSeason, targetEpisode);
                    if (!episodeFilterSuccess || !torrentDetails.videos || torrentDetails.videos.length === 0) {
                        logger.debug(`[stream-provider] No matching episodes found in torrent ${result.id} for S${filterSeason}E${targetEpisode}${searchResponse.animeMapping ? ` (mapped from S${season}E${episode})` : ''}`);
                        return null;
                    }

                    const knownSeasonEpisode = {
                        season,
                        episode,
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
            logger.info(`[stream-provider] Processing ${streamTasks.length} streams with max ${concurrencyLimit} concurrent debrid API calls`);
            
            const streamResults = await executeWithControlledConcurrency(streamTasks, concurrencyLimit);
            
            const streams = streamResults
                .filter(result => result.status === 'fulfilled' && result.value !== null)
                .map(result => result.value)
                .flat();

            const failedCount = streamResults.length - streams.length;
            if (failedCount > 0) {
                logger.info(`[stream-provider] Controlled concurrency processing complete: ${streams.length} streams built, ${failedCount} failed`);
            } else {
                logger.info(`[stream-provider] Controlled concurrency processing complete: ${streams.length} streams built successfully`);
            }
            
            const streamProcessingEnd = Date.now();
            logger.debug(`[stream-provider] Stream processing completed in ${streamProcessingEnd - streamProcessingStart}ms`);

            const sortedStreams = sortMovieStreamsByQuality(streams);
            
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
}

export default StreamProvider;