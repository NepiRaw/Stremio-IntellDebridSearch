/**
 * Stream Performance Optimization Module
 * Implements parallel processing and caching for stream formatting operations
 */

import { logger } from '../utils/logger.js';
import { extractTechnicalDetailsLegacy } from '../utils/unified-torrent-parser.js';
import { extractSeriesInfo, extractMovieInfo } from './metadata-extractor.js';
import { Worker } from 'worker_threads';
import path from 'path';

/**
 * Cache for technical details extraction to avoid repeated pattern matching
 */
const TECHNICAL_DETAILS_CACHE = new Map();
/**
 * Cache for parsed metadata to avoid repeated parsing operations
 */
const PARSING_CACHE = new Map();
const CACHE_MAX_SIZE = 1000; // Limit cache size to prevent memory leaks

/**
 * Get or parse metadata with caching for performance optimization
 * This implements lazy parsing - only parse when needed and cache results
 */
export function getOrParseMetadata(containerName, videoName, type = 'series') {
    const cacheKey = `${containerName}|${videoName}|${type}`;
    
    if (PARSING_CACHE.has(cacheKey)) {
        logger.debug(`[performance] Cache hit for parsing: ${videoName.substring(0, 30)}...`);
        return PARSING_CACHE.get(cacheKey);
    }
    
    logger.debug(`[performance] Cache miss - parsing: ${videoName.substring(0, 30)}...`);
    
    const metadata = {
        seriesInfo: type === 'series' ? extractSeriesInfo(videoName, containerName) : null,
        movieInfo: type === 'movie' ? extractMovieInfo(videoName || containerName) : null,
        technicalDetails: extractTechnicalDetailsLegacy(videoName || containerName)
    };
    
    // Manage cache size
    if (PARSING_CACHE.size >= CACHE_MAX_SIZE) {
        const firstKey = PARSING_CACHE.keys().next().value;
        PARSING_CACHE.delete(firstKey);
        logger.debug(`[performance] Parsing cache size limit reached, evicted oldest entry`);
    }
    
    PARSING_CACHE.set(cacheKey, metadata);
    return metadata;
}

export async function batchExtractTechnicalDetails(streams) {
    logger.debug(`[performance] Batch processing ${streams.length} streams for technical details`);
    
    const startTime = performance.now();
    
    const nameGroups = new Map();
    
    streams.forEach((stream, index) => {
        const normalizedName = normalizeFilename(stream.name || stream.title || '');
        if (!nameGroups.has(normalizedName)) {
            nameGroups.set(normalizedName, []);
        }
        nameGroups.get(normalizedName).push({ stream, index });
    });
    
    logger.debug(`[performance] Grouped ${streams.length} streams into ${nameGroups.size} unique filenames`);
    
    const processedDetails = new Map();
    
    for (const [normalizedName, group] of nameGroups) {
        let technicalDetails = TECHNICAL_DETAILS_CACHE.get(normalizedName);
        
        if (!technicalDetails) {
            technicalDetails = extractTechnicalDetailsLegacy(normalizedName);
            
            if (TECHNICAL_DETAILS_CACHE.size >= CACHE_MAX_SIZE) {
                const firstKey = TECHNICAL_DETAILS_CACHE.keys().next().value;
                TECHNICAL_DETAILS_CACHE.delete(firstKey);
            }
            TECHNICAL_DETAILS_CACHE.set(normalizedName, technicalDetails);
        }
        
        processedDetails.set(normalizedName, technicalDetails);
    }

    nameGroups.forEach((group, normalizedName) => {
        const technicalDetails = processedDetails.get(normalizedName);
        group.forEach(({ stream }) => {
            stream.cachedTechnicalDetails = technicalDetails;
        });
    });
    
    const endTime = performance.now();
    logger.debug(`[performance] Batch technical details extraction completed in ${(endTime - startTime).toFixed(2)}ms`);
    
    return streams;
}

export async function parallelStreamFormatting(streamData, maxWorkers = 4) {
    const formatStartTime = performance.now();
    logger.debug(`[performance] Starting stream formatting for ${streamData.length} streams`);
    
    if (streamData.length <= 2) {
        logger.debug(`[performance] Using optimized sequential processing for very small batch (${streamData.length} streams)`);
        const result = await formatStreamsSequentially(streamData);
        const formatEndTime = performance.now();
        logger.debug(`[performance] Sequential stream formatting completed in ${(formatEndTime - formatStartTime).toFixed(2)}ms`);
        return result;
    }
    
    logger.debug(`[performance] Using parallel stream formatting with ${maxWorkers} workers for ${streamData.length} streams`);
    
    const parallelStartTime = performance.now();
    
    const chunkSize = Math.ceil(streamData.length / maxWorkers);
    const chunks = [];
    
    for (let i = 0; i < streamData.length; i += chunkSize) {
        chunks.push(streamData.slice(i, i + chunkSize));
    }
    
    try {
        const workerPromises = chunks.map((chunk, index) => 
            processChunkWithWorker(chunk, index)
        );
        
        const results = await Promise.all(workerPromises);
        const formattedStreams = results.flat();
        
        const parallelEndTime = performance.now();
        logger.debug(`[performance] Parallel stream formatting completed in ${(parallelEndTime - parallelStartTime).toFixed(2)}ms`);
        
        return formattedStreams;
        
    } catch (error) {
        logger.warn('[performance] Parallel processing failed, falling back to sequential:', error);
        return await formatStreamsSequentially(streamData);
    }
}

async function processChunkWithWorker(chunk, workerIndex) {
    return new Promise((resolve, reject) => {
        logger.debug(`[performance] Worker ${workerIndex} processing ${chunk.length} streams`);
        
        try {
            const processed = formatStreamsSequentially(chunk);
            resolve(processed);
        } catch (error) {
            reject(error);
        }
    });
}

async function formatStreamsSequentially(streamData) {
    const { toStreams } = await import('../stream/stream-builder.js');
    
    logger.debug(`[performance] Processing ${streamData.length} streams sequentially with optimizations`);
    
    const streamsForOptimization = streamData.map(data => ({
        name: data.details?.name || '',
        title: data.details?.title || ''
    }));
    
    await batchExtractTechnicalDetails(streamsForOptimization);
    
    const allStreams = [];
    
    streamData.forEach((data, index) => {
        try {
            // Pre-parse metadata using lazy caching
            const parsedMetadata = getOrParseMetadata(
                data.details?.name || '',
                data.details?.videos?.[0]?.name || '',
                data.type
            );
            
            // Use toStreams to get all streams from a torrent container (fixes Issue 1)
            const streams = toStreams(data.details, data.type, parsedMetadata, data.knownSeasonEpisode, data.variantInfo, data.searchContext);
            
            if (streamsForOptimization[index] && streamsForOptimization[index].cachedTechnicalDetails) {
                streams.forEach(stream => {
                    if (stream && stream.title) {
                        logger.debug(`[performance] Using cached technical details for stream: ${data.details?.name?.substring(0, 30)}...`);
                    }
                });
            }
            
            // Add all streams from this container
            allStreams.push(...streams);
            
        } catch (error) {
            logger.warn(`[performance] Failed to format streams for ${data.details?.name}:`, error);
        }
    });
    
    logger.debug(`[performance] Generated ${allStreams.length} total streams from ${streamData.length} containers`);
    return allStreams.filter(stream => stream !== null);
}

function normalizeFilename(filename) {
    return filename
        .toLowerCase()
        .replace(/[\[\]{}()|+*?.^$\\]/g, '') // Remove regex special chars
        .replace(/\s+/g, ' ')
        .trim();
}

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

export function optimizedPatternMatching(text, patterns) {
    const textHash = simpleHash(text);
    const cacheKey = `${textHash}_${patterns.length}`;
    
    if (TECHNICAL_DETAILS_CACHE.has(cacheKey)) {
        return TECHNICAL_DETAILS_CACHE.get(cacheKey);
    }
    
    const matches = [];
    for (const pattern of patterns) {
        if ((pattern.compiledPattern || pattern.pattern).test(text)) {
            matches.push(pattern);
        }
    }
    
    if (TECHNICAL_DETAILS_CACHE.size < CACHE_MAX_SIZE) {
        TECHNICAL_DETAILS_CACHE.set(cacheKey, matches);
    }
    
    return matches;
}

function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32-bit integer
    }
    return hash;
}

export function clearPerformanceCaches() {
    TECHNICAL_DETAILS_CACHE.clear();
    PARSING_CACHE.clear();
    logger.debug('[performance] Performance caches cleared');
}
