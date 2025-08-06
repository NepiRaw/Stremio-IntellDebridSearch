/**
 * Roman Numeral Utilities - Centralized Roman numeral detection and conversion
 * TASK 5.4: Consolidate Roman numeral handling from multiple files
 * 
 * Replaces Roman numeral code from:
 * - src/utils/parse-torrent-title.js (romanToNumber function)
 * - src/search/torrent-analyzer.js (romanToNumber function)
 * - src/stream/stream-builder.js (Roman numeral patterns)
 * 
 * @fileoverview Simple Roman numeral utilities for media content analysis
 */

import { logger } from './logger.js';

/**
 * Roman numeral character mappings
 */
const ROMAN_NUMERAL_MAP = {
    'I': 1, 'V': 5, 'X': 10, 'L': 50, 'C': 100, 'D': 500, 'M': 1000
};

/**
 * Basic Roman numeral season patterns for media
 */
const ROMAN_SEASON_PATTERNS = [
    /(?:season|series|saison|staffel|temporada|stagione)[\s.-]*([IVX]+)/i,
    /([IVX]+)[\s.-]*(?:season|series|saison|staffel|temporada|stagione)/i,
    /\b([IVX]+)\b/i  // Basic Roman numeral pattern
];

/**
 * Check if a string is a valid Roman numeral
 * @param {string} text - Text to check
 * @returns {boolean} - True if valid Roman numeral
 */
export function isRomanNumeral(text) {
    if (!text || typeof text !== 'string') return false;
    const upperText = text.toUpperCase().trim();
    return /^[IVXLCDM]+$/.test(upperText) && romanToNumber(upperText) !== null;
}

/**
 * Roman numeral detection pattern - for use in text processing
 */
export const ROMAN_NUMERAL_PATTERN = /\b([IVXLCDM]+)\b/i;

/**
 * Join separate Roman numerals pattern - for use in text processing  
 */
export const JOIN_ROMAN_NUMERALS_PATTERN = /\b([IVXLCDM]+)\s([IVXLCDM]+)\b/g;

/**
 * Convert Roman numeral to number with validation
 * @param {string} roman - Roman numeral string
 * @returns {number|null} - Converted number or null if invalid
 */
export function romanToNumber(roman) {
    if (!roman || typeof roman !== 'string') return null;
    
    const upperRoman = roman.toUpperCase().trim();
    if (!upperRoman) return null;
    
    // Basic validation - only valid Roman numeral characters
    if (!/^[IVXLCDM]+$/.test(upperRoman)) return null;
    
    let result = 0;
    let prevValue = 0;
    
    // Process from right to left
    for (let i = upperRoman.length - 1; i >= 0; i--) {
        const currentValue = ROMAN_NUMERAL_MAP[upperRoman[i]];
        
        if (!currentValue) return null; // Invalid character
        
        // Subtractive notation: if current value is less than previous, subtract
        if (currentValue < prevValue) {
            result -= currentValue;
        } else {
            result += currentValue;
        }
        
        prevValue = currentValue;
    }
    
    // Sanity check: reasonable range for media seasons
    if (result < 1 || result > 50) return null;
    
    return result;
}

/**
 * Parse Roman numeral seasons from media titles
 * @param {string} title - Media title to parse
 * @returns {Object|null} - Season information or null
 */
export function parseRomanSeasons(title) {
    if (!title || typeof title !== 'string') return null;
    
    for (const pattern of ROMAN_SEASON_PATTERNS) {
        const match = title.match(pattern);
        if (match?.[1]) {
            const romanNumeral = match[1].toUpperCase();
            const season = romanToNumber(romanNumeral);
            
            if (season !== null) {
                logger.debug(`[parseRomanSeasons] Found Roman season: ${romanNumeral} = ${season}`);
                
                return {
                    season: season,
                    roman: romanNumeral,
                    fullMatch: match[0]
                };
            }
        }
    }
    
    return null;
}
