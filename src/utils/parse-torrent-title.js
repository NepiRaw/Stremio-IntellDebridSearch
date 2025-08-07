import { parseUnified } from './unified-torrent-parser.js';
import { romanToNumber } from './roman-numeral-utils.js';
import { parseSeasonFromTitle } from './episode-patterns.js';

/**
 * Compatibility wrapper for parse-torrent-title
 * This delegates to the unified parser for consistent parsing across the codebase
 */
export function parse(title) {
    // Use unified parser which already includes domain cleanup and comprehensive parsing
    return parseUnified(title);
}

export function parseRomanNumeral(num) {
    const romanMap = {
        1: 'I', 2: 'II', 3: 'III', 4: 'IV', 5: 'V',
        6: 'VI', 7: 'VII', 8: 'VIII', 9: 'IX', 10: 'X',
        11: 'XI', 12: 'XII', 13: 'XIII', 14: 'XIV', 15: 'XV',
        16: 'XVI', 17: 'XVII', 18: 'XVIII', 19: 'XIX', 20: 'XX'
    };
    return romanMap[num] || '';
}

export function parseSeason(title, strict = false) {
    return parseSeasonFromTitle(title, strict);
}

export default { parse, parseSeason, parseRomanNumeral, romanToNumber }

export { romanToNumber };