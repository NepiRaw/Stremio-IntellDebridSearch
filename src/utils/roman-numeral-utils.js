import { logger } from './logger.js';
import cache, { romanCache } from './cache-manager.js';

// Cache configuration constants
const ROMAN_CACHE_TTL = 72000; // 20 hours (shorter than parser cache)
const ROMAN_CACHE_TYPE = 'roman';

const loggedRomanResults = new Set();

function logRomanResult(title, upperRoman, season, episodeNum) {
    const logKey = `${title}:${upperRoman}:${season}:${episodeNum}`;
    
    if (!loggedRomanResults.has(logKey)) {
        logger.debug(`[parseRomanSeasons] Found Roman season: ${upperRoman} = ${season}, episode = ${episodeNum} - ${title}`);
        loggedRomanResults.add(logKey);
        
        if (loggedRomanResults.size > 1000) {
            loggedRomanResults.clear();
        }
    }
}

// ============ UNIFIED ROMAN NUMERAL DEFINITIONS ============
/**
 * Single source of truth for Roman numeral values
 * Eliminates redundant ROMAN_NUMERAL_MAP and romanMap definitions
 */
const ROMAN_VALUES = [
    {symbol: 'M', value: 1000}, {symbol: 'CM', value: 900},
    {symbol: 'D', value: 500},  {symbol: 'CD', value: 400},
    {symbol: 'C', value: 100},  {symbol: 'XC', value: 90},
    {symbol: 'L', value: 50},   {symbol: 'XL', value: 40},
    {symbol: 'X', value: 10},   {symbol: 'IX', value: 9},
    {symbol: 'V', value: 5},    {symbol: 'IV', value: 4},
    {symbol: 'I', value: 1}
];

const ROMAN_SEASON_PATTERNS = [
    // Simple pattern: Look for Roman numerals in titles followed by episode indicators
    // This should only be used when classic S##E## patterns are not found
    /\b([IVX]{1,4})\s*[-–—]\s*(\d{1,3})/i,  // "III - 04", "V - 01", etc.
    /\b([IVX]{1,4})\s+episode\s*(\d{1,3})/i  // "III Episode 4", "V Episode 1", etc.
];

// ============ UNIFIED VALIDATION ============
/**
 * Consolidated validation for Roman numerals
 * @param {string} text - Text to validate
 * @returns {boolean} True if valid Roman numeral
 */
export function isValidRomanNumeral(text) {
    if (!text || typeof text !== 'string') return false;
    
    const normalized = text.toUpperCase().trim();
    if (!normalized) return false;
    
    // Check if contains only valid Roman numeral characters
    if (!/^[IVXLCDM]+$/.test(normalized)) return false;
    
    // Additional validation: proper Roman numeral pattern
    const validPattern = /^M{0,4}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/;
    return validPattern.test(normalized);
}

// ============ UNIFIED ROMAN NUMERAL CONVERSION ============
/**
 * Convert Roman numeral to number using dynamic algorithm
 * Replaces both romanToNumber() and parseRomanNumeral() approaches
 * @param {string} roman - Roman numeral to convert
 * @returns {number|null} Converted number or null if invalid
 */
export function convertRomanToNumber(roman) {
    if (!isValidRomanNumeral(roman)) return null;
    
    const upperRoman = roman.toUpperCase().trim();
    let result = 0;
    let i = 0;
    
    // Process from largest to smallest values
    for (const {symbol, value} of ROMAN_VALUES) {
        while (upperRoman.substring(i, i + symbol.length) === symbol) {
            result += value;
            i += symbol.length;
        }
    }
    
    // Ensure we processed the entire string
    if (i !== upperRoman.length) return null;
    
    return result;
}

/**
 * Convert number to Roman numeral using dynamic algorithm
 * @param {number} num - Number to convert (1-3999)
 * @returns {string} Roman numeral string or empty string if invalid
 */
export function convertNumberToRoman(num) {
    if (!Number.isInteger(num) || num < 1 || num > 3999) return '';
    
    let result = '';
    let remaining = num;
    
    // Process from largest to smallest values
    for (const {symbol, value} of ROMAN_VALUES) {
        const count = Math.floor(remaining / value);
        if (count > 0) {
            result += symbol.repeat(count);
            remaining -= value * count;
        }
    }
    
    return result;
}

// ============ PATTERN CONSTANTS ============
export const ROMAN_NUMERAL_PATTERN = /\b([IVXLCDM]+)\b/i;
export const JOIN_ROMAN_NUMERALS_PATTERN = /\b([IVXLCDM]+)\s([IVXLCDM]+)\b/g;

// ============ BACKWARD COMPATIBILITY EXPORTS ============
/**
 * Legacy function name - now uses unified validation
 * @param {string} text - Text to validate
 * @returns {boolean} True if valid Roman numeral
 */
export function isRomanNumeral(text) {
    return isValidRomanNumeral(text);
}

/**
 * Legacy function name - now uses unified conversion with season-specific range
 * @param {string} roman - Roman numeral to convert
 * @returns {number|null} Converted number (1-50 for season compatibility) or null if invalid
 */
export function romanToNumber(roman) {
    const result = convertRomanToNumber(roman);
    // Maintain original season range limitation for compatibility
    if (result !== null && (result < 1 || result > 50)) return null;
    return result;
}

/**
 * Legacy function name - now uses unified number to roman conversion
 * @param {number} num - Number to convert
 * @returns {string} Roman numeral string or empty string if invalid
 */
export function parseRomanNumeral(num) {
    return convertNumberToRoman(num);
}

// ============ ROMAN SEASON PARSING ============
export function parseRomanSeasons(title) {
    if (!title || typeof title !== 'string') return null;
    
    // Multi-tier cache lookup strategy
    const romanKey = `roman:${title}`;
    const parserKey = `parser:${title}`;
    
    // 1. Check if filename was already parsed by unified parser (most comprehensive)
    if (cache.has(parserKey)) {
        const parserCached = cache.get(parserKey);
        if (parserCached && parserCached.romanSeason !== undefined) {
            return parserCached.romanSeason;
        }
    }
    
    // 2. Check dedicated Roman cache (faster lookup, longer TTL)
    if (romanCache.has(romanKey)) {
        const romanCached = romanCache.get(romanKey);
        return romanCached;
    }
    
    // 3. Compute Roman season parsing (original logic)
    const result = computeRomanSeasons(title);
    
    // 4. Cache the result in dedicated Roman cache for future lookups
    romanCache.set(romanKey, result, ROMAN_CACHE_TTL, { type: ROMAN_CACHE_TYPE });
    
    return result;
}

// Extract original parsing logic into separate function
function computeRomanSeasons(title) {
    // Only try Roman numeral parsing if there's no explicit S##E## / S## E## / S## - E## / S##.E## pattern
    const hasExplicitSE = /s\d{1,2}e\d{1,3}/i.test(title);
    if (hasExplicitSE) {
        return null; // Use explicit S##E## numbering instead
    }
    
    for (let i = 0; i < ROMAN_SEASON_PATTERNS.length; i++) {
        const pattern = ROMAN_SEASON_PATTERNS[i];
        const match = title.match(pattern);
        
        if (match) {
            const romanNumeral = match[1];
            const episodeNum = match[2];
            
            if (romanNumeral && isRomanNumeral(romanNumeral)) {
                const upperRoman = romanNumeral.toUpperCase();
                const season = romanToNumber(upperRoman);
                
                if (season !== null && season >= 1 && season <= 10) {
                    // Enhanced logging with deduplication
                    logRomanResult(title, upperRoman, season, episodeNum);
                    
                    return {
                        season: season,
                        episode: parseInt(episodeNum, 10),
                        roman: upperRoman,
                        pattern: pattern.source,
                        confidence: 0.9
                    };
                }
            }
        }
    }
    
    return null;
}
