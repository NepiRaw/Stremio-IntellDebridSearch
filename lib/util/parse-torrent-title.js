import PTT from 'parse-torrent-title'

const DomainNameRegex = /^www\.[a-zA-Z0-9]+\.[a-zA-Z]{2,}[ \-]+/i
const SourcePrefixRegex = /^\[[a-zA-Z0-9 ._]+\][ \-]*/

function parse(title) {
    title = title.replace(DomainNameRegex, '')
    title = title.replace(SourcePrefixRegex, '')
    return PTT.parse(title)
}

// Add a utility to parse roman numerals for seasons (I, II, III, IV, etc)
export function parseRomanNumeral(num) {
    if (!num || typeof num !== 'number') return '';
    const romans = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX'];
    return romans[num - 1] || '';
}

// Regex patterns for various season formats
const seasonPatterns = {
    standard: /s(?:eason[\s.-]*)?(\d{1,2})/i,
    standardPadded: /s(?:eason[\s.-]*)?0*(\d{1,2})/i,
    romanNumeral: /s(?:eason[\s.-]*)?((?:X{1,3}|X?V?I{1,3}|X?I?V))/i,
    frenchSeason: /(?:saison|s[ae][\s.-]*?)(\d{1,2})/i,
    frenchRoman: /(?:saison|s[ae][\s.-]*?)((?:X{1,3}|X?V?I{1,3}|X?I?V))/i,
    seasonWord: /(?:season|saison|serie|temporada|staffel)[\s.-]*(\d{1,2})/i,  // Added Spanish and German
    plainNumber: /[\s.-](\d{1,2})[ex]/i,
    japaneseSeason: /(?:シーズン|シリーズ)[\s.-]*(\d{1,2})/i,  // Added シリーズ (series)
    germanSeason: /staffel[\s.-]*(\d{1,2})/i,
    spanishSeason: /temporada[\s.-]*(\d{1,2})/i,
    italianSeason: /stagione[\s.-]*(\d{1,2})/i,
    zeroPadded: /[\s.-]0*(\d{1,2})[ex\s]/i,  // Matches 01, 02, etc.
    seasonFolder: /[\\/](?:s(?:eason)?|saison)[\s.-]*(\d{1,2})[\\/]/i  // Matches season folders
};

/**
 * Convert a roman numeral to a number
 */
export function romanToNumber(roman) {
    if (!roman) return null;
    const romanMap = {
        'I': 1, 'V': 5, 'X': 10, 'L': 50, 'C': 100
    };
    
    let result = 0;
    for (let i = 0; i < roman.length; i++) {
        const current = romanMap[roman[i]];
        const next = romanMap[roman[i + 1]];
        if (next > current) {
            result += next - current;
            i++;
        } else {
            result += current;
        }
    }
    return result;
}

/**
 * Parse a season number from various formats
 * @param {string} title - The title or filename to parse
 * @param {boolean} [strict=false] - If true, only accept more reliable patterns
 * @returns {number|null} The season number or null if not found
 */
export function parseSeason(title, strict = false) {
    if (!title) return null;

    // Normalize title for better matching
    const normalizedTitle = title.replace(/\s+/g, ' ')
                               .replace(/[\[\](){}]/g, ' ')
                               .trim();

    // Sort patterns by reliability - standard and word-based patterns first
    const reliablePatterns = ['standard', 'standardPadded', 'seasonWord', 'seasonFolder'];
    const sortedPatterns = Object.entries(seasonPatterns).sort(([a], [b]) => {
        const aReliable = reliablePatterns.includes(a);
        const bReliable = reliablePatterns.includes(b);
        return bReliable - aReliable;
    });

    for (const [format, pattern] of sortedPatterns) {
        // Skip less reliable patterns in strict mode
        if (strict && !reliablePatterns.includes(format)) continue;

        const match = normalizedTitle.match(pattern);
        if (match?.[1]) {
            // Convert roman numerals if found
            if (format.includes('roman')) {
                const num = romanToNumber(match[1].toUpperCase());
                if (num && num > 0 && num <= 30) return num; // Sanity check for reasonable season numbers
            }

            // Parse regular numbers
            const num = parseInt(match[1], 10);
            if (!isNaN(num) && num > 0 && num <= 30) return num; // Sanity check for reasonable season numbers
        }
    }
    
    return null;
}

export default { parse, parseSeason, parseRomanNumeral, romanToNumber }