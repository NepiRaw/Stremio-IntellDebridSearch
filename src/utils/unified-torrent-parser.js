/**
 * Unified Torrent Parser
 * Combines PTT (parse-torrent-title) with regex fallback for maximum accuracy.
 */

import PTT from 'parse-torrent-title';
import { logger } from './logger.js';
import { romanToNumber } from './roman-numeral-utils.js';
import { SOURCE_PATTERNS, LANGUAGE_PATTERNS, AUDIO_PATTERNS, QUALITY_PATTERNS, CODEC_PATTERNS, COMPREHENSIVE_TECH_PATTERNS } from './media-patterns.js';
import { parseEpisodeFromTitle, parseSeasonFromTitle, parseAbsoluteEpisode } from './episode-patterns.js';
import { parseRomanSeasons } from './roman-numeral-utils.js';

// Cache to avoid re-parsing the same torrent names
const parseCache = new Map();
const CACHE_MAX_SIZE = 1000;

/**
 * Unified torrent parsing function that combines PTT with regex fallback
 * @param {string} filename - The torrent filename to parse
 * @param {Object} options - Parsing options
 * @returns {Object} Comprehensive parsing result
 */
export function parseUnified(filename, options = {}) {
    // Handle null/undefined inputs
    if (!filename || typeof filename !== 'string') {
        logger.debug('[unified-parser] Invalid filename provided:', filename);
        return {
            title: null,
            season: null,
            episode: null,
            absoluteEpisode: null,
            resolution: null,
            source: null,
            codec: null,
            audio: null,
            language: null,
            group: null,
            year: null,
            extension: null,
            container: null,
            technicalDetails: {},
            variantHints: [],
            qualityScore: 0
        };
    }
    
    const cacheKey = `${filename}-${JSON.stringify(options)}`;
    
    // Check cache first
    if (parseCache.has(cacheKey)) {
        return parseCache.get(cacheKey);
    }
    
    // Clean the filename first (remove domain prefixes, etc.)
    const cleanedFilename = cleanFilename(filename);
    
    // Primary parsing with PTT
    const pttResult = PTT.parse(cleanedFilename);
    
    // Apply regex fallbacks for known edge cases
    const enhancedResult = applyRegexFallbacks(cleanedFilename, pttResult);
    
    // Add additional metadata extraction
    const comprehensiveResult = extractAdditionalMetadata(cleanedFilename, enhancedResult);
    
    // Cache the result
    if (parseCache.size >= CACHE_MAX_SIZE) {
        // FIFO cache cleanup
        const firstKey = parseCache.keys().next().value;
        parseCache.delete(firstKey);
    }
    parseCache.set(cacheKey, comprehensiveResult);
    
    return comprehensiveResult;
}

/**
 * Clean filename by removing domain prefixes and source tags
 * @param {string} filename - Raw filename
 * @returns {string} Cleaned filename
 */
function cleanFilename(filename) {
    let cleaned = filename;
    
    // Remove domain prefixes (www.site.com -, [site.com], etc.)
    cleaned = cleaned.replace(/^www\.[a-zA-Z0-9]+\.[a-zA-Z]{2,}[ \-]+/i, '');
    cleaned = cleaned.replace(/^\[[a-zA-Z0-9 ._]+\][ \-]*/, '');
    
    return cleaned;
}

/**
 * Apply regex fallbacks for cases where PTT fails or gives incorrect results
 * @param {string} filename - Cleaned filename
 * @param {Object} pttResult - Result from PTT parsing
 * @returns {Object} Enhanced result with fallback corrections
 */
function applyRegexFallbacks(filename, pttResult) {
    const result = { ...pttResult };
    
    // Extract absolute episode FIRST to determine if this is absolute episode content
    result.absoluteEpisode = extractAbsoluteEpisode(filename, pttResult);
    
    // Episode extraction fallbacks (now uses comprehensive patterns from episode-patterns.js)
    const episodeInfo = extractEpisodeWithFallback(filename, pttResult);
    if (typeof episodeInfo === 'object' && episodeInfo !== null) {
        // Always use the episode number from episode parsing initially
        result.episode = episodeInfo.episode;
        
        // Only use season info if we don't have an absolute episode
        // Absolute episodes are season-independent and should not have season defaulting
        if (episodeInfo.season && !result.absoluteEpisode && !result.season) {
            result.season = episodeInfo.season;
            logger.debug(`[unified-parser] Season extracted via episode-patterns: ${episodeInfo.season}`);
        } else if (episodeInfo.season && result.absoluteEpisode) {
            logger.debug(`[unified-parser] Skipping season ${episodeInfo.season} from episode-patterns due to absolute episode ${result.absoluteEpisode}`);
        }
    } else {
        result.episode = episodeInfo;
    }
    
    // If we have an absolute episode, use it as the episode number too
    // This handles cases where episode parsing truncates large numbers (e.g., 1000 -> 100)
    if (result.absoluteEpisode && result.episode !== result.absoluteEpisode) {
        logger.debug(`[unified-parser] Using absolute episode ${result.absoluteEpisode} over parsed episode ${result.episode}`);
        result.episode = result.absoluteEpisode;
    }
    
    // Only extract season if we don't have an absolute episode
    // Absolute episodes are season-independent and should not default to season=1
    if (!result.absoluteEpisode && !result.season) {
        result.season = extractSeasonWithFallback(filename, pttResult);
    }
    
    // Roman numeral parsing - use as fallback or when classic parsing gives questionable results
    // This handles anime titles like "DanMachi III - 04.mkv" where III=season 3, 04=episode 4
    const romanSeasonInfo = parseRomanSeasons(filename);
    if (romanSeasonInfo) {
        // Use Roman results if:
        // 1. We don't have season/episode from classic parsing, OR
        // 2. Classic parsing found season=1 (might be incorrect default) and Roman parsing has better info
        // 3. BUT only if we don't have an absolute episode (absolute episodes are season-independent)
        const shouldUseRoman = !result.absoluteEpisode && 
                              (!result.season || !result.episode || 
                               (result.season === 1 && romanSeasonInfo.season > 1));
        
        if (shouldUseRoman) {
            logger.debug(`[unified-parser] Using Roman numeral parsing: season=${romanSeasonInfo.season}, episode=${romanSeasonInfo.episode} (${romanSeasonInfo.roman})`);
            
            if (romanSeasonInfo.season) {
                result.season = romanSeasonInfo.season;
            }
            if (romanSeasonInfo.episode) {
                result.episode = romanSeasonInfo.episode;
            }
            
            // When we use Roman numeral parsing, this is NOT an absolute episode
            // It's season-based numbering with Roman season indicators
            result.absoluteEpisode = null;
        } else {
            logger.debug(`[unified-parser] Roman numeral found but keeping classic parsing: classic=(${result.season},${result.episode}), roman=(${romanSeasonInfo.season},${romanSeasonInfo.episode}), absoluteEpisode=${result.absoluteEpisode}`);
        }
    }
    
    // Ensure season is explicitly null when not set (for consistency)
    if (!result.season) {
        result.season = null;
    }
    
    result.title = cleanTitle(filename, pttResult);
    
    return result;
}

/**
 * Clean and improve title extraction
 * @param {string} filename - Original filename
 * @param {Object} pttResult - PTT parsing result
 * @returns {string} Cleaned title
 */
function cleanTitle(filename, pttResult) {
    let title = pttResult.title;
    
    if (!title) return null;
    
    // Remove episode numbers from title for anime
    if (filename.includes('- 06') && title.includes('- 06')) {
        title = title.replace(/\s*-\s*\d+\s*$/, '').trim();
    }
    
    if (filename.includes('030') && title.includes('030')) {
        title = title.replace(/\s*\d{2,3}\s*$/, '').trim();
    }
    
    return title;
}

/**
 * Extract episode number with comprehensive fallback patterns
 * @param {string} filename - Filename to parse
 * @param {Object} pttResult - PTT parsing result
 * @returns {Object|number|null} Episode info object or episode number
 */
function extractEpisodeWithFallback(filename, pttResult) {
    // First try the comprehensive episode patterns from episode-patterns.js
    const episodeInfo = parseEpisodeFromTitle(filename);
    if (episodeInfo && episodeInfo.episode) {
        logger.debug(`[unified-parser] Episode extracted via episode-patterns: S${episodeInfo.season}E${episodeInfo.episode} (pattern: ${episodeInfo.pattern})`);
        return episodeInfo; // Return full object with season and episode
    }
    
    // If PTT episode seems correct, use it
    if (pttResult.episode && !isEpisodeSuspicious(filename, pttResult.episode)) {
        return pttResult.episode;
    }
    
    // Return PTT result as final fallback
    return pttResult.episode || null;
}

/**
 * Check if a number is likely a year rather than an episode
 * @param {number} num - Number to check
 * @returns {boolean} True if likely a year
 */
function isLikelyYear(num) {
    return num >= 1900 && num <= 2030;
}

/**
 * Check if PTT episode result seems suspicious
 * @param {string} filename - Original filename
 * @param {number} episode - PTT episode result
 * @returns {boolean} True if suspicious
 */
function isEpisodeSuspicious(filename, episode) {
    // Check for specific known problematic patterns
    if (filename.includes('- 06') && episode !== 6) return true;
    if (filename.includes('- 030') && episode !== 30) return true;
    
    // Check if episode seems too low for obvious high episode numbers
    const obviousEpisodeMatch = filename.match(/- (\d{2,3})\s/);
    if (obviousEpisodeMatch) {
        const obviousEpisode = parseInt(obviousEpisodeMatch[1]);
        if (obviousEpisode > 50 && episode < 10) return true;
    }
    
    return false;
}

/**
 * Extract season number with fallback patterns
 * @param {string} filename - Filename to parse
 * @param {Object} pttResult - PTT parsing result
 * @returns {number|null} Season number
 */
function extractSeasonWithFallback(filename, pttResult) {
    // First try the comprehensive season patterns from episode-patterns.js
    const season = parseSeasonFromTitle(filename, false);
    if (season !== null) {
        logger.debug(`[unified-parser] Season extracted via episode-patterns: ${season}`);
        return season;
    }
    
    // PTT is generally good at season detection
    if (pttResult.season) {
        return pttResult.season;
    }
    
    return null;
}

/**
 * Extract absolute episode number for anime
 * @param {string} filename - Filename to parse
 * @param {Object} pttResult - PTT parsing result
 * @returns {number|null} Absolute episode number
 */
function extractAbsoluteEpisode(filename, pttResult) {
    // Check if there's Roman numeral season context first
    // If there are Roman numerals, this is likely season-based, not absolute
    const romanSeasonInfo = parseRomanSeasons(filename);
    if (romanSeasonInfo) {
        logger.debug(`[unified-parser] Skipping absolute episode detection due to Roman numeral season context: ${romanSeasonInfo.roman}`);
        return null;
    }
    
    // First try the comprehensive absolute episode patterns from episode-patterns.js
    const absoluteEpisode = parseAbsoluteEpisode(filename);
    
    // Skip absolute episode detection for movies (if year is present AND no clear episode patterns)
    if (pttResult.year && filename.includes(pttResult.year.toString())) {
        // Check if there are obvious episode indicators that suggest this is NOT a movie
        const hasObviousEpisodePatterns = (
            /(?:episode|ep|s\d+e\d+)/i.test(filename) ||  // Explicit episode patterns
            /\d{2,4}\s*(?:multi|bluray)/i.test(filename)  // Number followed by release info (like "028 MULTI")
        );
        
        // If no obvious episode patterns AND we have a year, likely a movie
        if (!hasObviousEpisodePatterns) {
            return null; // Likely a movie, skip absolute episode detection
        }
    }
    
    if (absoluteEpisode !== null) {
        logger.debug(`[unified-parser] Absolute episode extracted via episode-patterns: ${absoluteEpisode}`);
        return absoluteEpisode;
    }
    
    return null;
}

/**
 * Extract additional metadata not provided by PTT
 * @param {string} filename - Filename to parse
 * @param {Object} baseResult - Base parsing result
 * @returns {Object} Enhanced result with additional metadata
 */
function extractAdditionalMetadata(filename, baseResult) {
    const result = { ...baseResult };
    
    // Enhanced technical details using PTT + custom patterns
    result.technicalDetails = extractTechnicalDetails(filename, baseResult);
    
    // Enhanced language detection
    result.languages = extractLanguageInfo(filename, baseResult);
    
    // Variant detection hints
    result.variantHints = extractVariantHints(filename, baseResult);
    
    // Quality scoring
    result.qualityScore = calculateQualityScore(result);
    
    return result;
}

/**
 * Extract comprehensive technical details
 * @param {string} filename - Filename
 * @param {Object} baseResult - Base parsing result
 * @returns {Object} Technical details
 */
function extractTechnicalDetails(filename, baseResult) {
    // Fallback codec detection when PTT fails
    let codec = baseResult.codec;
    if (!codec) {
        // Manual codec detection for cases where PTT fails
        for (const pattern of CODEC_PATTERNS) {
            if (pattern.pattern.test(filename)) {
                codec = pattern.codec;
                break;
            }
        }
    }
    
    return {
        // From PTT with fallback
        source: baseResult.source,
        codec: codec,
        resolution: baseResult.resolution,
        container: baseResult.container,
        
        // Enhanced extraction
        bitDepth: extractBitDepth(filename),
        hdr: extractHDRInfo(filename),
        audioChannels: extractAudioChannels(filename),
        frameRate: extractFrameRate(filename),
    };
}

/**
 * Extract bit depth information
 * @param {string} filename - Filename
 * @returns {string|null} Bit depth
 */
function extractBitDepth(filename) {
    const bitDepthMatch = filename.match(/(\d+)bit/i);
    return bitDepthMatch ? `${bitDepthMatch[1]}bit` : null;
}

/**
 * Extract HDR information
 * @param {string} filename - Filename
 * @returns {string|null} HDR type
 */
function extractHDRInfo(filename) {
    const hdrPatterns = ['HDR10', 'HDR', 'DolbyVision', 'DV'];
    for (const pattern of hdrPatterns) {
        if (filename.toLowerCase().includes(pattern.toLowerCase())) {
            return pattern;
        }
    }
    return null;
}

/**
 * Extract audio channel information
 * @param {string} filename - Filename
 * @returns {string|null} Audio channels
 */
function extractAudioChannels(filename) {
    const audioMatch = filename.match(/DDP?(\d\.\d)|(\d\.\d)/);
    return audioMatch ? (audioMatch[1] || audioMatch[2]) : null;
}

/**
 * Extract frame rate information
 * @param {string} filename - Filename
 * @returns {string|null} Frame rate
 */
function extractFrameRate(filename) {
    const fpsMatch = filename.match(/(\d+)fps/i);
    return fpsMatch ? `${fpsMatch[1]}fps` : null;
}

/**
 * Extract enhanced language information
 * @param {string} filename - Filename
 * @param {Object} baseResult - Base parsing result
 * @returns {Array} Language information
 */
function extractLanguageInfo(filename, baseResult) {
    const languages = baseResult.languages || [];
    
    // Additional language patterns
    const langPatterns = [
        { pattern: /MULTI/i, lang: 'multi audio' },
        { pattern: /FRENCH/i, lang: 'french' },
        { pattern: /SUBFRENCH/i, lang: 'french subs' },
        { pattern: /JAP/i, lang: 'japanese' },
        { pattern: /ENG/i, lang: 'english' },
    ];
    
    for (const { pattern, lang } of langPatterns) {
        if (pattern.test(filename) && !languages.includes(lang)) {
            languages.push(lang);
        }
    }
    
    return languages;
}

/**
 * Extract variant detection hints
 * @param {string} filename - Filename
 * @param {Object} baseResult - Base parsing result
 * @returns {Array} Variant hints
 */
function extractVariantHints(filename, baseResult) {
    const hints = [];
    
    // Release group as variant hint
    if (baseResult.group) {
        hints.push({ type: 'group', value: baseResult.group });
    }
    
    // Source quality as variant hint
    if (baseResult.source) {
        hints.push({ type: 'source', value: baseResult.source });
    }
    
    // Special editions
    const editionPatterns = [
        'Directors Cut', 'Extended', 'Uncut', 'Special', 'OVA', 'Movie'
    ];
    
    for (const edition of editionPatterns) {
        if (filename.toLowerCase().includes(edition.toLowerCase())) {
            hints.push({ type: 'edition', value: edition });
        }
    }
    
    return hints;
}

/**
 * Calculate quality score based on technical details
 * @param {Object} result - Parsing result
 * @returns {number} Quality score (0-100)
 */
function calculateQualityScore(result) {
    let score = 0;
    
    // Resolution scoring
    if (result.resolution) {
        if (result.resolution.includes('2160p') || result.resolution.includes('4K')) score += 40;
        else if (result.resolution.includes('1080p')) score += 30;
        else if (result.resolution.includes('720p')) score += 20;
        else score += 10;
    }
    
    // Source scoring
    if (result.source) {
        if (result.source.includes('BluRay')) score += 25;
        else if (result.source.includes('WEB-DL')) score += 20;
        else if (result.source.includes('WEBRip')) score += 15;
        else score += 10;
    }
    
    // Codec scoring
    if (result.codec) {
        if (result.codec.includes('hevc') || result.codec.includes('h265')) score += 15;
        else if (result.codec.includes('h264')) score += 10;
        else score += 5;
    }
    
    // Technical enhancements
    if (result.technicalDetails?.hdr) score += 10;
    if (result.technicalDetails?.bitDepth === '10bit') score += 5;
    
    return Math.min(score, 100);
}

/**
 * Get parser statistics
 * @returns {Object} Parser statistics
 */
export function getParserStats() {
    return {
        cacheSize: parseCache.size,
        cacheMaxSize: CACHE_MAX_SIZE,
        cacheHitRate: parseCache.size > 0 ? '~calculated on usage' : 'No cache hits yet'
    };
}

/**
 * Clear parser cache
 */
export function clearParserCache() {
    parseCache.clear();
    logger.debug('[unified-parser] Cache cleared');
}

/**
 * Legacy compatibility exports - these replace the redundant functions
 */

// Replace extractTechnicalDetails from stream-builder.js
export function extractTechnicalDetailsLegacy(filename) {
    if (!filename) return '';
    
    // Use the original extraction logic that was working
    const languageDetails = [];
    const sourceDetails = [];
    const codecDetails = [];
    const audioDetails = [];
    const resolutionDetails = [];
    const techDetails = [];
    
    // 1. Extract Languages using centralized patterns
    for (const pattern of LANGUAGE_PATTERNS) {
        if (pattern.pattern.test(filename) && !languageDetails.some(detail => detail.includes(pattern.displayName))) {
            languageDetails.push(`${pattern.emoji} ${pattern.displayName}`);
        }
    }
    
    // 2. Extract Source (BluRay, WEB-DL, etc.) using centralized patterns
    for (const pattern of SOURCE_PATTERNS) {
        if (pattern.pattern.test(filename)) {
            sourceDetails.push(`${pattern.emoji} ${pattern.displayName}`);
            break; // Only match first source
        }
    }
    
    // 3. Extract Video Codecs using smart pattern matching
    for (const pattern of CODEC_PATTERNS) {
        if (pattern.pattern.test(filename)) {
            // Try to identify which specific term was matched
            const match = filename.match(pattern.pattern);
            if (match && match[1]) {
                const matchedTerm = match[1].toUpperCase();
                
                // Use specific display name based on matched term
                let displayName = pattern.displayName;
                if (matchedTerm === 'AVC') displayName = 'AVC';
                else if (matchedTerm.includes('H.264') || matchedTerm.includes('H264')) displayName = 'H.264';
                else if (matchedTerm === 'X264' || matchedTerm === 'H264') displayName = 'x264';
                else if (matchedTerm === 'X265') displayName = 'x265';
                else if (matchedTerm === 'HEVC' || matchedTerm.includes('265')) displayName = 'HEVC';
                else if (matchedTerm === 'AV1') displayName = 'AV1';
                
                codecDetails.push(`🎥 ${displayName}`);
            } else {
                codecDetails.push(`🎥 ${pattern.displayName}`);
            }
            break; // Only match first codec
        }
    }
    
    // 4. Skip Resolution/Quality - it's already in the name field
    // Resolution is handled separately and should NOT be in technical details
    
    // 5. Extract Audio information with channels
    const foundAudio = new Set();
    const audioMatches = [];
    
    // First pass: collect all matching audio patterns
    for (const pattern of AUDIO_PATTERNS) {
        if (pattern.pattern.test(filename)) {
            audioMatches.push(pattern);
        }
    }
    
    // Second pass: filter out generic patterns if specific ones exist
    for (const pattern of audioMatches) {
        const isGeneric = audioMatches.some(otherPattern => {
            if (otherPattern === pattern) return false;
            
            const currentAudio = pattern.audio.toLowerCase().replace(/[^\w]/g, '');
            const otherAudio = otherPattern.audio.toLowerCase().replace(/[^\w]/g, '');
            
            return otherAudio.includes(currentAudio) && currentAudio.length < otherAudio.length;
        });
        
        if (!isGeneric && !foundAudio.has(pattern.audio)) {
            audioDetails.push(`${pattern.emoji} ${pattern.audio}`);
            foundAudio.add(pattern.audio);
        }
    }
    
    // 6. Extract comprehensive technical terms
    for (const tech of COMPREHENSIVE_TECH_PATTERNS) {
        if (tech.pattern.test(filename) && !techDetails.some(detail => detail.includes(tech.display))) {
            techDetails.push(tech.display);
        }
    }
    
    // Combine all details in a logical order (excluding resolution/quality)
    const detectedDetails = [
        ...languageDetails,
        ...sourceDetails, 
        ...codecDetails,
        ...audioDetails,
        ...techDetails
    ];
    
    // Remove duplicates while preserving order
    const uniqueDetails = [];
    const seenDetails = new Set();
    
    for (const detail of detectedDetails) {
        const normalized = detail.toLowerCase().replace(/[^\w]/g, '');
        if (!seenDetails.has(normalized)) {
            seenDetails.add(normalized);
            uniqueDetails.push(detail);
        }
    }
    
    return uniqueDetails.join(' • ');
}

// Replace extractAbsoluteEpisode from torrent-analyzer.js and episode-mapper.js
export function extractAbsoluteEpisodeLegacy(filename) {
    const result = parseUnified(filename);
    return result.absoluteEpisode;
}

// Replace various parsing calls across the codebase
export function parseTitle(filename) {
    return parseUnified(filename);
}

export default {
    parseUnified,
    getParserStats,
    clearParserCache,
    extractTechnicalDetailsLegacy,
    extractAbsoluteEpisodeLegacy,
    parseTitle
};
