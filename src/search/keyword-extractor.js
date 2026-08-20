/**
 * Keyword Extractor
 * Handles text normalization and keyword extraction
 * This module is used in Phase1 for fast title matching
 */

/**
 * Extract keywords from title for search optimization
 * @param {string} title - Title to extract keywords from
 * @returns {string} - Normalized keywords
 */
export function extractKeywords(title) {
    if (!title || typeof title !== 'string') return '';
    
    return title
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^\p{L}\p{N}\s]/gu, " ") // Replace ALL punctuation with spaces to preserve word boundaries
        .trim()
        .replace(/\s{2,}/g, " ") // Collapse multiple spaces
        .split(/\s+/)
        .filter(word =>
            word.length > 1 ||
            word.toLowerCase() === "a" ||
            /^[ivxlcdm]$/i.test(word) || // Single-letter title words: "Initial D", "Darou ka V"
            /^\d+$/.test(word)
        )
        .slice(0, 15) // Limit to prevent overly long searches
        .join(" ");
}