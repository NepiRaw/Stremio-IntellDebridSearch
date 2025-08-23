/**
 * Quality processing module for stream quality extraction and analysis
 * Handles quality extraction, scoring, and display formatting
 */

import { extractQualityDisplay, extractQualityInfo } from '../utils/media-patterns.js';
import { logger } from '../utils/logger.js';

export function extractQuality(video, details) {
    const videoName = video.name || '';
    const torrentName = details.name || '';
    const combinedName = `${torrentName} ${videoName}`;
    
    logger.debug(`[extractQuality] Analyzing: "${combinedName}"`);
    
    const fallbackInfo = {
        resolution: video.info?.resolution || details.info?.resolution
    };
    
    const quality = extractQualityDisplay(combinedName, fallbackInfo);
    logger.debug(`[extractQuality] Found quality: ${quality}`);
    
    return quality;
}

export function sortMovieStreamsByQuality(streams) {
    return streams.sort((a, b) => {
        const aQualityLine = a.name.split('\n')[1] || '';
        const bQualityLine = b.name.split('\n')[1] || '';
        
        const aQualityInfo = extractQualityInfo(aQualityLine);
        const bQualityInfo = extractQualityInfo(bQualityLine);
        
        const aScore = aQualityInfo.score || -1;
        const bScore = bQualityInfo.score || -1;
        
        if (aScore !== bScore) {
            return bScore - aScore;
        }
        
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
            
            const unitMultiplier = { 'B': 1, 'KB': 1024, 'MB': 1024*1024, 'GB': 1024*1024*1024, 'TB': 1024*1024*1024*1024 };
            const aSizeBytes = aSize * (unitMultiplier[aUnit] || 1);
            const bSizeBytes = bSize * (unitMultiplier[bUnit] || 1);
            
            return bSizeBytes - aSizeBytes;
        }
        
        return 0;
    });
}

export function deduplicateStreams(streams) {
    const seen = new Set();
    const deduplicated = [];
    let duplicateCount = 0;
    
    for (const stream of streams) {
        const titleLines = stream.title.split('\n');
        const videoFileName = titleLines[0] || '';
        
        const sizeLine = titleLines[titleLines.length - 1] || '';
        const sizeMatch = sizeLine.match(/(\d+\.?\d*\s*[KMGT]B)/);
        const size = sizeMatch ? sizeMatch[1] : '';
        
        const uniqueKey = `${videoFileName}|${size}`.toLowerCase();
        
        if (!seen.has(uniqueKey)) {
            seen.add(uniqueKey);
            deduplicated.push(stream);
        } else {
            logger.info(`[quality-processor] 🔄 Filtered duplicate stream: ${videoFileName} (${size})`);
            duplicateCount++;
        }
    }
    
    if (duplicateCount > 0) {
        logger.info(`[quality-processor] 📊 Stream deduplication: ${streams.length} → ${deduplicated.length} streams (filtered ${duplicateCount} duplicates)`);
    }
    
    return deduplicated;
}