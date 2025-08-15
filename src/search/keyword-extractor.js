/**
 * Keyword Extractor
 * Handles text normalization and keyword extraction
 * This module is used in Phase1 for fast title matching
 */

import { isRomanNumeral, JOIN_ROMAN_NUMERALS_PATTERN } from '../utils/roman-numeral-utils.js';

/**
 * Extract keywords from title for search optimization
 * @param {string} title - Title to extract keywords from
 * @returns {string} - Normalized keywords
 */
export function extractKeywords(title) {
    if (!title || typeof title !== 'string') return '';
    
    return title
        .normalize("NFKC")
        .replace(/[^\p{L}\p{N}\s]/gu, " ") // Replace ALL punctuation with spaces to preserve word boundaries
        .trim()
        .replace(/\s{2,}/g, " ") // Collapse multiple spaces
        .replace(JOIN_ROMAN_NUMERALS_PATTERN, "$1$2") // Join separate Roman numerals
        .split(/\s+/)
        .filter(word =>
            word.length > 1 ||
            word.toLowerCase() === "a" ||
            word === "I" ||
            (isRomanNumeral(word) || /^\d+$/.test(word)) // Keep Roman numerals and numbers
        )
        .slice(0, 15) // Limit to prevent overly long searches
        .join(" ");
}