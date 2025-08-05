/**
 * Jikan API client for anime season information
 * EXACT WORKING FUNCTIONS extracted from working addon advanced-search.js
 */

import { logger } from '../utils/logger.js';

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
        logger.debug(`[anime-search] Using cached data for: ${titleQuery}`);
        return cached.data;
    }

    try {
        logger.debug(`[anime-search] Fetching anime info for: ${titleQuery}`);
        
        // Fetch initial search results
        const searchUrl = `https://api.jikan.moe/v4/anime?q=${encodeURIComponent(titleQuery)}&limit=10`;
        const searchResponse = await fetch(searchUrl, {
            headers: { Accept: 'application/json' }
        });
        
        if (!searchResponse.ok) {
            logger.warn(`[anime-search] Search failed: ${searchResponse.status}`);
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
            logger.debug(`[anime-search] No matching anime found for: ${titleQuery}`);
            return [];
        }
        
        // Get unique MAL IDs
        const malIds = [...new Set(entries.map(entry => entry.mal_id))];
        logger.debug(`[anime-search] Found ${malIds.length} unique anime entries`);
        
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
                    logger.debug(`[anime-search] Rate limiting: waiting ${waitTime}ms before next request`);
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                }
                
                lastRequestTime = Date.now();
                logger.debug(`[anime-search] Fetching details for MAL ID ${malId} (${i + 1}/${malIds.length})`);
                
                const detailUrl = `https://api.jikan.moe/v4/anime/${malId}`;
                const detailResponse = await fetch(detailUrl, {
                    headers: { Accept: 'application/json' }
                });
                
                if (!detailResponse.ok) {
                    if (detailResponse.status === 429) {
                        logger.warn(`[anime-search] ⚠️  Rate limited (HTTP 429) for MAL ID ${malId}, waiting 1 second and retrying...`);
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        
                        // Retry once after rate limit
                        const retryResponse = await fetch(detailUrl, {
                            headers: { Accept: 'application/json' }
                        });
                        
                        if (!retryResponse.ok) {
                            logger.warn(`[anime-search] Retry failed for MAL ID ${malId}: HTTP ${retryResponse.status}`);
                            continue;
                        }
                        
                        const retryData = await retryResponse.json();
                        const anime = retryData.data;
                        
                        if (!anime) {
                            logger.warn(`[anime-search] No data found for MAL ID ${malId} after retry`);
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
                        logger.debug(`[anime-search] ✅ Successfully fetched details for MAL ID ${malId} after retry: ${anime.title} (${anime.episodes} episodes)`);
                        continue;
                    } else {
                        logger.warn(`[anime-search] Failed to fetch details for MAL ID ${malId}: HTTP ${detailResponse.status}`);
                        continue;
                    }
                }
                
                const detailData = await detailResponse.json();
                const anime = detailData.data;
                
                if (!anime) {
                    logger.warn(`[anime-search] No data found for MAL ID ${malId}`);
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
                logger.debug(`[anime-search] ✅ Successfully fetched details for MAL ID ${malId}: ${anime.title} (${anime.episodes} episodes)`);
                
            } catch (error) {
                logger.warn(`[anime-search] Error fetching details for MAL ID ${malId}:`, error.message);
                // Continue to next MAL ID instead of failing completely
                continue;
            }
        }
        
        logger.debug(`[anime-search] Successfully fetched ${successfulFetches}/${malIds.length} anime details`);
        
        if (animeList.length === 0) {
            logger.warn(`[anime-search] No anime details could be fetched for any MAL ID`);
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
                    logger.debug(`[anime-search] Detected "${anime.title}" as continuation of previous season, assigning S${actualSeasonNumber.toString().padStart(2, '0')}`);
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
        
        logger.info(`[anime-search] ✅ Found ${result.length} anime seasons for "${titleQuery}":`, 
            result.map(r => `${r.season_number} (${r.episodes} eps) - ${r.title}`));
        
        // Cache the result to avoid repeated API calls
        animeSeasonCache.set(cacheKey, {
            data: result,
            timestamp: Date.now()
        });
        
        return result;
        
    } catch (error) {
        logger.warn('[anime-search] Failed to fetch anime season info:', error);
        return [];
    }
}

/**
 * Get queue status for monitoring
 * @returns {object}
 */
export function getRateLimiterStatus() {
    return {
        cacheSize: animeSeasonCache.size,
        cacheKeys: Array.from(animeSeasonCache.keys())
    };
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
    
    logger.debug(`[anime-mapping] Mapping S${targetSeason}E${targetEpisode} across ${mainSeasons.length} seasons`);
    
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
        logger.info(`[anime-mapping] ❌ No mapping needed: S${targetSeason}E${targetEpisode} exists in requested season (${requestedSeasonData.episodes} episodes available)`);
        return null;
    }
    
    // Only proceed with mapping if the episode exceeds the capacity of the requested season
    if (requestedSeasonData) {
        logger.info(`[anime-mapping] ✅ Episode ${targetEpisode} exceeds S${targetSeason} capacity (${requestedSeasonData.episodes} episodes), attempting cross-season mapping`);
    } else {
        logger.info(`[anime-mapping] ✅ S${targetSeason} not found in anime data, attempting cross-season mapping for episode ${targetEpisode}`);
    }
    
    let cumulativeEpisodes = 0;
    
    for (const season of combinedSeasons) {
        const seasonStart = cumulativeEpisodes + 1;
        const seasonEnd = cumulativeEpisodes + season.episodes;
        
        logger.info(`[anime-mapping] ${season.season_number}: Episodes ${seasonStart}-${seasonEnd} (${season.episodes} total)`);
        
        if (targetEpisode >= seasonStart && targetEpisode <= seasonEnd) {
            const mappedEpisode = targetEpisode - cumulativeEpisodes;
            const mappedSeason = parseInt(season.season_number.replace('S', ''));
            
            logger.info(`[anime-mapping] ✅ SUCCESS: Mapped S${targetSeason}E${targetEpisode} → S${mappedSeason}E${mappedEpisode}`);
            
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
    
    logger.debug(`[anime-mapping] ❌ Episode ${targetEpisode} not found in any season (total episodes: ${cumulativeEpisodes})`);
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
        logger.debug(`[advanced-search] No alternative titles available for ${contentType} search`);
        return titleVariations;
    }
    
    logger.debug(`[advanced-search] Selecting ${contentType} titles from ${alternativeTitlesWithCountry.length} alternatives using anime-specific prioritization`);
    
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
            logger.debug(`[advanced-search] Added ${countryCode} ${label}: "${title}"`);
            return true;
        }
        return false;
    };
    
    // Anime-specific prioritization: 1st JP → 1st US → 2nd JP → 2nd US → 1st FR → other countries
    const jpTitles = getTitlesForCountry('JP');
    const usTitles = getTitlesForCountry('US');
    const frTitles = getTitlesForCountry('FR');
    
    logger.debug(`[advanced-search] Available titles by country - JP: ${jpTitles.length}, US: ${usTitles.length}, FR: ${frTitles.length}`);
    
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
