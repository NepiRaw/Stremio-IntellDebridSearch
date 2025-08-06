/**
 * Centralized patterns for quality, codecs, sources, languages, etc.
 * Used across the entire codebase for consistency and maintainability.
 * 
 * IMPORTANT: This file consolidates patterns from:
 * - lib/stream-provider.js (quality extraction, language mapping, codec mapping)
 * - lib/advanced-search.js (technical patterns, quality scoring)
 * - test-fuzzy-matching.js (title cleaning patterns)
 */

/**
 * Quality extraction patterns with scoring for advanced search
 * Ordered by priority (highest quality first)
 * Based on stream-provider.js qualityPatterns and advanced-search.js quality scoring
 */
const QUALITY_PATTERNS = [
    // 4K/UHD patterns - Diamond (highest quality) - stream-provider.js line 639
    { pattern: /(2160p|4K|UHD|UHDBD|UHD-BD|4K-UHD)/i, quality: '4K', displayName: '4K UHD', score: 40, emoji: '💎' },
    // 1440p patterns - Ring - stream-provider.js line 641
    { pattern: /1440p/i, quality: '1440p', displayName: '1440p', score: 30, emoji: '💍' },
    // 1080p patterns - Star (very good quality) - stream-provider.js line 643
    { pattern: /1080p/i, quality: '1080p', displayName: '1080p', score: 20, emoji: '⭐' },
    // 720p patterns - Sparkles (good quality) - stream-provider.js line 645
    { pattern: /720p/i, quality: '720p', displayName: '720p', score: 10, emoji: '✨' },
    // 576p patterns - Circle - stream-provider.js line 647
    { pattern: /576p/i, quality: '576p', displayName: '576p', score: 7, emoji: '🔘' },
    // 480p patterns - Black dot - stream-provider.js line 649
    { pattern: /480p/i, quality: '480p', displayName: '480p', score: 5, emoji: '⚫' },
    // DVD quality - Disc - stream-provider.js line 651
    { pattern: /\b(DVD|DVDRIP)\b/i, quality: 'DVD', displayName: 'DVD', score: 3, emoji: '📀' }
];

/**
 * Source patterns with scoring for advanced search
 * Ordered by quality preference
 * Based on stream-provider.js qualityPatterns and advanced-search.js source scoring
 */
const SOURCE_PATTERNS = [
    // BluRay patterns (including BD variants) - stream-provider.js line 655 & advanced-search.js
    // Updated to handle BluRay1080p, BluRay720p, BD1080p, etc (no space between source and resolution)
    { pattern: /\b(BLURAY|BLU-RAY|BDRIP|BD-RIP|BD)(?:\d+p?)?\b/i, source: 'BluRay', displayName: 'BluRay', score: 15, emoji: '💿' },
    // Web DL patterns - enhanced to catch WebDl1080p, WEB-DL1080p, etc
    { pattern: /\b(WEBDL|WEB-DL|WEB\.DL)(?:\d+p?)?\b/i, source: 'WEB-DL', displayName: 'WEB-DL', score: 12, emoji: '🌐' },
    // Web Rip patterns - enhanced to catch WebRip1080p, WEBRip720p, etc
    { pattern: /\b(WEBRIP|WEB-RIP|WEB\.RIP|WEBRIP)(?:\d+p?)?\b/i, source: 'WEBRip', displayName: 'WEB-Rip', score: 10, emoji: '🌐' },
    // Plain WEB pattern (treat as WEB-DL) - for titles like "1080p.WEB.x264"
    { pattern: /\b(WEB)(?:\d+p?)?\b/i, source: 'WEB-DL', displayName: 'WEB-DL', score: 12, emoji: '🌐' },
    // HDTV patterns - stream-provider.js line 657 & advanced-search.js
    { pattern: /\bHDTV\b/i, source: 'HDTV', displayName: 'HDTV', score: 5, emoji: '📺' }
];

/**
 * Codec patterns with scoring for advanced search
 * Ordered by efficiency/quality preference
 * Based on stream-provider.js codecMap and advanced-search.js codec scoring
 */
const CODEC_PATTERNS = [
    // HEVC patterns - stream-provider.js codecMap & advanced-search.js
    { pattern: /\b(HEVC|x265|H\.?265|h265)\b/i, codec: 'HEVC', displayName: 'HEVC', score: 10, emoji: '🎯' },
    // x264 patterns - stream-provider.js codecMap & advanced-search.js  
    { pattern: /\b(x264|H\.?264|AVC|h264)\b/i, codec: 'x264', displayName: 'x264', score: 5, emoji: '📺' }
];

/**
 * Language patterns for display enhancement
 * Ordered by specificity (longest patterns first to avoid conflicts)
 * Based on stream-provider.js languageMap (lines 999-1025)
 */
const LANGUAGE_PATTERNS = [
    // Multi-language indicators (most specific first) - stream-provider.js lines 1000-1008
    { pattern: /\b(Multiple Subtitle|Multiple Subtitles|Multi-Sub)\b/i, language: 'MULTI', displayName: 'MULTI', emoji: '🌍' },
    { pattern: /\b(MULTILINGUAL|MULTILANG)\b/i, language: 'MULTI', displayName: 'MULTI', emoji: '🌍' },
    { pattern: /\b(MULTi3|MULTi2|MULTi|MULTI)\b/i, language: 'MULTI', displayName: 'MULTI', emoji: '🌍' },
    
    // French variations (ordered by specificity) - stream-provider.js lines 1010-1017
    { pattern: /\bTRUEFRENCH\b/i, language: 'TrueFrench', displayName: 'TrueFrench', emoji: '🇫🇷' },
    { pattern: /\bSUBFRENCH\b/i, language: 'SubFrench', displayName: 'SubFrench', emoji: '🇫🇷' },
    { pattern: /\bVOSTFR\b/i, language: 'VOSTFR', displayName: 'VOSTFR', emoji: '🇫🇷' },
    { pattern: /\b(FRENCH|FRANCAIS)\b/i, language: 'French', displayName: 'French', emoji: '🇫🇷' },
    { pattern: /\bVFF\b/i, language: 'VFF', displayName: 'VFF', emoji: '🇫🇷' },
    { pattern: /\bVF\b/i, language: 'VF', displayName: 'VF', emoji: '🇫🇷' },
    { pattern: /\bFR\b/i, language: 'FR', displayName: 'FR', emoji: '🇫🇷' },
    
    // Other languages - stream-provider.js lines 1019-1025
    { pattern: /\bENGLISH\b/i, language: 'English', displayName: 'English', emoji: '🇺🇸' },
    { pattern: /\bJAPANESE\b/i, language: 'Japanese', displayName: 'Japanese', emoji: '🇯🇵' },
    { pattern: /\bSPANISH\b/i, language: 'Spanish', displayName: 'Spanish', emoji: '🇪🇸' },
    { pattern: /\bGERMAN\b/i, language: 'German', displayName: 'German', emoji: '🇩🇪' },
    { pattern: /\bITALIAN\b/i, language: 'Italian', displayName: 'Italian', emoji: '🇮🇹' }
];

/**
 * Audio codec patterns for display enhancement
 * Enhanced to cover all major audio format variations with optimal ordering to prevent redundancy
 * Most specific patterns first to avoid multiple matches for the same audio feature
 * Based on stream-provider.js codecMap (lines 1027-1048) and extended for comprehensive coverage
 */
const AUDIO_PATTERNS = [
    // Dolby Atmos patterns (highest priority - most specific first)
    { pattern: /\b(EAC3[\.\-]?5\.1[\.\-]?ATMOS|E\-AC3[\.\-]?5\.1[\.\-]?ATMOS)\b/i, audio: 'EAC3 5.1 Atmos', displayName: 'EAC3 5.1 Atmos', emoji: '🔊' },
    { pattern: /\b(DDP5\.1[\.\-]?ATMOS|DD\+5\.1[\.\-]?ATMOS)\b/i, audio: 'DD+ 5.1 Atmos', displayName: 'DD+ 5.1 Atmos', emoji: '🔊' },
    { pattern: /\b(DOLBY[\s\-\.]?ATMOS|ATMOS)\b/i, audio: 'Atmos', displayName: 'Atmos', emoji: '🔊' },
    
    // DTS variants (ordered by quality - most specific first)
    { pattern: /\b(DTS[\s\-\:]?X|DTSX)\b/i, audio: 'DTS:X', displayName: 'DTS:X', emoji: '🔊' },
    { pattern: /\b(DTS[\s\-\:]?HD[\s\-\.]?MA|DTS\-HD\.MA)\b/i, audio: 'DTS-HD MA', displayName: 'DTS-HD MA', emoji: '🔊' },
    { pattern: /\b(DTS[\s\-\:]?HD|DTS\s*HD)\b/i, audio: 'DTS-HD', displayName: 'DTS-HD', emoji: '🔊' },
    { pattern: /\b(DTS)\b/i, audio: 'DTS', displayName: 'DTS', emoji: '🔊' },
    
    // TrueHD patterns
    { pattern: /\b(TRUEHD|TRUE[\s\-\.]?HD|TRUE\s*HD)\b/i, audio: 'TrueHD', displayName: 'TrueHD', emoji: '🔊' },
    
    // EAC3/AC3 variants (most specific first to avoid redundancy)
    { pattern: /\b(EAC3[\.\-]?5\.1|E\-AC3[\.\-]?5\.1|EAC3\.5\.1)\b/i, audio: 'EAC3 5.1', displayName: 'EAC3 5.1', emoji: '🎵' },
    { pattern: /\b(AC3[\.\-]?5\.1|AC\-3[\.\-]?5\.1)\b/i, audio: 'AC3 5.1', displayName: 'AC3 5.1', emoji: '🎵' },
    { pattern: /\b(DDP5\.1|DD\+5\.1|DDPLUS5\.1)\b/i, audio: 'DD+ 5.1', displayName: 'DD+ 5.1', emoji: '🎵' },
    { pattern: /\b(EAC3|E\-AC3|EAC\-3)\b/i, audio: 'EAC3', displayName: 'EAC3', emoji: '🎵' },
    { pattern: /\b(AC3|AC\-3)\b/i, audio: 'AC3', displayName: 'AC3', emoji: '🎵' },
    
    // AAC variants (most specific first to avoid redundancy)
    { pattern: /\b(HE\-AAC[\.\-]?5\.1|HEAAC[\.\-]?5\.1)\b/i, audio: 'HE-AAC 5.1', displayName: 'HE-AAC 5.1', emoji: '🎵' },
    { pattern: /\b(AAC[\.\-]?5\.1|AAC\.5\.1)\b/i, audio: 'AAC 5.1', displayName: 'AAC 5.1', emoji: '🎵' },
    { pattern: /\b(HE\-AAC|HEAAC)\b/i, audio: 'HE-AAC', displayName: 'HE-AAC', emoji: '🎵' },
    { pattern: /\b(AAC)\b/i, audio: 'AAC', displayName: 'AAC', emoji: '🎵' },
    
    // Lossless audio formats
    { pattern: /\b(FLAC)\b/i, audio: 'FLAC', displayName: 'FLAC', emoji: '🎵' },
    { pattern: /\b(LPCM)\b/i, audio: 'LPCM', displayName: 'LPCM', emoji: '🔊' },
    
    // Other formats
    { pattern: /\b(MP3)\b/i, audio: 'MP3', displayName: 'MP3', emoji: '🎵' },
    { pattern: /\b(OGG)\b/i, audio: 'OGG', displayName: 'OGG', emoji: '🎵' },
    
    // Color depth (moved here as it's often mentioned with audio specs)
    { pattern: /\b(10BITS?|10BIT)\b/i, audio: '10bit', displayName: '10bit', emoji: '🎨' },
    { pattern: /\b(12BITS?|12BIT)\b/i, audio: '12bit', displayName: '12bit', emoji: '🎨' }
];

/**
 * Patterns for technical info detection (used in title cleaning)
 * Enhanced to cover all technical information variants
 * Used to identify where technical information starts in torrent names
 * Based on stream-provider.js techPatterns (lines 905-911) and advanced-search.js techPatterns (lines 1391-1397)
 */
const TECHNICAL_PATTERNS = [
    // Resolution patterns - same in both files
    /\b(2160p|1440p|1080p|720p|576p|480p|4K|UHD)/i,
    // Source patterns - enhanced to include BD and WebDl variants
    /\b(BLURAY|BLU-RAY|BD|WEBRIP|WEB-RIP|WEBDL|WEB-DL|WEB\.DL|WEB\.RIP|HDTV|BDRIP|BD-RIP|DVDRIP)/i,
    // Codec patterns - same in both files
    /\b(x264|x265|H\.?264|H\.?265|HEVC|AVC|h264|h265)/i,
    // Language patterns - same in both files
    /\b(MULTI|MULTi|MULTi\d+|VOSTFR|TRUEFRENCH|FRENCH)/i,
    // Audio patterns - enhanced to include all variants
    /\b(AAC|DTS|AC3|EAC3|E-AC3|ATMOS|TRUEHD|TRUE-HD|LPCM|FLAC|HE-AAC|HEAAC|DDP|DD\+)/i,
    // HDR and quality patterns
    /\b(HDR10\+|HDR10|HDR|HDLIGHT|HD-LIGHT|DOLBY\s*VISION|DV)/i,
    // Bit depth patterns
    /\b(10BITS?|10BIT|12BITS?|12BIT|8BITS?|8BIT)/i
];

/**
 * Comprehensive technical terms for detailed stream information
 * Enhanced to cover all possible technical details and variants
 * Used in extractTechnicalDetails for complete technical analysis
 */
const COMPREHENSIVE_TECH_PATTERNS = [
    // HDR variants (including HDLight and quality variants)
    { pattern: /(HDR10\+|HDR10PLUS)/i, display: '🌈 HDR10+' },
    { pattern: /HDR10(?!\+)/i, display: '🌈 HDR10' },
    { pattern: /\b(HDLIGHT[\.\-]?10BIT|HD[\.\-]?LIGHT[\.\-]?10BIT)\b/i, display: '🌈 HDLight 10bit' },
    { pattern: /\b(HDLIGHT|HD[\.\-]?LIGHT)\b/i, display: '🌈 HDLight' },
    { pattern: /\b(HDR)\b/i, display: '🌈 HDR' },
    { pattern: /\b(DOLBY\s*VISION|DV)\b/i, display: '🌈 Dolby Vision' },
    
    // Color depth and encoding quality
    { pattern: /\b(10BITS?|10BIT)\b/i, display: '🎨 10bit' },
    { pattern: /\b(12BITS?|12BIT)\b/i, display: '🎨 12bit' },
    { pattern: /\b(8BITS?|8BIT)\b/i, display: '🎨 8bit' },
    
    // Audio enhancements (only non-duplicated patterns - specific audio patterns are in AUDIO_PATTERNS)
    // Note: Removed duplicate patterns that exist in AUDIO_PATTERNS to avoid redundancy
    { pattern: /\b(LPCM)\b/i, display: '🔊 LPCM' },
    { pattern: /\b(FLAC)\b/i, display: '🎵 FLAC' },
    
    // Video processing
    { pattern: /\b(REMUX)\b/i, display: '🎯 REMUX' },
    { pattern: /\b(REPACK)\b/i, display: '📦 REPACK' },
    { pattern: /\b(PROPER)\b/i, display: '✅ PROPER' },
    { pattern: /\b(INTERNAL)\b/i, display: '🏠 INTERNAL' },
    
    // Frame rates
    { pattern: /\b(60FPS|60P)\b/i, display: '🎬 60fps' },
    { pattern: /\b(50FPS|50P)\b/i, display: '🎬 50fps' },
    { pattern: /\b(30FPS|30P)\b/i, display: '🎬 30fps' },
    { pattern: /\b(24FPS|24P)\b/i, display: '🎬 24fps' },
    
    // Special features
    { pattern: /\b(IMAX)\b/i, display: '🎞️ IMAX' },
    { pattern: /\b(EXTENDED|EXT)\b/i, display: '⏱️ Extended' },
    { pattern: /\b(DIRECTORS?\s*CUT|DC)\b/i, display: '🎬 Director\'s Cut' },
    { pattern: /\b(UNCUT)\b/i, display: '🔓 Uncut' },
    { pattern: /\b(UNRATED)\b/i, display: '🔞 Unrated' }
];

/**
 * Patterns for cleaning up artifacts and unwanted text
 * Based on stream-provider.js quality removal (line 995) and other cleanup patterns
 */
const CLEANUP_PATTERNS = {
    // Quality indicators to remove from details - stream-provider.js line 995
    qualityRemoval: /\b(2160p|1440p|1080p|720p|576p|480p|4K|UHD|UHDBD|UHD-BD|4K-UHD)\b/gi,
    // Source indicators to remove from details - stream-provider.js line 996
    sourceRemoval: /\b(DVD|DVDRIP|BLURAY|BLU-RAY|BDRIP|BD-RIP|HDTV)\b/gi,
    // Unknown/unwanted terms to remove completely (streaming services, platforms, etc.)
    unwantedTerms: /\b(VRV|CRUNCHYROLL|FUNIMATION|HULU|AMZN|AMAZON|NETFLIX|NF|DSNP|DISNEY)\b/gi,
    // Empty brackets removal
    emptyBrackets: /\[\s*\]/g,
    // Remove brackets from technical terms
    bracketContent: /\[([^\]]+)\]/g,
    // Empty parentheses removal
    emptyParentheses: /\(\s*\)/g,
    // Dots and underscores to spaces - used in both stream-provider.js and advanced-search.js
    dotsUnderscores: /[\._]/g,
    // Multiple spaces to single space - used in both files
    multipleSpaces: /\s+/g,
    // Trailing hyphens and spaces - used in both files
    trailingDash: /\s*-\s*$/,
    // Group tags at beginning - used in both files
    groupTags: /^[\[\{][^\]\}]+[\]\}]\s*/
};

/**
 * Episode name filtering patterns for stream-provider.js
 * Based on stream-provider.js lines 840-842 and 844-845
 */
const EPISODE_NAME_FILTERS = {
    // Technical patterns to skip - stream-provider.js line 841
    technicalPatterns: /^\d+p$|^x26[45]$|^hevc$|^avc$|^10bits?$/i,
    // Hash patterns - stream-provider.js line 841
    hashPatterns: /^[A-Z0-9]{8,}$/i,
    // Common false positives - stream-provider.js line 841
    falsePositives: /^(VRV|Multiple Subtitle|1080p|720p|480p)$/i,
    // Season/Episode patterns - stream-provider.js line 842
    seasonEpisodePatterns: /^(Season \d+|Episode \d+)$/i,
    // Source patterns - stream-provider.js line 842
    sourcePatterns: /^(BluRay|WEBRip|WEB-DL|HDTV)$/i,
    // Release group patterns - stream-provider.js line 842
    releaseGroupPatterns: /^(x264|x265|HEVC|AVC|EMBER|SubsPlease|HorribleSubs|Erai-raws|Judas|GKIDS|AMZN)$/i,
    // URL patterns - stream-provider.js line 843
    urlPatterns: /www\.|\.com/
};

const FILE_EXTENSIONS = {
    video: ["3g2", "3gp", "avi", "flv", "mkv", "mk3d", "mov", "mp2", "mp4", "m4v", "mpe", "mpeg", "mpg", "mpv", "webm", "wmv", "ogm", "ts", "m2ts"],
    subtitle: ["aqt", "gsub", "jss", "sub", "ttxt", "pjs", "psb", "rt", "smi", "slt", "ssf", "srt", "ssa", "ass", "usf", "idx", "vtt"],
    disk: ["iso", "m2ts", "ts", "vob"],
    archive: ["rar", "zip"]
};


/**
 * Extract quality from torrent name using centralized patterns
 * @param {string} name - Torrent name to analyze
 * @returns {Object} - Quality information with score
 */
function extractQualityInfo(name) {
    const quality = {
        resolution: null,
        source: null,
        codec: null,
        score: 0
    };
    
    // Check quality patterns
    for (const pattern of QUALITY_PATTERNS) {
        if (pattern.pattern.test(name)) {
            quality.resolution = pattern.quality;
            quality.score += pattern.score;
            break;
        }
    }
    
    // Check source patterns
    for (const pattern of SOURCE_PATTERNS) {
        if (pattern.pattern.test(name)) {
            quality.source = pattern.source;
            quality.score += pattern.score;
            break;
        }
    }
    
    // Check codec patterns
    for (const pattern of CODEC_PATTERNS) {
        if (pattern.pattern.test(name)) {
            quality.codec = pattern.codec;
            quality.score += pattern.score;
            break;
        }
    }
    
    return quality;
}

/**
 * Extract quality string with emoji for display
 * @param {string} name - Torrent or video name
 * @param {Object} fallbackInfo - Optional fallback resolution info
 * @returns {string} - Formatted quality string with emoji
 */
function extractQualityDisplay(name, fallbackInfo = null) {
    const combinedName = name + (fallbackInfo?.resolution || '');
    
    // Try quality patterns first
    for (const pattern of QUALITY_PATTERNS) {
        if (pattern.pattern.test(combinedName)) {
            return `${pattern.emoji} ${pattern.displayName}`;
        }
    }
    
    // Try source patterns for special cases like BluRay without resolution
    for (const pattern of SOURCE_PATTERNS) {
        if (pattern.pattern.test(combinedName)) {
            return `${pattern.emoji} ${pattern.displayName}`;
        }
    }
    
    // Handle fallback resolution with emoji
    const fallbackResolution = fallbackInfo?.resolution;
    if (fallbackResolution && fallbackResolution !== 'Unknown') {
        if (fallbackResolution.includes('2160') || fallbackResolution.includes('4K')) return '💎 ' + fallbackResolution;
        if (fallbackResolution.includes('1440')) return '💍 ' + fallbackResolution;
        if (fallbackResolution.includes('1080')) return '⭐ ' + fallbackResolution;
        if (fallbackResolution.includes('720')) return '✨ ' + fallbackResolution;
        if (fallbackResolution.includes('576')) return '🔘 ' + fallbackResolution;
        if (fallbackResolution.includes('480')) return '⚫ ' + fallbackResolution;
        return '📺 ' + fallbackResolution;
    }
    
    return '❓ Unknown';
}

/**
 * Create language map for replacement operations (ordered by length)
 * @returns {Object} - Language code to display name mapping
 */
function createLanguageMap() {
    const map = {};
    LANGUAGE_PATTERNS.forEach(pattern => {
        // Extract the pattern content between parentheses
        const patternStr = pattern.pattern.source;
        const match = patternStr.match(/\(([^)]+)\)/);
        if (match) {
            const variants = match[1].split('|').filter(v => v.length > 0);
            variants.forEach(variant => {
                map[variant] = `${pattern.emoji} ${pattern.displayName}`;
            });
        }
    });
    return map;
}

/**
 * Create codec map for replacement operations
 * @returns {Object} - Codec code to display name mapping
 */
function createCodecMap() {
    const map = {};
    
    // Add codec patterns
    CODEC_PATTERNS.forEach(pattern => {
        const patternStr = pattern.pattern.source;
        const match = patternStr.match(/\(([^)]+)\)/);
        if (match) {
            const variants = match[1].split('|').filter(v => v.length > 0);
            variants.forEach(variant => {
                // Clean up regex special characters
                const cleanVariant = variant.replace(/\\\./g, '.').replace(/\?/g, '');
                map[cleanVariant] = `${pattern.emoji} ${pattern.displayName}`;
            });
        }
    });
    
    // Add audio patterns
    AUDIO_PATTERNS.forEach(pattern => {
        const patternStr = pattern.pattern.source;
        const match = patternStr.match(/\(([^)]+)\)/);
        if (match) {
            const variants = match[1].split('|').filter(v => v.length > 0);
            variants.forEach(variant => {
                map[variant] = `${pattern.emoji} ${pattern.displayName}`;
            });
        }
    });
    
    return map;
}

export {
    QUALITY_PATTERNS,
    SOURCE_PATTERNS,
    CODEC_PATTERNS,
    LANGUAGE_PATTERNS,
    AUDIO_PATTERNS,
    TECHNICAL_PATTERNS,
    COMPREHENSIVE_TECH_PATTERNS,
    CLEANUP_PATTERNS,
    EPISODE_NAME_FILTERS,
    FILE_EXTENSIONS,
    extractQualityInfo,
    extractQualityDisplay,
    createLanguageMap,
    createCodecMap
};
