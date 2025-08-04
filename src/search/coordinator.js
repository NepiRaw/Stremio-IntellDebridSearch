/**
 * Search Coordinator - Main advancedSearch function properly refactored
 * This is the EXACT working advancedSearch function but using modular APIs
 * 
 * Key process (copied exactly from working addon):
 * 1. Get alternative titles from TMDb using api/tmdb.js
 * 2. Fetch ALL torrents from the selected provider (bulk fetch)
 * 3. Pre-filter by keyword inclusion  
 * 4. Use Fuse.js for fuzzy matching
 * 5. Deep content analysis for season/episode matching
 */

import { logger } from '../utils/logger.js';
import { fetchTMDbAlternativeTitles } from '../api/tmdb.js';
import { extractKeywords } from '../search/keyword-extractor.js';
import { getEpisodeMapping } from '../search/episode-mapper.js';
import { analyzeTorrent } from '../search/torrent-analyzer.js';
import { sortMovieStreamsByQuality, deduplicateStreams } from '../stream/quality-processor.js';
import { toStream, filterSeason, filterEpisode, filterYear } from '../stream/stream-builder.js';
import Fuse from 'fuse.js';
import parseTorrentTitleModule from '../utils/parse-torrent-title.js';
import { FILE_TYPES } from '../utils/file-types.js';

// Extract functions from the module
const { parse: parseTorrentTitle } = parseTorrentTitleModule;

// Simple in-memory cache for anime season info to avoid repeated API calls
const animeSeasonCache = new Map();
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

/**
 * Fetch anime season information from MyAnimeList via Jikan API
 * @param {string} titleQuery - The anime title to search for
 * @returns {Promise<Array>} - Array of anime seasons with episode counts and season numbers
 */
export async function fetchAnimeSeasonInfo(titleQuery) {
    if (!titleQuery || typeof titleQuery !== 'string') {
        return [];
    }

    // Check cache first
    const cacheKey = titleQuery.toLowerCase().trim();
    const cached = animeSeasonCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < CACHE_DURATION) {
        console.log(`[anime-search] Using cached data for: ${titleQuery}`);
        return cached.data;
    }

    try {
        console.log(`[anime-search] Fetching anime info for: ${titleQuery}`);
        
        // Fetch initial search results
        const searchUrl = `https://api.jikan.moe/v4/anime?q=${encodeURIComponent(titleQuery)}&limit=10`;
        const searchResponse = await fetch(searchUrl, {
            headers: { Accept: 'application/json' }
        });
        
        if (!searchResponse.ok) {
            console.warn(`[anime-search] Search failed: ${searchResponse.status}`);
            return [];
        }
        
        const searchData = await searchResponse.json();
        
        // Select relevant entries (TV + Special)
        const entries = searchData.data?.filter(entry => {
            return ['TV', 'Special'].includes(entry.type) &&
                   entry.titles?.some(title => 
                       title.title.toLowerCase().includes(titleQuery.toLowerCase())
                   );
        }) || [];
        
        if (entries.length === 0) {
            console.log(`[anime-search] No matching anime found for: ${titleQuery}`);
            return [];
        }
        
        // Get unique MAL IDs
        const malIds = [...new Set(entries.map(entry => entry.mal_id))];
        console.log(`[anime-search] Found ${malIds.length} unique anime entries`);
        
        // Fetch detailed info for each MAL ID with proper rate limiting
        const animeList = [];
        let successfulFetches = 0;
        let lastRequestTime = 0;
        
        // Rate limiting: Max 3 requests per second (1000ms / 3 = 334ms minimum between requests)
        const MIN_REQUEST_INTERVAL = 334; // milliseconds
        
        for (let i = 0; i < malIds.length; i++) {
            const malId = malIds[i];
            
            try {
                // Ensure proper rate limiting - wait at least 334ms between requests
                const now = Date.now();
                const timeSinceLastRequest = now - lastRequestTime;
                
                if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
                    const waitTime = MIN_REQUEST_INTERVAL - timeSinceLastRequest;
                    console.log(`[anime-search] Rate limiting: waiting ${waitTime}ms before next request`);
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                }
                
                lastRequestTime = Date.now();
                console.log(`[anime-search] Fetching details for MAL ID ${malId} (${i + 1}/${malIds.length})`);
                
                const detailUrl = `https://api.jikan.moe/v4/anime/${malId}`;
                const detailResponse = await fetch(detailUrl, {
                    headers: { Accept: 'application/json' }
                });
                
                if (!detailResponse.ok) {
                    if (detailResponse.status === 429) {
                        console.warn(`[anime-search] ⚠️  Rate limited (HTTP 429) for MAL ID ${malId}, waiting 1 second and retrying...`);
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        
                        // Retry once after rate limit
                        const retryResponse = await fetch(detailUrl, {
                            headers: { Accept: 'application/json' }
                        });
                        
                        if (!retryResponse.ok) {
                            console.warn(`[anime-search] Retry failed for MAL ID ${malId}: HTTP ${retryResponse.status}`);
                            continue;
                        }
                        
                        const retryData = await retryResponse.json();
                        const anime = retryData.data;
                        
                        if (!anime) {
                            console.warn(`[anime-search] No data found for MAL ID ${malId} after retry`);
                            continue;
                        }
                        
                        // Parse aired date
                        const dateObj = anime.aired?.prop?.from;
                        let airedFrom = null;
                        if (dateObj?.year && dateObj?.month && dateObj?.day) {
                            const month = dateObj.month.toString().padStart(2, '0');
                            const day = dateObj.day.toString().padStart(2, '0');
                            airedFrom = `${dateObj.year}-${month}-${day}`;
                        }
                        
                        animeList.push({
                            mal_id: malId,
                            title: anime.title,
                            type: anime.type,
                            aired_from: airedFrom,
                            year: anime.year,
                            season: anime.season,
                            episodes: anime.episodes || 0
                        });
                        
                        successfulFetches++;
                        console.log(`[anime-search] ✅ Successfully fetched details for MAL ID ${malId} after retry: ${anime.title} (${anime.episodes} episodes)`);
                        continue;
                    } else {
                        console.warn(`[anime-search] Failed to fetch details for MAL ID ${malId}: HTTP ${detailResponse.status}`);
                        continue;
                    }
                }
                
                const detailData = await detailResponse.json();
                const anime = detailData.data;
                
                if (!anime) {
                    console.warn(`[anime-search] No data found for MAL ID ${malId}`);
                    continue;
                }
                
                // Parse aired date
                const dateObj = anime.aired?.prop?.from;
                let airedFrom = null;
                if (dateObj?.year && dateObj?.month && dateObj?.day) {
                    const month = dateObj.month.toString().padStart(2, '0');
                    const day = dateObj.day.toString().padStart(2, '0');
                    airedFrom = `${dateObj.year}-${month}-${day}`;
                }
                
                animeList.push({
                    mal_id: malId,
                    title: anime.title,
                    type: anime.type,
                    aired_from: airedFrom,
                    year: anime.year,
                    season: anime.season,
                    episodes: anime.episodes || 0
                });
                
                successfulFetches++;
                console.log(`[anime-search] ✅ Successfully fetched details for MAL ID ${malId}: ${anime.title} (${anime.episodes} episodes)`);
                
            } catch (error) {
                console.warn(`[anime-search] Error fetching details for MAL ID ${malId}:`, error.message);
                // Continue to next MAL ID instead of failing completely
                continue;
            }
        }
        
        console.log(`[anime-search] Successfully fetched ${successfulFetches}/${malIds.length} anime details`);
        
        if (animeList.length === 0) {
            console.warn(`[anime-search] No anime details could be fetched for any MAL ID`);
            return [];
        }
        
        // Sort by air date and assign season numbers intelligently
        const sorted = animeList
            .filter(anime => anime.aired_from)
            .sort((a, b) => new Date(a.aired_from) - new Date(b.aired_from));

        let seasonIndex = 1;
        const result = sorted.map((anime, index) => {
            if (anime.type === 'Special') {
                return {
                    ...anime,
                    season_number: 'S00'
                };
            }
            
            // Detect if this is a part/continuation of the previous season
            let actualSeasonNumber = seasonIndex;
            
            if (index > 0) {
                const currentTitle = anime.title.toLowerCase();
                const previousAnime = sorted[index - 1];
                const previousTitle = previousAnime.title.toLowerCase();
                
                // Check if this is a "Part 2", "Part II", "Cour 2", etc. of the same season
                const isPartContinuation = (
                    (currentTitle.includes('part 2') || currentTitle.includes('part ii') || 
                     currentTitle.includes('cour 2') || currentTitle.includes('cours 2') ||
                     currentTitle.includes('season part 2')) &&
                    previousTitle.includes('season') && currentTitle.includes('season') &&
                    // Check if they share the same season number pattern (e.g., "2nd season")
                    (currentTitle.match(/(\d+)(?:st|nd|rd|th)\s*season/) || [])[1] === 
                    (previousTitle.match(/(\d+)(?:st|nd|rd|th)\s*season/) || [])[1]
                );
                
                if (isPartContinuation && previousAnime.type !== 'Special') {
                    // Use the same season number as the previous anime
                    actualSeasonNumber = seasonIndex - 1;
                    console.log(`[anime-search] Detected "${anime.title}" as continuation of previous season, assigning S${actualSeasonNumber.toString().padStart(2, '0')}`);
                } else {
                    seasonIndex++;
                    actualSeasonNumber = seasonIndex - 1;
                }
            } else {
                seasonIndex++;
                actualSeasonNumber = seasonIndex - 1;
            }
            
            return {
                ...anime,
                season_number: `S${actualSeasonNumber.toString().padStart(2, '0')}`
            };
        });
        
        console.log(`[anime-search] Found ${result.length} anime seasons:`, 
            result.map(r => `${r.season_number} (${r.episodes} eps) - ${r.title}`));
        
        // Cache the result to avoid repeated API calls
        animeSeasonCache.set(cacheKey, {
            data: result,
            timestamp: Date.now()
        });
        
        return result;
        
    } catch (error) {
        console.warn('[anime-search] Failed to fetch anime season info:', error);
        return [];
    }
}

/**
 * Map Stremio episode number to correct anime season and episode
 * @param {Array} animeSeasons - Array of anime season info from fetchAnimeSeasonInfo
 * @param {number} targetSeason - Original season from Stremio (usually 1)
 * @param {number} targetEpisode - Original episode from Stremio
 * @returns {Object|null} - Mapped season and episode info or null
 */
export function mapAnimeEpisode(animeSeasons, targetSeason, targetEpisode) {
    if (!animeSeasons?.length || !targetEpisode) {
        return null;
    }
    
    // Filter out specials for episode counting
    const mainSeasons = animeSeasons.filter(season => season.type === 'TV' && season.episodes > 0);
    
    if (mainSeasons.length === 0) {
        return null;
    }
    
    console.log(`[anime-mapping] Mapping S${targetSeason}E${targetEpisode} across ${mainSeasons.length} seasons`);
    
    // Group seasons by season_number and combine episode counts for parts/cours
    const seasonGroups = new Map();
    
    for (const season of mainSeasons) {
        const seasonNum = season.season_number;
        if (seasonGroups.has(seasonNum)) {
            // Combine episodes for season parts (e.g., Season 2 + Season 2 Part 2)
            const existing = seasonGroups.get(seasonNum);
            existing.episodes += season.episodes;
            existing.titles.push(season.title);
        } else {
            seasonGroups.set(seasonNum, {
                season_number: seasonNum,
                episodes: season.episodes,
                titles: [season.title],
                type: season.type,
                aired_from: season.aired_from
            });
        }
    }
    
    // Convert back to array and sort by season number
    const combinedSeasons = Array.from(seasonGroups.values()).sort((a, b) => {
        const aNum = parseInt(a.season_number.replace('S', ''));
        const bNum = parseInt(b.season_number.replace('S', ''));
        return aNum - bNum;
    });
    
    // IMPORTANT: Check if the requested season exists and has enough episodes
    // Only map to a different season if the episode number exceeds what's available
    const requestedSeasonNum = `S${targetSeason.toString().padStart(2, '0')}`;
    const requestedSeasonData = combinedSeasons.find(s => s.season_number === requestedSeasonNum);
    
    if (requestedSeasonData && targetEpisode <= requestedSeasonData.episodes) {
        console.log(`[anime-mapping] ❌ No mapping needed: S${targetSeason}E${targetEpisode} exists in requested season (${requestedSeasonData.episodes} episodes available)`);
        return null;
    }
    
    // Only proceed with mapping if the episode exceeds the capacity of the requested season
    if (requestedSeasonData) {
        console.log(`[anime-mapping] Episode ${targetEpisode} exceeds S${targetSeason} capacity (${requestedSeasonData.episodes} episodes), attempting cross-season mapping`);
    } else {
        console.log(`[anime-mapping] S${targetSeason} not found in anime data, attempting cross-season mapping for episode ${targetEpisode}`);
    }
    
    let cumulativeEpisodes = 0;
    
    for (const season of combinedSeasons) {
        const seasonStart = cumulativeEpisodes + 1;
        const seasonEnd = cumulativeEpisodes + season.episodes;
        
        console.log(`[anime-mapping] ${season.season_number}: Episodes ${seasonStart}-${seasonEnd} (${season.episodes} total)`);
        
        if (targetEpisode >= seasonStart && targetEpisode <= seasonEnd) {
            const mappedEpisode = targetEpisode - cumulativeEpisodes;
            const mappedSeason = parseInt(season.season_number.replace('S', ''));
            
            console.log(`[anime-mapping] ✅ Mapped S${targetSeason}E${targetEpisode} → S${mappedSeason}E${mappedEpisode}`);
            
            return {
                originalSeason: targetSeason,
                originalEpisode: targetEpisode,
                mappedSeason: mappedSeason,
                mappedEpisode: mappedEpisode,
                animeTitle: season.titles.join(' + '),
                seasonInfo: season
            };
        }
        
        cumulativeEpisodes += season.episodes;
    }
    
    console.log(`[anime-mapping] ❌ Episode ${targetEpisode} not found in any season (total episodes: ${cumulativeEpisodes})`);
    return null;
}

/**
 * Select the best title variations for anime search based on country priority
 * @param {string} originalTitle - Original search title
 * @param {Array} alternativeTitlesWithCountry - Alternative titles with country info from TMDb
 * @param {string} contentType - 'anime' or 'series' to determine country priorities
 * @returns {Array<string>} - Prioritized list of title variations for search
 */
export function selectTitleVariationsForAnime(originalTitle, alternativeTitlesWithCountry, contentType = 'anime') {
    const titleVariations = [];
    
    // 1. Always include the original title first
    titleVariations.push(originalTitle);
    
    if (!alternativeTitlesWithCountry || alternativeTitlesWithCountry.length === 0) {
        console.log(`[advanced-search] No alternative titles available for ${contentType} search`);
        return titleVariations;
    }
    
    console.log(`[advanced-search] Selecting ${contentType} titles from ${alternativeTitlesWithCountry.length} alternatives using anime-specific prioritization`);
    
    const addedTitles = new Set([originalTitle.toLowerCase()]);
    
    // Helper function to get titles for a country in their original TMDb order
    const getTitlesForCountry = (countryCode) => {
        return alternativeTitlesWithCountry
            .filter(alt => alt.country === countryCode);
    };
    
    // Helper function to add a title if it's unique and valid
    const addTitle = (title, countryCode, label) => {
        const normalizedForComparison = title.toLowerCase();
        if (!addedTitles.has(normalizedForComparison) && title.length > 2) {
            titleVariations.push(title);
            addedTitles.add(normalizedForComparison);
            console.log(`[advanced-search] Added ${countryCode} ${label}: "${title}"`);
            return true;
        }
        return false;
    };
    
    // Anime-specific prioritization: 1st JP → 1st US → 2nd JP → 2nd US → 1st FR → other countries
    const jpTitles = getTitlesForCountry('JP');
    const usTitles = getTitlesForCountry('US');
    const frTitles = getTitlesForCountry('FR');
    
    console.log(`[advanced-search] Available titles by country - JP: ${jpTitles.length}, US: ${usTitles.length}, FR: ${frTitles.length}`);
    
    let jpIndex = 0;
    let usIndex = 0;
    let frIndex = 0;
    
    const maxTotalTitles = 8;
    
    // 1st JP title
    if (jpIndex < jpTitles.length && titleVariations.length < maxTotalTitles) {
        addTitle(jpTitles[jpIndex].title, 'JP', `title #${jpIndex + 1} (priority)`);
        jpIndex++;
    }
    
    // 1st US title
    if (usIndex < usTitles.length && titleVariations.length < maxTotalTitles) {
        addTitle(usTitles[usIndex].title, 'US', `title #${usIndex + 1} (priority)`);
        usIndex++;
    }
    
    // 2nd JP title
    if (jpIndex < jpTitles.length && titleVariations.length < maxTotalTitles) {
        addTitle(jpTitles[jpIndex].title, 'JP', `title #${jpIndex + 1} (priority)`);
        jpIndex++;
    }
    
    // 2nd US title
    if (usIndex < usTitles.length && titleVariations.length < maxTotalTitles) {
        addTitle(usTitles[usIndex].title, 'US', `title #${usIndex + 1} (priority)`);
        usIndex++;
    }
    
    // 1st French title
    if (frIndex < frTitles.length && titleVariations.length < maxTotalTitles) {
        addTitle(frTitles[frIndex].title, 'FR', `title #${frIndex + 1} (priority)`);
        frIndex++;
    }
    
    // Fill remaining slots with first title from other priority countries
    const otherCountries = ['GB', 'DE', 'ES', 'IT', 'KR', 'CN', 'TW', 'XX'];
    for (const countryCode of otherCountries) {
        if (titleVariations.length >= maxTotalTitles) break;
        
        const countryTitles = getTitlesForCountry(countryCode);
        if (countryTitles.length > 0) {
            addTitle(countryTitles[0].title, countryCode, 'first title');
        }
    }
    
    // If we still have slots, add remaining JP and US titles
    while (titleVariations.length < maxTotalTitles && (jpIndex < jpTitles.length || usIndex < usTitles.length)) {
        if (jpIndex < jpTitles.length) {
            titleVariations.push(jpTitles[jpIndex++]);
        }
        if (titleVariations.length < maxTotalTitles && usIndex < usTitles.length) {
            titleVariations.push(usTitles[usIndex++]);
        }
    }

    return titleVariations;
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
                info: parseTorrentTitle(item.filename),
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
                info: parseTorrentTitle(item.name),
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
                info: parseTorrentTitle(item.filename),
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
                info: parseTorrentTitle(item.name),
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
                info: parseTorrentTitle(item.name),
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
        return [];
    }

    logger.info(`[coordinator] Phase 1 complete: ${titleMatches.length} matches out of ${allRawResults.length} total results`);
    
    // For movies or when no episode info needed, return Phase 1 results
    if (type === 'movie' || (!season && !episode)) {
        logger.info('[coordinator] Movie or no episode filtering needed, returning Phase 1 results');
        
        return {
            results: titleMatches.map(m => m.item),
            absoluteEpisode: null
        };
    }

    // ========== PHASE 2: DEEP CONTENT ANALYSIS ==========
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
    const matches = analyzedResults
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
        
    logger.info(`[coordinator] Phase 2 complete: ${matches.length} matching episodes found`);
    logger.info(`[coordinator] Performance summary: ${allRawResults.length} total → ${titleMatches.length} title matches → ${matches.length} final results`);
    
    return {
        results: matches,
        absoluteEpisode: absoluteEpisode
    };
}
