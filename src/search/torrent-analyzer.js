/**
 * Torrent Analyzer
 * Handles torrent content analysis for episode matching (Phase 2)
 */

import { logger } from '../utils/logger.js';
import { parseUnified } from '../utils/unified-torrent-parser.js';
import { isVideo } from '../stream/metadata-extractor.js';
import { AbsoluteEpisodeProcessor } from '../utils/absolute-episode-processor.js';

/**
 * Check if two season numbers match, handling various formats and edge cases
 * @param {string|number} foundSeason - The season number found in the torrent
 * @param {string|number} targetSeason - The season number we're looking for
 * @returns {boolean} - Whether the seasons match
 */
export function checkSeasonMatch(foundSeason, targetSeason) {
    if ((foundSeason === null || foundSeason === undefined) || 
        (targetSeason === null || targetSeason === undefined)) {
        return false;
    }
    
    if (typeof foundSeason === 'string') {
        const parsed = parseInt(foundSeason, 10);
        if (!isNaN(parsed)) foundSeason = parsed;
    }
    if (typeof targetSeason === 'string') {
        const parsed = parseInt(targetSeason, 10);
        if (!isNaN(parsed)) targetSeason = parsed;
    }
    
    const normalizedTarget = parseInt(targetSeason, 10);
    const normalizedFound = parseInt(foundSeason, 10);
    
    if (!isNaN(normalizedTarget) && !isNaN(normalizedFound) &&
        normalizedTarget >= 0 && normalizedTarget <= 30 &&
        normalizedFound >= 0 && normalizedFound <= 30) {
        return normalizedFound === normalizedTarget;
    }
    
    return false;
}

/**
 * Analyze a torrent for episode matching - PHASE 2: Deep content analysis
 * @param {Object} torrent - The torrent to analyze
 * @param {number} targetSeason - Target season number
 * @param {number} targetEpisode - Target episode number
 * @param {Object} absoluteEpisode - Absolute episode data from Trakt (optional)
 * @returns {Object} - Analysis result
 */
export function analyzeTorrent(torrent, targetSeason, targetEpisode, absoluteEpisode = null) {
    const result = {
        isDirect: false,
        isContainer: false,
        hasMatchingEpisode: false,
        matchingFiles: [],
        details: null,
        seasonInfo: { found: null, target: targetSeason }
    };

    const info = torrent.info || {};
    
    const isEpisodeMatch = (videoInfo, videoName = '') => {
        if (!videoInfo) return false;
        
        if (checkSeasonMatch(videoInfo.season, targetSeason) && 
            parseInt(videoInfo.episode, 10) === parseInt(targetEpisode, 10)) {
            logger.info(`[torrent-analyzer] ✅ Classic S${targetSeason}E${targetEpisode} match (found S${videoInfo.season}E${videoInfo.episode}) for: ${videoName}`);
            return true;
        }
        
        if (absoluteEpisode && absoluteEpisode.absoluteEpisode) { // Check for absolute episode match if Trakt data is available
            if (AbsoluteEpisodeProcessor.matchesAbsoluteEpisode(videoName, absoluteEpisode.absoluteEpisode)) {
                logger.info(`[torrent-analyzer] ✅ Absolute episode ${absoluteEpisode.absoluteEpisode} match for: ${videoName}`);
                return true;
            }
        }
        
        return false;
    };
    
    if (isVideo(torrent.name)) {
        result.isDirect = true;
        
        if (!info.season || !info.episode) {
            const parsed = parseUnified(torrent.name);
            logger.info(`[torrent-analyzer] parseUnified for "${torrent.name}": season=${parsed.season}, episode=${parsed.episode}`);
            info.season = info.season || parsed.season;
            info.episode = info.episode || parsed.episode;
            info.absoluteEpisode = info.absoluteEpisode || parsed.absoluteEpisode;
            
            if (!info.season && parsed.season) {
                info.season = parsed.season;
                info.episode = info.episode || parsed.episode;
            }
            
            if ((info.season === null || info.season === undefined) && targetSeason === 1 && info.episode) {
                logger.warn(`[torrent-analyzer] SEASON FALLBACK: Setting season=1 for "${torrent.name}" with episode=${info.episode} (originally season=${info.season})`);
                info.season = 1;
            }
        }
        
        if (isEpisodeMatch(info, torrent.name)) {
            result.hasMatchingEpisode = true;
            result.matchingFiles = [torrent];
        }

        return result;
    }
    
    result.isContainer = true;
    if (torrent.videos?.length) {
        
        const matchingVideos = torrent.videos.filter(video => {
            const videoInfo = video.info || {};
            
            if (!videoInfo.season || !videoInfo.episode) {
                const parsed = parseUnified(video.name);
                if (parsed.season || parsed.episode || parsed.absoluteEpisode) {
                    logger.debug(`[torrent-analyzer] parseUnified for video "${video.name}": season=${parsed.season}, episode=${parsed.episode}, absolute=${parsed.absoluteEpisode}`);
                } 
                videoInfo.season = videoInfo.season || parsed.season;
                videoInfo.episode = videoInfo.episode || parsed.episode;
                videoInfo.absoluteEpisode = videoInfo.absoluteEpisode || parsed.absoluteEpisode;
                
                if (!videoInfo.season && parsed.season) {
                    videoInfo.season = parsed.season;
                    videoInfo.episode = videoInfo.episode || parsed.episode;
                }
                
                if ((videoInfo.season === null || videoInfo.season === undefined) && targetSeason === 1 && videoInfo.episode) {
                    logger.warn(`[torrent-analyzer] SEASON FALLBACK (video): Setting season=1 for video "${video.name}" with episode=${videoInfo.episode} (originally season=${videoInfo.season})`);
                    videoInfo.season = 1;
                }
                
                video.info = videoInfo;
            }

            return isEpisodeMatch(videoInfo, video.name);
        });
        
        if (matchingVideos.length > 0) {
            result.hasMatchingEpisode = true;
            result.matchingFiles = matchingVideos;
        }
    } else {
        logger.info(`[torrent-analyzer] Container has no processed videos:`, torrent.name);
    }

    return result;
}