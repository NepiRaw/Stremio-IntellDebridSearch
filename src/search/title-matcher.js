import { fetchTMDbAlternativeTitles, searchTMDbByTitle } from '../api/tmdb.js';
import { calculateFuzzyScore, extractKeywords, findBestMatch } from '../utils/string-utils.js';
import { logger } from '../utils/logger.js';
import Fuse from 'fuse.js';

/**
 * Title matcher module - handles title matching using fuzzy logic and alternative titles
 * Improves search accuracy by matching variations and alternative titles
 */

/**
 * Extract and normalize title keywords for search
 * @param {string} title - Title to extract keywords from
 * @returns {string} - Normalized keywords string
 */
export function extractTitleKeywords(title) {
    if (!title || typeof title !== 'string') return '';
    
    return title
        .normalize("NFKC") // Unicode normalization
        .replace(/[^\p{L}\p{N}\s?!]/gu, " ") // Replace punctuation with spaces to preserve word boundaries
        .trim()
        .replace(/\s{2,}/g, " ") // Collapse multiple spaces
        .replace(/\b([IVXLCDM]+)\s([IVXLCDM]+)\b/g, "$1$2") // Join separate Roman numerals
        .split(/\s+/)
        .filter(word =>
            word.length > 1 ||
            word.toLowerCase() === "a" ||
            word === "I" ||
            /^[IVXLCDM\d]+$/.test(word) // Keep Roman numerals and numbers
        )
        .slice(0, 15) // Limit to prevent overly long searches
        .join(" ");
}

/**
 * Calculate fuzzy score between search title and torrent title
 * @param {string} searchTitle - The title being searched for
 * @param {string} torrentTitle - The torrent title to compare against
 * @param {string[]} alternativeTitles - Alternative titles to consider
 * @returns {object} - Score information with details
 */
export function calculateTitleFuzzyScore(searchTitle, torrentTitle, alternativeTitles = []) {
    if (!searchTitle || !torrentTitle) {
        return { score: 0, matchType: 'no_match', details: 'Missing titles' };
    }

    const normalizedSearch = searchTitle.toLowerCase().trim();
    const normalizedTorrent = torrentTitle.toLowerCase().trim();
    
    // Exact match
    if (normalizedSearch === normalizedTorrent) {
        return { score: 1.0, matchType: 'exact', details: 'Exact title match' };
    }

    // Check against alternative titles
    for (const altTitle of alternativeTitles) {
        if (altTitle && normalizedSearch === altTitle.toLowerCase().trim()) {
            return { score: 0.95, matchType: 'alternative_exact', details: `Exact match with alternative title: ${altTitle}` };
        }
    }

    // Extract keywords for comparison
    const searchKeywords = extractTitleKeywords(normalizedSearch);
    const torrentKeywords = extractTitleKeywords(normalizedTorrent);
    
    if (!searchKeywords || !torrentKeywords) {
        return { score: 0, matchType: 'no_keywords', details: 'No keywords found' };
    }

    // Calculate base fuzzy score
    let baseScore = calculateFuzzyScore(searchKeywords, torrentKeywords, {
        exactMatchBonus: 0.3,
        substringBonus: 0.2,
        wordBoundaryBonus: 0.1
    });

    // Check for substring matches
    if (normalizedTorrent.includes(normalizedSearch)) {
        baseScore += 0.2;
    } else if (normalizedSearch.includes(normalizedTorrent)) {
        baseScore += 0.15;
    }

    // Check alternative titles for partial matches
    let bestAltScore = 0;
    let bestAltTitle = '';
    for (const altTitle of alternativeTitles) {
        if (!altTitle) continue;
        
        const altScore = calculateFuzzyScore(searchKeywords, extractTitleKeywords(altTitle.toLowerCase()));
        if (altScore > bestAltScore) {
            bestAltScore = altScore;
            bestAltTitle = altTitle;
        }
    }

    // Use best alternative if it's better than direct match
    if (bestAltScore > baseScore) {
        return {
            score: Math.min(bestAltScore + 0.1, 1.0), // Small bonus for alternative match
            matchType: 'alternative_fuzzy',
            details: `Best alternative match: ${bestAltTitle}`
        };
    }

    // Determine match type based on score
    let matchType = 'fuzzy';
    if (baseScore >= 0.8) matchType = 'high_fuzzy';
    else if (baseScore >= 0.6) matchType = 'medium_fuzzy';
    else if (baseScore >= 0.4) matchType = 'low_fuzzy';
    else matchType = 'poor_match';

    return {
        score: Math.min(baseScore, 1.0),
        matchType,
        details: `Fuzzy match score: ${baseScore.toFixed(3)}`
    };
}

/**
 * Perform fuzzy matching against multiple titles
 * @param {string} extractedTitle - Title to search for
 * @param {string[]} alternativeTitles - Array of alternative titles
 * @param {object[]} torrents - Array of torrent objects with name/title property
 * @param {number} threshold - Minimum score threshold (default 0.3)
 * @returns {object[]} - Array of matches with scores
 */
export function performFuzzyMatching(extractedTitle, alternativeTitles = [], torrents = [], threshold = 0.3) {
    if (!extractedTitle || !Array.isArray(torrents)) {
        logger.warn('[title-matcher] Invalid input for fuzzy matching');
        return [];
    }

    const matches = [];
    
    for (const torrent of torrents) {
        const torrentTitle = torrent.name || torrent.title || '';
        if (!torrentTitle) continue;

        const scoreInfo = calculateTitleFuzzyScore(extractedTitle, torrentTitle, alternativeTitles);
        
        if (scoreInfo.score >= threshold) {
            matches.push({
                torrent,
                score: scoreInfo.score,
                matchType: scoreInfo.matchType,
                details: scoreInfo.details,
                title: torrentTitle
            });
        }
    }

    // Sort by score (highest first)
    matches.sort((a, b) => b.score - a.score);
    
    logger.debug(`[title-matcher] Found ${matches.length} matches above threshold ${threshold} for "${extractedTitle}"`);
    
    return matches;
}

/**
 * Get alternative titles from TMDb and perform enhanced matching
 * @param {string} searchTitle - Title to search for
 * @param {string} tmdbId - TMDb ID
 * @param {string} imdbId - IMDb ID
 * @param {string} type - Content type ('movie' or 'series')
 * @param {string} tmdbApiKey - TMDb API key
 * @returns {Promise<object>} - Alternative titles and search data
 */
export async function getAlternativeTitlesForMatching(searchTitle, tmdbId, imdbId, type, tmdbApiKey) {
    if (!tmdbApiKey) {
        logger.warn('[title-matcher] No TMDb API key provided, using original title only');
        return {
            originalTitle: searchTitle,
            alternativeTitles: [],
            searchTitle: extractTitleKeywords(searchTitle),
            hasAlternatives: false
        };
    }

    try {
        // Fetch alternative titles from TMDb
        const alternativeTitles = await fetchTMDbAlternativeTitles(tmdbId, type, tmdbApiKey, imdbId);
        
        logger.debug(`[title-matcher] Found ${alternativeTitles.length} alternative titles for "${searchTitle}"`);
        
        return {
            originalTitle: searchTitle,
            alternativeTitles,
            searchTitle: extractTitleKeywords(searchTitle),
            hasAlternatives: alternativeTitles.length > 0
        };
        
    } catch (err) {
        logger.warn(`[title-matcher] Failed to fetch alternative titles:`, err.message);
        return {
            originalTitle: searchTitle,
            alternativeTitles: [],
            searchTitle: extractTitleKeywords(searchTitle),
            hasAlternatives: false
        };
    }
}

/**
 * Detect simple title variants (like Roman numerals, sequels)
 * @param {string} extractedTitle - Extracted title
 * @param {string} searchTitle - Original search title
 * @param {string[]} alternativeTitles - Alternative titles
 * @returns {object} - Variant detection result
 */
export function detectTitleVariants(extractedTitle, searchTitle, alternativeTitles = []) {
    if (!extractedTitle || !searchTitle) {
        return { hasVariants: false, variants: [] };
    }

    const variants = new Set([extractedTitle, searchTitle]);
    
    // Add alternative titles
    alternativeTitles.forEach(title => {
        if (title && title.trim()) {
            variants.add(title.trim());
        }
    });

    // Generate Roman numeral variants
    const romanNumerals = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
    const arabicNumbers = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];
    
    for (const title of Array.from(variants)) {
        // Convert Roman to Arabic
        romanNumerals.forEach((roman, index) => {
            if (title.includes(` ${roman}`)) {
                variants.add(title.replace(` ${roman}`, ` ${arabicNumbers[index]}`));
            }
        });
        
        // Convert Arabic to Roman
        arabicNumbers.forEach((arabic, index) => {
            if (title.includes(` ${arabic}`)) {
                variants.add(title.replace(` ${arabic}`, ` ${romanNumerals[index]}`));
            }
        });
    }

    // Generate common abbreviation variants
    const abbreviations = [
        ['and', '&'],
        ['&', 'and'],
        ['vs', 'versus'],
        ['versus', 'vs']
    ];
    
    for (const title of Array.from(variants)) {
        abbreviations.forEach(([from, to]) => {
            const regex = new RegExp(`\\b${from}\\b`, 'gi');
            if (regex.test(title)) {
                variants.add(title.replace(regex, to));
            }
        });
    }

    const variantArray = Array.from(variants).filter(v => v !== extractedTitle);
    
    return {
        hasVariants: variantArray.length > 0,
        variants: variantArray,
        totalVariants: variants.size
    };
}

/**
 * Enhanced title matching with multiple strategies
 * @param {string} searchTitle - Title to search for
 * @param {object[]} torrents - Array of torrents to search through
 * @param {object} options - Matching options
 * @returns {Promise<object[]>} - Matched torrents with scores
 */
export async function enhancedTitleMatching(searchTitle, torrents, options = {}) {
    const {
        tmdbId = null,
        imdbId = null,
        type = 'series',
        tmdbApiKey = null,
        threshold = 0.3,
        maxResults = 50
    } = options;

    if (!searchTitle || !Array.isArray(torrents)) {
        logger.warn('[title-matcher] Invalid input for enhanced matching');
        return [];
    }

    // Get alternative titles and variants
    const titleData = await getAlternativeTitlesForMatching(searchTitle, tmdbId, imdbId, type, tmdbApiKey);
    const variantData = detectTitleVariants(titleData.searchTitle, titleData.originalTitle, titleData.alternativeTitles);
    
    // Combine all possible title variations
    const allTitleVariations = [
        titleData.originalTitle,
        titleData.searchTitle,
        ...titleData.alternativeTitles,
        ...variantData.variants
    ].filter(Boolean);

    logger.debug(`[title-matcher] Using ${allTitleVariations.length} title variations for matching`);

    // Perform fuzzy matching with all variations
    const matches = performFuzzyMatching(titleData.searchTitle, allTitleVariations, torrents, threshold);
    
    // Enhance matches with additional metadata
    const enhancedMatches = matches.map(match => ({
        ...match,
        alternativeTitles: titleData.alternativeTitles,
        hasAlternatives: titleData.hasAlternatives,
        variants: variantData.variants,
        searchStrategy: 'enhanced_fuzzy'
    }));

    // Return top results
    return enhancedMatches.slice(0, maxResults);
}

/**
 * Quick title matching for simple cases (no API calls)
 * @param {string} searchTitle - Title to search for
 * @param {object[]} torrents - Array of torrents to search through
 * @param {number} threshold - Minimum score threshold
 * @returns {object[]} - Matched torrents with scores
 */
export function quickTitleMatching(searchTitle, torrents, threshold = 0.5) {
    if (!searchTitle || !Array.isArray(torrents)) {
        logger.warn('[title-matcher] Invalid input for quick matching');
        return [];
    }

    const extractedTitle = extractTitleKeywords(searchTitle);
    const variantData = detectTitleVariants(extractedTitle, searchTitle);
    
    // Use Fuse.js for quick fuzzy search
    const fuse = new Fuse(torrents, {
        keys: ['name', 'title'],
        threshold: 1 - threshold, // Fuse uses inverse threshold
        minMatchCharLength: 2,
        includeScore: true
    });

    const searchResults = fuse.search(extractedTitle);
    
    return searchResults.map(result => ({
        torrent: result.item,
        score: 1 - result.score, // Convert back to our scoring system
        matchType: 'quick_fuzzy',
        details: `Quick fuzzy match`,
        title: result.item.name || result.item.title,
        searchStrategy: 'quick_fuzzy'
    }));
}
