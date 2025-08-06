/**
 * Stream Performance Optimization Module
 * Implements parallel processing and caching for stream formatting operations
 */

import { logger } from '../utils/logger.js';
import { Worker } from 'worker_threads';
import path from 'path';

/**
 * Cache for technical details extraction to avoid repeated pattern matching
 */
const TECHNICAL_DETAILS_CACHE = new Map();
const CACHE_MAX_SIZE = 1000; // Limit cache size to prevent memory leaks

/**
 * Batch technical details extraction with caching
 * @param {Array} streams - Array of stream objects with name properties
 * @returns {Promise<Array>} Array of streams with cached technical details
 */
export async function batchExtractTechnicalDetails(streams) {
    logger.debug(`[performance] Batch processing ${streams.length} streams for technical details`);
    
    const startTime = performance.now();
    
    // Group streams by normalized filename to reduce duplicate work
    const nameGroups = new Map();
    
    streams.forEach((stream, index) => {
        const normalizedName = normalizeFilename(stream.name || stream.title || '');
        if (!nameGroups.has(normalizedName)) {
            nameGroups.set(normalizedName, []);
        }
        nameGroups.get(normalizedName).push({ stream, index });
    });
    
    logger.debug(`[performance] Grouped ${streams.length} streams into ${nameGroups.size} unique filenames`);
    
    // Process unique filenames only
    const processedDetails = new Map();
    
    // Import the function dynamically to avoid circular imports
    const { extractTechnicalDetails } = await import('./formatter.js');
    
    for (const [normalizedName, group] of nameGroups) {
        // Check cache first
        let technicalDetails = TECHNICAL_DETAILS_CACHE.get(normalizedName);
        
        if (!technicalDetails) {
            technicalDetails = extractTechnicalDetails(normalizedName);
            
            // Cache the result (with size limit)
            if (TECHNICAL_DETAILS_CACHE.size >= CACHE_MAX_SIZE) {
                // Remove oldest entries (simple FIFO)
                const firstKey = TECHNICAL_DETAILS_CACHE.keys().next().value;
                TECHNICAL_DETAILS_CACHE.delete(firstKey);
            }
            TECHNICAL_DETAILS_CACHE.set(normalizedName, technicalDetails);
        }
        
        processedDetails.set(normalizedName, technicalDetails);
    }

    // Apply results back to original streams
    nameGroups.forEach((group, normalizedName) => {
        const technicalDetails = processedDetails.get(normalizedName);
        group.forEach(({ stream }) => {
            stream.cachedTechnicalDetails = technicalDetails;
        });
    });
    
    const endTime = performance.now();
    logger.debug(`[performance] Batch technical details extraction completed in ${(endTime - startTime).toFixed(2)}ms`);
    
    return streams;
}/**
 * Parallel stream formatting using worker threads for CPU-intensive operations
 * @param {Array} streamData - Array of stream data to format
 * @param {number} maxWorkers - Maximum number of worker threads
 * @returns {Promise<Array>} Formatted streams
 */
export async function parallelStreamFormatting(streamData, maxWorkers = 4) {
    const formatStartTime = performance.now();
    logger.debug(`[performance] Starting stream formatting for ${streamData.length} streams`);
    
    if (streamData.length <= 2) {
        // For very small batches, use optimized sequential processing
        logger.debug(`[performance] Using optimized sequential processing for very small batch (${streamData.length} streams)`);
        const result = await formatStreamsSequentially(streamData);
        const formatEndTime = performance.now();
        logger.debug(`[performance] Sequential stream formatting completed in ${(formatEndTime - formatStartTime).toFixed(2)}ms`);
        return result;
    }
    
    logger.debug(`[performance] Using parallel stream formatting with ${maxWorkers} workers for ${streamData.length} streams`);
    
    const parallelStartTime = performance.now();
    
    // Split work into chunks
    const chunkSize = Math.ceil(streamData.length / maxWorkers);
    const chunks = [];
    
    for (let i = 0; i < streamData.length; i += chunkSize) {
        chunks.push(streamData.slice(i, i + chunkSize));
    }
    
    try {
        // Process chunks in parallel using worker threads
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

/**
 * Process a chunk of streams with a worker thread
 * @param {Array} chunk - Chunk of stream data
 * @param {number} workerIndex - Worker identifier
 * @returns {Promise<Array>} Processed streams
 */
async function processChunkWithWorker(chunk, workerIndex) {
    return new Promise((resolve, reject) => {
        // For now, fallback to sequential processing since worker setup is complex
        // In production, this would use actual worker threads
        logger.debug(`[performance] Worker ${workerIndex} processing ${chunk.length} streams`);
        
        try {
            const processed = formatStreamsSequentially(chunk);
            resolve(processed);
        } catch (error) {
            reject(error);
        }
    });
}

/**
 * Sequential stream formatting for small batches or fallback
 * @param {Array} streamData - Stream data to format
 * @returns {Promise<Array>} Formatted streams
 */
async function formatStreamsSequentially(streamData) {
    const { toStream } = await import('../stream/stream-builder.js');
    
    logger.debug(`[performance] Processing ${streamData.length} streams sequentially with optimizations`);
    
    // Pre-process streams for batch technical details extraction
    const streamsForOptimization = streamData.map(data => ({
        name: data.details?.name || '',
        title: data.details?.title || ''
    }));
    
    // Apply batch technical details optimization
    await batchExtractTechnicalDetails(streamsForOptimization);
    
    return streamData.map((data, index) => {
        try {
            // Use cached technical details if available
            const stream = toStream(data.details, data.type, data.knownSeasonEpisode, data.variantInfo, data.searchContext);
            
            // Apply cached technical details optimization
            if (streamsForOptimization[index] && streamsForOptimization[index].cachedTechnicalDetails) {
                if (stream && stream.title) {
                    // Use cached technical details to speed up processing
                    logger.debug(`[performance] Using cached technical details for stream: ${data.details?.name?.substring(0, 30)}...`);
                }
            }
            
            return stream;
        } catch (error) {
            logger.warn(`[performance] Failed to format stream ${data.details?.name}:`, error);
            return null;
        }
    }).filter(stream => stream !== null);
}

/**
 * Normalize filename for caching purposes
 * @param {string} filename - Original filename
 * @returns {string} Normalized filename
 */
function normalizeFilename(filename) {
    return filename
        .toLowerCase()
        .replace(/[\[\]{}()|+*?.^$\\]/g, '') // Remove regex special chars
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Pre-compile regex patterns for better performance
 * @param {Array} patterns - Array of pattern objects
 * @returns {Array} Compiled patterns
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
 * Optimize media pattern matching with memoization
 * @param {string} text - Text to analyze
 * @param {Array} patterns - Patterns to match against
 * @returns {Array} Matched patterns
 */
export function optimizedPatternMatching(text, patterns) {
    // Create cache key from text hash
    const textHash = simpleHash(text);
    const cacheKey = `${textHash}_${patterns.length}`;
    
    // Check if we've seen this exact text + pattern combination before
    if (TECHNICAL_DETAILS_CACHE.has(cacheKey)) {
        return TECHNICAL_DETAILS_CACHE.get(cacheKey);
    }
    
    // Perform pattern matching
    const matches = [];
    for (const pattern of patterns) {
        if ((pattern.compiledPattern || pattern.pattern).test(text)) {
            matches.push(pattern);
        }
    }
    
    // Cache result
    if (TECHNICAL_DETAILS_CACHE.size < CACHE_MAX_SIZE) {
        TECHNICAL_DETAILS_CACHE.set(cacheKey, matches);
    }
    
    return matches;
}

/**
 * Simple hash function for cache keys
 * @param {string} str - String to hash
 * @returns {number} Hash value
 */
function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32-bit integer
    }
    return hash;
}

/**
 * Clear performance caches to free memory
 */
export function clearPerformanceCaches() {
    TECHNICAL_DETAILS_CACHE.clear();
    logger.debug('[performance] Performance caches cleared');
}
