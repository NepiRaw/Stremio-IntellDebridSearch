/**
 * Variant Detection System
 * Can be disabled from environment variable
 */

import { TECHNICAL_PATTERNS, FILE_EXTENSIONS, CLEANUP_PATTERNS, COMPREHENSIVE_TECH_PATTERNS, isTechnicalTerm, isMeaningfulVariant, isEpisodeSeasonPattern } from './media-patterns.js';
import { romanToNumber } from './roman-numeral-utils.js';
import { logger } from '../utils/logger.js';

function calculateSimilarity(str1, str2) {
    if (!str1 || !str2) return 0;
    
    const words1 = str1.toLowerCase().split(/\s+/).filter(w => w.length > 0);
    const words2 = str2.toLowerCase().split(/\s+/).filter(w => w.length > 0);
    
    if (words1.length === 0 || words2.length === 0) return 0;
    
    const commonWords = words1.filter(word => words2.includes(word));
    const totalWords = Math.max(words1.length, words2.length);
    
    return commonWords.length / totalWords;
}

/**
 * Simple variant detection based on title comparison
 * This is a content-agnostic approach using string normalization
 * @param {string} extractedTitle - The torrent title to check
 * @param {string} searchTitle - The original search title  
 * @param {Array} alternativeTitles - Alternative titles from metadata
 * @param {string} episodeTitle - Detected episode title to exclude from variant detection
 * @returns {Object} - Result object with isVariant and variantName
 */
export function detectSimpleVariant(extractedTitle, searchTitle, alternativeTitles = [], episodeTitle = null) {
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
    
    if (normalizedExtracted === normalizedSearch) {
        return { isVariant: false, variantName: null };
    }
    
    const allTitles = [normalizedSearch, ...alternativeTitles.map(alt => normalizeTitle(alt.title || alt.normalizedTitle || alt))];
    
    for (const altTitle of allTitles) {
        if (normalizedExtracted === altTitle) {
            return { isVariant: false, variantName: null };
        }
    }
    
    const extractedWithoutEpisode = normalizedExtracted.replace(/\s+\d{1,3}$/, '').trim(); // Remove trailing episode numbers
    
    for (const altTitle of allTitles) {
        if (extractedWithoutEpisode === altTitle) {
            logger.debug(`[detectSimpleVariant] Extracted title (minus episode) "${extractedWithoutEpisode}" exactly matches alternative title "${altTitle}", not a variant`);
            return { isVariant: false, variantName: null };
        }
        
        const similarity = calculateSimilarity(extractedWithoutEpisode, altTitle);
        if (similarity > 0.85) { // 85% similarity threshold
            logger.debug(`[detectSimpleVariant] Extracted title "${extractedWithoutEpisode}" is ${Math.round(similarity * 100)}% similar to alternative title "${altTitle}", not a variant`);
            return { isVariant: false, variantName: null };
        }
    }
    
    const allBaseTitles = [normalizedSearch, ...alternativeTitles.map(alt => normalizeTitle(alt.title || alt.normalizedTitle || alt))]
        .sort((a, b) => b.length - a.length);
    
    for (const baseTitle of allBaseTitles) {
        if (normalizedExtracted.includes(baseTitle)) {
            let variantPart = normalizedExtracted
                .replace(baseTitle, '')
                .trim()
                .replace(/^[-:\s]+/, '') // Remove leading separators
                .replace(/[-:\s]+$/, ''); // Remove trailing separators
            
                if (variantPart && variantPart.length > 2) {
                    const normalizedVariantPart = normalizeTitle(variantPart);
                    logger.debug(`[detectSimpleVariant] Checking variant part "${normalizedVariantPart}" against ${alternativeTitles.length} alternative titles`);
                    
                    for (const altTitle of alternativeTitles) {
                        const normalizedAltTitle = normalizeTitle(altTitle.title || altTitle.normalizedTitle || altTitle);
                        logger.debug(`[detectSimpleVariant] Comparing variant "${normalizedVariantPart}" with alt title "${normalizedAltTitle}"`);
                        
                        if (normalizedAltTitle.includes(normalizedVariantPart) || normalizedVariantPart.includes(normalizedAltTitle)) {
                            logger.debug(`[detectSimpleVariant] Variant part "${variantPart}" found in alternative title "${normalizedAltTitle}", not a variant`);
                            return { isVariant: false, variantName: null };
                        }
                    }
                    
                    if (episodeTitle) {
                        const normalizedEpisodeTitle = normalizeTitle(episodeTitle);
                        const normalizedVariantPartForEpisode = normalizeTitle(variantPart);
                        
                        if (normalizedVariantPartForEpisode === normalizedEpisodeTitle || 
                            normalizedVariantPartForEpisode.includes(normalizedEpisodeTitle) ||
                            normalizedEpisodeTitle.includes(normalizedVariantPartForEpisode)) {
                            return { isVariant: false, variantName: null };
                        }
                    }
                variantPart = cleanupVariantName(variantPart);
                
                const trimmedVariant = variantPart.trim();
                if (trimmedVariant && trimmedVariant.length > 1 && !/^\s*$/.test(trimmedVariant)) {
                    logger.debug(`[detectSimpleVariant] Found variant: "${extractedTitle}" -> base: "${baseTitle}" -> variant part: "${variantPart}"`);
                    return { 
                        isVariant: true, 
                        variantName: trimmedVariant.split(' ').map(word => 
                            word.charAt(0).toUpperCase() + word.slice(1)
                        ).join(' ')
                    };
                } else {
                    logger.debug(`[detectSimpleVariant] Variant part "${variantPart}" cleaned to empty/meaningless, ignoring`);
                }
            }
        }
    }
    
    return { isVariant: false, variantName: null };
}

export function cleanupVariantName(variantPart) {
    let cleaned = variantPart;
    
    const lowerVariant = cleaned.toLowerCase().trim();
    
    if (/^\d{1,3}$/.test(lowerVariant)) {
        logger.debug(`[cleanupVariantName] Detected episode number: "${variantPart}", ignoring as variant`);
        return ''; 
    }
    
    if (/^[ivx]{1,5}$/.test(lowerVariant)) {
        const romanValue = romanToNumber(lowerVariant.toUpperCase());
        if (romanValue !== null && romanValue >= 1 && romanValue <= 10) {
            return '';
        }
    }
    
    // Use centralized episode/season pattern detection
    if (isEpisodeSeasonPattern(lowerVariant)) {
        return '';
    }
    
    // Now proceed with normal variant cleanup for legitimate variants
    // Check if the variant contains any meaningful descriptors using centralized patterns
    const hasMeaningfulContent = isMeaningfulVariant(lowerVariant);
    
    // If it contains meaningful variant content, do minimal cleanup
    if (hasMeaningfulContent) {
        // Use centralized technical term detection instead of hardcoded patterns
        const words = cleaned.split(/\s+/);
        const cleanedWords = words.filter(word => !isTechnicalTerm(word));
        cleaned = cleanedWords.join(' ')
            .replace(/\[[^\]]*\]/g, '') // Remove brackets content
            .replace(/\([^)]*\)/g, '') // Remove parentheses content
            .replace(/[\._\-]+/g, ' ') // Replace separators with spaces
            .replace(/\s+/g, ' ') // Multiple spaces to single space
            .trim();
    } else {
        // For non-meaningful content, apply comprehensive cleanup using centralized patterns
        for (const pattern of TECHNICAL_PATTERNS) {
            cleaned = cleaned.replace(pattern, '');
        }
        
        // Apply comprehensive tech patterns to remove additional technical terms
        for (const techPattern of COMPREHENSIVE_TECH_PATTERNS) {
            cleaned = cleaned.replace(techPattern.pattern, '');
        }
        
        // Remove file extensions using centralized patterns
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
            
        // SIMPLIFIED cleanup for variant detection (keeping essential partial term removal)
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
