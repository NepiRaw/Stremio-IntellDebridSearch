/**
 * Variant Detection System
 * Can be disabled from environment variable
 */

import { AUTO_TECHNICAL_PATTERNS, FILE_EXTENSIONS, CLEANUP_PATTERNS, COMPREHENSIVE_TECH_PATTERNS, isTechnicalTerm, isMeaningfulVariant } from './media-patterns.js';
import { parseSeasonFromTitle, parseEpisodeFromTitle, parseAbsoluteEpisode } from './episode-patterns.js';
import { romanToNumber } from './roman-numeral-utils.js';
import { isKnownReleaseGroup } from './groups-util.js';

/**
 * TextUtils Class - Consolidated text processing utilities
 */
class TextUtils {
    static calculateSimilarity(str1, str2) {
        if (!str1 || !str2) return 0;
        
        const words1 = this.extractWords(str1);
        const words2 = this.extractWords(str2);
        
        if (words1.length === 0 || words2.length === 0) return 0;
        
        const commonWords = words1.filter(word => words2.includes(word));
        const totalWords = Math.max(words1.length, words2.length);
        
        return commonWords.length / totalWords;
    }

    static extractWords(text) {
        return text.toLowerCase()
            .split(/\s+/)
            .filter(w => w.length > 0);
    }

    static normalizeTitle(title) {
        if (!title || typeof title !== 'string') return '';
        
        return title.toLowerCase()
            .replace(/[^\p{L}\p{N}\s]/gu, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    static containsEpisodePattern(text) {
        const lowerText = text.toLowerCase().trim();
        
        if (/^\d{1,3}$/.test(lowerText)) { // Check for simple numbers (episode numbers)
            return true;
        }
        
        if (/^[ivx]{1,5}$/.test(lowerText)) { // Check for roman numerals
            const romanValue = romanToNumber(lowerText.toUpperCase());
            if (romanValue !== null && romanValue >= 1 && romanValue <= 10) {
                return true;
            }
        }
        
        // Use episode/season parsing
        const seasonInfo = parseSeasonFromTitle(lowerText);
        const episodeInfo = parseEpisodeFromTitle(lowerText);
        const absoluteEpisode = parseAbsoluteEpisode(lowerText);
        
        return seasonInfo !== null || episodeInfo !== null || absoluteEpisode !== null;
    }

    static cleanupText(text, options = {}) {
        const {
            preserveMeaningfulVariants = false,
            removeFileExtensions = true,
            removeTechnicalTerms = true
        } = options;

        let cleaned = text;
        const lowerText = cleaned.toLowerCase().trim();

        // Check if the text contains meaningful descriptors, else do cleanups
        const hasMeaningfulVariant = isMeaningfulVariant(lowerText);

        if (preserveMeaningfulVariants && hasMeaningfulVariant) {
            const words = cleaned.split(/\s+/);
            
            const cleanedWords = words.filter(word => {
                const isTech = isTechnicalTerm(word);
                if (isTech) return false;
                
                const isReleaseGroup = isKnownReleaseGroup(word);
                if (isReleaseGroup) return false;
                
                return true;
            });
            
            cleaned = cleanedWords.join(' ');
        } else {
            if (removeTechnicalTerms) {
                for (const pattern of AUTO_TECHNICAL_PATTERNS) {
                    cleaned = cleaned.replace(pattern, '');
                }
                
                for (const techPattern of COMPREHENSIVE_TECH_PATTERNS) {
                    cleaned = cleaned.replace(techPattern.pattern, '');
                }
            }

            if (removeFileExtensions) {
                for (const ext of Object.values(FILE_EXTENSIONS).flat()) {
                    const extPattern = new RegExp(`\\b${ext}\\b`, 'gi');
                    cleaned = cleaned.replace(extPattern, '');
                }
            }

            cleaned = cleaned
                .replace(CLEANUP_PATTERNS.qualityRemoval, '')
                .replace(CLEANUP_PATTERNS.sourceRemoval, '')
                .replace(CLEANUP_PATTERNS.unwantedTerms, '')
                .replace(CLEANUP_PATTERNS.bracketContent, '')
                .replace(CLEANUP_PATTERNS.emptyBrackets, '')
                .replace(CLEANUP_PATTERNS.emptyParentheses, '')
                .replace(CLEANUP_PATTERNS.groupTags, '')
                .replace(CLEANUP_PATTERNS.dotsUnderscores, ' ')
                .replace(CLEANUP_PATTERNS.multipleSpaces, ' ')
                .replace(CLEANUP_PATTERNS.trailingDash, '');
        }

        // Final cleanup
        const finalResult = cleaned
            .replace(/\b\d{3,4}x\d{3,4}\b/g, '') // Remove resolution patterns
            .replace(/\b\d{1,2}\b/g, '') // Remove episode numbers
            .replace(/\b(rip|dl)\b/gi, '') // Remove partial technical terms
            .replace(/\b(bd|web|hd|tv|dvd)\b/gi, '') // Remove source fragments
            .replace(/\s+/g, ' ') // Collapse spaces
            .trim();
            
        return finalResult;
    }

    static removeEpisodeSuffix(title) {
        return title.replace(/\s+\d{1,3}$/, '').trim();
    }

    static capitalizeWords(text) {
        return text.split(' ')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
    }
}

function calculateSimilarity(str1, str2) {
    return TextUtils.calculateSimilarity(str1, str2);
}

/**
 * Simple variant detection based on title comparison
 * Uses TextUtils for optimized text processing
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
    
    // Use TextUtils for normalization
    const normalizedExtracted = TextUtils.normalizeTitle(extractedTitle);
    const normalizedSearch = TextUtils.normalizeTitle(searchTitle);
    
    if (normalizedExtracted === normalizedSearch) {
        return { isVariant: false, variantName: null };
    }
    
    // Normalize all alternative titles using TextUtils
    const allTitles = [normalizedSearch, ...alternativeTitles.map(alt => 
        TextUtils.normalizeTitle(alt.title || alt.normalizedTitle || alt)
    )];
    
    for (const altTitle of allTitles) {
        if (normalizedExtracted === altTitle) {
            return { isVariant: false, variantName: null };
        }
    }
    
    const extractedWithoutEpisode = TextUtils.removeEpisodeSuffix(normalizedExtracted);
    
    for (const altTitle of allTitles) {
        if (extractedWithoutEpisode === altTitle) {
            return { isVariant: false, variantName: null };
        }
        
        const similarity = TextUtils.calculateSimilarity(extractedWithoutEpisode, altTitle);
        if (similarity > 0.85) { // 85% similarity threshold
            return { isVariant: false, variantName: null };
        }
    }
    
    const allBaseTitles = [normalizedSearch, ...alternativeTitles.map(alt => 
        TextUtils.normalizeTitle(alt.title || alt.normalizedTitle || alt)
    )].sort((a, b) => b.length - a.length);
    
    for (const baseTitle of allBaseTitles) {
        if (normalizedExtracted.includes(baseTitle)) {
            let variantPart = normalizedExtracted
                .replace(baseTitle, '')
                .trim()
                .replace(/^[-:\s]+/, '') // Remove leading separators
                .replace(/[-:\s]+$/, ''); // Remove trailing separators
            
            if (variantPart && variantPart.length > 2) {
                const normalizedVariantPart = TextUtils.normalizeTitle(variantPart);
                
                for (const altTitle of alternativeTitles) {
                    const normalizedAltTitle = TextUtils.normalizeTitle(altTitle.title || altTitle.normalizedTitle || altTitle);
                    
                    if (normalizedAltTitle.includes(normalizedVariantPart) || normalizedVariantPart.includes(normalizedAltTitle)) {
                        return { isVariant: false, variantName: null };
                    }
                }
                
                if (episodeTitle) {
                    const normalizedEpisodeTitle = TextUtils.normalizeTitle(episodeTitle);
                    const normalizedVariantPartForEpisode = TextUtils.normalizeTitle(variantPart);
                    
                    if (normalizedVariantPartForEpisode === normalizedEpisodeTitle || 
                        normalizedVariantPartForEpisode.includes(normalizedEpisodeTitle) ||
                        normalizedEpisodeTitle.includes(normalizedVariantPartForEpisode)) {
                        return { isVariant: false, variantName: null };
                    }
                }

                variantPart = cleanupVariantName(variantPart);
                
                const trimmedVariant = variantPart.trim();
                if (trimmedVariant && trimmedVariant.length > 1 && !/^\s*$/.test(trimmedVariant)) {
                    return { 
                        isVariant: true, 
                        variantName: TextUtils.capitalizeWords(trimmedVariant)
                    };
                }
            }
        }
    }
    
    return { isVariant: false, variantName: null };
}

export function cleanupVariantName(variantPart) {
    let cleaned = variantPart;
    
    const lowerVariant = cleaned.toLowerCase().trim();
    
    // First, extract potentially meaningful content by preserving words before technical terms
    let meaningfulParts = [];
    const words = cleaned.split(/\s+/);
    
    for (let i = 0; i < words.length; i++) {
        const word = words[i];
        const lowerWord = word.toLowerCase();
        
        // Check if this word starts a technical sequence (like "S01", "2017", etc.)
        if (/^s\d+$/i.test(word) || /^\d{4}$/.test(word) || /^\d{1,2}x\d{1,2}$/i.test(word)) {
            // Stop here - everything after this is likely technical
            break;
        }
        
        // Check if word is a pure technical term
        if (isTechnicalTerm(word)) {
            continue;
        }
        
        // Check if word is a release group
        if (isKnownReleaseGroup(word)) {
            continue;
        }
        
        meaningfulParts.push(word);
    }
    
    // If we found meaningful parts, use them
    if (meaningfulParts.length > 0) {
        cleaned = meaningfulParts.join(' ');
        
        // Apply comprehensive text cleanup but preserve meaningful variants
        cleaned = TextUtils.cleanupText(cleaned, {
            preserveMeaningfulVariants: true,
            removeFileExtensions: true,
            removeTechnicalTerms: true
        });
        
        // Additional cleanup for remaining technical terms
        cleaned = cleaned
            .replace(/\b(s\d+|season\s*\d+)\b/gi, '') // Remove season patterns
            .replace(/\b\d{4}\b/g, '') // Remove years
            .replace(/\b\d{1,2}x\d{1,2}\b/gi, '') // Remove episode patterns
            .replace(/\s+/g, ' ')
            .trim();
        return cleaned;
    }
    
    // Fallback: if no meaningful parts found, check if the whole thing is just episode patterns
    if (TextUtils.containsEpisodePattern(lowerVariant)) {
        return ''; 
    }
    
    // Apply standard cleanup
    cleaned = TextUtils.cleanupText(cleaned, {
        preserveMeaningfulVariants: true,
        removeFileExtensions: true,
        removeTechnicalTerms: true
    });
    
    return cleaned;
}

export { TextUtils };