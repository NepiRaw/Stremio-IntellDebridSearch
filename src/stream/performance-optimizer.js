/**
 * Performance Optimize module for the stream builder 
 * Cache metadata and technical details,allowing faster fetch and build operations.
 */

import { logger } from '../utils/logger.js';
import cache from '../utils/cache-manager.js';
import { extractTechnicalDetailsLegacy } from '../utils/unified-torrent-parser.js';
import { extractSeriesInfo, extractMovieInfo } from './metadata-extractor.js';
import { optimizedStreamCreation, toStreamSingle } from '../stream/stream-builder.js';

// Cache prefixes for unified cache organization
const METADATA_CACHE_PREFIX = 'metadata_';
const TECHNICAL_CACHE_PREFIX = 'tech_details_';
const PATTERN_CACHE_PREFIX = 'pattern_match_';

// TTL configurations (in seconds)
const METADATA_TTL = 43200;     // 12 hour for metadata (can be refined)
const TECHNICAL_TTL = 86400;    // 24 hours for technical details (static data)
const PATTERN_TTL = 43200;      // 12 hours for pattern matches (static patterns)

/**
 * Get or parse metadata using multi-level cache
 * Level 1: Exact cache (current behavior) 
 * Level 2: Fuzzy cache (shared across similar episodes)
 * Level 3: Parse and cache both exact and fuzzy
 */
export function getOrParseMetadata(containerName, videoName, type = 'series') {
    // Level 1: Try exact cache
    const exactKey = `${METADATA_CACHE_PREFIX}${containerName}|${videoName}|${type}`;
    let cached = cache.get(exactKey);
    
    if (cached !== null) {
        logger.debug(`[performance] Exact cache hit: ${videoName.substring(0, 30)}...`);
        return cached;
    }
    
    // Level 2: Try fuzzy cache
    const fuzzyKey = createFuzzyKey(containerName, videoName, type);
    cached = cache.get(fuzzyKey);
    
    if (cached !== null) {
        logger.debug(`[performance] Fuzzy cache hit: ${videoName.substring(0, 30)}...`);
        return adaptCachedMetadata(cached, videoName, containerName, type);
    }
    
    // Level 3: Parse and cache both exact and fuzzy
    logger.debug(`[performance] Cache miss - parsing: ${videoName.substring(0, 30)}...`);
    
    const metadata = {
        seriesInfo: type === 'series' ? extractSeriesInfo(videoName, containerName) : null,
        movieInfo: type === 'movie' ? extractMovieInfo(videoName || containerName) : null,
        technicalDetails: extractTechnicalDetailsLegacy(videoName || containerName),
        parsedAt: Date.now()
    };
    
    // Cache both exact and fuzzy versions
    cache.set(exactKey, metadata, METADATA_TTL, {
        type: 'metadata_exact',
        containerName: containerName.substring(0, 50),
        contentType: type
    });
    
    cache.set(fuzzyKey, metadata, METADATA_TTL * 2, { // Longer TTL for shared cache
        type: 'metadata_fuzzy',
        containerName: containerName.substring(0, 50),
        contentType: type,
        sharedKey: true
    });
    
    return metadata;
}

/**
 * Batch extract technical details with unified cache
 */
export async function batchExtractTechnicalDetails(streams) {
    logger.debug(`[performance] Batch processing ${streams.length} streams`);
    
    const startTime = performance.now();
    const nameGroups = new Map();
    const cacheHits = new Set();
    const cacheMisses = new Set();
    
    streams.forEach((stream) => {
        const normalizedName = normalizeFilename(stream.name || stream.title || '');
        if (!nameGroups.has(normalizedName)) {
            nameGroups.set(normalizedName, []);
        }
        nameGroups.get(normalizedName).push(stream);
    });
    
    logger.debug(`[performance] Grouped ${streams.length} streams into ${nameGroups.size} unique filenames`);
    
    for (const [normalizedName, streamGroup] of nameGroups) {
        const cacheKey = `${TECHNICAL_CACHE_PREFIX}${normalizedName}`;
        let technicalDetails = cache.get(cacheKey);
        
        if (technicalDetails !== null) {
            cacheHits.add(normalizedName);
        } else {
            cacheMisses.add(normalizedName);
            technicalDetails = extractTechnicalDetailsLegacy(normalizedName);
            
            cache.set(cacheKey, technicalDetails, TECHNICAL_TTL, {
                type: 'technical_details',
                filename: normalizedName.substring(0, 50),
                extractedAt: Date.now()
            });
        }
        
        streamGroup.forEach(stream => {
            stream.cachedTechnicalDetails = technicalDetails;
        });
    }
    
    const endTime = performance.now();
    const duration = endTime - startTime;
    
    logger.debug(`[performance] Batch processing completed in ${duration.toFixed(2)}ms`);
    logger.debug(`[performance] Cache performance: ${cacheHits.size} hits, ${cacheMisses.size} misses`);
    
    return streams;
}

/**
 * Sequential stream formatting with error handling
 */
export async function sequentialStreamFormatting(streamData) {
    const formatStartTime = performance.now();
    
    try {
        const streamsForOptimization = streamData.map(data => ({
            name: data.details?.name || '',
            title: data.details?.title || ''
        }));
        
        await batchExtractTechnicalDetails(streamsForOptimization);
        
        const allStreams = [];
        let successCount = 0;
        let errorCount = 0;
        
        for (const data of streamData) {
            try {
                const parsedMetadata = getOrParseMetadata(
                    data.details?.name || '',
                    data.details?.videos?.[0]?.name || '',
                    data.type
                );
                
                const streams = optimizedStreamCreation(
                    data.details, 
                    data.type, 
                    parsedMetadata, 
                    data.knownSeasonEpisode, 
                    data.variantInfo, 
                    data.searchContext
                );
                
                allStreams.push(...streams);
                successCount++;
                
            } catch (error) {
                logger.warn(`[performance] Failed to format streams for ${data.details?.name}: ${error.message}`);
                errorCount++;
            }
        }
        
        const endTime = performance.now();
        const duration = endTime - formatStartTime;
        
        logger.debug(`[performance] Stream formatting completed in ${duration.toFixed(2)}ms`);
        logger.debug(`[performance] Processed ${successCount}/${streamData.length} containers successfully`);
        
        if (errorCount > 0) {
            logger.warn(`[performance] ${errorCount} containers failed processing`);
        }
        
        return allStreams.filter(stream => stream !== null);
        
    } catch (error) {
        logger.error(`[performance] Stream formatting failed: ${error.message}`);
        return [];
    }
}

/**
 * Pattern matching with unified cache
 */
export function optimizedPatternMatching(text, patterns) {
    if (!patterns || patterns.length === 0 || !text) {
        return [];
    }
    
    const textHash = simpleHash(text);
    const cacheKey = `${PATTERN_CACHE_PREFIX}${textHash}_${patterns.length}`;
    
    const cached = cache.get(cacheKey);
    if (cached !== null) {
        return cached;
    }
    
    const matches = [];
    for (const pattern of patterns) {
        const regex = pattern.compiledPattern || pattern.pattern;
        if (regex && regex.test(text)) {
            matches.push(pattern);
        }
    }
    
    cache.set(cacheKey, matches, PATTERN_TTL, {
        type: 'pattern_match',
        textLength: text.length,
        patternCount: patterns.length
    });
    
    return matches;
}

/**
 * Format single stream data
 */
export async function formatSingleStreamData(streamData) {
    try {
        const { details, type, knownSeasonEpisode, variantInfo, searchContext } = streamData;
        
        let parsedMetadata = null;
        if (details?.name || details?.videos?.[0]?.name) {
            parsedMetadata = getOrParseMetadata(
                details.name || '',
                details.videos?.[0]?.name || '',
                type
            );
        }
        
        return toStreamSingle(details, type, parsedMetadata, knownSeasonEpisode, variantInfo, searchContext);

    } catch (error) {
        logger.warn(`[performance] Failed to format single stream: ${error.message}`);
        return null;
    }
}

/**
 * Clear performance caches
 */
export function clearPerformanceCaches() {
    const metadataEntries = cache.getByPattern(`^${METADATA_CACHE_PREFIX}`);
    const technicalEntries = cache.getByPattern(`^${TECHNICAL_CACHE_PREFIX}`);
    const patternEntries = cache.getByPattern(`^${PATTERN_CACHE_PREFIX}`);
    
    const totalEntries = metadataEntries.length + technicalEntries.length + patternEntries.length;
    
    [...metadataEntries, ...technicalEntries, ...patternEntries].forEach(entry => {
        cache.delete(entry.key);
    });
    
    logger.debug(`[performance] Cleared ${totalEntries} performance cache entries`);
}

/**
 * Pre-compile patterns for better performance
 */
export function preCompilePatterns(patterns) {
    const startTime = performance.now();
    
    const compiled = patterns.map(pattern => ({
        ...pattern,
        compiledPattern: new RegExp(pattern.pattern.source, pattern.pattern.flags)
    }));
    
    const endTime = performance.now();
    logger.debug(`[performance] Pre-compiled ${patterns.length} patterns in ${(endTime - startTime).toFixed(2)}ms`);
    
    return compiled;
}

import { parseEpisodeFromTitle, parseSeasonFromTitle, parseAbsoluteEpisode } from '../utils/episode-patterns.js';

/**
 * Create fuzzy cache key by removing episode-specific parts
 */
function createFuzzyKey(containerName, videoName, type) {
    const normalized = normalizeFilename(containerName);
    
    const episodeInfo = parseEpisodeFromTitle(containerName);
    const absoluteEpisode = parseAbsoluteEpisode(containerName);
    
    let episodeAgnostic = normalized;
    
    if (episodeInfo) {
        const seasonPadded = String(episodeInfo.season).padStart(2, '0');
        const episodePadded = String(episodeInfo.episode).padStart(2, '0');
        
        episodeAgnostic = episodeAgnostic
            .replace(new RegExp(`s${seasonPadded}e${episodePadded}`, 'gi'), 's00e00')
            .replace(new RegExp(`s${episodeInfo.season}e${episodeInfo.episode}`, 'gi'), 's00e00')
            .replace(new RegExp(`${episodeInfo.season}x${episodePadded}`, 'gi'), '0x00')
            .replace(new RegExp(`${episodeInfo.season}x${episodeInfo.episode}`, 'gi'), '0x00')
            .replace(new RegExp(`season ${episodeInfo.season} episode ${episodeInfo.episode}`, 'gi'), 'season 0 episode 0');
    } else if (absoluteEpisode) {
        const absolutePadded = String(absoluteEpisode).padStart(3, '0');
        episodeAgnostic = episodeAgnostic
            .replace(new RegExp(`\\b${absoluteEpisode}\\b`, 'g'), '000')
            .replace(new RegExp(`\\b${absolutePadded}\\b`, 'g'), '000')
            .replace(new RegExp(`episode ${absoluteEpisode}`, 'gi'), 'episode 000')
            .replace(new RegExp(`ep ${absoluteEpisode}`, 'gi'), 'ep 000');
    } else {
        episodeAgnostic = episodeAgnostic
            .replace(/s\d+e\d+/gi, 's00e00')      // S01E01 → S00E00
            .replace(/\d+x\d+/gi, '0x00')         // 1x01 → 0x00  
            .replace(/episode?\s*\d+/gi, 'episode0') // Episode 1 → Episode0
            .replace(/ep\s*\d+/gi, 'ep0')         // Ep 1 → Ep0
            .replace(/\[\d+\]/gi, '[0]')          // [01] → [0]
            .replace(/part\s*\d+/gi, 'part0');    // Part 1 → Part0
    }
    
    return `${METADATA_CACHE_PREFIX}fuzzy_${episodeAgnostic}|${type}`;
}

/**
 * Adapt cached metadata for current episode
 */
function adaptCachedMetadata(cachedMetadata, currentVideoName, currentContainerName, type) {
    const adapted = JSON.parse(JSON.stringify(cachedMetadata));
    
    if (type === 'series' && adapted.seriesInfo) {
        try {
            const episodeInfo = parseEpisodeFromTitle(currentContainerName);
            const absoluteEpisode = parseAbsoluteEpisode(currentContainerName);
            
            if (episodeInfo) {
                adapted.seriesInfo.season = episodeInfo.season;
                adapted.seriesInfo.episode = episodeInfo.episode;
                adapted.seriesInfo.episodePattern = episodeInfo.pattern;
                
                if (currentVideoName) {
                    const currentEpisodeInfo = extractSeriesInfo(currentVideoName, currentContainerName);
                    if (currentEpisodeInfo?.episodeTitle) {
                        adapted.seriesInfo.episodeTitle = currentEpisodeInfo.episodeTitle;
                    }
                }
            } else if (absoluteEpisode) {
                adapted.seriesInfo.absoluteEpisode = absoluteEpisode;
                adapted.seriesInfo.season = adapted.seriesInfo.season || 1; 
                adapted.seriesInfo.episode = null; 
            }
            
        } catch (error) {
            logger.debug(`[performance] Failed to adapt episode info using episode-patterns: ${error.message}`);
            
            try {
                const currentEpisodeInfo = extractSeriesInfo(currentVideoName, currentContainerName);
                if (currentEpisodeInfo) {
                    adapted.seriesInfo.episode = currentEpisodeInfo.episode;
                    adapted.seriesInfo.episodeTitle = currentEpisodeInfo.episodeTitle;
                    adapted.seriesInfo.absoluteEpisode = currentEpisodeInfo.absoluteEpisode;
                }
            } catch (fallbackError) {
                logger.debug(`[performance] Fallback adaptation also failed: ${fallbackError.message}`);
            }
        }
    }
    
    adapted.adaptedAt = Date.now();
    adapted.originalParsedAt = adapted.parsedAt;
    adapted.cacheSource = 'fuzzy_adapted';
    
    return adapted;
}

/**
 * Utility functions
 */
function normalizeFilename(filename) {
    return filename
        .toLowerCase()
        .replace(/[\[\]{}()|+*?^$\\]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return hash;
}