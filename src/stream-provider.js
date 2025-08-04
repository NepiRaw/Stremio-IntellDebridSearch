/**
 * Stream Provider - New modular implementation
 * Provides movie and series streams using the refactored modular architecture
 * Replaces the monolithic 1362-line legacy stream-provider.js
 */

import { coordinateSearch } from './search/coordinator.js';
import { toStream, filterSeason, filterEpisode, filterYear } from './stream/stream-builder.js';
import { sortMovieStreamsByQuality, deduplicateStreams } from './stream/quality-processor.js';
import { logger } from './utils/logger.js';
import { ValidationError } from './utils/error-handler.js';
import Cinemeta from './api/cinemeta.js';
import AllDebrid from './providers/all-debrid.js';
import RealDebrid from './providers/real-debrid.js';
import DebridLink from './providers/debrid-link.js';
import Premiumize from './providers/premiumize.js';
import TorBox from './providers/torbox.js';

/**
 * StreamProvider class - Main interface for stream retrieval
 * Maintains the same API as the legacy version for backward compatibility
 */
class StreamProvider {
    /**
     * Get streams for movies
     * @param {object} config - Configuration object with provider settings
     * @param {string} type - Content type ('movie')
     * @param {string} id - Content ID (imdb:ttxxxxxxx)
     * @returns {Promise<Array>} - Array of stream objects
     */
    static async getMovieStreams(config, type, id) {
        const startTime = Date.now();
        logger.info(`[stream-provider] Starting movie stream search for ${id}`);

        try {
            // Validate input parameters
            if (!config || !type || !id) {
                throw new ValidationError('Missing required parameters', null, 'MISSING_PARAMS');
            }

            if (type !== 'movie') {
                throw new ValidationError(`Invalid content type: ${type}`, 'type', 'INVALID_TYPE');
            }

            if (!id.startsWith('tt')) {
                throw new ValidationError(`Invalid movie ID format: ${id}`, 'id', 'INVALID_ID');
            }

            // Extract IMDB ID
            const imdbId = id.startsWith('imdb:') ? id.replace('imdb:', '') : id;
            
            // Get content metadata from Cinemeta
            const cinemetaDetails = await Cinemeta.getMeta(type, imdbId);
            if (!cinemetaDetails || !cinemetaDetails.name) {
                logger.warn(`[stream-provider] No metadata found for ${imdbId}`);
                return [];
            }

            // Setup providers
            const providers = { AllDebrid, RealDebrid, DebridLink, Premiumize, TorBox };
            
            // Perform search using the modular coordinator
            const searchResults = await coordinateSearch({
                apiKey: config.DebridApiKey,
                provider: config.DebridProvider,
                searchKey: cinemetaDetails.name,
                type: 'movie',
                imdbId,
                season: null,
                episode: null,
                threshold: 0.3,
                providers,
                tmdbApiKey: config.TmdbApiKey,
                traktApiKey: config.TraktAppiKey
            });

            logger.debug(`[stream-provider] Search found ${searchResults.length} results for movie ${imdbId}`);

            if (!searchResults || searchResults.length === 0) {
                logger.info(`[stream-provider] No streams found for movie ${imdbId}`);
                return [];
            }

            // Build stream objects from search results
            const streams = [];
            for (const result of searchResults) {
                try {
                    const stream = toStream(result, 'movie', null, result.variantInfo, null);
                    
                    if (stream && stream.url) {
                        streams.push(stream);
                    }
                } catch (error) {
                    logger.warn(`[stream-provider] Failed to build stream from result: ${error.message}`);
                    // Continue with other results
                }
            }

            // Sort streams by quality
            const sortedStreams = sortMovieStreamsByQuality(streams);
            
            const duration = Date.now() - startTime;
            logger.info(`[stream-provider] Movie search completed in ${duration}ms. Found ${sortedStreams.length} streams for ${imdbId}`);

            return sortedStreams;

        } catch (error) {
            const duration = Date.now() - startTime;
            logger.error(`[stream-provider] Movie search failed in ${duration}ms for ${id}:`, error);
            
            // Return empty array on error to maintain compatibility
            return [];
        }
    }

    /**
     * Get streams for TV series
     * @param {object} config - Configuration object with provider settings
     * @param {string} type - Content type ('series')
     * @param {string} id - Content ID (imdb:ttxxxxxxx:season:episode)
     * @returns {Promise<Array>} - Array of stream objects
     */
    static async getSeriesStreams(config, type, id) {
        const startTime = Date.now();
        logger.info(`[stream-provider] Starting series stream search for ${id}`);

        try {
            // Validate input parameters
            if (!config || !type || !id) {
                throw new ValidationError('Missing required parameters', null, 'MISSING_PARAMS');
            }

            if (type !== 'series') {
                throw new ValidationError(`Invalid content type: ${type}`, 'type', 'INVALID_TYPE');
            }

            // Parse series ID format: ttxxxxxxx:season:episode
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

            // Get content metadata from Cinemeta
            const cinemetaDetails = await Cinemeta.getMeta(type, imdbId);
            if (!cinemetaDetails || !cinemetaDetails.name) {
                logger.warn(`[stream-provider] No metadata found for ${imdbId}`);
                return [];
            }

            // Setup providers
            const providers = { AllDebrid, RealDebrid, DebridLink, Premiumize, TorBox };

            // Perform search using the modular coordinator
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
                tmdbApiKey: config.TmdbApiKey,
                traktApiKey: config.TraktAppiKey
            });

            // Extract results from coordinator response
            const searchResults = searchResponse.results || [];

            logger.debug(`[stream-provider] Search found ${searchResults.length} results for series ${imdbId} S${season}E${episode}`);

            if (!searchResults || searchResults.length === 0) {
                logger.info(`[stream-provider] No streams found for series ${imdbId} S${season}E${episode}`);
                return [];
            }

            // Build stream objects from search results
            const streams = [];
            for (const result of searchResults) {
                try {
                    const knownSeasonEpisode = {
                        season,
                        episode,
                        absoluteEpisode: searchResponse.absoluteEpisode
                    };
                    const stream = toStream(result, 'series', knownSeasonEpisode, result.variantInfo, null);
                    
                    if (stream && stream.url) {
                        streams.push(stream);
                    }
                } catch (error) {
                    logger.warn(`[stream-provider] Failed to build stream from result: ${error.message}`);
                    // Continue with other results
                }
            }

            // Deduplicate and sort streams by quality
            const deduplicatedStreams = deduplicateStreams(streams);
            const sortedStreams = sortMovieStreamsByQuality(deduplicatedStreams);
            
            const duration = Date.now() - startTime;
            logger.info(`[stream-provider] Series search completed in ${duration}ms. Found ${sortedStreams.length} streams for ${imdbId} S${season}E${episode}`);

            return sortedStreams;

        } catch (error) {
            const duration = Date.now() - startTime;
            logger.error(`[stream-provider] Series search failed in ${duration}ms for ${id}:`, error);
            
            // Return empty array on error to maintain compatibility
            return [];
        }
    }
}

export default StreamProvider;
