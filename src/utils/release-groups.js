/**
 * Release Groups Utility
 * Centralized management of known release groups and detection logic
 * Generated: 2025-06-28T20:20:00.000Z
 * 
 * This file can be updated to add new release groups without modifying core code
 */

/**
 * Comprehensive list of known release groups
 * Add new groups here as they are discovered
 */
export const KNOWN_RELEASE_GROUPS = new Set([
    // High-frequency groups (from AllDebrid analysis)
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
    
    // Anime release groups
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
    
    // Scene/P2P groups
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
    
    // BluRay/Remux groups
    'BluDragon',
    'DTA',
    'SAMPA',
    'Garshasp',
    
    // Personal/smaller groups
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
]);

/**
 * Technical terms that should NOT be considered release groups
 * This blacklist helps avoid false positives
 */
export const TECHNICAL_BLACKLIST = new Set([
    // Quality/Resolution
    '1080p', '720p', '480p', '576p', '2160p', '4K', 'UHD', 'HD', 'SD',
    
    // Codecs
    'x264', 'x265', 'H264', 'H265', 'H.264', 'H.265', 'HEVC', 'AVC', 'h264', 'h265',
    
    // Audio
    'AAC', 'AC3', 'DTS', 'ATMOS', 'FLAC', 'MP3', 'OGG', 'PCM',
    
    // Bit depth
    '10bit', '10bits', '10BITS', '8bit', '12bit',
    
    // Languages
    'MULTI', 'MULTi', 'MULTi3', 'MULTi2', 'VOSTFR', 'FRENCH', 'ENGLISH', 'JAPANESE',
    'GERMAN', 'SPANISH', 'ITALIAN', 'SUBFRENCH', 'VF', 'VFF', 'VO', 'VO-VOSTFR',
    'French - Japanese', 'English - Japanese', 'Multi - Japanese',
    
    // Sources
    'BluRay', 'BDRip', 'WEBRip', 'WEB-DL', 'HDTV', 'DVDRip', 'CAM', 'TS', 'TC',
    'WEBRIP', 'WEB', 'BD', 'DVD', 'Bluray', 'BLU-RAY',
    
    // Collections/Flags
    'COMPLETE', 'COMPLET', 'Batch', 'PROPER', 'REPACK', 'EXTENDED', 'DIRECTORS',
    'CUT', 'UNRATED', 'THEATRICAL', 'IMAX', 'LIMITED', 'FESTIVAL', 'DVDSCR',
    'INTERNAL', 'Integral', 'Integrale', 'Season', 'Saison',
    
    // Audio descriptions
    'dual audio', 'Dual Audio', 'Dual-Audio', 'Dual Audio-EngSubs', 'Multiple Subtitle', 
    'Multiple Subtitles', 'MSubs', 'ESub', 'ESUB', 'Subs', 'EngSubs',
    
    // File formats
    'mkv', 'mp4', 'avi', 'm4v', 'mov', 'wmv', 'flv', 'webm',
    
    // Generic terms
    'CUSTOM', 'Raws', 'RAW', 'v2', 'v3', 'Final',
    
    // Technical specs combinations
    'BD 1080p FLAC', 'WEB 1080p', 'BD AV1'
]);

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

/**
 * Check if a string is a known release group
 * @param {string} group - Group name to check
 * @returns {boolean} - True if it's a known release group
 */
export function isKnownReleaseGroup(group) {
    if (!group || typeof group !== 'string') return false;
    return KNOWN_RELEASE_GROUPS.has(group.trim());
}

/**
 * Validate if a string could be a release group (not a technical term)
 * @param {string} group - Group name to validate
 * @returns {boolean} - True if it could be a valid release group
 */
export function isValidReleaseGroup(group) {
    if (!group || typeof group !== 'string') return false;
    
    const trimmed = group.trim();
    
    // Length checks
    if (trimmed.length < 2 || trimmed.length > 30) return false;
    
    // Must contain at least one letter
    if (!/[A-Za-z]/.test(trimmed)) return false;
    
    // Check against blacklist (case insensitive)
    if (TECHNICAL_BLACKLIST.has(trimmed) || 
        TECHNICAL_BLACKLIST.has(trimmed.toLowerCase()) ||
        TECHNICAL_BLACKLIST.has(trimmed.toUpperCase())) {
        return false;
    }
    
    // Don't allow pure years
    if (/^\d{4}$/.test(trimmed)) return false;
    
    // Don't allow hash-like strings
    if (/^[A-F0-9]{8,}$/i.test(trimmed)) return false;
    
    // Don't allow pure technical patterns
    if (/^\d+p$/i.test(trimmed)) return false;
    if (/^x26[45]$/i.test(trimmed)) return false;
    if (/^h\.?26[45]$/i.test(trimmed)) return false;
    
    // Don't allow season/episode patterns
    if (/^S\d{1,2}E\d{1,3}$/i.test(trimmed)) return false;
    if (/^S\d{1,2}E\d{1,3}\./i.test(trimmed)) return false;
    
    // Don't allow file extensions
    if (/\.(mkv|mp4|avi|m4v|mov|wmv|flv|webm|ts|m2ts)$/i.test(trimmed)) return false;
    
    // Don't allow season/episode + language patterns
    if (/^S\d{1,2}E\d{1,3}\.(VOSTFR|MULTI|FR|EN|JP)$/i.test(trimmed)) return false;
    
    // Don't allow just episode numbers with extension-like suffixes
    if (/^\d{1,3}\.mkv$/i.test(trimmed)) return false;
    
    // If it's a known group, definitely valid
    if (KNOWN_RELEASE_GROUPS.has(trimmed)) return true;
    
    // Additional validation for unknown groups
    const alphaCount = (trimmed.match(/[A-Za-z]/g) || []).length;
    const digitCount = (trimmed.match(/[0-9]/g) || []).length;
    const specialCount = (trimmed.match(/[^A-Za-z0-9]/g) || []).length;
    
    // Too many digits suggests technical term
    if (digitCount > alphaCount && digitCount > 3) return false;
    
    // Too many special characters
    if (specialCount > 3) return false;
    
    return true;
}

/**
 * Extract release group from filename using multiple patterns
 * @param {string} filename - Filename to analyze
 * @returns {string|null} - Detected release group or null
 */
export function extractReleaseGroup(filename) {
    if (!filename) return null;
    
    const detectedGroups = [];
    
    // Pattern 1: [GroupName] brackets
    const bracketMatches = filename.match(/\[([^\]]+)\]/g);
    if (bracketMatches) {
        bracketMatches.forEach(match => {
            const group = match.replace(/[\[\]]/g, '').trim();
            if (isValidReleaseGroup(group)) {
                detectedGroups.push(group);
            }
        });
    }
    
    // Pattern 2: (GroupName) at end
    const parenMatch = filename.match(/\(([^)]+)\)$/);
    if (parenMatch && isValidReleaseGroup(parenMatch[1])) {
        detectedGroups.push(parenMatch[1].trim());
    }
    
    // Pattern 3: -GroupName at end
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
    
    // Pattern 4: Known groups anywhere in filename
    KNOWN_RELEASE_GROUPS.forEach(knownGroup => {
        if (filename.includes(knownGroup) && !detectedGroups.includes(knownGroup)) {
            detectedGroups.push(knownGroup);
        }
    });
    
    // Pattern 5: MSubs-GroupName pattern
    const msubsMatch = filename.match(/MSubs-([A-Za-z0-9]+)/);
    if (msubsMatch && isValidReleaseGroup(msubsMatch[0])) {
        detectedGroups.push(msubsMatch[0]);
    }
    
    // Pattern 6: GroupName (CR) pattern for Crunchyroll rips
    const crMatch = filename.match(/([A-Za-z0-9\-]+)\s*\(CR\)/);
    if (crMatch && isValidReleaseGroup(crMatch[1])) {
        detectedGroups.push(crMatch[1] + ' (CR)');
    }
    
    // Return the best match
    if (detectedGroups.length === 0) return null;
    if (detectedGroups.length === 1) return detectedGroups[0];
    
    // Prefer known groups
    const knownMatches = detectedGroups.filter(g => KNOWN_RELEASE_GROUPS.has(g));
    if (knownMatches.length > 0) return knownMatches[0];
    
    // Otherwise return the longest (likely most specific)
    return detectedGroups.sort((a, b) => b.length - a.length)[0];
}

/**
 * Add a new release group to the known list
 * @param {string} groupName - Name of the release group to add
 * @returns {boolean} - True if added successfully
 */
export function addReleaseGroup(groupName) {
    if (!groupName || typeof groupName !== 'string') return false;
    
    const trimmed = groupName.trim();
    if (isValidReleaseGroup(trimmed) && !KNOWN_RELEASE_GROUPS.has(trimmed)) {
        KNOWN_RELEASE_GROUPS.add(trimmed);
        return true;
    }
    return false;
}

/**
 * Get statistics about release group detection
 * @returns {Object} - Statistics object
 */
export function getReleaseGroupStats() {
    return {
        totalKnownGroups: KNOWN_RELEASE_GROUPS.size,
        blacklistedTerms: TECHNICAL_BLACKLIST.size,
        extractionPatterns: EXTRACTION_PATTERNS.length
    };
}

/**
 * Get all known release groups as an array (for debugging/display)
 * @returns {string[]} - Array of all known release groups
 */
export function getAllKnownGroups() {
    return Array.from(KNOWN_RELEASE_GROUPS).sort();
}

// Default export for convenience
export default {
    KNOWN_RELEASE_GROUPS,
    TECHNICAL_BLACKLIST,
    isKnownReleaseGroup,
    isValidReleaseGroup,
    extractReleaseGroup,
    addReleaseGroup,
    getReleaseGroupStats,
    getAllKnownGroups
};
