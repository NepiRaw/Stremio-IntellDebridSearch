/**
 * Variant Detection System - EXACT Working Implementation
 * Extracted from working addon without modifications
 */

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
    if (normalizedExtracted.includes(normalizedSearch)) {
        // Extract the variant part (what comes after the base title)
        let variantPart = normalizedExtracted
            .replace(normalizedSearch, '')
            .trim()
            .replace(/^[-:\s]+/, '') // Remove leading separators
            .replace(/[-:\s]+$/, ''); // Remove trailing separators
        
        if (variantPart && variantPart.length > 2) {
            console.log(`[detectSimpleVariant] Found variant: "${extractedTitle}" -> variant part: "${variantPart}"`);
            return { 
                isVariant: true, 
                variantName: variantPart.split(' ').map(word => 
                    word.charAt(0).toUpperCase() + word.slice(1)
                ).join(' ')
            };
        }
    }
    
    return { isVariant: false, variantName: null };
}
