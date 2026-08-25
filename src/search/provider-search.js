/**
 * Provider Search Module
 * Handles bulk torrent fetching with provider-specific optimizations
 */

import Fuse from 'fuse.js';
import { logger } from '../utils/logger.js';
import { getProvider } from '../providers/index.js';
import { extractKeywords } from './keyword-extractor.js';
import { configManager } from '../config/configuration.js';
import { isSameWork } from './phase-1-title-matching.js';
import { parseName } from '../parsing/parser.js';

/**
 * Fetch all torrents from provider using optimized bulk methods
 * @param {string} providerName - Provider name
 * @param {Object} legacyProvider - Legacy provider instance, used until the provider migrates
 * @param {string} apiKey - API key
 * @param {string|Promise<string>} normalizedSearchKey - Fallback search term, awaited only on the
 *   two paths that use it, so a caller can hand over a promise and let the listing start first
 * @param {number} threshold - Search threshold for fallback
 * @returns {Array} Array of normalized torrents
 */
export async function fetchProviderTorrents(providerName, legacyProvider, apiKey, normalizedSearchKey, threshold) {
    logger.info(`[provider-search] Fetching all torrents from ${providerName}`);

    const provider = getProvider(providerName);
    if (provider) {
        const torrents = await provider.listTorrents(apiKey);
        logger.info(`[provider-search] Retrieved ${torrents.length} total torrents from ${providerName}`);
        return torrents;
    }

    const config = configManager.getProviderConfig(providerName);
    if (!config) {
        logger.error(`[provider-search] Unsupported provider: ${providerName}`);
        throw new Error(`Unsupported provider: ${providerName}`);
    }

    const bulkMethod = legacyProvider[config.bulkMethod];
    if (!bulkMethod) {
        if (typeof legacyProvider.searchTorrents !== 'function') {
            logger.error(`[provider-search] ${providerName} implementation error: Missing both '${config.bulkMethod}' and 'searchTorrents' methods`);
            throw new Error(`${providerName} does not support torrent fetching - missing both '${config.bulkMethod}' and 'searchTorrents' methods`);
        }

        logger.info(`[provider-search] ${providerName} using fallback searchTorrents method (no bulk support)`);
        return await legacyProvider.searchTorrents(apiKey, await normalizedSearchKey, threshold);
    }

    try {
        let result;
        if (config.methodArgs) {
            const args = [...config.methodArgs];
            args[1] = apiKey;
            result = await bulkMethod.apply(legacyProvider, args);
        } else {
            result = await bulkMethod.call(legacyProvider, apiKey);
        }

        const safeResult = Array.isArray(result) ? result : [];
        const normalizedTorrents = safeResult.map(config.dataMapper);

        logger.info(`[provider-search] Retrieved ${normalizedTorrents.length} total torrents from ${providerName}`);
        return normalizedTorrents;

    } catch (error) {
        logger.warn(`[provider-search] Failed to fetch torrents from ${providerName}:`, error.message);

        // Check if fallback method exists before calling it
        if (typeof legacyProvider.searchTorrents === 'function') {
            logger.info(`[provider-search] Falling back to searchTorrents for ${providerName}`);
            return await legacyProvider.searchTorrents(apiKey, await normalizedSearchKey, threshold);
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

/**
 * The catalog's own search, used when no advanced search is configured: list the library, then
 * fuzzy match its names. Matching never belongs in a provider module, so it lives here.
 */
export async function searchProviderLibrary(providerName, legacyProvider, apiKey, searchKey, threshold = 0.3) {
    if (!getProvider(providerName)) return legacyProvider.searchTorrents(apiKey, searchKey, threshold);

    const torrents = await fetchProviderTorrents(providerName, legacyProvider, apiKey, searchKey, threshold);
    if (!searchKey) return torrents;

    const fuse = new Fuse(torrents, { keys: ['name', 'filename'], threshold, minMatchCharLength: 2, includeScore: true });
    const found = fuse.search(searchKey).map(result => ({ ...result.item, searchScore: result.score }));

    logger.debug(`[provider-search] Library search for "${searchKey}": ${found.length} of ${torrents.length} torrents`);
    return found;
}
