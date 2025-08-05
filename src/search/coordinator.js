/**
 * Search Coordinator Module
 * Orchestrates multi-phase search across different providers and APIs
 * Two-phase approach: fast title matching, then deep content analysis
 */

import { logger } from '../utils/logger.js';
import { extractKeywords } from './keyword-extractor.js';
import parseTorrentTitle from '../utils/parse-torrent-title.js';
import { FILE_TYPES } from '../utils/file-types.js';
import { fetchTMDbAlternativeTitles } from '../api/tmdb.js';
import { getEpisodeMapping } from '../api/trakt.js';
import { analyzeTorrent } from './torrent-analyzer.js';
import Fuse from 'fuse.js';

/**
 * Get basic title information without complete metadata
 */
export function getBasicTitleInfo(searchKey, type) {
    const cleanedTitle = extractKeywords(searchKey);
    return {
        title: cleanedTitle,
        normalizedTitle: cleanedTitle.toLowerCase(),
        type: type
    };
}

/**
 * Get search strategy based on content type and metadata availability
 */
export function getSearchStrategy(type, season, episode, alternativeTitles) {
    return {
        useMultiplePhases: type === 'series' && season && episode,
        useTitleVariations: alternativeTitles.length > 0,
        useAnimeSearch: type === 'series'
    };
}

/**
 * Perform advanced search using TMDb/Trakt APIs when available.
 * Uses a two-phase approach: fast title matching, then deep content analysis.
 * THIS IS THE EXACT WORKING FUNCTION FROM THE WORKING ADDON
 */
export async function coordinateSearch(params) {
    const {
        apiKey, provider, searchKey, type, imdbId,
        season, episode, 
        threshold = 0.3, providers
    } = params;
    
    // Implement fallback to environment variables for API keys when not provided by user
    let { tmdbApiKey, traktApiKey } = params;
    
    // Fallback to .env variables if API keys are not provided
    if (!tmdbApiKey && process.env.TMDB_API_KEY) {
        tmdbApiKey = process.env.TMDB_API_KEY;
        logger.info('[coordinator] Using TMDb API key from environment variables');
    }
    
    if (!traktApiKey && process.env.TRAKT_API_KEY) {
        traktApiKey = process.env.TRAKT_API_KEY;
        logger.info('[coordinator] Using Trakt API key from environment variables');
    }
    
    logger.info('[coordinator] Starting two-phase search for:', searchKey);
    logger.info('[coordinator] Normalized search key:', extractKeywords(searchKey));

    // ========== PHASE 0: PREPARE SEARCH TERMS + EPISODE MAPPING ==========
    logger.info('[coordinator] Phase 0: Preparing search terms and episode mapping');
    
    // Get absolute episode number early if Trakt API is available
    let absoluteEpisode = null;
    if (traktApiKey && type === 'series' && season && episode) {
        logger.info(`[coordinator] Fetching absolute episode mapping for S${season}E${episode}`);
        absoluteEpisode = await getEpisodeMapping(traktApiKey, imdbId, season, episode);
        if (absoluteEpisode) {
            logger.info(`[coordinator] ✅ Found absolute episode: ${absoluteEpisode}`);
        } else {
            logger.info(`[coordinator] ❌ No absolute episode found from Trakt API`);
        }
    }
    
    let alternativeTitles = [];
    if (tmdbApiKey && type && imdbId) {
        logger.info('[coordinator] TMDb API available, fetching alternative titles');
        alternativeTitles = await fetchTMDbAlternativeTitles(null, type, tmdbApiKey, imdbId);
    }
    
    // Prepare all search terms - use all titles for provider search
    const normalizedSearchKey = extractKeywords(searchKey);
    const allSearchTerms = [normalizedSearchKey];
    
    if (alternativeTitles.length > 0) {
        // Extract normalized titles from the new format with country info
        const normalizedAlternatives = alternativeTitles.map(alt => alt.normalizedTitle || alt);
        allSearchTerms.push(...normalizedAlternatives);
    }

    // OPTIMIZATION: Deduplicate normalized search terms to reduce redundant Fuse.js searches
    const termMap = new Map();
    allSearchTerms.filter(term => term && term.trim()).forEach(term => {
        const lowerKey = term.toLowerCase();
        if (!termMap.has(lowerKey)) {
            termMap.set(lowerKey, term); // Keep first occurrence with original casing
        }
    });
    const uniqueSearchTerms = Array.from(termMap.values());
    
    logger.info(`[coordinator] Deduplicated search terms: ${allSearchTerms.length} → ${uniqueSearchTerms.length} unique terms`);

    // ========== OPTIMIZED PROVIDER SEARCH (SINGLE FETCH + PRE-FILTER) ==========
    logger.info('[coordinator] Optimized provider search - fetching all torrents once');
    
    const providerImpl = providers[provider];
    if (!providerImpl) {
        throw new Error(`Invalid provider: ${provider}`);
    }
    
    // Check for bulk fetch method (different providers have different method names)
    const bulkMethod = providerImpl.listTorrentsParallel || providerImpl.listFilesParallel || providerImpl.listFiles || providerImpl.searchTorrents;
    if (!bulkMethod) {
        throw new Error(`Provider ${provider} does not support bulk torrent fetching`);
    }

    // OPTIMIZATION: Get ALL torrents once instead of multiple searches
    let allTorrents = [];
    try {
        logger.info(`[coordinator] Fetching all torrents from ${provider}`);
        
        // Use provider-specific bulk methods when available for maximum performance
        // THIS IS THE EXACT LOGIC FROM THE WORKING ADDON
        if (provider === 'AllDebrid' && providerImpl.listTorrentsParallel) {
            logger.info('[coordinator] Using AllDebrid bulk torrent fetch');
            const torrentsResults = await providerImpl.listTorrentsParallel(apiKey);
            allTorrents = torrentsResults.map(item => ({
                source: 'alldebrid',
                id: item.id,
                name: item.filename,
                type: 'other',
                info: parseTorrentTitle.parse(item.filename),
                size: item.size,
                created: new Date(item.completionDate)
            }));
        } else if (provider === 'DebridLink' && providerImpl.listTorrentsParallel) {
            logger.info('[coordinator] Using DebridLink bulk torrent fetch');
            const torrentsResults = await providerImpl.listTorrentsParallel(apiKey);
            allTorrents = torrentsResults.map(item => ({
                source: 'debridlink',
                id: item.id.split('-')[0],
                name: item.name,
                type: 'other',
                info: parseTorrentTitle.parse(item.name),
                size: item.size,
                created: new Date(item.created * 1000)
            }));
        } else if (provider === 'RealDebrid' && providerImpl.listFilesParrallel) {
            logger.info('[coordinator] Using RealDebrid bulk torrent fetch');
            const torrentsResults = await providerImpl.listFilesParrallel(FILE_TYPES.TORRENTS, apiKey, 1, 1000);
            allTorrents = torrentsResults.map(item => ({
                source: 'realdebrid',
                id: item.id,
                name: item.filename,
                type: 'other',
                info: parseTorrentTitle.parse(item.filename),
                size: item.bytes, // RealDebrid uses 'bytes' field, not 'size'
                created: new Date(item.added) // RealDebrid uses 'added' field
            }));
        } else if (provider === 'TorBox' && providerImpl.listFilesParallel) {
            logger.info('[coordinator] Using TorBox bulk torrent fetch');
            const torrentsResults = await providerImpl.listFilesParallel(FILE_TYPES.TORRENTS, apiKey, 1, 1000);
            allTorrents = torrentsResults.map(item => ({
                source: 'torbox',
                id: item.id,
                name: item.name,
                type: 'other',
                info: parseTorrentTitle.parse(item.name),
                size: item.size,
                created: new Date(item.created_at)
            }));
        } else if (provider === 'Premiumize' && providerImpl.listFiles) {
            logger.info('[coordinator] Using Premiumize bulk file fetch');
            const filesResults = await providerImpl.listFiles(apiKey);
            allTorrents = filesResults.map(item => ({
                source: 'premiumize',
                id: item.id,
                name: item.name,
                type: 'other',
                info: parseTorrentTitle.parse(item.name),
                size: item.size,
                created: new Date(item.created_at * 1000) // Premiumize uses created_at * 1000
            }));
        } else {
            // Fallback: search with main title only (still much better than multiple searches)
            logger.info(`[coordinator] Using fallback search with main title for ${provider}`);
            allTorrents = await providerImpl.searchTorrents(apiKey, normalizedSearchKey, threshold);
        }
        
        logger.info(`[coordinator] Retrieved ${allTorrents.length} total torrents`);
    } catch (error) {
        logger.warn('[coordinator] Failed to fetch torrents:', error);
        return [];
    }

    if (allTorrents.length === 0) {
        logger.info('❌ [coordinator] No torrents found');
        return [];
    }

    // OPTIMIZATION: Pre-filter torrents by keyword inclusion before expensive Fuse.js
    logger.info('[coordinator] Pre-filtering torrents by keywords');
    const keywords = uniqueSearchTerms.filter(term => term && typeof term === "string");
    
    // Add episode-specific keywords for series
    if (type === 'series' && season && episode) {
        keywords.push(`S${season}E${episode}`);
        if (absoluteEpisode && absoluteEpisode !== parseInt(episode)) {
            keywords.push(`${absoluteEpisode}`);
            keywords.push(`${absoluteEpisode} MULTI`);
            keywords.push(`${absoluteEpisode} BluRay`);
        }
    }

    const relevantTorrents = allTorrents.filter(torrent => {
        const normalizedTitle = extractKeywords(torrent.name).toLowerCase();
        return keywords.some(keyword => 
            normalizedTitle.includes(keyword.toLowerCase())
        );
    });
    
    logger.info(`[coordinator] Pre-filter: ${allTorrents.length} → ${relevantTorrents.length} relevant torrents`);
    
    if (relevantTorrents.length === 0) {
        logger.info('❌ [coordinator] No relevant torrents found after pre-filtering');
        return [];
    }

    // Convert to the format expected by Phase 1
    const allRawResults = relevantTorrents;
    
    // ========== PHASE 1: FAST TITLE MATCHING ==========
    logger.info('[coordinator] Phase 1: Fast title matching');
    
    const normalizedResults = allRawResults.map(result => ({
        ...result,
        normalizedName: extractKeywords(result.name),
        normalizedTitle: extractKeywords(result.info?.title || ''),
        originalResult: result
    }));

    const titleFuse = new Fuse(normalizedResults, {
        keys: ['normalizedName', 'normalizedTitle'],
        threshold: threshold,
        minMatchCharLength: 2,
        includeScore: true
    });

    const titleMatches = [];
    const seenMatches = new Set(); // Track duplicates by original name

    // Search for each unique normalized term
    for (const term of uniqueSearchTerms) {
        const matches = titleFuse.search(term);
        
        // Add unique matches
        matches.forEach(match => {
            const originalName = match.item.originalResult.name;
            if (!seenMatches.has(originalName)) {
                seenMatches.add(originalName);
                titleMatches.push({
                    ...match,
                    item: match.item.originalResult
                });
            }
        });
        
        // Only log when matches are found
        if (matches.length > 0) {
            logger.info(`[coordinator] Found ${matches.length} matches for normalized term: "${term}"`);
        }
    }
    
    // Log Phase 1 summary
    if (titleMatches.length === 0) {
        logger.info('❌ [coordinator] No title matches found in Phase 1');
        
        // For movies, return empty results immediately (no anime fallback needed)
        if (type === 'movie') {
            logger.info('[coordinator] Movie content with no matches - returning empty results');
            return [];
        }
        
        // For series, continue to Phase 3 (anime fallback) if we have season/episode info
        if (type === 'series' && season && episode) {
            logger.info('[coordinator] Series with no Phase 1 matches - proceeding to Phase 3 anime fallback');
        } else {
            logger.info('[coordinator] Series without season/episode info - returning empty results');
            return [];
        }
    } else {
        logger.info(`[coordinator] Phase 1 complete: ${titleMatches.length} matches out of ${allRawResults.length} total results`);
    }
    
    // For movies or when no episode info needed, return Phase 1 results
    if (type === 'movie' || (!season && !episode)) {
        logger.info('[coordinator] Movie or no episode filtering needed, returning Phase 1 results');
        
        return {
            results: titleMatches.map(m => m.item),
            absoluteEpisode: null
        };
    }

    // ========== PHASE 2: DEEP CONTENT ANALYSIS ==========
    let matches = [];
    
    if (titleMatches.length > 0) {
        logger.info('[coordinator] Phase 2: Deep content analysis for episode matching');
        
        // Batch fetch torrent details to avoid individual API calls
        const torrentsNeedingDetails = titleMatches.filter(match => 
            providers[provider]?.getTorrentDetails && !match.item.videos
        );
    
    if (torrentsNeedingDetails.length > 0) {
        logger.info(`[coordinator] Batch fetching details for ${torrentsNeedingDetails.length} torrents`);
        await Promise.all(
            torrentsNeedingDetails.map(async match => {
                try {
                    const details = await providers[provider].getTorrentDetails(apiKey, match.item.id);
                    Object.assign(match.item, details);
                } catch (e) {
                    logger.warn(`[coordinator] Failed to fetch details for ${match.item.name}:`, e);
                }
            })
        );
    }

    // Analyze torrents for episode matching
    const analyzedResults = titleMatches.map(match => {
        const analysis = analyzeTorrent(match.item, parseInt(season), parseInt(episode), absoluteEpisode);
        return {
            torrent: match.item,
            analysis,
            score: match.score
        };
    });

    // Filter to only matching episodes and extract specific video files    
    matches = analyzedResults
        .filter(result => {
            const hasMatch = result.analysis.hasMatchingEpisode;
            if (!hasMatch) {
                logger.info(`[coordinator] ❌ REJECTED: ${result.torrent.name} - No matching episodes found`);
            }
            return hasMatch;
        }).flatMap(result => {
            // For containers, return each matching video as a separate result
            if (result.analysis.isContainer && result.analysis.matchingFiles.length > 0) {
                const extractedVideos = result.analysis.matchingFiles.map(video => ({
                    // Create a clean object with only the extracted video - don't include original videos array
                    id: result.torrent.id,
                    source: result.torrent.source,
                    name: video.name,
                    size: video.size,
                    url: video.url,
                    info: {
                        ...(result.torrent.info || {}),
                        ...(video.info || {})
                    },
                    // Keep track that this is from a container
                    containerName: result.torrent.name,
                    isExtractedVideo: true,
                    // Create a videos array with only this video
                    videos: [video]
                }));
                
                return extractedVideos;
            } else {
                // For direct files, return as is
                return [result.torrent];
            }
        });
        
        logger.debug(`[coordinator] Phase 2 complete: ${matches.length} matching episodes found`);
    } else {
        logger.debug('[coordinator] Phase 2 skipped: No title matches from Phase 1');
    }
    
    logger.debug(`[coordinator] Performance summary: ${allRawResults.length} total → ${titleMatches.length} title matches → ${matches.length} final results`);
    
    // ========== PHASE 3: ANIME SEASON CHECK (Final fallback) ==========
    if (matches.length === 0 && type === 'series' && season && episode) {
        // Check if this is Season 0 (specials/OVA) - don't do anime mapping for S00
        if (parseInt(season) === 0) {
            logger.info('[coordinator] Season 0 (specials/OVA) detected - skipping anime mapping phase');
            logger.info('[coordinator] For S00 episodes, we only look for direct S00E{episode} matches');
            
            return {
                results: [],
                absoluteEpisode: absoluteEpisode
            };
        }
        
        logger.info('[coordinator] Phase 3: Trying anime season mapping as final fallback');
        
        try {
            // Import anime functions - moved to jikan.js for better organization
            const { fetchAnimeSeasonInfo, mapAnimeEpisode, selectTitleVariationsForAnime } = await import('../api/jikan.js');
            
            // Use country-aware title selection for anime searches
            const titleVariations = selectTitleVariationsForAnime(
                searchKey, 
                alternativeTitles, 
                'anime'
            );
            
            logger.info(`[coordinator] Country-prioritized anime search with ${titleVariations.length} title variations:`, titleVariations);
            
            // Try each title variation until we find anime seasons
            let animeSeasons = [];
            let successfulTitle = null;
            
            for (const titleVariation of titleVariations) {
                logger.info(`[coordinator] Trying anime search with: "${titleVariation}"`);
                animeSeasons = await fetchAnimeSeasonInfo(titleVariation);
                
                if (animeSeasons.length > 0) {
                    successfulTitle = titleVariation;
                    logger.info(`[coordinator] ✅ Found anime seasons with country-prioritized title: "${titleVariation}"`);
                    console.log(`[anime-search] ✅ Found ${animeSeasons.length} anime seasons for "${titleVariation}":`, 
                        animeSeasons.map(r => `${r.season_number} (${r.episodes} eps) - ${r.title}`));
                    break;
                } else {
                    logger.info(`[coordinator] ❌ No anime found for: "${titleVariation}"`);
                }
            }
            
            if (animeSeasons.length > 0) {
                // Try to map the episode to correct season
                const episodeMapping = mapAnimeEpisode(animeSeasons, parseInt(season), parseInt(episode));
                
                if (episodeMapping) {
                    logger.info(`[coordinator] Anime mapping found using "${successfulTitle}": S${season}E${episode} → S${episodeMapping.mappedSeason}E${episodeMapping.mappedEpisode}`);
                    
                    // OPTIMIZATION: Instead of full recursive search, reuse existing data and only re-analyze
                    logger.info('[coordinator] Optimized anime retry: Re-analyzing existing torrents with new season/episode');
                    
                    // Re-analyze the same torrents we already found with the new season/episode
                    const reAnalyzedResults = titleMatches.map(match => {
                        const analysis = analyzeTorrent(
                            match.item, 
                            parseInt(episodeMapping.mappedSeason), 
                            parseInt(episodeMapping.mappedEpisode), 
                            absoluteEpisode
                        );
                        return {
                            torrent: match.item,
                            analysis,
                            score: match.score
                        };
                    });
                    
                    // Extract matching episodes with new criteria
                    const animeMatches = reAnalyzedResults
                        .filter(result => {
                            const hasMatch = result.analysis.hasMatchingEpisode;
                            if (hasMatch) {
                                logger.info(`[coordinator] ✅ ANIME MATCH: ${result.torrent.name} - Found S${episodeMapping.mappedSeason}E${episodeMapping.mappedEpisode}`);
                            }
                            return hasMatch;
                        })
                        .flatMap(result => {
                            // For containers, return each matching video as a separate result
                            if (result.analysis.isContainer && result.analysis.matchingFiles.length > 0) {
                                const extractedVideos = result.analysis.matchingFiles.map(video => ({
                                    ...result.torrent,
                                    name: video.name,
                                    size: video.size,
                                    info: {
                                        ...(result.torrent.info || {}),
                                        ...(video.info || {})
                                    },
                                    // Keep track that this is from a container and anime mapping was used
                                    containerName: result.torrent.name,
                                    isExtractedVideo: true,
                                    animeMapping: episodeMapping,
                                    videos: [video]
                                }));
                                
                                return extractedVideos;
                            }
                            // For direct files, return as is with anime mapping info
                            return [{
                                ...result.torrent,
                                animeMapping: episodeMapping
                            }];
                        });
                    
                    if (animeMatches.length > 0) {
                        logger.info(`[coordinator] ✅ Optimized anime retry successful: Found ${animeMatches.length} results (no additional API calls needed)`);
                        
                        return {
                            results: animeMatches,
                            absoluteEpisode: absoluteEpisode,
                            animeMapping: episodeMapping, // Pass the complete mapping object instead of just true
                            mappedSeason: episodeMapping.mappedSeason,
                            mappedEpisode: episodeMapping.mappedEpisode
                        };
                    } else {
                        logger.info('[coordinator] ❌ Optimized anime retry failed: No results found with mapped season/episode');
                    }
                } else {
                    logger.info('[coordinator] No anime episode mapping found');
                }
            } else {
                logger.info('[coordinator] No anime seasons found for any country-prioritized title variation');
            }
        } catch (error) {
            logger.warn('[coordinator] Anime season check failed:', error);
        }
    }
    
    return {
        results: matches,
        absoluteEpisode: absoluteEpisode
    };
}
