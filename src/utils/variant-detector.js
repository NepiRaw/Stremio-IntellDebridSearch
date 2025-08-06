/**
 * Variant Detection System - EXACT Working Implementation
 * Extracted from working addon without modifications
 */

import { TECHNICAL_PATTERNS, FILE_EXTENSIONS, CLEANUP_PATTERNS, COMPREHENSIVE_TECH_PATTERNS } from './media-patterns.js';

/**
 * Simple variant detection based on title comparison
 * This is a content-agnostic approach using string normalization
 * @param {string} extractedTitle - The torrent title to check
 * @param {string} searchTitle - The original search title  
 * @param {Array} alternativeTitles - Alternative titles from metadata
 * @returns {Object} - Result object with isVariant and variantName
 */
export function detectSimpleVariant(extractedTitle, searchTitle, alternativeTitles = []) {
    if (!extractedTitle || !searchTitle) {
        return { isVariant: false, variantName: null };
    }
    
    const normalizeTitle = (title) => {
        return title.toLowerCase()
            .replace(/[^\p{L}\p{N}\s]/gu, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    };
    
    const normalizedExtracted = normalizeTitle(extractedTitle);
    const normalizedSearch = normalizeTitle(searchTitle);
    
    // If the extracted title is exactly the same as search title, it's not a variant
    if (normalizedExtracted === normalizedSearch) {
        return { isVariant: false, variantName: null };
    }
    
    // Check if extracted title matches any alternative title exactly
    const allTitles = [normalizedSearch, ...alternativeTitles.map(alt => normalizeTitle(alt.title || alt.normalizedTitle || alt))];
    
    for (const altTitle of allTitles) {
        if (normalizedExtracted === altTitle) {
            return { isVariant: false, variantName: null };
        }
    }
    
    // Check if the extracted title contains the search title as a base
    // Sort all base titles by length (longest first) to prefer more specific matches
    const allBaseTitles = [normalizedSearch, ...alternativeTitles.map(alt => normalizeTitle(alt.title || alt.normalizedTitle || alt))]
        .sort((a, b) => b.length - a.length); // Longest first
    
    for (const baseTitle of allBaseTitles) {
        if (normalizedExtracted.includes(baseTitle)) {
            // Extract the variant part (what comes after the base title)
            let variantPart = normalizedExtracted
                .replace(baseTitle, '')
                .trim()
                .replace(/^[-:\s]+/, '') // Remove leading separators
                .replace(/[-:\s]+$/, ''); // Remove trailing separators
            
            if (variantPart && variantPart.length > 2) {
                // Clean up variant part using media patterns to remove technical terms
                variantPart = cleanupVariantName(variantPart);
                
                // Check if variant part is meaningful after cleanup
                const trimmedVariant = variantPart.trim();
                if (trimmedVariant && trimmedVariant.length > 1 && !/^\s*$/.test(trimmedVariant)) {
                    console.log(`[detectSimpleVariant] Found variant: "${extractedTitle}" -> base: "${baseTitle}" -> variant part: "${variantPart}"`);
                    return { 
                        isVariant: true, 
                        variantName: trimmedVariant.split(' ').map(word => 
                            word.charAt(0).toUpperCase() + word.slice(1)
                        ).join(' ')
                    };
                } else {
                    console.log(`[detectSimpleVariant] Variant part "${variantPart}" cleaned to empty/meaningless, ignoring`);
                }
            }
        }
    }
    
    return { isVariant: false, variantName: null };
}

/**
 * Clean up variant name by removing technical terms using media patterns only
 * BUT preserve meaningful variant descriptors like "Directors Cut", "Extended", "Uncut", etc.
 * @param {string} variantPart - The variant part to clean up
 * @returns {string} - Cleaned variant name
 */
export function cleanupVariantName(variantPart) {
    let cleaned = variantPart;
    
    // First, preserve meaningful variant terms that we DON'T want to remove
    const meaningfulVariants = [
        'directors cut', 'director cut', 'extended', 'uncut', 'unrated',
        'remastered', 'special', 'ova', 'oav', 'special edition',
        'theatrical','ultimate', 'definitive', 'extra', 'bonus'
    ];
    
    // Check if the variant contains any meaningful descriptors
    const lowerVariant = cleaned.toLowerCase();
    const hasMeaningfulContent = meaningfulVariants.some(term => 
        lowerVariant.includes(term)
    );
    
    // If it contains meaningful variant content, do minimal cleanup
    if (hasMeaningfulContent) {
        // Only remove clearly technical/file-related terms, preserve variant descriptors
        cleaned = cleaned
            .replace(/\b(mkv|mp4|avi|flac|aac|x264|x265|hevc|1080p|720p|480p)\b/gi, '')
            .replace(/\b(webrip|web-dl|bdrip|bluray|hdtv|dvdrip)\b/gi, '')
            .replace(/\b\d{4}x\d{4}\b/g, '') // Remove resolution patterns
            .replace(/\[[^\]]*\]/g, '') // Remove brackets content
            .replace(/\([^)]*\)/g, '') // Remove parentheses content
            .replace(/[\._\-]+/g, ' ') // Replace separators with spaces
            .replace(/\s+/g, ' ') // Multiple spaces to single space
            .trim();
    } else {
        // For non-meaningful content, apply full cleanup
        // Apply all technical patterns to remove technical terms
        for (const pattern of TECHNICAL_PATTERNS) {
            cleaned = cleaned.replace(pattern, '');
        }
        
        // Apply comprehensive tech patterns to remove additional technical terms
        for (const techPattern of COMPREHENSIVE_TECH_PATTERNS) {
            cleaned = cleaned.replace(techPattern.pattern, '');
        }
        
        // Remove file extensions
        for (const ext of Object.values(FILE_EXTENSIONS).flat()) {
            const extPattern = new RegExp(`\\b${ext}\\b`, 'gi');
            cleaned = cleaned.replace(extPattern, '');
        }
        
        // Apply cleanup patterns from media-patterns.js
        cleaned = cleaned
            .replace(CLEANUP_PATTERNS.qualityRemoval, '') // Remove quality indicators
            .replace(CLEANUP_PATTERNS.sourceRemoval, '') // Remove source indicators  
            .replace(CLEANUP_PATTERNS.unwantedTerms, '') // Remove streaming services
            .replace(CLEANUP_PATTERNS.bracketContent, '') // Remove bracket content
            .replace(CLEANUP_PATTERNS.emptyBrackets, '') // Remove empty brackets
            .replace(CLEANUP_PATTERNS.emptyParentheses, '') // Remove empty parentheses
            .replace(CLEANUP_PATTERNS.groupTags, '') // Remove group tags
            .replace(CLEANUP_PATTERNS.dotsUnderscores, ' ') // Replace dots/underscores with spaces
            .replace(CLEANUP_PATTERNS.multipleSpaces, ' ') // Multiple spaces to single space
            .replace(CLEANUP_PATTERNS.trailingDash, '') // Remove trailing dashes
            .trim(); // Remove leading/trailing whitespace
            
        // ADDITIONAL CLEANUP for variant detection issues (Task 4.23.2 fixes)
        cleaned = cleaned
            .replace(/\b\d{3,4}x\d{3,4}\b/g, '') // Remove resolution patterns like "1920x1080"
            .replace(/\b\d{1,2}\b/g, '') // Remove episode numbers like "02", "1", "12"
            .replace(/\b(rip|dl)\b/gi, '') // Remove standalone "rip", "dl" (partial technical terms)
            .replace(/\b(bd|web|hd|tv|dvd)\b/gi, '') // Remove standalone source fragments
            .replace(/\s+/g, ' ') // Collapse multiple spaces
            .trim(); // Final trim
    }
    
    return cleaned;
}
