/**
 * Enhanced Jikan API client with UnifiedCacheManager integration
 * Rate limited API with enterprise-grade caching and cleanup redundancy
 */

import { logger } from '../utils/logger.js';
import cache from '../utils/cache-manager.js'; // UnifiedCacheManager instance
import { errorManager } from '../utils/error-handler.js';

/**
 * Rate Limiter for Jikan API (3 requests/second max)
 */
class JikanRateLimiter {
    constructor() {
        this.lastRequestTime = 0;
        this.minInterval = 334; // 1000ms / 3 requests = 334ms minimum
        this.retryDelay = 600; // Retry delay for rate limits (ms)
    }

    async waitForNextRequest() {
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        
        if (timeSinceLastRequest < this.minInterval) {
            const waitTime = this.minInterval - timeSinceLastRequest;
            logger.debug(`[jikan-rate-limiter] Waiting ${waitTime}ms before next request`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
        
        this.lastRequestTime = Date.now();
    }

    async handleRateLimit(retryFunction) {
        logger.warn(`[jikan-rate-limiter] ⚠️ Rate limited (HTTP 429), waiting ${this.retryDelay}ms and retrying...`);
        await new Promise(resolve => setTimeout(resolve, this.retryDelay));
        return await retryFunction();
    }

    getStats() {
        return {
            minInterval: this.minInterval,
            retryDelay: this.retryDelay,
            lastRequestTime: this.lastRequestTime
        };
    }
}

const rateLimiter = new JikanRateLimiter();

/**
 * Helper function to parse anime aired dates
 */
function parseAnimeAiredDate(anime) {
    const dateObj = anime.aired?.prop?.from;
    if (!dateObj?.year || !dateObj?.month || !dateObj?.day) {
        return null;
    }
    
    const month = dateObj.month.toString().padStart(2, '0');
    const day = dateObj.day.toString().padStart(2, '0');
    return `${dateObj.year}-${month}-${day}`;
}

/**
 * Fetch wrapper with unified error handling
 */
async function fetchJikanData(url, description = 'anime data') {
    await rateLimiter.waitForNextRequest();
    
    try {
        logger.debug(`[jikan-api] Fetching ${description} from: ${url}`);
        
        const response = await fetch(url, {
            headers: { Accept: 'application/json' }
        });
        
        if (!response.ok) {
            if (response.status === 429) {
                // Rate limit retry - delegate to rate limiter
                return await rateLimiter.handleRateLimit(async () => {
                    const retryResponse = await fetch(url, {
                        headers: { Accept: 'application/json' }
                    });
                    
                    if (!retryResponse.ok) {
                        throw new Error(`Retry failed: HTTP ${retryResponse.status}`);
                    }
                    
                    return await retryResponse.json();
                });
            } else {
                throw new Error(`HTTP ${response.status}`);
            }
        }
        
        return await response.json();
    } catch (error) {
        logger.warn(`[jikan-api] Failed to fetch ${description}:`, error.message);
        throw error;
    }
}

/**
 * Enhanced fetchAnimeSeasonInfo with UnifiedCacheManager integration
 * 24-hour cache TTL with automatic cleanup
 */
export async function fetchAnimeSeasonInfo(titleQuery) {
    if (!titleQuery || typeof titleQuery !== 'string') {
        return [];
    }

    // Use UnifiedCacheManager with 24-hour TTL (86400 seconds)
    const cacheKey = `jikan:anime_season:${titleQuery.toLowerCase().trim()}`;
    
    // Check UnifiedCacheManager first
    const cached = cache.get(cacheKey);
    if (cached) {
        logger.debug(`[jikan-api] 💾 Cache:HIT for anime season: ${titleQuery}`);
        return cached;
    }
    
    logger.debug(`[jikan-api] 🔍 Cache:MISS - fetching anime season info for: ${titleQuery}`);

    try {
        // Phase 1: Search for anime
        const searchUrl = `https://api.jikan.moe/v4/anime?q=${encodeURIComponent(titleQuery)}&limit=10`;
        const searchData = await fetchJikanData(searchUrl, `anime search for "${titleQuery}"`);
        
        // Filter relevant entries (TV + Special)
        const entries = searchData.data?.filter(entry => {
            return ['TV', 'Special'].includes(entry.type) &&
                   entry.titles?.some(title => 
                       title.title.toLowerCase().includes(titleQuery.toLowerCase())
                   );
        }) || [];
        
        if (entries.length === 0) {
            logger.debug(`[jikan-api] No matching anime found for: ${titleQuery}`);
            
            // Cache empty result for 24 hours to avoid repeated API calls
            cache.set(cacheKey, [], 86400, { 
                type: 'anime_season',
                query: titleQuery,
                resultCount: 0 
            });
            return [];
        }
        
        // Phase 2: Fetch detailed info for each unique MAL ID
        const malIds = [...new Set(entries.map(entry => entry.mal_id))];
        logger.debug(`[jikan-api] Found ${malIds.length} unique anime entries`);
        
        const animeList = [];
        let successfulFetches = 0;
        
        for (let i = 0; i < malIds.length; i++) {
            const malId = malIds[i];
            
            try {
                const detailUrl = `https://api.jikan.moe/v4/anime/${malId}`;
                const detailData = await fetchJikanData(detailUrl, `details for MAL ID ${malId} (${i + 1}/${malIds.length})`);
                
                const anime = detailData.data;
                if (!anime) {
                    logger.warn(`[jikan-api] No data found for MAL ID ${malId}`);
                    continue;
                }
                
                // Use helper function to parse aired date (eliminates duplication)
                const airedFrom = parseAnimeAiredDate(anime);
                
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
                logger.debug(`[jikan-api] ✅ Successfully fetched details for MAL ID ${malId}: ${anime.title} (${anime.episodes} episodes)`);
                
            } catch (error) {
                logger.warn(`[jikan-api] Error fetching details for MAL ID ${malId}:`, error.message);
                continue;
            }
        }
        
        logger.debug(`[jikan-api] Successfully fetched ${successfulFetches}/${malIds.length} anime details`);
        
        if (animeList.length === 0) {
            logger.warn(`[jikan-api] No anime details could be fetched for any MAL ID`);
            
            // Cache empty result to avoid repeated failures
            cache.set(cacheKey, [], 86400, { 
                type: 'anime_season',
                query: titleQuery,
                resultCount: 0,
                fetchAttempts: malIds.length,
                successfulFetches: 0
            });
            return [];
        }
        
        // Phase 3: Sort and assign season numbers intelligently
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

                // Treats 'Part 2', 'Part II', 'Cour 2', etc. as continuation of previous season
                const isPartContinuation = (
                    (currentTitle.includes('part 2') || currentTitle.includes('part ii') ||
                     currentTitle.includes('cour 2') || currentTitle.includes('cours 2') ||
                     currentTitle.includes('season part 2')) &&
                    previousAnime.type !== 'Special' &&
                    (currentTitle.replace(/part 2|part ii|cour 2|cours 2|season part 2/g, '').trim() === previousTitle.replace(/season \d+|part 1|part i|cour 1|cours 1/g, '').trim() ||
                     currentTitle.includes(previousTitle.split(' ')[0]))
                );

                if (isPartContinuation) {
                    actualSeasonNumber = seasonIndex - 1;
                    logger.debug(`[jikan-api] Detected "${anime.title}" as continuation of previous season, assigning S${actualSeasonNumber.toString().padStart(2, '0')}`);
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
        
        logger.info(`[jikan-api] ✅ Found ${result.length} anime seasons for "${titleQuery}":`, 
            result.map(r => `${r.season_number} (${r.episodes} eps) - ${r.title}`));
        
        // Cache successful result with UnifiedCacheManager (24-hour TTL)
        cache.set(cacheKey, result, 86400, {
            type: 'anime_season',
            query: titleQuery,
            resultCount: result.length,
            fetchAttempts: malIds.length,
            successfulFetches: successfulFetches,
            rateLimiterStats: rateLimiter.getStats()
        });
        
        return result;
        
    } catch (error) {
        // Use ErrorManager for consistent error handling
        errorManager.processError(error, 'jikan:fetch_anime_season', [titleQuery]);
        return [];
    }
}

/**
 * Enhanced diagnostics function with UnifiedCacheManager integration
 */
export function getRateLimiterStatus() {
    const cacheStats = cache.getStats();
    const jikanCacheEntries = cache.getByPattern('jikan:.*');
    
    return {
        rateLimiter: rateLimiter.getStats(),
        cache: {
            totalStats: cacheStats,
            jikanEntries: jikanCacheEntries.length,
            jikanKeys: jikanCacheEntries.map(entry => entry.key)
        }
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

    const combinedSeasons = Array.from(seasonGroups.values()).sort((a, b) => {
        const aNum = parseInt(a.season_number.replace('S', ''));
        const bNum = parseInt(b.season_number.replace('S', ''));
        return aNum - bNum;
    });
    
    // Check if the requested season exists and has enough episodes
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
    
    titleVariations.push(originalTitle);
    
    if (!alternativeTitlesWithCountry || alternativeTitlesWithCountry.length === 0) {
        logger.debug(`[AnimeTitleVariation] No alternative titles available for ${contentType} search`);
        return titleVariations;
    }
    
    logger.debug(`[AnimeTitleVariation] Selecting ${contentType} titles from ${alternativeTitlesWithCountry.length} alternatives using anime-specific prioritization`);
    
    const addedTitles = new Set([originalTitle.toLowerCase()]);
    
    const getTitlesForCountry = (countryCode) => {
        return alternativeTitlesWithCountry
            .filter(alt => alt.country === countryCode);
    };
    
    const addTitle = (title, countryCode, label) => {
        const normalizedForComparison = title.toLowerCase();
        if (!addedTitles.has(normalizedForComparison) && title.length > 2) {
            titleVariations.push(title);
            addedTitles.add(normalizedForComparison);
            logger.debug(`[AnimeTitleVariation] Added ${countryCode} ${label}: "${title}"`);
            return true;
        }
        return false;
    };
    
    // Anime-specific prioritization: 1st JP → 1st US → 2nd JP → 2nd US → 1st FR → other countries
    const jpTitles = getTitlesForCountry('JP');
    const usTitles = getTitlesForCountry('US');
    const frTitles = getTitlesForCountry('FR');
    
    logger.debug(`[AnimeTitleVariation] Available titles by country - JP: ${jpTitles.length}, US: ${usTitles.length}, FR: ${frTitles.length}`);
    
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