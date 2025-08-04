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
 * Get queue status for monitoring
 * @returns {object}
 */
export function getRateLimiterStatus() {
    return {
        cacheSize: animeSeasonCache.size,
        cacheKeys: Array.from(animeSeasonCache.keys())
    };
}
