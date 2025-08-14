/**
 * Media Patterns Utility - Centralized patterns for quality, codecs, sources, languages, audio, etc.
 * 
 */

const QUALITY_PATTERNS = [
    { pattern: /(2160p|4K|UHD|UHDBD|UHD-BD|4K-UHD|3840x2160)/i, quality: '4K', displayName: '4K UHD', score: 40, emoji: '💎' },
    { pattern: /(1440p|2560x1440)/i, quality: '1440p', displayName: '1440p', score: 30, emoji: '💍' },
    { pattern: /(1080p|1920x1080)/i, quality: '1080p', displayName: '1080p', score: 20, emoji: '⭐' },
    { pattern: /(720p|1280x720)/i, quality: '720p', displayName: '720p', score: 10, emoji: '✨' },
    { pattern: /(576p|720x576)/i, quality: '576p', displayName: '576p', score: 7, emoji: '🔘' },
    { pattern: /(480p|720x480)/i, quality: '480p', displayName: '480p', score: 5, emoji: '⚫' },
    { pattern: /\b(DVD|DVDRIP)\b/i, quality: 'DVD', displayName: 'DVD', score: 3, emoji: '📀' }
];

const SOURCE_PATTERNS = [
    // Order matters - more specific patterns first
    { pattern: /\b(BDRIP|BD-RIP)(?:\d+p?)?\b/i, source: 'BDRip', displayName: 'BDRip', score: 14, emoji: '💿' },
    { pattern: /\b(BLURAY|BLU-RAY|BD)(?:\d+p?)?\b/i, source: 'BluRay', displayName: 'BluRay', score: 15, emoji: '📀' },
    { pattern: /\b(WEBDL|WEB-DL|WEB\.DL)(?:\d+p?)?\b/i, source: 'WEB-DL', displayName: 'WEB-DL', score: 12, emoji: '🌐' },
    { pattern: /\b(WEBRIP|WEB-RIP|WEB\.RIP|WEBRIP)(?:\d+p?)?\b/i, source: 'WEBRip', displayName: 'WEBRip', score: 10, emoji: '🌐' },
    { pattern: /\b(WEB)(?:\d+p?)?\b/i, source: 'WEB-DL', displayName: 'WEB-DL', score: 12, emoji: '🌐' },
    { pattern: /\bHDTV\b/i, source: 'HDTV', displayName: 'HDTV', score: 5, emoji: '📺' }
];

const CODEC_PATTERNS = [
    // === NEXT-GEN CODECS (Highest Efficiency) ===
    { pattern: /\b(AV1)\b/i, codec: 'AV1', displayName: 'AV1', score: 12, emoji: '🎬' },
    
    // === H.265/HEVC FAMILY (High Efficiency) ===
    { pattern: /\b(x265)\b/i, codec: 'x265', displayName: 'x265', score: 11, emoji: '🎥' },
    { pattern: /\b(HEVC|H\.?265|h265)\b/i, codec: 'HEVC', displayName: 'HEVC', score: 10, emoji: '📹' },
    
    // === H.264/AVC FAMILY (Standard Efficiency) ===
    { pattern: /\b(x264|H\.?264|AVC|h264)\b/i, codec: 'x264', displayName: 'x264', score: 9, emoji: '🎥' }
];

const LANGUAGE_PATTERNS = [
    // === MULTILINGUAL & CUSTOM (Highest Priority) ===
    { pattern: /\b(Multiple Subtitle|Multiple Subtitles|Multi-Sub|MULTILINGUAL|MULTILANG)\b/i, language: 'MULTI', displayName: 'MULTI', emoji: '🌍' },
    { pattern: /\b(MULTi3|MULTi2|MULTi|MULTI)\b/i, language: 'MULTI', displayName: 'MULTI', emoji: '🌍' },
    { pattern: /\b(CUSTOM)\b/i, language: 'CUSTOM', displayName: 'CUSTOM', emoji: '🔧' },
    
    // === FRENCH LANGUAGE FAMILY (Priority Order: Specialized > General) ===
    { pattern: /\bTRUEFRENCH\b/i, language: 'TrueFrench', displayName: 'TrueFrench', emoji: '🇫🇷' },
    { pattern: /\bSUBFRENCH\b/i, language: 'SubFrench', displayName: 'SubFrench', emoji: '🇫🇷' },
    { pattern: /\bVOSTFR\b/i, language: 'VOSTFR', displayName: 'VOSTFR', emoji: '🇫🇷' },
    { pattern: /\bVFF\b/i, language: 'VFF', displayName: 'VFF', emoji: '🇫🇷' },
    { pattern: /\bVF\b/i, language: 'VF', displayName: 'VF', emoji: '🇫🇷' },
    { pattern: /\b(FRENCH|FRANCAIS|FRE|FRA|FR)\b/i, language: 'French', displayName: 'French', emoji: '🇫🇷' },
    
    // === OTHER LANGUAGES ===
    { pattern: /\b(ENGLISH|ENG)\b/i, language: 'English', displayName: 'English', emoji: '🇬🇧' },
    { pattern: /\b(JAPANESE|JAP|JP)\b/i, language: 'Japanese', displayName: 'Japanese', emoji: '🇯🇵' },
    { pattern: /\b(SPANISH|SPA)\b/i, language: 'Spanish', displayName: 'Spanish', emoji: '🇪🇸' },
    { pattern: /\b(GERMAN|GER)\b/i, language: 'German', displayName: 'German', emoji: '🇩🇪' },
    { pattern: /\b(ITALIAN|ITA)\b/i, language: 'Italian', displayName: 'Italian', emoji: '🇮🇹' },
    { pattern: /\b(KOREAN|KOR)\b/i, language: 'Korean', displayName: 'Korean', emoji: '🇰🇷' },
    { pattern: /\b(CHINESE|CHI|CN)\b/i, language: 'Chinese', displayName: 'Chinese', emoji: '🇨🇳' },
    { pattern: /\b(RUSSIAN|RUS)\b/i, language: 'Russian', displayName: 'Russian', emoji: '🇷🇺' },
    { pattern: /\b(PORTUGUESE|POR|PT)\b/i, language: 'Portuguese', displayName: 'Portuguese', emoji: '🇵🇹' }
];

const AUDIO_PATTERNS = [
    // === ATMOS & IMMERSIVE AUDIO (Highest Priority) ===
    { pattern: /\b(EAC3[\.\-]?5\.1[\.\-]?ATMOS|E\-AC3[\.\-]?5\.1[\.\-]?ATMOS)\b/i, audio: 'EAC3 5.1 Atmos', displayName: 'EAC3 5.1 Atmos', emoji: '🔊' },
    { pattern: /\b(DDP5\.1[\.\-]?ATMOS|DD\+5\.1[\.\-]?ATMOS)\b/i, audio: 'DD+ 5.1 Atmos', displayName: 'DD+ 5.1 Atmos', emoji: '🔊' },
    { pattern: /\b(DOLBY[\s\-\.]?ATMOS|ATMOS)\b/i, audio: 'Atmos', displayName: 'Atmos', emoji: '🔊' },
    { pattern: /\b(DTS[\s\-\:]?X|DTSX)\b/i, audio: 'DTS:X', displayName: 'DTS:X', emoji: '🔊' },
    
    // === HIGH-END LOSSLESS AUDIO ===
    { pattern: /\b(DTS[\s\-\:]?HD[\s\-\.]?MA|DTS\-HD\.MA)\b/i, audio: 'DTS-HD MA', displayName: 'DTS-HD MA', emoji: '🔊' },
    { pattern: /\b(DTS[\s\-\:]?HD|DTS\s*HD)\b/i, audio: 'DTS-HD', displayName: 'DTS-HD', emoji: '🔊' },
    { pattern: /\b(TRUEHD|TRUE[\s\-\.]?HD|TRUE\s*HD)\b/i, audio: 'TrueHD', displayName: 'TrueHD', emoji: '🔊' },
    { pattern: /\b(FLAC)\b/i, audio: 'FLAC', displayName: 'FLAC', emoji: '🎵' },
    { pattern: /\b(LPCM)\b/i, audio: 'LPCM', displayName: 'LPCM', emoji: '🔊' },
    
    // === ENHANCED AC3/EAC3 FAMILY (Priority: 5.1 > Basic) ===
    { pattern: /\b(EAC3[\.\-]?5\.1|E\-AC3[\.\-]?5\.1|EAC3\.5\.1)\b/i, audio: 'EAC3 5.1', displayName: 'EAC3 5.1', emoji: '🎵' },
    { pattern: /\b(EAC3|E\-AC3|EAC\-3)\b/i, audio: 'EAC3', displayName: 'EAC3', emoji: '🎵' },
    { pattern: /\b(AC3[\.\-]?5\.1|AC\-3[\.\-]?5\.1)\b/i, audio: 'AC3 5.1', displayName: 'AC3 5.1', emoji: '🎵' },
    { pattern: /\b(AC3|AC\-3)\b/i, audio: 'AC3', displayName: 'AC3', emoji: '🎵' },
    
    // === DOLBY DIGITAL PLUS FAMILY (Priority: 5.1 > 2.0) ===
    { pattern: /\b(DDP5\.1|DD\+5\.1|DDPLUS5\.1)\b/i, audio: 'DD+ 5.1', displayName: 'DD+ 5.1', emoji: '🎵' },
    { pattern: /\b(DDP2\.0|DD\+2\.0|DDPLUS2\.0)\b/i, audio: 'DD+ 2.0', displayName: 'DD+ 2.0', emoji: '🎵' },
    
    // === AAC FAMILY (Priority: HE-AAC 5.1 > AAC 5.1 > HE-AAC > AAC) ===
    { pattern: /\b(HE\-AAC[\.\-]?5\.1|HEAAC[\.\-]?5\.1)\b/i, audio: 'HE-AAC 5.1', displayName: 'HE-AAC 5.1', emoji: '🎵' },
    { pattern: /\b(AAC[\.\-]?5\.1|AAC\.5\.1)\b/i, audio: 'AAC 5.1', displayName: 'AAC 5.1', emoji: '🎵' },
    { pattern: /\b(HE\-AAC|HEAAC)\b/i, audio: 'HE-AAC', displayName: 'HE-AAC', emoji: '🎵' },
    { pattern: /\b(AAC)\b/i, audio: 'AAC', displayName: 'AAC', emoji: '🎵' },
    
    // === DTS BASIC FAMILY ===
    { pattern: /\b(DTS)\b/i, audio: 'DTS', displayName: 'DTS', emoji: '🔊' },
    
    // === OTHER CODECS ===
    { pattern: /\b(OPUS)\b/i, audio: 'Opus', displayName: 'Opus', emoji: '🎵' },
    { pattern: /\b(MP3)\b/i, audio: 'MP3', displayName: 'MP3', emoji: '🎵' },
    { pattern: /\b(OGG)\b/i, audio: 'OGG', displayName: 'OGG', emoji: '🎵' },
    
    // === CHANNEL CONFIGURATIONS (Standalone) ===
    { pattern: /\b(7\.1)\b/i, audio: '7.1', displayName: '7.1', emoji: '🔊' },
    { pattern: /\b(5\.1)\b/i, audio: '5.1', displayName: '5.1', emoji: '🔊' },
    { pattern: /\b(2\.0)\b/i, audio: '2.0', displayName: '2.0', emoji: '🔊' },
    
    // === BIT DEPTH ===
    { pattern: /\b(10BITS?|10BIT)\b/i, audio: '10bit', displayName: '10bit', emoji: '🎨' },
    { pattern: /\b(12BITS?|12BIT)\b/i, audio: '12bit', displayName: '12bit', emoji: '🎨' }
];

const CONTENT_TYPE_PATTERNS = {
    series: [
        /[Ss]\d{1,2}[Ee]\d{1,3}/, // S01E01 format
        /\d{1,2}x\d{1,3}/, // 1x01 format  
        /Episode\s*\d+/i, // Episode 1
        /[Ee]p\d+/i, // Ep1, EP01
        /Season\s*\d+/i, // Season 1
    ],
    movie: [
        /\b\d{4}\b/, // Year (common in movie names)
        /\b(Part|Pt)\s*[I1-9]/i, // Part I, Part 1
    ]
};

const COMPREHENSIVE_TECH_PATTERNS = [
    { pattern: /(HDR10\+|HDR10PLUS)/i, display: '🌈 HDR10+' },
    { pattern: /HDR10(?!\+)/i, display: '🌈 HDR10' },
    { pattern: /\b(HDLIGHT[\.\-]?10BIT|HD[\.\-]?LIGHT[\.\-]?10BIT)\b/i, display: '🌈 HDLight 10bit' },
    { pattern: /\b(HDLIGHT|HD[\.\-]?LIGHT)\b/i, display: '🌈 HDLight' },
    { pattern: /\b(HDR)\b/i, display: '🌈 HDR' },
    { pattern: /\b(DOLBY\s*VISION|DV)\b/i, display: '🌈 Dolby Vision' },
    
    { pattern: /\b(10BITS?|10BIT)\b/i, display: '🎨 10bit' },
    { pattern: /\b(12BITS?|12BIT)\b/i, display: '🎨 12bit' },
    { pattern: /\b(8BITS?|8BIT)\b/i, display: '🎨 8bit' },
    
    { pattern: /\b(LPCM)\b/i, display: '🔊 LPCM' },
    { pattern: /\b(FLAC)\b/i, display: '🎵 FLAC' },
    
    { pattern: /\b(REMUX)\b/i, display: '🎯 REMUX' },
    { pattern: /\b(REPACK)\b/i, display: '📦 REPACK' },
    { pattern: /\b(PROPER)\b/i, display: '✅ PROPER' },
    { pattern: /\b(INTERNAL)\b/i, display: '🏠 INTERNAL' },
    
    { pattern: /\b(60FPS|60P)\b/i, display: '🎬 60fps' },
    { pattern: /\b(50FPS|50P)\b/i, display: '🎬 50fps' },
    { pattern: /\b(30FPS|30P)\b/i, display: '🎬 30fps' },
    { pattern: /\b(24FPS|24P)\b/i, display: '🎬 24fps' },
    
    { pattern: /\b(IMAX)\b/i, display: '🎞️ IMAX' },
    { pattern: /\b(EXTENDED|EXT)\b/i, display: '⏱️ Extended' },
    { pattern: /\b(DIRECTORS?\s*CUT|DC)\b/i, display: '🎬 Director\'s Cut' },
    { pattern: /\b(UNCUT)\b/i, display: '🔓 Uncut' },
    { pattern: /\b(UNRATED)\b/i, display: '🔞 Unrated' }
];


const CLEANUP_PATTERNS = {
    qualityRemoval: /\b(2160p|1440p|1080p|720p|576p|480p|4K|UHD|UHDBD|UHD-BD|4K-UHD)\b/gi,
    sourceRemoval: /\b(DVD|DVDRIP|BLURAY|BLU-RAY|BDRIP|BD-RIP|HDTV)\b/gi,
    unwantedTerms: /\b(VRV|CRUNCHYROLL|FUNIMATION|HULU|AMZN|AMAZON|NETFLIX|NF|DSNP|DISNEY)\b/gi,
    emptyBrackets: /\[\s*\]/g,
    bracketContent: /\[([^\]]+)\]/g,
    emptyParentheses: /\(\s*\)/g,
    dotsUnderscores: /[\._]/g,
    multipleSpaces: /\s+/g,
    trailingDash: /\s*-\s*$/,
    groupTags: /^[\[\{][^\]\}]+[\]\}]\s*/
};



// Meaningful variant patterns for variant detection
const MEANINGFUL_VARIANT_PATTERNS = [
    /directors?\s*cut/i,
    /director\s*cut/i,
    /extended/i,
    /uncut/i,
    /unrated/i,
    /remastered/i,
    /special\s*edition/i,
    /special/i,
    /theatrical/i,
    /ultimate/i,
    /definitive/i,
    /extra/i,
    /bonus/i,
    /ova/i,
    /oav/i,
    /nced/i,
    /ncop/i,
    /collectors?\s*edition/i,
    /limited\s*edition/i,
    /anniversary\s*edition/i,
    /criterion\s*collection/i,
    /fan\s*edit/i,
    /alternate\s*ending/i,
    /final\s*cut/i,
    /ona/i,
    /oad/i,
    /tv\s*special/i,
    /recap/i,
    /complete\s*series/i,
    /miniseries/i,
    /webisode/i
];

const FILE_EXTENSIONS = {
    video: ["3g2", "3gp", "avi", "flv", "mkv", "mk3d", "mov", "mp2", "mp4", "m4v", "mpe", "mpeg", "mpg", "mpv", "webm", "wmv", "ogm", "ts", "m2ts"],
    subtitle: ["aqt", "gsub", "jss", "sub", "ttxt", "pjs", "psb", "rt", "smi", "slt", "ssf", "srt", "ssa", "ass", "usf", "idx", "vtt"],
    disk: ["iso", "m2ts", "ts", "vob"],
    archive: ["rar", "zip"]
};


function extractQualityInfo(name) {
    const quality = {
        resolution: null,
        source: null,
        codec: null,
        score: 0
    };
    
    // Patterns are ordered by priority - first match wins
    for (const pattern of QUALITY_PATTERNS) {
        if (pattern.pattern.test(name)) {
            quality.resolution = pattern.quality;
            quality.score += pattern.score;
            break;
        }
    }
    
    for (const pattern of SOURCE_PATTERNS) {
        if (pattern.pattern.test(name)) {
            quality.source = pattern.source;
            quality.score += pattern.score;
            break;
        }
    }

    for (const pattern of CODEC_PATTERNS) {
        if (pattern.pattern.test(name)) {
            quality.codec = pattern.codec;
            quality.score += pattern.score;
            break;
        }
    }
    
    return quality;
}

function extractQualityDisplay(name, fallbackInfo = null) {
    // Patterns are ordered by priority - first match wins
    for (const pattern of QUALITY_PATTERNS) {
        if (pattern.pattern.test(name)) {
            return `${pattern.emoji} ${pattern.displayName}`;
        }
    }
    
    // Secondary: Check for structured resolution from PTT parsing
    const fallbackResolution = fallbackInfo?.resolution;
    if (fallbackResolution && fallbackResolution !== 'Unknown') {
        if (fallbackResolution.includes('2160') || fallbackResolution.includes('4K')) return '💎 4K UHD';
        if (fallbackResolution.includes('1440')) return '💍 1440p';
        if (fallbackResolution.includes('1080')) return '⭐ 1080p';
        if (fallbackResolution.includes('720')) return '✨ 720p';
        if (fallbackResolution.includes('576')) return '🔘 576p';
        if (fallbackResolution.includes('480')) return '⚫ 480p';
        return '📺 ' + fallbackResolution;
    }
    
    return '❓ Unknown';
}


function detectContentType(filename) {
    for (const pattern of CONTENT_TYPE_PATTERNS.series) {
        if (pattern.test(filename)) {
            return 'series';
        }
    }

    for (const pattern of CONTENT_TYPE_PATTERNS.movie) {
        if (pattern.test(filename)) {
            return 'movie';
        }
    }

    return 'series';
}

function extractLanguageFromFilename(filename) {
    if (!filename) return null;

    // Patterns are ordered by priority - first match wins
    for (const { pattern, language } of LANGUAGE_PATTERNS) {
        if (pattern.test(filename)) {
            return language;
        }
    }

    return null;
}

// Dynamic technical pattern generator - automatically builds comprehensive patterns
// from all existing pattern categories
function generateComprehensiveTechnicalPatterns() {
    const allPatterns = new Set();
    
    QUALITY_PATTERNS.forEach(p => allPatterns.add(p.pattern.source));
    SOURCE_PATTERNS.forEach(p => allPatterns.add(p.pattern.source));
    CODEC_PATTERNS.forEach(p => allPatterns.add(p.pattern.source));
    AUDIO_PATTERNS.forEach(p => allPatterns.add(p.pattern.source));
    LANGUAGE_PATTERNS.forEach(p => allPatterns.add(p.pattern.source));
    COMPREHENSIVE_TECH_PATTERNS.forEach(item => allPatterns.add(item.pattern.source));
    
    return Array.from(allPatterns)
        .filter(pattern => pattern && pattern.trim() !== '' && pattern !== '(?:)')
        .map(pattern => new RegExp(pattern, 'i'));
}

// Auto-generated comprehensive technical patterns
const AUTO_TECHNICAL_PATTERNS = generateComprehensiveTechnicalPatterns();

function isTechnicalTerm(text) {
    if (!text) return false;
    return AUTO_TECHNICAL_PATTERNS.some(pattern => pattern.test(text));
}

function isMeaningfulVariant(text) {
    if (!text) return false;
    return MEANINGFUL_VARIANT_PATTERNS.some(pattern => pattern.test(text));
}

/**
 * Check if filename has obvious episode indicators
 */
function hasObviousEpisodeIndicators(filename) {
    if (!filename) return false;
    
    // Check for explicit episode patterns
    for (const pattern of CONTENT_TYPE_PATTERNS.series) {
        if (pattern.test(filename)) {
            return true;
        }
    }
    
    // Check for number followed by release info (like "028 MULTI")
    if (/\d{2,4}\s*(?:multi|bluray)/i.test(filename)) {
        return true;
    }
    
    return false;
}

export {
    QUALITY_PATTERNS,
    SOURCE_PATTERNS,
    CODEC_PATTERNS,
    LANGUAGE_PATTERNS,
    AUDIO_PATTERNS,
    AUTO_TECHNICAL_PATTERNS,
    COMPREHENSIVE_TECH_PATTERNS,
    CONTENT_TYPE_PATTERNS,
    CLEANUP_PATTERNS,
    MEANINGFUL_VARIANT_PATTERNS,
    FILE_EXTENSIONS,
    extractQualityInfo,
    extractQualityDisplay,
    detectContentType,
    extractLanguageFromFilename,
    isTechnicalTerm,
    isMeaningfulVariant,
    hasObviousEpisodeIndicators
};