/**
 * Provider Search Module
 * Handles bulk torrent fetching with provider-specific optimizations
 */

import { logger } from '../utils/logger.js';
import { extractKeywords } from './keyword-extractor.js';
import parseTorrentTitle from '../utils/parse-torrent-title.js';
import { FILE_TYPES } from '../utils/file-types.js';

/**
 * Provider method mapping configuration
 */
const PROVIDER_CONFIGS = {
    AllDebrid: {
        bulkMethod: 'listTorrentsParallel',
        dataMapper: (item) => ({
            source: 'alldebrid',
            id: item.id,
            name: item.filename,
            type: 'other',
            info: parseTorrentTitle.parse(item.filename),
            size: item.size,
            created: new Date(item.completionDate)
        })
    },
    DebridLink: {
        bulkMethod: 'listTorrentsParallel',
        dataMapper: (item) => ({
            source: 'debridlink',
            id: item.id.split('-')[0],
            name: item.name,
            type: 'other',
            info: parseTorrentTitle.parse(item.name),
            size: item.size,
            created: new Date(item.created * 1000)
        })
    },
    RealDebrid: {
        bulkMethod: 'listFilesParrallel',
        methodArgs: [FILE_TYPES.TORRENTS, null, 1, 1000], // apiKey will be inserted at index 1
        dataMapper: (item) => ({
            source: 'realdebrid',
            id: item.id,
            name: item.filename,
            type: 'other',
            info: parseTorrentTitle.parse(item.filename),
            size: item.bytes, // RealDebrid uses 'bytes' field, not 'size'
            created: new Date(item.added) // RealDebrid uses 'added' field
        })
    },
    TorBox: {
        bulkMethod: 'listFilesParallel',
        methodArgs: [FILE_TYPES.TORRENTS, null, 1, 1000], // apiKey will be inserted at index 1
        dataMapper: (item) => ({
            source: 'torbox',
            id: item.id,
            name: item.name,
            type: 'other',
            info: parseTorrentTitle.parse(item.name),
            size: item.size,
            created: new Date(item.created_at)
        })
    },
    Premiumize: {
        bulkMethod: 'listFiles',
        dataMapper: (item) => ({
            source: 'premiumize',
            id: item.id,
            name: item.name,
            type: 'other',
            info: parseTorrentTitle.parse(item.name),
            size: item.size,
            created: new Date(item.created_at * 1000) // Premiumize uses created_at * 1000
        })
    }
};

/**
 * Fetch all torrents from provider using optimized bulk methods
 * @param {string} provider - Provider name
 * @param {Object} providerImpl - Provider implementation
 * @param {string} apiKey - API key
 * @param {string} normalizedSearchKey - Fallback search term
 * @param {number} threshold - Search threshold for fallback
 * @returns {Array} Array of normalized torrents
 */
export async function fetchProviderTorrents(provider, providerImpl, apiKey, normalizedSearchKey, threshold) {
    logger.info(`[provider-search] Fetching all torrents from ${provider}`);
    
    const config = PROVIDER_CONFIGS[provider];
    if (!config) {
        throw new Error(`Unsupported provider: ${provider}`);
    }

    const bulkMethod = providerImpl[config.bulkMethod];
    if (!bulkMethod) {
        // Fallback: search with main title only
        logger.info(`[provider-search] Using fallback search with main title for ${provider}`);
        return await providerImpl.searchTorrents(apiKey, normalizedSearchKey, threshold);
    }

    try {
        logger.info(`[provider-search] Using ${provider} bulk ${config.bulkMethod} method`);
        
        let result;
        if (config.methodArgs) {
            // Insert apiKey at the correct position
            const args = [...config.methodArgs];
            args[1] = apiKey;
            result = await bulkMethod.apply(providerImpl, args);
        } else {
            result = await bulkMethod.call(providerImpl, apiKey);
        }
        
        // Transform results using provider-specific mapper
        const normalizedTorrents = result.map(config.dataMapper);
        
        logger.info(`[provider-search] Retrieved ${normalizedTorrents.length} total torrents from ${provider}`);
        return normalizedTorrents;
        
    } catch (error) {
        logger.warn(`[provider-search] Failed to fetch torrents from ${provider}:`, error);
        
        // Fallback to search method if available
        if (providerImpl.searchTorrents) {
            logger.info(`[provider-search] Attempting fallback search for ${provider}`);
            return await providerImpl.searchTorrents(apiKey, normalizedSearchKey, threshold);
        }
        
        throw error;
    }
}

/**
 * Ultra-fast fuzzy matching for typo tolerance
 * Only checks exact-length windows with character substitutions
 * @param {string} title - The torrent title to search in
 * @param {string} keyword - The keyword to find
 * @param {number} minSimilarity - Minimum similarity (0.85 = allow 15% character differences)
 * @returns {boolean} Whether the keyword matches the title with typo tolerance
 */
function ultraFastFuzzyMatch(title, keyword, minSimilarity = 0.85) {
    // 1. Exact match first (fastest path)
    if (title.includes(keyword)) {
        return true;
    }
    
    // 2. Skip fuzzy for very short keywords (too many false positives)
    if (keyword.length < 4) {
        return false;
    }
    
    // 3. Calculate maximum allowed character differences
    const maxDifferences = Math.floor(keyword.length * (1 - minSimilarity));
    
    // 4. Check exact-length windows with character substitution counting
    for (let i = 0; i <= title.length - keyword.length; i++) {
        const window = title.substring(i, i + keyword.length);
        let differences = 0;
        
        // Count character differences
        for (let j = 0; j < keyword.length; j++) {
            if (keyword[j] !== window[j]) {
                differences++;
                if (differences > maxDifferences) break; // Early exit
            }
        }
        
        if (differences <= maxDifferences) {
            return true;
        }
    }
    
    return false;
}

/**
 * Pre-filter torrents by keyword inclusion with ultra-fast typo tolerance
 * @param {Array} allTorrents - Array of all torrents
 * @param {Array} keywords - Keywords to filter by
 * @returns {Array} Filtered torrents
 */
export function preFilterTorrentsByKeywords(allTorrents, keywords) {
    const relevantTorrents = allTorrents.filter(torrent => {
        const normalizedTitle = extractKeywords(torrent.name).toLowerCase();
        
        return keywords.some(keyword => {
            const normalizedKeyword = extractKeywords(keyword).toLowerCase();
            
            // Use ultra-fast fuzzy matching (includes exact matching as fast path)
            return ultraFastFuzzyMatch(normalizedTitle, normalizedKeyword, 0.85);
        });
    });
    
    // Only log in production scenarios (when dealing with substantial data)
    if (allTorrents.length > 50) {
        logger.info(`[provider-search] Pre-filter: ${allTorrents.length} → ${relevantTorrents.length} relevant torrents`);
    }
    
    return relevantTorrents;
}

/**
 * Get provider configuration for debugging/logging
 * @param {string} provider - Provider name
 * @returns {Object} Provider configuration
 */
export function getProviderConfig(provider) {
    return PROVIDER_CONFIGS[provider] || null;
}
