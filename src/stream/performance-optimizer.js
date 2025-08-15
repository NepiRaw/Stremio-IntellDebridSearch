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
const METADATA_TTL = 3600;      // 1 hour for metadata (can be refined)
const TECHNICAL_TTL = 86400;    // 24 hours for technical details (static data)
const PATTERN_TTL = 43200;      // 12 hours for pattern matches (static patterns)

/**
 * Get or parse metadata using unified cache
 */
export function getOrParseMetadata(containerName, videoName, type = 'series') {
    const cacheKey = `${METADATA_CACHE_PREFIX}${containerName}|${videoName}|${type}`;
    
    const cached = cache.get(cacheKey);
    if (cached !== null) {
        logger.debug(`[performance] Cache hit for metadata: ${videoName.substring(0, 30)}...`);
        return cached;
    }
    
    logger.debug(`[performance] Cache miss - parsing metadata: ${videoName.substring(0, 30)}...`);
    
    const metadata = {
        seriesInfo: type === 'series' ? extractSeriesInfo(videoName, containerName) : null,
        movieInfo: type === 'movie' ? extractMovieInfo(videoName || containerName) : null,
        technicalDetails: extractTechnicalDetailsLegacy(videoName || containerName),
        parsedAt: Date.now()
    };
    
    cache.set(cacheKey, metadata, METADATA_TTL, {
        type: 'metadata',
        containerName: containerName.substring(0, 50),
        contentType: type
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
 * Get performance statistics
 */
export function getPerformanceStats() {
    const cacheStats = cache.getStats();
    const metadataEntries = cache.getByPattern(`^${METADATA_CACHE_PREFIX}`);
    const technicalEntries = cache.getByPattern(`^${TECHNICAL_CACHE_PREFIX}`);
    const patternEntries = cache.getByPattern(`^${PATTERN_CACHE_PREFIX}`);
    
    return {
        unifiedCache: cacheStats,
        performanceEntries: {
            metadata: metadataEntries.length,
            technical: technicalEntries.length,
            pattern: patternEntries.length,
            total: metadataEntries.length + technicalEntries.length + patternEntries.length
        }
    };
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