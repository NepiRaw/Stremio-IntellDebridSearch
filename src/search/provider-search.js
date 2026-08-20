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
 * @param {string|Promise<string>} normalizedSearchKey - Fallback search term, awaited only on the
 *   two paths that use it, so a caller can hand over a promise and let the listing start first
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
        return await providerImpl.searchTorrents(apiKey, await normalizedSearchKey, threshold);
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
            return await providerImpl.searchTorrents(apiKey, await normalizedSearchKey, threshold);
        }
        
        // No fallback available, re-throw the error
        throw error;
    }
}

/** Typo tolerance: 0.85 allows 15% of a keyword's characters to differ. */
const MIN_SIMILARITY = 0.85;

function normalizeRaw(text) {
    return text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

function wordBoundaryPattern(keyword) {
    return new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
}

/**
 * Everything a keyword needs in order to be tested
 * Built once per request instead of once per (torrent, keyword) pair
 */
function prepareKeywords(keywords) {
    return keywords.map(keyword => {
        const extracted = extractKeywords(keyword).toLowerCase();

        return {
            rawPattern: wordBoundaryPattern(normalizeRaw(keyword)),
            extracted,
            extractedPattern: wordBoundaryPattern(extracted),
            maxDifferences: Math.floor(extracted.length * (1 - MIN_SIMILARITY))
        };
    });
}

/** Whether any window of the title differs from the keyword by no more than its tolerance. */
function fuzzyMatches(title, { extracted, extractedPattern, maxDifferences }) {
    if (extractedPattern.test(title)) {
        return true;
    }

    if (extracted.length < 4) {
        return false;
    }

    for (let i = 0; i <= title.length - extracted.length; i++) {
        let differences = 0;

        for (let j = 0; j < extracted.length; j++) {
            if (extracted[j] !== title[i + j]) {
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

function matchesAnyKeyword(torrentName, prepared) {
    const normalizedTitle = extractKeywords(torrentName).toLowerCase();
    const normalizedRaw = normalizeRaw(torrentName);

    return prepared.some(keyword =>
        keyword.rawPattern.test(normalizedRaw) || fuzzyMatches(normalizedTitle, keyword));
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

    const prepared = prepareKeywords(keywords);

    const relevantTorrents = allTorrents.filter(torrent => {
        if (matchesAnyKeyword(torrent.name, prepared)) {
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