import { logger } from './logger.js';

const ROMAN_NUMERAL_MAP = {
    'I': 1, 'V': 5, 'X': 10, 'L': 50, 'C': 100, 'D': 500, 'M': 1000
};

const ROMAN_SEASON_PATTERNS = [
    /(?:season|series|saison|staffel|temporada|stagione)[\s.-]*([IVX]+)/i,
    /([IVX]+)[\s.-]*(?:season|series|saison|staffel|temporada|stagione)/i,
    /\b([IVX]+)\b/i 
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
