/**
 * Episode Patterns Utility - Centralized season/episode detection patterns
 */

import { FILE_EXTENSIONS } from './media-patterns.js';
import { logger } from './logger.js';
import { romanToNumber, parseRomanSeasons } from './roman-numeral-utils.js';

export const SEASON_PATTERNS = {
    standard: {
        regex: /s(?:eason[\s.-]*)?(\d{1,2})/i,
        description: 'Standard S01, Season 1 format'
    },
    standardPadded: {
        regex: /s(?:eason[\s.-]*)?0*(\d{1,2})/i,
        description: 'Standard with zero padding S01, S001'
    },
    seasonEpisodeExtract: {
        regex: /S(\d+)E\d+/i,
        description: 'Extract season from S01E06 format'
    },
    seasonWordSpaced: {
        regex: /Season[\s]*(\d+)/i,
        description: 'Season 1 with optional space'
    },
    seasonOrS: {
        regex: /(?:S|Season)(\d+)/i,
        description: 'S1 or Season1 format'
    },
    seasonStandalone: {
        regex: /\bS(\d{1,2})\b/i,
        description: 'Standalone S1 format'
    },
    frenchSeason: {
        regex: /(?:saison|s[ae][\s.-]*?)(\d{1,2})/i,
        description: 'French format: saison 1, sa 1'
    },
    germanSeason: {
        regex: /staffel[\s.-]*(\d{1,2})/i,
        description: 'German format: Staffel 1'
    },
    spanishSeason: {
        regex: /temporada[\s.-]*(\d{1,2})/i,
        description: 'Spanish format: Temporada 1'
    },
    italianSeason: {
        regex: /stagione[\s.-]*(\d{1,2})/i,
        description: 'Italian format: Stagione 1'
    },
    japaneseSeason: {
        regex: /(?:シーズン|シリーズ)[\s.-]*(\d{1,2})/i,
        description: 'Japanese format: シーズン1, シリーズ1'
    },
    romanSeason: {
        regex: /(?:season|saison|serie|temporada|staffel)[\s.-]*([IVX]+)/i,
        description: 'Roman numeral season: Season II, Saison III',
        seasonType: 'roman'
    },
    seasonWord: {
        regex: /(?:season|saison|serie|temporada|staffel)[\s.-]*(\d{1,2})/i,
        description: 'Generic season word formats'
    },
    plainNumber: {
        regex: /[\s.-](\d{1,2})[ex]/i,
        description: 'Plain number before episode marker'
    },
    zeroPadded: {
        regex: /[\s.-]0*(\d{1,2})[ex\s]/i,
        description: 'Zero-padded format: 01e, 02x'
    },
    seasonFolder: {
        regex: /[\\/](?:s(?:eason)?|saison)[\s.-]*(\d{1,2})[\\/]/i,
        description: 'Season folder structure'
    }
};

export const EPISODE_PATTERNS = {
    seasonEpisode: {
        regex: /[Ss](\d+)[Ee](\d+)/,
        description: 'Standard S01E01 format',
        groups: { season: 1, episode: 2 }
    },
    seasonEpisodeDash: {
        regex: /[Ss](\d+)\s*-\s*(\d+)/,
        description: 'Season dash episode: S5 - 14',
        groups: { season: 1, episode: 2 }
    },
    numberXNumber: {
        regex: /\b(\d{1,2})x(\d{1,3})\b/,
        description: 'Number x Number: 1x01, 12x123',
        groups: { season: 1, episode: 2 },
        validation: 'skipResolution'
    },
    episodeOnly: {
        regex: /[Ee](\d+)/,
        description: 'Episode only: E07 (assume season 1)',
        groups: { episode: 1 },
        defaultSeason: 1
    },
    animeDashNumber: {
        regex: /(.+?)\s*-\s*(\d{2,3})(?:\s*\([^)]*\))?/,
        description: 'Anime dash number: Title - 06 or Title - 06 (1)',
        groups: { episode: 2 },
        defaultSeason: 1,
        forceDefaultSeason: true
    },
    writtenSeasonEpisode: {
        regex: /Season\s+(\d+)[\s\-]+Episode\s+(\d+)/i,
        description: 'Written format: Season 1 Episode 5',
        groups: { season: 1, episode: 2 }
    },
    romanSeasonWrittenEpisode: {
        regex: /Season\s+([IVX]+)\s+Episode\s+(\d+)/i,
        description: 'Roman season written episode: Season II Episode 05',
        groups: { season: 1, episode: 2 },
        seasonType: 'roman'
    }
};

// Avoidance patterns for false episode matches like "... (1).mkv"
export const AVOID_EPISODE_PATTERNS = [
    // Matches any filename ending with (1), (2), or (3) followed by a video extension
    new RegExp(`\\(([1-3])\\)\\.(${FILE_EXTENSIONS.video.join('|')})$`, 'i'),
];

export const ABSOLUTE_EPISODE_PATTERNS = {
    fourDigitBetweenDots: {
        regex: /\b(\d{4})\b.*\s/,
        description: '4-digit numbers between dots followed by resolution (e.g., One.Piece.1015.1080p)',
        groups: { episode: 1 }
    },
    threeToFourDigitWithQuality: {
        regex: /\.(\d{3,4})\..*(?:multi|bluray|1080p|720p|x264|x265|web|dl|hdtv)/i,
        description: '3-4 digit numbers between dots followed by resolution (e.g., Naruto.142.Title)',
        groups: { episode: 1 }
    },
    dashNumber: {
        regex: /[-\s](\d{2,4})(?:\s+(?:multi|bluray|1080p|720p|x264|x265|web|dl|hdtv|$))/i,
        description: 'Dash followed by 2-4 digit number before quality: - 030, - 1015',
        groups: { episode: 1 }
    },
    episodePrefixEnhanced: {
        regex: /Episode[\s]*(\d{2,4})/i,
        description: 'Episode prefix enhanced: Episode 030, Episode 1015',
        groups: { episode: 1 }
    },
    titleNumberWithDots: {
        regex: /(\w+(?:\.\w+)*?)\.(\d{3,4})(?:\.|$)/i,
        description: 'Title with dots followed by 3-4 digit number: One.Piece.142.1080p',
        groups: { title: 1, episode: 2 }
    },
    titleNumberSpaced: {
        regex: /(\w+)\s+(\d{3,4})(?:\s|$)/i,
        description: 'Title followed by 3-4 digit number: DanMachi 031',
        groups: { title: 1, episode: 2 }
    },
    titleNumberGeneric: {
        regex: /(\w+)\s+(\d{2,4})(?:\s|$)/i,
        description: 'Title followed by 2-4 digit number: Title 001',
        groups: { title: 1, episode: 2 }
    },
    titleDashNumber: {
        regex: /(\w+)\s*-\s*(\d{2,4})(?:\s|$)/i,
        description: 'Title dash number: Title - 001',
        groups: { title: 1, episode: 2 }
    },
    numberDashTitle: {
        regex: /^(\d{2,4})\s*-\s*(.+)/i,
        description: 'Number dash title: 031 - Title',
        groups: { episode: 1, title: 2 }
    },
    episodePrefix: {
        regex: /(?:ep|episode)\s*(\d{2,4})(?:\s|$)/i,
        description: 'Episode prefix: Ep001, Episode 031',
        groups: { episode: 1 }
    },
    beforeQuality: {
        regex: /^([^0-9]*?)(\d{2,4})(?:\s+(?:multi|bluray|1080p|720p|x264|x265|web|dl|hdtv))/i,
        description: 'Number before quality keywords',
        groups: { title: 1, episode: 2 }
    },
    absoluteOnly: {
        regex: /\b(\d{3,4})\s/,
        description: 'Standalone 3-4-digit absolute episode: 031 MULTI, 1015 1080p',
        groups: { episode: 1 }
    }
};

export const EPISODE_TITLE_PATTERNS = [
    // Quoted episode names (French/international format)
    /''([^'']+)''/g, // Double single quotes like ''Rêve - Espoir lointain''
    /'([^']+)'/g, // Single quotes like 'Episode Name'
    /"([^"]+)"/g, // Double quotes like "Episode Name"
    
    // Standard patterns
    /[Ss]\d{1,2}[Ee]\d{1,3}\.(.+?)\.(?:\d{3,4}p|BluRay|WEBRip|HDTV|x264|x265)/i, // S01E01.Title.720p
    /[Ss]\d{1,2}[Ee]\d{1,3}\s*-\s*(.+?)(?:\.|$)/i, // S01E01 - Title
    /[Ss]\d{1,2}[Ee]\d{1,3}\s+(.+?)(?:\s*\d{3,4}p|\s*BluRay|\s*WEBRip|\s*HDTV|\s*x264|\s*x265|$)/i, // S01E01 Title
    /[Ss]\d{1,2}[Ee]\d{1,3}\.(.+?)(?:\.|$)/i, // S01E01.Title.
    /Episode\s*\d+\s*-\s*(.+?)(?:\.|$)/i, // Episode 1 - Title
    
    // Absolute episode with title patterns
    /\d{2,3}\s+[A-Z].*?''([^'']+)''/i, // Like "029 MULTI ''Rêve - Espoir lointain''"
    /\d{2,3}\s+.*?"([^"]+)"/i, // Like "029 MULTI "Episode Name""
];

export function extractEpisodeTitleFromFilename(filename) {
    if (!filename) return null;

    // First try quoted patterns (highest priority for episode names)
    const quotedPatterns = [
        { name: 'double-single-quotes', pattern: /''([^'']+)''/g },
        { name: 'double-quotes', pattern: /"([^"]+)"/g },
        // { name: 'single-quotes', pattern: /'([^']+)'/g }, // Single-quotes pattern disabled due to false positives
    ];
    
    for (const {name, pattern} of quotedPatterns) {
        pattern.lastIndex = 0;
        const match = pattern.exec(filename);
        if (match && match[1]) {
            let title = match[1].trim();
            title = title.replace(/\s+/g, ' ').trim();
            
            if (title.length > 2) {
                console.log(`[extractEpisodeTitleFromFilename] Found quoted episode title (${name}): "${title}"`);
                return title;
            }
        }
    }
    
    /*
    // Then try standard patterns -- Too broad, can lead to false positives
    // Commented out to avoid confusion, but can be used if needed
    const standardPatterns = [
        /[Ss]\d{1,2}[Ee]\d{1,3}\.(.+?)\.(?:\d{3,4}p|BluRay|WEBRip|HDTV|x264|x265)/i, // S01E01.Title.720p
        /[Ss]\d{1,2}[Ee]\d{1,3}\s*-\s*(.+?)(?:\.|$)/i, // S01E01 - Title
        /[Ss]\d{1,2}[Ee]\d{1,3}\s+(.+?)(?:\s*\d{3,4}p|\s*BluRay|\s*WEBRip|\s*HDTV|\s*x264|\s*x265|$)/i, // S01E01 Title
        /[Ss]\d{1,2}[Ee]\d{1,3}\.(.+?)(?:\.|$)/i, // S01E01.Title.
        /Episode\s*\d+\s*-\s*(.+?)(?:\.|$)/i, // Episode 1 - Title
    ];

    for (const pattern of standardPatterns) {
        const match = filename.match(pattern);
        if (match && match[1]) {
            let title = match[1]
                .replace(/[._]/g, ' ') // Replace dots and underscores but keep dashes
                .replace(/\s+/g, ' ')
                .trim();
            
            // Remove technical terms from the end
            title = title.replace(/\b(720p|1080p|2160p|4K|BluRay|WEBRip|x264|x265).*$/i, '').trim();
            
            if (title.length > 2 && !title.match(/^\w{2,4}$/)) { // Avoid short technical terms
                console.log(`[extractEpisodeTitleFromFilename] Found standard episode title: "${title}"`);
                return title;
            }
        }
    }
    */

    return null;
}

export function parseSeasonFromTitle(title, strict = false) {
    if (!title) return null;
    
    // First check for roman numeral seasons
    const romanSeason = parseRomanSeasons(title);
    if (romanSeason) {
        return romanSeason.season;
    }
    
    const normalizedTitle = title.replace(/\s+/g, ' ')
                               .replace(/[\[\](){}]/g, ' ')
                               .trim();
    
    const reliablePatterns = ['standard', 'standardPadded', 'seasonWord', 'seasonFolder'];
    const patternsToUse = strict 
        ? Object.entries(SEASON_PATTERNS).filter(([key]) => reliablePatterns.includes(key))
        : Object.entries(SEASON_PATTERNS);
    
    const sortedPatterns = patternsToUse.sort(([a], [b]) => {
        const aReliable = reliablePatterns.includes(a);
        const bReliable = reliablePatterns.includes(b);
        return bReliable - aReliable;
    });
    
    for (const [format, pattern] of sortedPatterns) {
        const match = normalizedTitle.match(pattern.regex);
        if (match?.[1]) {
            let num;
            if (pattern.seasonType === 'roman') {
                num = romanToNumber(match[1]);
            } else {
                num = parseInt(match[1], 10);
            }
            
            // Reject season numbers that are too high (likely absolute episodes)
            // Season numbers above 20 are very rare and likely absolute episodes
            if (!isNaN(num) && num >= 0 && num <= 20) {
                return num;
            }
        }
    }
    
    return null;
}

export function parseEpisodeFromTitle(filename) {
    if (!filename) return null;
    
    const normalizedName = filename.replace(/\s+/g, ' ')
                                 .replace(/[\[\](){}]/g, ' ')
                                 .trim();
    
    // Sort patterns by priority (more specific patterns first)
    const patternEntries = Object.entries(EPISODE_PATTERNS);
    const sortedPatterns = [
        // Highest priority: Standard season/episode formats
        ...patternEntries.filter(([name]) => name === 'seasonEpisode'),
        ...patternEntries.filter(([name]) => name === 'writtenSeasonEpisode'),
        ...patternEntries.filter(([name]) => name === 'numberXNumber'),
        
        // Medium priority: Other specific patterns
        ...patternEntries.filter(([name]) => name === 'seasonEpisodeDash'),
        ...patternEntries.filter(([name]) => name === 'episodeOnly'),
        
        // Lowest priority: Generic anime dash pattern (only if no season info found)
        ...patternEntries.filter(([name]) => name === 'animeDashNumber')
    ];
    
    const seasonInfo = parseSeasonFromTitle(filename);
    
    for (const [patternName, pattern] of sortedPatterns) {
        const match = normalizedName.match(pattern.regex);
        if (!match) continue;
        
        if (pattern.validation === 'skipResolution') {
            const num1 = parseInt(match[1]);
            const num2 = parseInt(match[2]);
            const isResolution = (
                (num1 >= 640 && num2 >= 480) ||
                (num1 >= 320 && num2 >= 240) ||
                (num1 === 1920 && num2 === 1080) ||
                (num1 === 1280 && num2 === 720) ||
                (num1 === 3840 && num2 === 2160) ||
                (num1 === 2560 && num2 === 1440)
            );
            if (isResolution) continue;
        }
        
        let season = null;
        let episode = null;
        
        if (pattern.groups.season && match[pattern.groups.season]) {
            if (pattern.seasonType === 'roman') {
                season = romanToNumber(match[pattern.groups.season]);
            } else {
                season = parseInt(match[pattern.groups.season], 10);
            }
        } else if (pattern.defaultSeason) {
            if (pattern.forceDefaultSeason) {
                season = pattern.defaultSeason;
            } else if (patternName === 'animeDashNumber' && seasonInfo) {
                season = seasonInfo;
            } else {
                season = pattern.defaultSeason;
            }
        }
        
        if (pattern.groups.episode && match[pattern.groups.episode]) {
            episode = parseInt(match[pattern.groups.episode], 10);
        }
        
        if (season !== null && episode !== null && 
            season >= 0 && season <= 30 && 
            episode >= 1 && episode <= 999) {
            logger.debug(`[parseEpisodeFromTitle] Found S${season}E${episode} using pattern: ${patternName}`);
            return { season, episode, pattern: patternName };
        }
    }
    
    return null;
}

export function parseAbsoluteEpisode(filename) {
    if (!filename) return null;
    
    const videoExtensionPattern = new RegExp(`\\.(${FILE_EXTENSIONS.video.join('|')})$`, 'i');
    const cleanFilename = filename.replace(videoExtensionPattern, '');
    
    // Skip if this looks like a year in parentheses (not an absolute episode)
    // Pattern: (1900-2099) followed by season/episode format like S01E01
    if (/\(\d{4}\).*?S\d+E\d+/i.test(cleanFilename)) {
        logger.debug(`[parseAbsoluteEpisode] Skipping absolute episode detection - year in parentheses with S##E## format detected`);
        return null;
    }
    
    // Sort patterns by priority (more specific patterns first)
    const patternEntries = Object.entries(ABSOLUTE_EPISODE_PATTERNS);
    const sortedPatterns = [
        // High priority patterns for specific formats
        ...patternEntries.filter(([name]) => name === 'fourDigitBetweenDots'),
        ...patternEntries.filter(([name]) => name === 'threeToFourDigitWithQuality'),
        ...patternEntries.filter(([name]) => name === 'dashNumber'),
        ...patternEntries.filter(([name]) => name === 'episodePrefixEnhanced'),
        // Medium priority patterns  
        ...patternEntries.filter(([name]) => name === 'titleNumberWithDots'),
        ...patternEntries.filter(([name]) => name === 'titleNumberSpaced'),
        ...patternEntries.filter(([name]) => name === 'episodePrefix'),
        // Lower priority patterns
        ...patternEntries.filter(([name]) => !['fourDigitBetweenDots', 'threeToFourDigitWithQuality', 'dashNumber', 'episodePrefixEnhanced', 'titleNumberWithDots', 'titleNumberSpaced', 'episodePrefix'].includes(name))
    ];
    
    for (const [patternName, pattern] of sortedPatterns) {
        const match = cleanFilename.match(pattern.regex);
        if (!match) continue;
        
        let episodeStr = null;
        if (pattern.groups.episode) {
            episodeStr = match[pattern.groups.episode];
        }
        
        if (episodeStr && /^\d{2,4}$/.test(episodeStr)) {
            const episode = parseInt(episodeStr, 10);
            if (episode >= 1 && episode <= 9999) { // Support up to 4-digit episodes
                logger.debug(`[parseAbsoluteEpisode] Found absolute episode ${episode} using pattern: ${patternName}`);
                return episode;
            }
        }
    }
    
    return null;
}

export function detectEpisodeFormat(filename) {
    if (!filename) {
        return { format: 'unknown', confidence: 0 };
    }
    const episodeInfo = parseEpisodeFromTitle(filename);
    const absoluteEpisode = parseAbsoluteEpisode(filename);
    if (episodeInfo && absoluteEpisode) {
        return {
            format: 'hybrid',
            standard: episodeInfo,
            absolute: absoluteEpisode,
            confidence: 0.9
        };
    } else if (episodeInfo) {
        return {
            format: 'standard',
            episode: episodeInfo,
            confidence: 0.95
        };
    } else if (absoluteEpisode) {
        return {
            format: 'absolute',
            episode: absoluteEpisode,
            confidence: 0.8
        };
    }
    return { format: 'unknown', confidence: 0 };
}

export function checkSeasonMatch(foundSeason, targetSeason) {
    if ((foundSeason === null || foundSeason === undefined) || 
        (targetSeason === null || targetSeason === undefined)) {
        return false;
    }
    if (typeof foundSeason === 'string') {
        const parsed = parseSeasonFromTitle(foundSeason, true);
        if (parsed !== null) foundSeason = parsed;
    }
    if (typeof targetSeason === 'string') {
        const parsed = parseSeasonFromTitle(targetSeason, true);
        if (parsed !== null) targetSeason = parsed;
    }
    return parseInt(foundSeason, 10) === parseInt(targetSeason, 10);
}

export function matchEpisode(filename, targetSeason, targetEpisode, absoluteEpisode = null) {
    const result = {
        isMatch: false,
        confidence: 0,
        matchType: 'none',
        details: {}
    };
    const episodeInfo = parseEpisodeFromTitle(filename);
    if (episodeInfo) {
        const seasonMatch = checkSeasonMatch(episodeInfo.season, targetSeason);
        const episodeMatch = parseInt(episodeInfo.episode, 10) === parseInt(targetEpisode, 10);
        if (seasonMatch && episodeMatch) {
            result.isMatch = true;
            result.confidence = 0.95;
            result.matchType = 'standard';
            result.details = { 
                found: `S${episodeInfo.season}E${episodeInfo.episode}`,
                target: `S${targetSeason}E${targetEpisode}`,
                pattern: episodeInfo.pattern
            };
            return result;
        }
    }
    if (absoluteEpisode && !episodeInfo) {
        const foundAbsolute = parseAbsoluteEpisode(filename);
        if (foundAbsolute && foundAbsolute === parseInt(absoluteEpisode, 10)) {
            result.isMatch = true;
            result.confidence = 0.8;
            result.matchType = 'absolute';
            result.details = {
                found: `Absolute ${foundAbsolute}`,
                target: `Absolute ${absoluteEpisode}`
            };
            return result;
        }
    }
    return result;
}

