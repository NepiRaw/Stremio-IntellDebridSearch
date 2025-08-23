/**
 * Unified Torrent Parser
 * Combines PTT (parse-torrent-title) with regex fallback for maximum accuracy.
 * Centralized parsing engine for all torrent/video filename parsing needs.
 */

import PTT from 'parse-torrent-title';
import { logger } from './logger.js';
import { SOURCE_PATTERNS, LANGUAGE_PATTERNS, AUDIO_PATTERNS, QUALITY_PATTERNS, CODEC_PATTERNS, COMPREHENSIVE_TECH_PATTERNS, hasObviousEpisodeIndicators } from './media-patterns.js';
import { parseEpisodeFromTitle, parseSeasonFromTitle, parseAbsoluteEpisode } from './episode-patterns.js';
import { parseRomanSeasons } from './roman-numeral-utils.js';
import cache from './cache-manager.js'; // Use unified cache manager

// ============ CACHE MANAGEMENT ============
const PARSER_CACHE_TTL = 86400; // 24 hour TTL for parser results

// ============ CORE PARSING ENGINE ============

/**
 * Unified torrent parsing function that combines PTT with regex fallback
 * @param {string} filename - The torrent filename to parse
 * @param {Object} options - Parsing options
 * @returns {Object} Comprehensive parsing result
 */
export function parseUnified(filename, options = {}) {
    if (!filename || typeof filename !== 'string') {
        logger.debug('[unified-parser] Invalid filename provided:', filename);
        return createEmptyParseResult();
    }
    
    // Create cache key with options
    const cacheKey = Object.keys(options).length === 0 
        ? `parser:${filename}` 
        : `parser:${filename}:${JSON.stringify(options)}`;
    
    // Check unified cache first
    const cached = cache.get(cacheKey);
    if (cached !== null) {
        return cached;
    }
    
    const cleanedFilename = cleanFilename(filename);
    
    // Check if cleaned filename result is cached
    if (cleanedFilename !== filename && Object.keys(options).length === 0) {
        const cleanedCacheKey = `parser:${cleanedFilename}`;
        const cleanedCached = cache.get(cleanedCacheKey);
        if (cleanedCached !== null) {
            // Cache the result for original filename too
            cache.set(cacheKey, cleanedCached, PARSER_CACHE_TTL, { type: 'parser' });
            return cleanedCached;
        }
    }
    
    const pttResult = PTT.parse(cleanedFilename);
    const enhancedResult = applyRegexFallbacks(cleanedFilename, pttResult);
    const comprehensiveResult = extractAdditionalMetadata(cleanedFilename, enhancedResult);
    
    // Store in unified cache
    cache.set(cacheKey, comprehensiveResult, PARSER_CACHE_TTL, { type: 'parser' });
    
    // Also cache cleaned filename result if different
    if (cleanedFilename !== filename && Object.keys(options).length === 0) {
        const cleanedCacheKey = `parser:${cleanedFilename}`;
        cache.set(cleanedCacheKey, comprehensiveResult, PARSER_CACHE_TTL, { type: 'parser' });
    }
    
    return comprehensiveResult;
}

/**
 * Create empty parse result structure
 * @returns {Object} Empty parsing result
 */
function createEmptyParseResult() {
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
        technicalDetails: {}
    };
}

// ============ FILENAME CLEANING & PREPROCESSING ============

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

// ============ REGEX FALLBACK HANDLERS ============

/**
 * Apply regex fallbacks for cases where PTT fails or gives incorrect results
 * @param {string} filename - Cleaned filename
 * @param {Object} pttResult - Result from PTT parsing
 * @returns {Object} Enhanced result with fallback corrections
 */
function applyRegexFallbacks(filename, pttResult) {
    let result = { ...pttResult };
    
    // Call parseRomanSeasons() and share result
    const romanSeasonInfo = parseRomanSeasons(filename);
    
    if (pttResult.season && pttResult.episode) {
        // PTT found both season and episode
        logger.debug(`[unified-parser] PTT found reliable season/episode: S${pttResult.season}E${pttResult.episode}, using PTT results - ${filename}`);
        result.season = pttResult.season;
        result.episode = pttResult.episode;
        
        // Skip absolute episode extraction since we have clear season/episode
        result.absoluteEpisode = null;
        
    } else {        
        // Extract absolute episode FIRST to determine if this is absolute episode content
        // Pass pre-computed Roman data to avoid redundant call
        result.absoluteEpisode = extractAbsoluteEpisode(filename, pttResult, romanSeasonInfo);
        
        // Episode extraction fallbacks
        const episodeInfo = extractEpisodeWithFallback(filename, pttResult);
        if (typeof episodeInfo === 'object' && episodeInfo !== null) {
            result.episode = episodeInfo.episode;
            
            // Only use season info if we don't have an absolute episode
            if (episodeInfo.season !== null && (!result.absoluteEpisode || episodeInfo.season !== undefined)) {
                result.season = episodeInfo.season;
            } else if (episodeInfo.season && result.absoluteEpisode) {
                logger.debug(`[unified-parser] Skipping season ${episodeInfo.season} from episode-patterns due to absolute episode ${result.absoluteEpisode} - ${filename}`);
            }
        } else {
            result.episode = episodeInfo;
        }
        
        // Handle absolute episode vs season/episode priority
        result = handleAbsoluteEpisodePriority(result, episodeInfo, filename);
        
        // Only extract season if we don't have an absolute episode
        if (!result.absoluteEpisode && !result.season) {
            result.season = extractSeasonWithFallback(filename, pttResult);
        }
    }
    
    // Roman numeral parsing - use as fallback or when classic parsing gives questionable results
    // Pass pre-computed Roman data
    result = applyRomanNumeralFallback(result, filename, romanSeasonInfo);
    
    // Store Roman data in result for external modules (always set, even if null)
    result.romanSeason = romanSeasonInfo;
    
    // Ensure season is explicitly null when not set (for consistency)
    if (result.season === undefined) {
        result.season = null;
    }
    
    result.title = cleanTitle(filename, pttResult);
    
    return result;
}

/**
 * Handle priority between absolute episode and season/episode patterns
 * @param {Object} result - Current parsing result
 * @param {Object|number} episodeInfo - Episode info from episode parsing
 * @param {string} filename - Original filename
 * @returns {Object} Updated result
 */
function handleAbsoluteEpisodePriority(result, episodeInfo, filename) {
    // If we have an absolute episode, use it ONLY if we don't have clear season/episode patterns
    // When we have explicit season/episode patterns (like S01E01, S00E33), we should NEVER override them with absolute episode numbers as this leads to false matches
    if (result.absoluteEpisode && result.episode !== result.absoluteEpisode) {
        // Check if we have explicit season/episode info from the episode parsing
        const hasSeasonEpisodePattern = episodeInfo && typeof episodeInfo === 'object' && 
                                       episodeInfo.season !== null && episodeInfo.episode !== null;
        if (hasSeasonEpisodePattern) {
            logger.debug(`[unified-parser] Preserving explicit season/episode pattern: S${episodeInfo.season}E${episodeInfo.episode} (ignoring absolute episode ${result.absoluteEpisode} - ${filename})`);
            result.season = episodeInfo.season; // Preserve the season from episode parsing
            result.episode = episodeInfo.episode; // Preserve the episode from episode parsing
            result.absoluteEpisode = null; // Clear absolute episode when we have explicit patterns
        } else {
            logger.debug(`[unified-parser] Using absolute episode ${result.absoluteEpisode} over parsed episode ${result.episode} - ${filename}`);
            result.episode = result.absoluteEpisode;
        }
    }
    
    return result;
}

/**
 * Apply Roman numeral season parsing as fallback
 * @param {Object} result - Current parsing result
 * @param {string} filename - Original filename
 * @param {Object|null} romanSeasonInfo - Pre-computed Roman season info
 * @returns {Object} Updated result
 */
function applyRomanNumeralFallback(result, filename, romanSeasonInfo = null) {
    // Roman numeral parsing - use as fallback or when classic parsing gives questionable results
    // This handles anime titles like "DanMachi III - 04.mkv" where III=season 3, 04=episode 4
    
    // Use pre-computed Roman data if available, otherwise compute it
    const romanInfo = romanSeasonInfo !== null ? romanSeasonInfo : parseRomanSeasons(filename);
    
    if (romanInfo) {
        // Use Roman results if:
        // 1. We don't have season/episode from classic parsing, OR
        // 2. Classic parsing found season=1 (might be incorrect default) and Roman parsing has better info
        // 3. BUT only if we don't have an absolute episode (absolute episodes are season-independent)
        const shouldUseRoman = !result.absoluteEpisode && 
                              (!result.season || !result.episode || 
                               (result.season === 1 && romanInfo.season > 1));
        
        if (shouldUseRoman) {
            logger.debug(`[unified-parser] Using Roman numeral parsing: season=${romanInfo.season}, episode=${romanInfo.episode} (${romanInfo.roman}) - ${filename}`);
            
            if (romanInfo.season) {
                result.season = romanInfo.season;
            }
            if (romanInfo.episode) {
                result.episode = romanInfo.episode;
            }
            
            // When we use Roman numeral parsing, this can't be an absolute episode
            // It's season-based numbering with Roman season indicators
            result.absoluteEpisode = null;
        } else {
            logger.debug(`[unified-parser] Roman numeral found but keeping classic parsing: classic=(${result.season},${result.episode}), roman=(${romanInfo.season},${romanInfo.episode}), absoluteEpisode=${result.absoluteEpisode} - ${filename}`);
        }
    }
    
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
    
    return title;
}

// ============ EPISODE & SEASON EXTRACTION ============

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
        return episodeInfo; // Return full object with season and episode
    }
    
    // If PTT episode seems correct, use it
    if (pttResult.episode && !isEpisodeSuspicious(filename, pttResult.episode)) {
        return pttResult.episode;
    }
    
    return pttResult.episode || null;
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
        return season;
    }
    
    if (pttResult.season) {
        return pttResult.season;
    }
    
    return null;
}

/**
 * Extract absolute episode number for anime
 * @param {string} filename - Filename to parse
 * @param {Object} pttResult - PTT parsing result
 * @param {Object|null} romanSeasonInfo - Pre-computed Roman season info (Phase 2 optimization)
 * @returns {number|null} Absolute episode number
 */
function extractAbsoluteEpisode(filename, pttResult, romanSeasonInfo = null) {
    // PHASE 2: Use pre-computed Roman data if available, otherwise compute it
    const romanInfo = romanSeasonInfo !== null ? romanSeasonInfo : parseRomanSeasons(filename);
    
    if (romanInfo) {
        logger.debug(`[unified-parser] Skipping absolute episode detection due to Roman numeral season context: ${romanInfo.roman} - ${filename}`);
        return null;
    }
    
    // First try the comprehensive absolute episode patterns from episode-patterns.js
    const absoluteEpisode = parseAbsoluteEpisode(filename);
    
    // Skip absolute episode detection for movies (if year is present AND no clear episode patterns)
    if (pttResult.year && filename.includes(pttResult.year.toString())) {
        // Check if there are obvious episode indicators that suggest this is NOT a movie
        // Use centralized episode detection from media-patterns.js
        const hasObviousEpisodePatterns = hasObviousEpisodeIndicators(filename);
        
        // If no obvious episode patterns AND we have a year, likely a movie
        if (!hasObviousEpisodePatterns) {
            return null; // Likely a movie, skip absolute episode detection
        }
    }
    
    if (absoluteEpisode !== null) {
        logger.debug(`[unified-parser] Absolute episode extracted via episode-patterns: ${absoluteEpisode} - ${filename}`);
        return absoluteEpisode;
    }
    
    return null;
}

/**
 * Check if PTT episode result seems suspicious
 * @param {string} filename - Original filename
 * @param {number} episode - PTT episode result
 * @returns {boolean} True if suspicious
 */
function isEpisodeSuspicious(filename, episode) {    
    // Check if episode seems too low for obvious high episode numbers
    const obviousEpisodeMatch = filename.match(/- (\d{2,3})\s/);
    if (obviousEpisodeMatch) {
        const obviousEpisode = parseInt(obviousEpisodeMatch[1]);
        if (obviousEpisode > 50 && episode < 10) return true;
    }
    
    return false;
}

// ============ METADATA EXTRACTION ============

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
    
    return result;
    
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
    // Use centralized bit depth patterns from media-patterns.js
    const bitDepthPatterns = COMPREHENSIVE_TECH_PATTERNS.filter(pattern => 
        pattern.display.includes('bit')
    );
    
    for (const pattern of bitDepthPatterns) {
        if (pattern.pattern.test(filename)) {
            // Extract just the bit depth from display (remove emoji)
            return pattern.display.replace(/^[^\w]*\s*/, '');
        }
    }
    return null;
}

/**
 * Extract HDR information
 * @param {string} filename - Filename
 * @returns {string|null} HDR type
 */
function extractHDRInfo(filename) {
    // Use centralized HDR patterns from media-patterns.js
    const hdrTechPatterns = COMPREHENSIVE_TECH_PATTERNS.filter(pattern => 
        pattern.display.includes('HDR') || pattern.display.includes('Dolby Vision')
    );
    
    for (const techPattern of hdrTechPatterns) {
        if (techPattern.pattern.test(filename)) {
            // Extract just the HDR type from display (remove emoji)
            return techPattern.display.replace(/^[^\w]*\s*/, '');
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
    // First try to extract specific channel configurations from centralized patterns
    const channelPatterns = AUDIO_PATTERNS.filter(pattern => 
        pattern.audio && (pattern.audio.includes('.') || pattern.audio === '5.1' || pattern.audio === '7.1' || pattern.audio === '2.0')
    );
    
    for (const pattern of channelPatterns) {
        if (pattern.pattern.test(filename)) {
            return pattern.audio;
        }
    }
    
    // Fallback to regex for DDP/DD channel detection
    const audioMatch = filename.match(/DDP?(\d\.\d)|(\d\.\d)/);
    return audioMatch ? (audioMatch[1] || audioMatch[2]) : null;
}

/**
 * Extract frame rate information
 * @param {string} filename - Filename
 * @returns {string|null} Frame rate
 */
function extractFrameRate(filename) {
    // Use centralized frame rate patterns from media-patterns.js
    const fpsPatterns = COMPREHENSIVE_TECH_PATTERNS.filter(pattern => 
        pattern.display.includes('fps')
    );
    
    for (const pattern of fpsPatterns) {
        if (pattern.pattern.test(filename)) {
            // Extract just the fps from display (remove emoji)
            return pattern.display.replace(/^[^\w]*\s*/, '');
        }
    }
    return null;
}

/**
 * Extract enhanced language information
 * @param {string} filename - Filename
 * @param {Object} baseResult - Base parsing result
 * @returns {Array} Language information
 */
function extractLanguageInfo(filename, baseResult) {
    const languages = baseResult.languages || [];
    
    // Use centralized language patterns from media-patterns.js
    for (const langPattern of LANGUAGE_PATTERNS) {
        if (langPattern.pattern.test(filename)) {
            const langName = langPattern.displayName.toLowerCase();
            if (!languages.includes(langName)) {
                languages.push(langName);
            }
        }
    }
    
    return languages;
}

// ============ SIMPLIFIED TECHNICAL DETAILS ============

/**
 * Simplified technical details extraction using centralized patterns
 * This replaces the complex extractTechnicalDetailsLegacy function with a cleaner approach
 * @param {string} filename - Filename to extract from
 * @returns {string} Technical details string
 */
export function extractTechnicalDetailsLegacy(filename) {
    if (!filename) return '';
    
    const details = [];
    
    // Use centralized pattern matching from media-patterns.js
    // 1. Languages
    for (const pattern of LANGUAGE_PATTERNS) {
        if (pattern.pattern.test(filename)) {
            details.push(`${pattern.emoji} ${pattern.displayName}`);
        }
    }
    
    // 2. Source (BluRay, WEB-DL, etc.)
    for (const pattern of SOURCE_PATTERNS) {
        if (pattern.pattern.test(filename)) {
            details.push(`${pattern.emoji} ${pattern.displayName}`);
            break; // Only match first source
        }
    }
    
    // 3. Video Codecs
    for (const pattern of CODEC_PATTERNS) {
        if (pattern.pattern.test(filename)) {
            details.push(`🎥 ${pattern.displayName}`);
            break; // Only match first codec
        }
    }
    
    // 4. Audio
    const foundAudio = new Set();
    for (const pattern of AUDIO_PATTERNS) {
        if (pattern.pattern.test(filename) && !foundAudio.has(pattern.audio)) {
            details.push(`${pattern.emoji} ${pattern.audio}`);
            foundAudio.add(pattern.audio);
        }
    }
    
    // 5. Technical terms
    for (const tech of COMPREHENSIVE_TECH_PATTERNS) {
        if (tech.pattern.test(filename)) {
            details.push(tech.display);
        }
    }
    
    // Remove duplicates and return
    return [...new Set(details)].join(' • ');
}

// ============ COMPATIBILITY EXPORTS ============

// Replace extractAbsoluteEpisode from torrent-analyzer.js and episode-mapper.js
export function extractAbsoluteEpisodeLegacy(filename) {
    const result = parseUnified(filename);
    return result.absoluteEpisode;
}

// Main parsing interface
export function parseTitle(filename) {
    return parseUnified(filename);
}