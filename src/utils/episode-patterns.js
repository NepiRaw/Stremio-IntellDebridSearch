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
    }
};

export const ABSOLUTE_EPISODE_PATTERNS = {
    titleNumber: {
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
        regex: /\b(\d{3})\s/,
        description: 'Standalone 3-digit absolute episode: 031 MULTI',
        groups: { episode: 1 }
    }
};

export function parseSeasonFromTitle(title, strict = false) {
    if (!title) return null;
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
            const num = parseInt(match[1], 10);
            if (!isNaN(num) && num >= 0 && num <= 30) return num;
        }
    }
    return null;
}

export function parseEpisodeFromTitle(filename) {
    if (!filename) return null;
    const normalizedName = filename.replace(/\s+/g, ' ')
                                 .replace(/[\[\](){}]/g, ' ')
                                 .trim();
    for (const [patternName, pattern] of Object.entries(EPISODE_PATTERNS)) {
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
            season = pattern.defaultSeason;
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
    for (const [patternName, pattern] of Object.entries(ABSOLUTE_EPISODE_PATTERNS)) {
        const match = cleanFilename.match(pattern.regex);
        if (!match) continue;
        let episodeStr = null;
        if (pattern.groups.episode) {
            episodeStr = match[pattern.groups.episode];
        }
        if (episodeStr && /^\d{2,4}$/.test(episodeStr)) {
            const episode = parseInt(episodeStr, 10);
            if (episode >= 1 && episode <= 9999) {
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

