/**
 * Quality processing module for stream quality extraction and analysis
 * Handles quality extraction, scoring, and display formatting
 */

import { extractQualityDisplay, extractQualityInfo } from '../utils/media-patterns.js';

/**
 * Extract quality information from video and torrent details with emoji indicators
 * @param {Object} video - Video file details
 * @param {Object} details - Torrent details
 * @returns {string} - Formatted quality string with emoji
 */
export function extractQuality(video, details) {
    const videoName = video.name || '';
    const torrentName = details.name || '';
    const combinedName = `${torrentName} ${videoName}`;
    
    console.log(`[extractQuality] Analyzing: "${combinedName}"`);
    
    // Use centralized quality extraction with fallback support
    const fallbackInfo = {
        resolution: video.info?.resolution || details.info?.resolution
    };
    
    const quality = extractQualityDisplay(combinedName, fallbackInfo);
    console.log(`[extractQuality] Found quality: ${quality}`);
    
    return quality;
}

/**
 * Sort movie streams by quality (highest quality first)
 * @param {Array} streams - Array of stream objects
 * @returns {Array} - Sorted array of streams
 */
export function sortMovieStreamsByQuality(streams) {
    return streams.sort((a, b) => {
        // Extract quality info from stream names
        const aQualityLine = a.name.split('\n')[1] || '';
        const bQualityLine = b.name.split('\n')[1] || '';
        
        // Get quality scores
        const aQualityInfo = extractQualityInfo(aQualityLine);
        const bQualityInfo = extractQualityInfo(bQualityLine);
        
        const aScore = aQualityInfo.score || -1;
        const bScore = bQualityInfo.score || -1;
        
        // Sort by quality score (highest first)
        if (aScore !== bScore) {
            return bScore - aScore;
        }
        
        // If quality scores are the same, sort by file size (largest first)
        const aTitleLines = a.title.split('\n');
        const bTitleLines = b.title.split('\n');
        const aSizeLine = aTitleLines[aTitleLines.length - 1] || '';
        const bSizeLine = bTitleLines[bTitleLines.length - 1] || '';
        
        const aSizeMatch = aSizeLine.match(/(\d+\.?\d*)\s*([KMGT]B)/);
        const bSizeMatch = bSizeLine.match(/(\d+\.?\d*)\s*([KMGT]B)/);
        
        if (aSizeMatch && bSizeMatch) {
            const aSize = parseFloat(aSizeMatch[1]);
            const bSize = parseFloat(bSizeMatch[1]);
            const aUnit = aSizeMatch[2];
            const bUnit = bSizeMatch[2];
            
            // Convert to bytes for comparison
            const unitMultiplier = { 'B': 1, 'KB': 1024, 'MB': 1024*1024, 'GB': 1024*1024*1024, 'TB': 1024*1024*1024*1024 };
            const aSizeBytes = aSize * (unitMultiplier[aUnit] || 1);
            const bSizeBytes = bSize * (unitMultiplier[bUnit] || 1);
            
            return bSizeBytes - aSizeBytes;
        }
        
        return 0;
    });
}

/**
 * Deduplicate streams to prevent duplicate entries for the same episode
 * @param {Array} streams - Array of stream objects
 * @returns {Array} - Deduplicated array of streams
 */
export function deduplicateStreams(streams) {
    const seen = new Set();
    const deduplicated = [];
    
    for (const stream of streams) {
        // Create a unique key based on the video file name (first line of title)
        const titleLines = stream.title.split('\n');
        const videoFileName = titleLines[0] || '';
        
        // Extract a more specific key - combine file name + quality + size for uniqueness
        const qualityLine = stream.name.split('\n')[1] || '';
        const sizeLine = titleLines[titleLines.length - 1] || '';
        const sizeMatch = sizeLine.match(/(\d+\.?\d*\s*[KMGT]B)/);
        const size = sizeMatch ? sizeMatch[1] : '';
        
        const uniqueKey = `${videoFileName}|${qualityLine}|${size}`.toLowerCase();
        
        if (!seen.has(uniqueKey)) {
            seen.add(uniqueKey);
            deduplicated.push(stream);
        } else {
            console.log(`[deduplicateStreams] Skipping duplicate: ${videoFileName}`);
        }
    }
    
    return deduplicated;
}
