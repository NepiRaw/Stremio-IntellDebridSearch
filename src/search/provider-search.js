/**
 * Provider Search Module
 * Handles bulk torrent fetching with provider-specific optimizations
 */

import { logger } from '../utils/logger.js';
import { extractKeywords } from './keyword-extractor.js';
import { configManager } from '../config/configuration.js';

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
    
    const config = configManager.getProviderConfig(provider);
    if (!config) {
        logger.error(`[provider-search] Unsupported provider: ${provider}`);
        throw new Error(`Unsupported provider: ${provider}`);
    }

    const bulkMethod = providerImpl[config.bulkMethod];
    if (!bulkMethod) {
        if (typeof providerImpl.searchTorrents !== 'function') {
            logger.error(`[provider-search] ${provider} implementation error: Missing both '${config.bulkMethod}' and 'searchTorrents' methods`);
            throw new Error(`${provider} does not support torrent fetching - missing both '${config.bulkMethod}' and 'searchTorrents' methods`);
        }
        
        logger.info(`[provider-search] ${provider} using fallback searchTorrents method (no bulk support)`);
        return await providerImpl.searchTorrents(apiKey, normalizedSearchKey, threshold);
    }

    try {
        let result;
        if (config.methodArgs) {
            const args = [...config.methodArgs];
            args[1] = apiKey;
            result = await bulkMethod.apply(providerImpl, args);
        } else {
            result = await bulkMethod.call(providerImpl, apiKey);
        }
        
        const safeResult = Array.isArray(result) ? result : [];
        const normalizedTorrents = safeResult.map(config.dataMapper);
        
        logger.info(`[provider-search] Retrieved ${normalizedTorrents.length} total torrents from ${provider}`);
        return normalizedTorrents;
        
    } catch (error) {
        logger.warn(`[provider-search] Failed to fetch torrents from ${provider}:`, error.message);
        
        // Check if fallback method exists before calling it
        if (typeof providerImpl.searchTorrents === 'function') {
            logger.info(`[provider-search] Falling back to searchTorrents for ${provider}`);
            return await providerImpl.searchTorrents(apiKey, normalizedSearchKey, threshold);
        }
        
        // No fallback available, re-throw the error
        throw error;
    }
}

/**
 * Ultra-fast fuzzy matching for typo tolerance
 * @param {string} title - The torrent title to search in
 * @param {string} keyword - The keyword to find
 * @param {number} minSimilarity - Minimum similarity (0.85 = allow 15% character differences)
 * @returns {boolean} Whether the keyword matches the title with typo tolerance
 */
function ultraFastFuzzyMatch(title, keyword, minSimilarity = 0.85) {
    if (title.includes(keyword)) {
        return true;
    }
    
    if (keyword.length < 4) {
        return false;
    }
    
    const maxDifferences = Math.floor(keyword.length * (1 - minSimilarity));
    
    for (let i = 0; i <= title.length - keyword.length; i++) {
        const window = title.substring(i, i + keyword.length);
        let differences = 0;
        
        for (let j = 0; j < keyword.length; j++) {
            if (keyword[j] !== window[j]) {
                differences++;
                if (differences > maxDifferences) break;
            }
        }
        
        if (differences <= maxDifferences) {
            return true;
        }
    }
    
    return false;
}

/**
 * Pre-filter torrents by keyword inclusion with optimized performance
 * @param {Array} allTorrents - Array of all torrents
 * @param {Array} keywords - Keywords to filter by
 * @returns {Promise<Array>} Filtered torrents
 */
export async function preFilterTorrentsByKeywords(allTorrents, keywords) {
    const startTime = Date.now();
    
    const relevantTorrents = allTorrents.filter(torrent => {
        const normalizedTitle = extractKeywords(torrent.name).toLowerCase();
        
        return keywords.some(keyword => {
            const normalizedTorrentForRaw = torrent.name.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
            const normalizedKeywordForRaw = keyword.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
            
            if (normalizedTorrentForRaw.includes(normalizedKeywordForRaw)) {
                return true;
            }
            const normalizedKeyword = extractKeywords(keyword).toLowerCase();
            
            return ultraFastFuzzyMatch(normalizedTitle, normalizedKeyword, 0.85);
        });
    });
    
    const endTime = Date.now();
    logger.info(`[provider-search] Pre-filter: ${allTorrents.length} → ${relevantTorrents.length} relevant torrents (${endTime - startTime}ms)`);
    
    return relevantTorrents;
}

export function getProviderConfig(provider) {
    return configManager.getProviderConfig(provider);
}