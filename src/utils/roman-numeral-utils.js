import { logger } from './logger.js';

const ROMAN_NUMERAL_MAP = {
    'I': 1, 'V': 5, 'X': 10, 'L': 50, 'C': 100, 'D': 500, 'M': 1000
};

const ROMAN_SEASON_PATTERNS = [
    // Simple pattern: Look for Roman numerals in titles followed by episode indicators
    // This should only be used when classic S##E## patterns are not found
    /\b([IVX]{1,4})\s*[-–—]\s*(\d{1,3})/i,  // "III - 04", "V - 01", etc.
    /\b([IVX]{1,4})\s+episode\s*(\d{1,3})/i  // "III Episode 4", "V Episode 1", etc.
];

export function isRomanNumeral(text) {
    if (!text || typeof text !== 'string') return false;
    const upperText = text.toUpperCase().trim();
    return /^[IVXLCDM]+$/.test(upperText) && romanToNumber(upperText) !== null;
}

export const ROMAN_NUMERAL_PATTERN = /\b([IVXLCDM]+)\b/i;

export const JOIN_ROMAN_NUMERALS_PATTERN = /\b([IVXLCDM]+)\s([IVXLCDM]+)\b/g;

export function romanToNumber(roman) {
    if (!roman || typeof roman !== 'string') return null;
    
    const upperRoman = roman.toUpperCase().trim();
    if (!upperRoman) return null;
    
    if (!/^[IVXLCDM]+$/.test(upperRoman)) return null;
    
    let result = 0;
    let prevValue = 0;
    
    for (let i = upperRoman.length - 1; i >= 0; i--) {
        const currentValue = ROMAN_NUMERAL_MAP[upperRoman[i]];
        
        if (!currentValue) return null; 
        
        if (currentValue < prevValue) {
            result -= currentValue;
        } else {
            result += currentValue;
        }
        
        prevValue = currentValue;
    }
    
    if (result < 1 || result > 50) return null;
    
    return result;
}

/**
 * Convert number to Roman numeral
 * @param {number} num - Number to convert
 * @returns {string} Roman numeral string
 */
export function parseRomanNumeral(num) {
    const romanMap = {
        1: 'I', 2: 'II', 3: 'III', 4: 'IV', 5: 'V',
        6: 'VI', 7: 'VII', 8: 'VIII', 9: 'IX', 10: 'X',
        11: 'XI', 12: 'XII', 13: 'XIII', 14: 'XIV', 15: 'XV',
        16: 'XVI', 17: 'XVII', 18: 'XVIII', 19: 'XIX', 20: 'XX'
    };
    return romanMap[num] || '';
}

export function parseRomanSeasons(title) {
    if (!title || typeof title !== 'string') return null;
    
    // Only try Roman numeral parsing if there's no explicit S##E## pattern
    // We still want to try if it's something like "AnimeName III - 04" vs "DanMachi.S03E04"
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
                
                if (season !== null && season >= 1 && season <= 10) { // Reasonable season range
                    logger.debug(`[parseRomanSeasons] Found Roman season: ${upperRoman} = ${season}, episode = ${episodeNum}`);
                    
                    return {
                        season: season,
                        episode: parseInt(episodeNum, 10),
                        roman: upperRoman,
                        fullMatch: match[0]
                    };
                }
            }
        }
    }
    
    return null;
}
