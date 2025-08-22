/**
 * Release Groups Utility
 * Centralized management of known release groups and detection logic
 * This file can be updated to add new release groups without modifying core code
 */

export const KNOWN_RELEASE_GROUPS = new Set([
    'T3KASHi',
    'Tsundere-Raws',
    'Punisher694',
    'SR-71',
    'KAF',
    'MSubs-ToonsHub',
    'Amen',
    'Monkey D.Lulu',
    'AMB3R',
    'SHiNiGAMi',
    'sam',
    'Breeze',
    'SubsPlease',
    'Trix',
    'FW',
    'Erai-raws',
    'NoTag',
    'AnimeRG',
    'EMBER',
    'HorribleSubs',
    'Golumpa',
    'Judas',
    'iNSPiRE',
    'DiabloTripleA',
    'LTFR',
    'SceneGuardians',
    'SMILODON',
    'RARBG',
    'YTS',
    'YIFY',
    'PublicHD',
    'FGT',
    'CtrlHD',
    'DON',
    'SPARKS',
    'NTb',
    'NTG',
    'AMRAP',
    'FLUX',
    'ROVERS',
    'SURCODE',
    'TEPES',
    'BluDragon',
    'DTA',
    'SAMPA',
    'Garshasp',
    'matheousse',
    'Chris44',
    'ESPER',
    'Serendipity',
    'UwU',
    'SHANA',
    'Ryuu',
    'RYO',
    'DragonMax',
    'QTZ',
    'Tenrai-Sensei',
    'ToonsHub',
    'Eaulive',
    'BOTHD',
    'Slay3R'
]);

import { 
    QUALITY_PATTERNS, 
    SOURCE_PATTERNS, 
    CODEC_PATTERNS, 
    LANGUAGE_PATTERNS, 
    AUDIO_PATTERNS,
    COMPREHENSIVE_TECH_PATTERNS,
    FILE_EXTENSIONS
} from './media-patterns.js';

/**
 * Patterns for extracting release groups from filenames
 */
const EXTRACTION_PATTERNS = [
    // [GroupName] at start or end
    /\[([^\]]+)\]/g,
    
    // (GroupName) at end
    /\(([^)]+)\)$/,
    
    // -GroupName at end
    /\s-\s*([A-Za-z0-9][A-Za-z0-9\-\.]{1,25})$/,
    
    // .GroupName.extension
    /\.([A-Za-z0-9][A-Za-z0-9\-\.]{1,25})\.(mkv|mp4|avi)$/i,
    
    // MSubs-GroupName pattern
    /MSubs-([A-Za-z0-9]+)/,
    
    // GroupName (CR) pattern for Crunchyroll rips
    /([A-Za-z0-9\-]+)\s*\(CR\)/
];

export function isKnownReleaseGroup(group) {
    if (!group || typeof group !== 'string') return false;
    return KNOWN_RELEASE_GROUPS.has(group.trim());
}

function matchesTechnicalPattern(group) {
    const trimmed = group.trim();
    
    for (const pattern of QUALITY_PATTERNS) {
        if (pattern.pattern.test(trimmed)) return true;
    }
    
    for (const pattern of SOURCE_PATTERNS) {
        if (pattern.pattern.test(trimmed)) return true;
    }
    
    for (const pattern of CODEC_PATTERNS) {
        if (pattern.pattern.test(trimmed)) return true;
    }
    
    for (const pattern of LANGUAGE_PATTERNS) {
        if (pattern.pattern.test(trimmed)) return true;
    }
    
    for (const pattern of AUDIO_PATTERNS) {
        if (pattern.pattern.test(trimmed)) return true;
    }
    
    for (const pattern of COMPREHENSIVE_TECH_PATTERNS) {
        if (pattern.pattern.test(trimmed)) return true;
    }
    
    const extensions = [...FILE_EXTENSIONS.video, ...FILE_EXTENSIONS.subtitle, ...FILE_EXTENSIONS.disk, ...FILE_EXTENSIONS.archive];
    if (extensions.some(ext => trimmed.toLowerCase().endsWith(`.${ext}`))) return true;
    
    return false;
}

export function isValidReleaseGroup(group) {
    if (!group || typeof group !== 'string') return false;
    
    const trimmed = group.trim();
    
    if (trimmed.length < 2 || trimmed.length > 30) return false;
    
    if (!/[A-Za-z]/.test(trimmed)) return false;
    
    if (matchesTechnicalPattern(trimmed)) {
        return false;
    }
    if (/^\d{4}$/.test(trimmed)) return false;
    if (/^[A-F0-9]{8,}$/i.test(trimmed)) return false;
    if (/^S\d{1,2}E\d{1,3}$/i.test(trimmed)) return false;
    if (/^S\d{1,2}E\d{1,3}\./i.test(trimmed)) return false;
    if (/^S\d{1,2}E\d{1,3}\.(VOSTFR|MULTI|FR|EN|JP)$/i.test(trimmed)) return false;
    if (/^\d{1,3}\.mkv$/i.test(trimmed)) return false;
    if (KNOWN_RELEASE_GROUPS.has(trimmed)) return true;
    
    const alphaCount = (trimmed.match(/[A-Za-z]/g) || []).length;
    const digitCount = (trimmed.match(/[0-9]/g) || []).length;
    const specialCount = (trimmed.match(/[^A-Za-z0-9]/g) || []).length;
    
    if (digitCount > alphaCount && digitCount > 3) return false;
    
    if (specialCount > 3) return false;
    
    return true;
}

export function extractReleaseGroup(filename) {
    if (!filename) return null;
    
    const detectedGroups = [];
    
    const bracketMatches = filename.match(/\[([^\]]+)\]/g);
    if (bracketMatches) {
        bracketMatches.forEach(match => {
            const group = match.replace(/[\[\]]/g, '').trim();
            if (isValidReleaseGroup(group)) {
                detectedGroups.push(group);
            }
        });
    }
    
    const parenMatch = filename.match(/\(([^)]+)\)$/);
    if (parenMatch && isValidReleaseGroup(parenMatch[1])) {
        detectedGroups.push(parenMatch[1].trim());
    }
    
    const dashMatches = [
        filename.match(/\s-\s*([A-Za-z0-9][A-Za-z0-9\-\.]{1,25})$/),
        filename.match(/\.([A-Za-z0-9][A-Za-z0-9\-\.]{1,25})\.mkv$/i),
        filename.match(/\.([A-Za-z0-9][A-Za-z0-9\-\.]{1,25})\.mp4$/i),
        filename.match(/\.([A-Za-z0-9][A-Za-z0-9\-\.]{1,25})\.avi$/i)
    ];
    
    dashMatches.forEach(match => {
        if (match && isValidReleaseGroup(match[1])) {
            detectedGroups.push(match[1].trim());
        }
    });
    
    KNOWN_RELEASE_GROUPS.forEach(knownGroup => {
        if (filename.includes(knownGroup) && !detectedGroups.includes(knownGroup)) {
            detectedGroups.push(knownGroup);
        }
    });
    
    const msubsMatch = filename.match(/MSubs-([A-Za-z0-9]+)/);
    if (msubsMatch && isValidReleaseGroup(msubsMatch[0])) {
        detectedGroups.push(msubsMatch[0]);
    }
    
    const crMatch = filename.match(/([A-Za-z0-9\-]+)\s*\(CR\)/);
    if (crMatch && isValidReleaseGroup(crMatch[1])) {
        detectedGroups.push(crMatch[1] + ' (CR)');
    }
    
    if (detectedGroups.length === 0) return null;
    if (detectedGroups.length === 1) return detectedGroups[0];
    
    const knownMatches = detectedGroups.filter(g => KNOWN_RELEASE_GROUPS.has(g));
    if (knownMatches.length > 0) return knownMatches[0];
    
    return detectedGroups.sort((a, b) => b.length - a.length)[0];
}

export function addReleaseGroup(groupName) {
    if (!groupName || typeof groupName !== 'string') return false;
    
    const trimmed = groupName.trim();
    if (isValidReleaseGroup(trimmed) && !KNOWN_RELEASE_GROUPS.has(trimmed)) {
        KNOWN_RELEASE_GROUPS.add(trimmed);
        return true;
    }
    return false;
}

export function getReleaseGroupStats() {
    const totalTechnicalPatterns = QUALITY_PATTERNS.length + SOURCE_PATTERNS.length + 
                                  CODEC_PATTERNS.length + LANGUAGE_PATTERNS.length + 
                                  AUDIO_PATTERNS.length + COMPREHENSIVE_TECH_PATTERNS.length;
    
    return {
        totalKnownGroups: KNOWN_RELEASE_GROUPS.size,
        technicalPatterns: totalTechnicalPatterns,
        extractionPatterns: EXTRACTION_PATTERNS.length
    };
}

export function getAllKnownGroups() {
    return Array.from(KNOWN_RELEASE_GROUPS).sort();
}

export default {
    KNOWN_RELEASE_GROUPS,
    isKnownReleaseGroup,
    isValidReleaseGroup,
    extractReleaseGroup,
    addReleaseGroup,
    getReleaseGroupStats,
    getAllKnownGroups
};
