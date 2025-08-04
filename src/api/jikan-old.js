/**
 * Jikan API client with rate limiting
 * Controls Jikan API requests with built-in rate limiting (1 req/sec)
 * Respects Jikan's rate limits while providing anime-specific data
 */

// Rate limiting queue for Jikan API (1 request per second)
class JikanRateLimiter {
    constructor() {
        this.queue = [];
        this.processing = false;
        this.lastRequest = 0;
        this.minInterval = 1000; // 1 second between requests
    }

    async request(url) {
        return new Promise((resolve, reject) => {
            this.queue.push({ url, resolve, reject });
            this.processQueue();
        });
    }

    async processQueue() {
        if (this.processing || this.queue.length === 0) {
            return;
        }

        this.processing = true;

        while (this.queue.length > 0) {
            const now = Date.now();
            const timeSinceLastRequest = now - this.lastRequest;
            
            if (timeSinceLastRequest < this.minInterval) {
                const waitTime = this.minInterval - timeSinceLastRequest;
                logger.info(`[jikan-api] Rate limiting: waiting ${waitTime}ms`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }

            const { url, resolve, reject } = this.queue.shift();
            
            try {
                logger.info(`[jikan-api] Making request to: ${url}`);
                const response = await fetch(url);
                this.lastRequest = Date.now();
                
                if (!response.ok) {
                    throw new Error(`Jikan API error: ${response.status} ${response.statusText}`);
                }
                
                const data = await response.json();
                resolve(data);
            } catch (err) {
                logger.error(`[jikan-api] Request failed for ${url}:`, err.message);
                reject(err);
            }
        }

        this.processing = false;
    }
}

// Global rate limiter instance
const rateLimiter = new JikanRateLimiter();

/**
 * Fetch anime season information from Jikan API with rate limiting
 * @param {string} titleQuery - Anime title to search for
 * @returns {Promise<object|null>} - Anime season information or null
 */
export async function fetchAnimeSeasonInfo(titleQuery) {
    if (!titleQuery || typeof titleQuery !== 'string') {
        logger.warn('[jikan-api] Invalid title query provided');
        return null;
    }

    try {
        // Clean and encode the search query
        const cleanQuery = titleQuery
            .trim()
            .replace(/[^\w\s-]/g, '') // Remove special characters except hyphens
            .replace(/\s+/g, ' '); // Normalize spaces

        if (!cleanQuery) {
            logger.warn('[jikan-api] Empty query after cleaning');
            return null;
        }

        // Search for anime
        const searchUrl = `https://api.jikan.moe/v4/anime?q=${encodeURIComponent(cleanQuery)}&limit=5&order_by=popularity&sort=desc`;
        
        const searchData = await rateLimiter.request(searchUrl);

        if (!searchData.data || searchData.data.length === 0) {
            logger.info(`[jikan-api] No anime found for query: "${titleQuery}"`);
            return null;
        }

        // Get the most relevant result (first one, sorted by popularity)
        const anime = searchData.data[0];
        logger.info(`[jikan-api] Found anime: ${anime.title} (${anime.title_english || 'no English title'})`);

        // Get detailed information if available
        let seasonInfo = {
            malId: anime.mal_id,
            title: anime.title,
            titleEnglish: anime.title_english,
            titleJapanese: anime.title_japanese,
            episodes: anime.episodes,
            status: anime.status,
            aired: anime.aired,
            season: anime.season,
            year: anime.year,
            type: anime.type,
            synonyms: anime.title_synonyms || [],
            genres: anime.genres ? anime.genres.map(g => g.name) : []
        };

        // If we have a mal_id, try to get more detailed season/episode info
        if (anime.mal_id) {
            try {
                const detailUrl = `https://api.jikan.moe/v4/anime/${anime.mal_id}/episodes`;
                const episodeData = await rateLimiter.request(detailUrl);
                
                if (episodeData.data && episodeData.data.length > 0) {
                    seasonInfo.episodeList = episodeData.data.map(ep => ({
                        number: ep.mal_id,
                        title: ep.title,
                        titleJapanese: ep.title_japanese,
                        titleRomanji: ep.title_romanji,
                        aired: ep.aired
                    }));
                    
                    logger.info(`[jikan-api] Found ${episodeData.data.length} episodes for ${anime.title}`);
                }
            } catch (episodeErr) {
                logger.warn(`[jikan-api] Failed to fetch episodes for ${anime.title}:`, episodeErr.message);
                // Continue without episode details
            }
        }

        return seasonInfo;

    } catch (err) {
        logger.error(`[jikan-api] Failed to fetch anime season info for "${titleQuery}":`, err.message);
        return null;
    }
}

/**
 * Search for anime by multiple title variations
 * @param {string[]} titleVariations - Array of title variations to search
 * @returns {Promise<object|null>} - Best matching anime or null
 */
export async function searchAnimeByVariations(titleVariations) {
    if (!Array.isArray(titleVariations) || titleVariations.length === 0) {
        logger.warn('[jikan-api] No title variations provided');
        return null;
    }

    let bestMatch = null;
    let bestScore = 0;

    for (const title of titleVariations) {
        try {
            const result = await fetchAnimeSeasonInfo(title);
            if (result) {
                // Simple scoring based on episode count and status
                let score = 1;
                if (result.episodes) score += Math.min(result.episodes / 50, 2); // Bonus for longer series
                if (result.status === 'Finished Airing') score += 1; // Bonus for completed series
                if (result.titleEnglish) score += 0.5; // Bonus for having English title
                
                if (score > bestScore) {
                    bestScore = score;
                    bestMatch = result;
                }
            }
        } catch (err) {
            logger.warn(`[jikan-api] Failed to search for variation "${title}":`, err.message);
            continue;
        }
    }

    if (bestMatch) {
        logger.info(`[jikan-api] Best match found: ${bestMatch.title} (score: ${bestScore})`);
    } else {
        logger.info('[jikan-api] No matches found for any title variation');
    }

    return bestMatch;
}

/**
 * Get queue status for monitoring
 * @returns {object}
 */
export function getRateLimiterStatus() {
    return {
        queueLength: rateLimiter.queue.length,
        processing: rateLimiter.processing,
        lastRequest: rateLimiter.lastRequest,
        timeSinceLastRequest: Date.now() - rateLimiter.lastRequest
    };
}
