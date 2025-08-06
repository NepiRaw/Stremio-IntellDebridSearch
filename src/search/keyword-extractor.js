/**
 * Keyword Extractor - Extracted from working advanced-search.js
 * Handles text normalization and keyword extraction
 */

/**
 * Extract keywords from title for search optimization
 * @param {string} title - Title to extract keywords from
 * @returns {string} - Normalized keywords
 */
export function extractKeywords(title) {
    if (!title || typeof title !== 'string') return '';
    
    return title
        .normalize("NFKC") // Unicode normalization
        .replace(/[^\p{L}\p{N}\s]/gu, " ") // Replace ALL punctuation with spaces to preserve word boundaries
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
