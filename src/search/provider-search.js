/**
 * Provider Search Module
 * Handles bulk torrent fetching with provider-specific optimizations
 */

import { logger } from '../utils/logger.js';
import { extractKeywords } from './keyword-extractor.js';
import { configManager } from '../config/configuration.js';
import { isSameWork } from './phase-1-title-matching.js';
import { parseName } from '../parsing/parser.js';

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
    if (wordBoundaryIncludes(title, keyword)) {
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

function wordBoundaryIncludes(text, keyword) {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escaped}\\b`, 'i').test(text);
}

function matchesAnyKeyword(torrentName, keywords) {
    const normalizedTitle = extractKeywords(torrentName).toLowerCase();
    const normalizedTorrentForRaw = torrentName.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();

    return keywords.some(keyword => {
        const normalizedKeywordForRaw = keyword.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();

        if (wordBoundaryIncludes(normalizedTorrentForRaw, normalizedKeywordForRaw)) {
            return true;
        }

        return ultraFastFuzzyMatch(normalizedTitle, extractKeywords(keyword).toLowerCase(), 0.85);
    });
}

/**
 * Pre-filter torrents by keyword inclusion with optimized performance
 * @param {Array} allTorrents - Array of all torrents
 * @param {Array} keywords - Keywords to filter by
 * @param {Array<Set<string>>} aliasVocabularies - Alias vocabularies for the identity lane
 * @returns {Promise<Array>} Filtered torrents
 */
export async function preFilterTorrentsByKeywords(allTorrents, keywords, aliasVocabularies = []) {
    const startTime = Date.now();
    let rescued = 0;

    const relevantTorrents = allTorrents.filter(torrent => {
        if (matchesAnyKeyword(torrent.name, keywords)) {
            return true;
        }

        if (!aliasVocabularies.length || !isSameWork(parseName(torrent.name)?.title, aliasVocabularies)) {
            return false;
        }

        rescued++;
        return true;
    });

    const endTime = Date.now();
    logger.info(`[provider-search] Pre-filter: ${allTorrents.length} → ${relevantTorrents.length} relevant torrents (${rescued} by title identity, ${endTime - startTime}ms)`);

    return relevantTorrents;
}

export function getProviderConfig(provider) {
    return configManager.getProviderConfig(provider);
}