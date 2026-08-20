/**
 * Quality processing module for stream quality extraction and analysis
 * Handles quality extraction, scoring, and display formatting
 */

import { qualityLine, qualityRank } from './display.js';
import { logger } from '../utils/logger.js';

export function extractQuality(video, details) {
    return qualityLine(video?.parsed, details?.parsed);
}

/** Falls back to the built strings for a stream created without ranking signals. */
function rankOf(stream) {
    if (stream.rank) return stream.rank;

    const sizeLine = stream.title.split('\n').at(-1) || '';
    const size = sizeLine.match(/(\d+\.?\d*)\s*([KMGT]?B)/);
    const unit = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 };

    return {
        isVariant: stream.title.includes('🔄 Variant:'),
        match: 0,
        quality: qualityRank(stream.name.split('\n')[1] || ''),
        size: size ? parseFloat(size[1]) * (unit[size[2]] || 1) : 0
    };
}

/**
 * Best first: a release of the work asked for before a variant of it, then how well the name answers
 * the requested episode, then resolution, then size. Variants keep the same order among themselves.
 */
export function sortStreamsByRank(streams) {
    return streams.sort((a, b) => {
        const left = rankOf(a);
        const right = rankOf(b);

        return (Number(left.isVariant) - Number(right.isVariant))
            || (right.match - left.match)
            || (right.quality - left.quality)
            || (right.size - left.size);
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