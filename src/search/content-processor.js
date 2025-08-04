import { fetchAnimeSeasonInfo } from '../api/jikan.js';
import { logger } from '../utils/logger.js';

/**
 * Content processor module - handles content-type-specific processing in a generic way
 * Provides content-specific logic without hardcoding content types
 */

/**
 * Process content based on type, handling different content formats generically
 * @param {string} contentType - The type of content (movie, series, anime, etc.)
 * @param {string} originalTitle - Original title from search
 * @param {string[]} alternativeTitles - Alternative titles from TMDb
 * @param {object} options - Additional processing options
 * @returns {Promise<object>} - Processed content information
 */
export async function processContent(contentType, originalTitle, alternativeTitles = [], options = {}) {
    if (!originalTitle) {
        logger.warn('[content-processor] No original title provided for processing');
        return { 
            success: false, 
            error: 'Missing original title',
            processedTitles: []
        };
    }

    logger.info(`[content-processor] Processing ${contentType} content: "${originalTitle}"`);

    const result = {
        success: true,
        contentType,
        originalTitle,
        processedTitles: [],
        contentSpecificData: {},
        confidence: 1.0
    };

    // Always include the original title
    result.processedTitles.push({
        title: originalTitle,
        type: 'original',
        confidence: 1.0
    });

    // Add alternative titles
    if (alternativeTitles && alternativeTitles.length > 0) {
        alternativeTitles.forEach((altTitle, index) => {
            result.processedTitles.push({
                title: altTitle,
                type: 'alternative',
                confidence: Math.max(0.8 - (index * 0.1), 0.5) // Decreasing confidence
            });
        });
        logger.debug(`[content-processor] Added ${alternativeTitles.length} alternative titles`);
    }

    // Content-type specific processing
    try {
        switch (contentType?.toLowerCase()) {
            case 'anime':
                await processAnimeContent(result, options);
                break;
            
            case 'series':
            case 'tv':
                await processSeriesContent(result, options);
                break;
            
            case 'movie':
            case 'film':
                await processMovieContent(result, options);
                break;
            
            default:
                logger.debug(`[content-processor] Using generic processing for content type: ${contentType}`);
                await processGenericContent(result, options);
                break;
        }
    } catch (err) {
        logger.error(`[content-processor] Error in content-specific processing:`, err.message);
        result.success = false;
        result.error = `Content processing failed: ${err.message}`;
    }

    logger.info(`[content-processor] Processed ${result.processedTitles.length} title variations for ${contentType}`);
    return result;
}

/**
 * Process anime-specific content
 * @param {object} result - Result object to populate
 * @param {object} options - Processing options
 */
async function processAnimeContent(result, options = {}) {
    const { originalTitle } = result;
    
    logger.debug('[content-processor] Processing anime-specific content');

    // Try to fetch anime season information if available
    try {
        const animeInfo = await fetchAnimeSeasonInfo(originalTitle);
        if (animeInfo) {
            result.contentSpecificData.animeInfo = animeInfo;
            
            // Add additional anime title variations if found
            if (animeInfo.alternativeTitles) {
                animeInfo.alternativeTitles.forEach(altTitle => {
                    if (!result.processedTitles.some(t => t.title === altTitle)) {
                        result.processedTitles.push({
                            title: altTitle,
                            type: 'anime_alternative',
                            confidence: 0.7
                        });
                    }
                });
            }
            
            logger.debug('[content-processor] Enhanced anime content with Jikan data');
        }
    } catch (err) {
        logger.warn(`[content-processor] Failed to fetch anime info: ${err.message}`);
    }

    // Add common anime title variations
    addAnimeVariations(result);
}

/**
 * Process series-specific content
 * @param {object} result - Result object to populate  
 * @param {object} options - Processing options
 */
async function processSeriesContent(result, options = {}) {
    logger.debug('[content-processor] Processing series-specific content');
    
    // Add common series variations
    addSeriesVariations(result);
    
    // Store series-specific metadata
    if (options.season && options.episode) {
        result.contentSpecificData.episodeInfo = {
            season: options.season,
            episode: options.episode
        };
    }
}

/**
 * Process movie-specific content
 * @param {object} result - Result object to populate
 * @param {object} options - Processing options
 */
async function processMovieContent(result, options = {}) {
    logger.debug('[content-processor] Processing movie-specific content');
    
    // Add common movie variations
    addMovieVariations(result);
    
    // Store movie-specific metadata
    if (options.year) {
        result.contentSpecificData.year = options.year;
    }
}

/**
 * Process generic content (fallback)
 * @param {object} result - Result object to populate
 * @param {object} options - Processing options
 */
async function processGenericContent(result, options = {}) {
    logger.debug('[content-processor] Processing generic content');
    
    // Add basic title variations
    addBasicVariations(result);
}

/**
 * Add anime-specific title variations
 * @param {object} result - Result object to modify
 */
function addAnimeVariations(result) {
    const { originalTitle } = result;
    
    // Common anime variations
    const variations = [
        originalTitle.replace(/\s+/g, ''), // Remove spaces
        originalTitle.replace(/[:-]/g, ' '), // Replace colons and dashes with spaces
        originalTitle.replace(/\s*Season\s*\d+/i, ''), // Remove season markers
        originalTitle.replace(/\s*Part\s*\d+/i, ''), // Remove part markers
    ];

    variations.forEach(variation => {
        if (variation !== originalTitle && variation.length > 2) {
            result.processedTitles.push({
                title: variation,
                type: 'anime_variation',
                confidence: 0.6
            });
        }
    });
}

/**
 * Add series-specific title variations  
 * @param {object} result - Result object to modify
 */
function addSeriesVariations(result) {
    const { originalTitle } = result;
    
    // Common series variations
    const variations = [
        originalTitle.replace(/\s*\(\d{4}\)/, ''), // Remove year in parentheses
        originalTitle.replace(/\s*Season\s*\d+/i, ''), // Remove season info
        originalTitle.replace(/[:\-]/g, ' '), // Replace special chars
    ];

    variations.forEach(variation => {
        if (variation !== originalTitle && variation.length > 2) {
            result.processedTitles.push({
                title: variation,
                type: 'series_variation',
                confidence: 0.7
            });
        }
    });
}

/**
 * Add movie-specific title variations
 * @param {object} result - Result object to modify
 */
function addMovieVariations(result) {
    const { originalTitle } = result;
    
    // Common movie variations
    const variations = [
        originalTitle.replace(/\s*\(\d{4}\)/, ''), // Remove year in parentheses
        originalTitle.replace(/[:\-]/g, ' '), // Replace special chars
        originalTitle.replace(/\s*Part\s*\d+/i, ''), // Remove part markers
    ];

    variations.forEach(variation => {
        if (variation !== originalTitle && variation.length > 2) {
            result.processedTitles.push({
                title: variation,
                type: 'movie_variation',
                confidence: 0.7
            });
        }
    });
}

/**
 * Add basic title variations (fallback)
 * @param {object} result - Result object to modify
 */
function addBasicVariations(result) {
    const { originalTitle } = result;
    
    // Basic variations
    const variations = [
        originalTitle.replace(/[:\-]/g, ' '), // Replace special chars
        originalTitle.replace(/\s+/g, ' ').trim(), // Normalize spaces
    ];

    variations.forEach(variation => {
        if (variation !== originalTitle && variation.length > 2) {
            result.processedTitles.push({
                title: variation,
                type: 'basic_variation',
                confidence: 0.5
            });
        }
    });
}

/**
 * Map episode numbers for different content types
 * @param {string} contentType - Type of content
 * @param {object} seasonData - Season information
 * @param {number} targetSeason - Target season number
 * @param {number} targetEpisode - Target episode number
 * @returns {object} - Episode mapping result
 */
export function mapContentEpisode(contentType, seasonData, targetSeason, targetEpisode) {
    if (!targetSeason || !targetEpisode) {
        logger.warn('[content-processor] Invalid episode mapping parameters');
        return { success: false, error: 'Missing season or episode' };
    }

    logger.debug(`[content-processor] Mapping ${contentType} episode S${targetSeason}E${targetEpisode}`);

    const mappingResult = {
        success: true,
        contentType,
        originalSeason: targetSeason,
        originalEpisode: targetEpisode,
        mappedSeason: targetSeason,
        mappedEpisode: targetEpisode,
        absoluteEpisode: null,
        confidence: 1.0
    };

    // Content-type specific episode mapping
    switch (contentType?.toLowerCase()) {
        case 'anime':
            return mapAnimeEpisode(seasonData, targetSeason, targetEpisode, mappingResult);
        
        case 'series':
        case 'tv':
            return mapSeriesEpisode(seasonData, targetSeason, targetEpisode, mappingResult);
        
        default:
            logger.debug(`[content-processor] Using generic episode mapping for ${contentType}`);
            return mappingResult;
    }
}

/**
 * Map anime episode numbers (handles different numbering schemes)
 * @param {object} seasonData - Anime season data
 * @param {number} targetSeason - Target season
 * @param {number} targetEpisode - Target episode
 * @param {object} result - Result object to populate
 * @returns {object} - Mapping result
 */
function mapAnimeEpisode(seasonData, targetSeason, targetEpisode, result) {
    // If we have anime season data from Jikan, use it for mapping
    if (seasonData && Array.isArray(seasonData)) {
        try {
            const targetSeasonData = seasonData.find(season => 
                season.season_number === targetSeason || 
                season.year === targetSeason
            );

            if (targetSeasonData && targetSeasonData.episodes) {
                const episodeData = targetSeasonData.episodes.find(ep => 
                    ep.episode_number === targetEpisode
                );

                if (episodeData) {
                    result.absoluteEpisode = episodeData.absolute_number || null;
                    result.confidence = 0.9;
                    logger.debug(`[content-processor] Mapped anime episode using Jikan data`);
                }
            }
        } catch (err) {
            logger.warn(`[content-processor] Error mapping anime episode: ${err.message}`);
        }
    }

    // Fallback: estimate absolute episode for anime
    if (!result.absoluteEpisode) {
        // Rough estimation: assume 12-25 episodes per season
        const estimatedEpisodes = 12;
        result.absoluteEpisode = ((targetSeason - 1) * estimatedEpisodes) + targetEpisode;
        result.confidence = 0.6;
        logger.debug(`[content-processor] Using estimated absolute episode: ${result.absoluteEpisode}`);
    }

    return result;
}

/**
 * Map series episode numbers
 * @param {object} seasonData - Series season data
 * @param {number} targetSeason - Target season
 * @param {number} targetEpisode - Target episode
 * @param {object} result - Result object to populate
 * @returns {object} - Mapping result
 */
function mapSeriesEpisode(seasonData, targetSeason, targetEpisode, result) {
    // For regular series, we typically use standard season/episode numbering
    // Additional mapping logic can be added here if needed
    
    if (seasonData && seasonData.episodeCount) {
        // Validate episode exists in season
        if (targetEpisode > seasonData.episodeCount) {
            result.success = false;
            result.error = `Episode ${targetEpisode} exceeds season ${targetSeason} episode count (${seasonData.episodeCount})`;
            logger.warn(`[content-processor] ${result.error}`);
        }
    }

    return result;
}

/**
 * Get title variations for searching based on content type
 * @param {string} contentType - Type of content
 * @param {string} originalTitle - Original title
 * @param {string[]} alternativeTitles - Alternative titles
 * @returns {Promise<string[]>} - Array of title variations for searching
 */
export async function getTitleVariationsForSearch(contentType, originalTitle, alternativeTitles = []) {
    logger.debug(`[content-processor] Getting title variations for ${contentType} search`);

    const processedContent = await processContent(contentType, originalTitle, alternativeTitles);
    
    if (!processedContent.success) {
        logger.error(`[content-processor] Failed to process content: ${processedContent.error}`);
        return [originalTitle]; // Fallback to original title
    }

    // Extract titles sorted by confidence
    const titleVariations = processedContent.processedTitles
        .sort((a, b) => b.confidence - a.confidence)
        .map(item => item.title)
        .filter((title, index, array) => array.indexOf(title) === index); // Remove duplicates

    logger.info(`[content-processor] Generated ${titleVariations.length} title variations for search`);
    return titleVariations;
}
