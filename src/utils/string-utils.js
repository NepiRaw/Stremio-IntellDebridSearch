/**
 * String manipulation and similarity calculation utilities
 * Centralizes string operations used across multiple modules
 */

/**
 * Calculate string similarity using Levenshtein distance
 * @param {string} str1 - First string
 * @param {string} str2 - Second string
 * @returns {number} - Similarity score between 0 and 1 (1 = identical)
 */
export function calculateStringSimilarity(str1, str2) {
    if (!str1 || !str2) return 0;
    if (str1 === str2) return 1;

    const distance = levenshteinDistance(str1.toLowerCase(), str2.toLowerCase());
    const maxLength = Math.max(str1.length, str2.length);
    
    if (maxLength === 0) return 1;
    
    return 1 - (distance / maxLength);
}

/**
 * Compute Levenshtein distance between two strings
 * @param {string} str1 - First string
 * @param {string} str2 - Second string
 * @returns {number} - Edit distance
 */
export function levenshteinDistance(str1, str2) {
    const matrix = [];

    // Initialize first row and column
    for (let i = 0; i <= str2.length; i++) {
        matrix[i] = [i];
    }

    for (let j = 0; j <= str1.length; j++) {
        matrix[0][j] = j;
    }

    // Fill the matrix
    for (let i = 1; i <= str2.length; i++) {
        for (let j = 1; j <= str1.length; j++) {
            if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1, // substitution
                    matrix[i][j - 1] + 1,     // insertion
                    matrix[i - 1][j] + 1      // deletion
                );
            }
        }
    }

    return matrix[str2.length][str1.length];
}

/**
 * Normalize string for comparison (remove special characters, normalize spaces)
 * @param {string} str - String to normalize
 * @returns {string} - Normalized string
 */
export function normalizeString(str) {
    if (!str || typeof str !== 'string') return '';
    
    return str
        .normalize("NFKC") // Unicode normalization
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, " ") // Replace non-alphanumeric with spaces
        .replace(/\s+/g, " ") // Collapse multiple spaces
        .trim();
}

/**
 * Extract meaningful keywords from a string
 * @param {string} str - Input string
 * @param {number} maxWords - Maximum number of words to return
 * @returns {string[]} - Array of keywords
 */
export function extractKeywords(str, maxWords = 15) {
    if (!str || typeof str !== 'string') return [];
    
    const normalized = normalizeString(str);
    
    return normalized
        .split(/\s+/)
        .filter(word => 
            word.length > 1 || 
            word.toLowerCase() === "a" || 
            word === "i" ||
            /^[ivxlcdm\d]+$/i.test(word) // Keep Roman numerals and numbers
        )
        .slice(0, maxWords);
}

/**
 * Calculate fuzzy match score using multiple algorithms
 * @param {string} needle - String to search for
 * @param {string} haystack - String to search in
 * @param {object} options - Options for scoring
 * @returns {number} - Match score between 0 and 1
 */
export function calculateFuzzyScore(needle, haystack, options = {}) {
    if (!needle || !haystack) return 0;
    
    const {
        caseSensitive = false,
        exactMatchBonus = 0.5,
        substringBonus = 0.3,
        wordBoundaryBonus = 0.2
    } = options;
    
    const normalizedNeedle = caseSensitive ? needle : needle.toLowerCase();
    const normalizedHaystack = caseSensitive ? haystack : haystack.toLowerCase();
    
    // Exact match
    if (normalizedNeedle === normalizedHaystack) {
        return 1;
    }
    
    // Base similarity using Levenshtein
    let score = calculateStringSimilarity(normalizedNeedle, normalizedHaystack);
    
    // Bonus for exact substring match
    if (normalizedHaystack.includes(normalizedNeedle)) {
        score += exactMatchBonus;
    }
    
    // Bonus for partial substring matches
    const needleWords = normalizedNeedle.split(/\s+/);
    const haystackWords = normalizedHaystack.split(/\s+/);
    
    let matchingWords = 0;
    for (const needleWord of needleWords) {
        if (haystackWords.some(haystackWord => haystackWord.includes(needleWord))) {
            matchingWords++;
        }
    }
    
    if (needleWords.length > 0) {
        const wordMatchRatio = matchingWords / needleWords.length;
        score += substringBonus * wordMatchRatio;
    }
    
    // Bonus for word boundary matches
    const wordBoundaryRegex = new RegExp(`\\b${escapeRegex(normalizedNeedle)}\\b`);
    if (wordBoundaryRegex.test(normalizedHaystack)) {
        score += wordBoundaryBonus;
    }
    
    return Math.min(score, 1); // Cap at 1
}

/**
 * Escape special characters for regex
 * @param {string} str - String to escape
 * @returns {string} - Escaped string
 */
export function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');
}

/**
 * Find the best match from an array of strings
 * @param {string} needle - String to search for
 * @param {string[]} haystack - Array of strings to search in
 * @param {number} threshold - Minimum score threshold (0-1)
 * @returns {object|null} - Best match with score, or null if no match above threshold
 */
export function findBestMatch(needle, haystack, threshold = 0.3) {
    if (!needle || !Array.isArray(haystack) || haystack.length === 0) {
        return null;
    }
    
    let bestMatch = null;
    let bestScore = threshold;
    
    for (const candidate of haystack) {
        if (!candidate) continue;
        
        const score = calculateFuzzyScore(needle, candidate);
        if (score > bestScore) {
            bestScore = score;
            bestMatch = {
                value: candidate,
                score: score,
                original: candidate
            };
        }
    }
    
    return bestMatch;
}

/**
 * Remove common words that don't help with matching
 * @param {string[]} words - Array of words
 * @returns {string[]} - Filtered words
 */
export function removeStopWords(words) {
    const stopWords = new Set([
        'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
        'from', 'up', 'about', 'into', 'through', 'during', 'before', 'after', 'above', 'below',
        'between', 'among', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
        'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'can'
    ]);
    
    return words.filter(word => 
        word && 
        word.length > 1 && 
        !stopWords.has(word.toLowerCase())
    );
}

/**
 * Clean filename for comparison (remove file extensions and common video tags)
 * @param {string} filename - Filename to clean
 * @returns {string} - Cleaned filename
 */
export function cleanFilename(filename) {
    if (!filename) return '';
    
    return filename
        .replace(/\.(mkv|mp4|avi|m4v|mov|wmv|flv|webm)$/i, '') // Remove video extensions
        .replace(/\[(.*?)\]/g, ' ') // Remove bracketed content
        .replace(/\{(.*?)\}/g, ' ') // Remove braced content
        .replace(/\((.*?)\)/g, ' ') // Remove parenthetical content
        .replace(/[._-]/g, ' ') // Replace separators with spaces
        .replace(/\s+/g, ' ') // Normalize spaces
        .trim();
}
