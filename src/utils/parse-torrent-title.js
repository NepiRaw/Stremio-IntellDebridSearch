import PTT from 'parse-torrent-title'
import { romanToNumber } from './roman-numeral-utils.js';
import { SEASON_PATTERNS, parseSeasonFromTitle } from './episode-patterns.js';

const DomainNameRegex = /^www\.[a-zA-Z0-9]+\.[a-zA-Z]{2,}[ \-]+/i
const SourcePrefixRegex = /^\[[a-zA-Z0-9 ._]+\][ \-]*/

export function parse(title) {
    title = title.replace(DomainNameRegex, '')
    title = title.replace(SourcePrefixRegex, '')
    return PTT.parse(title)
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