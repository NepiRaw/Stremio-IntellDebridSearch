/**
 * Phase 0: Search Preparation Module
 * Handles search term preparation, episode mapping, and term deduplication
 */

import { logger } from '../utils/logger.js';
import { extractKeywords } from './keyword-extractor.js';
import { fetchTMDbAlternativeTitles } from '../api/tmdb.js';
import { getEpisodeMapping } from '../api/trakt.js';
import fs from 'fs';
import path from 'path';

/**
 * Get manual search terms for a specific IMDB ID from JSON configuration
 */
function getManualSearchTerms(imdbId) {
    try {
        const configPath = path.join(process.cwd(), 'src', 'config', 'manual-search-mappings.json');
        if (!fs.existsSync(configPath)) {
            return [];
        }
        
        const rawContent = fs.readFileSync(configPath, 'utf8');
        
        // Strip comments (//) for easier maintenance
        const cleanContent = rawContent
            .replace(/\/\/.*$/gm, '');
        
        const mappings = JSON.parse(cleanContent);
        return mappings[imdbId] || [];
    } catch (error) {
        logger.warn(`[phase-0] Failed to load manual search mappings: ${error.message}`);
        return [];
    }
}

/**
 * Prepare search terms and fetch episode mapping
 * @param {Object} params - Preparation parameters
 * @param {string} params.searchKey - Main search term
 * @param {string} params.type - Content type (movie/series)
 * @param {string} params.imdbId - IMDB ID
 * @param {number} params.season - Season number (for series)
 * @param {number} params.episode - Episode number (for series)
 * @param {string} params.tmdbApiKey - TMDb API key
 * @param {string} params.traktApiKey - Trakt API key
 * @returns {Object} Prepared search data
 */
export async function prepareSearchTerms(params) {
    const { searchKey, type, imdbId, season, episode, tmdbApiKey, traktApiKey } = params;
    
    logger.info('[phase-0] Starting search preparation');
    
    const apiCalls = [];
    
    let absoluteEpisodePromise = null;
    if (traktApiKey && type === 'series' && season && episode) {
        logger.info(`[phase-0] Fetching absolute episode mapping for S${season}E${episode}`);
        absoluteEpisodePromise = getEpisodeMapping(traktApiKey, imdbId, season, episode);
        apiCalls.push(absoluteEpisodePromise);
    }
    
    // Fetch alternative titles from TMDb
    let alternativeTitlesPromise = null;
    if (tmdbApiKey && type && imdbId) {
        logger.info('[phase-0] TMDb API available, fetching alternative titles');
        alternativeTitlesPromise = fetchTMDbAlternativeTitles(null, type, tmdbApiKey, imdbId);
        apiCalls.push(alternativeTitlesPromise);
    }
    
    // Wait for all API calls to complete in parallel
    let absoluteEpisode = null;
    let alternativeTitles = [];
    
    if (apiCalls.length > 0) {
        const startTime = Date.now();
        
        const results = await Promise.all([
            absoluteEpisodePromise || Promise.resolve(null),
            alternativeTitlesPromise || Promise.resolve([])
        ]);
        
        absoluteEpisode = results[0];
        alternativeTitles = results[1];
        
        const duration = Date.now() - startTime;
        
        if (absoluteEpisode) {
            if (absoluteEpisode.absoluteEpisode != null) {
                logger.info(`[phase-0] ✅ Found absolute episode: ${absoluteEpisode.absoluteEpisode} (${absoluteEpisode.title || 'No title'})`);
            } else {
                logger.info(`[phase-0] ❌ No absolute episode number found, but got title: ${absoluteEpisode.title || 'No title'}`);
            }
        } else if (traktApiKey && type === 'series' && season && episode) {
            logger.info(`[phase-0] ❌ No absolute episode found from Trakt API`);
        }
    }
    
    // Prepare all search terms + Add raw titles first for exact matching
    const allSearchTerms = [];
    
    allSearchTerms.push(searchKey); // 1. Add the original search key (non-normalized) first for exact matches
    
    // 2. Add manual search terms from JSON configuration
    const manualTerms = getManualSearchTerms(imdbId);
    if (manualTerms.length > 0) {
        logger.info(`[phase-0] 🎯 Adding ${manualTerms.length} manual search terms for ${imdbId}: ${manualTerms.join(', ')}`);
        allSearchTerms.push(...manualTerms);
    }
    
    if (alternativeTitles.length > 0) { // 3. Add raw alternative titles (non-normalized) for exact matches
        const rawAlternatives = alternativeTitles.map(alt => alt.title || alt);
        allSearchTerms.push(...rawAlternatives);
    }
    
    const normalizedSearchKey = extractKeywords(searchKey); // 4. Then add normalized versions for fuzzy matching
    allSearchTerms.push(normalizedSearchKey);
    
    if (alternativeTitles.length > 0) {
        // Extract normalized titles from the new format with country info
        const normalizedAlternatives = alternativeTitles.map(alt => alt.normalizedTitle || alt);
        allSearchTerms.push(...normalizedAlternatives);
    }

    // Deduplicate normalized search terms to reduce redundant Fuse.js searches
    const termMap = new Map();
    allSearchTerms.filter(term => term && term.trim()).forEach(term => {
        const lowerKey = term.toLowerCase();
        if (!termMap.has(lowerKey)) {
            termMap.set(lowerKey, term); // Keep first occurrence with original casing
        }
    });
    const uniqueSearchTerms = Array.from(termMap.values());
    
    logger.info(`[phase-0] Deduplicated search terms: ${allSearchTerms.length} → ${uniqueSearchTerms.length} unique terms`);

    return {
        normalizedSearchKey,
        alternativeTitles,
        uniqueSearchTerms,
        absoluteEpisode
    };
}

/**
 * Generate episode-specific keywords for series content
 * @param {string} type - Content type
 * @param {number} season - Season number
 * @param {number} episode - Episode number
 * @param {Object} absoluteEpisode - Absolute episode object
 * @param {Array} uniqueSearchTerms - Base search terms
 * @returns {Array} Extended keywords including episode-specific terms
 */
export function generateEpisodeKeywords(type, season, episode, absoluteEpisode, uniqueSearchTerms) {
    const keywords = uniqueSearchTerms.filter(term => term && typeof term === "string");
    
    if (type === 'movie') {
        logger.debug(`[phase-0] Generated movie keywords (${keywords.length}): ${keywords.join(', ')}`);
        return keywords;
    }
    
    // Add episode-specific keywords for series
    if (type === 'series' && season && episode) {
        keywords.push(`S${season}E${episode}`);
        
        // Add absolute episode keywords if available
        if (absoluteEpisode && absoluteEpisode.absoluteEpisode && absoluteEpisode.absoluteEpisode !== parseInt(episode)) {
            const absNum = absoluteEpisode.absoluteEpisode;
            
            const paddedAbs = absNum.toString().padStart(3, '0'); // Add 3-digit zero-padded format (e.g., "029")
            keywords.push(`${paddedAbs}`);
            keywords.push(`${absNum}`);// Also add non-padded format (e.g., "29")
        }
    }

    logger.debug(`[phase-0] Generated keywords (${keywords.length}): ${keywords.join(', ')}`);
    return keywords;
}