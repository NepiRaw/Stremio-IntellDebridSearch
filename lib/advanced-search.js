import { encode } from 'urlencode';
import parseTorrentTitleModule from './util/parse-torrent-title.js'
import Fuse from 'fuse.js';
import { isVideo } from './util/extension-util.js';
import { FILE_TYPES } from './util/file-types.js';
import { extractQualityInfo, TECHNICAL_PATTERNS } from './util/media-patterns.js';

// Extract functions from the module
const { parse: parseTorrentTitle, parseSeason, parseRomanNumeral, romanToNumber } = parseTorrentTitleModule;

export function extractKeywords(title) {
    if (!title || typeof title !== 'string') return '';
      return title
        .normalize("NFKC") // Unicode normalization
        .replace(/[^\p{L}\p{N}\s?!]/gu, " ") // Replace punctuation with spaces to preserve word boundaries
        .trim()
        .replace(/\s{2,}/g, " ") // Collapse multiple spaces
        .replace(/\b([IVXLCDM]+)\s([IVXLCDM]+)\b/g, "$1$2") // Join separate Roman numerals
        .split(/\s+/)
        .filter(word =>
            word.length > 1 ||
            word.toLowerCase() === "a" ||
            word === "I" ||
            /^[IVXLCDM\d]+$/.test(word) // Keep Roman numerals and numbers
        )        .slice(0, 15) // Limit to prevent overly long searches
        .join(" ");
}

/**
 * Fetch alternative titles for a movie or series using TMDb API.
 * Accepts either tmdbId or imdbId. If only imdbId is provided, fetch tmdbId first.
 * @param {string|null} tmdbId - The TMDb ID of the movie/series (optional if imdbId is provided).
 * @param {string} type - 'movie' or 'series'.
 * @param {string} tmdbApiKey - The TMDb API key.
 * @param {string|null} imdbId - The IMDb ID (optional, used if tmdbId is not provided).
 * @returns {Promise<string[]>} - List of normalized alternative titles.
 */
export async function fetchTMDbAlternativeTitles(tmdbId, type, tmdbApiKey, imdbId = null) {
    // Always use imdbId for TMDb lookup if present and tmdbId is not provided
    let resolvedTmdbId = tmdbId;
    
    if (!resolvedTmdbId && imdbId && tmdbApiKey) {
        const findUrl = `https://api.themoviedb.org/3/find/${imdbId}?api_key=${tmdbApiKey}&external_source=imdb_id`;
        try {
            const resp = await fetch(findUrl);
            const data = await resp.json();
            if (type === 'movie' && data.movie_results && data.movie_results.length) {
                resolvedTmdbId = data.movie_results[0].id;
            } else if (type === 'series' && data.tv_results && data.tv_results.length) {
                resolvedTmdbId = data.tv_results[0].id;
            }
        } catch (e) {
            console.warn('[advanced-search] TMDb ID lookup failed:', e);
            return [];
        }
    }
    
    if (!tmdbApiKey || !resolvedTmdbId) return [];
    
    const url = type === 'movie'
        ? `https://api.themoviedb.org/3/movie/${resolvedTmdbId}/alternative_titles?api_key=${tmdbApiKey}`
        : `https://api.themoviedb.org/3/tv/${resolvedTmdbId}/alternative_titles?api_key=${tmdbApiKey}`;
      try {
        const resp = await fetch(url);
        const data = await resp.json();
        if (!data.results) return [];
        
        // Extract titles with country information
        const titlesWithCountry = data.results
            .filter(t => t.title && t.title.trim()) // Filter out empty titles
            .map(t => ({
                title: t.title,
                country: t.iso_3166_1 || 'XX', // Use 'XX' for unknown countries
                normalizedTitle: extractKeywords(t.title)
            }))
            .filter(t => t.normalizedTitle.length > 0); // Remove titles that normalize to empty
        
        console.log(`[advanced-search] Found ${titlesWithCountry.length} alternative titles with countries:`, 
            titlesWithCountry.map(t => `"${t.title}" (${t.country})`));
        
        return titlesWithCountry;
    } catch (e) {
        console.warn('[advanced-search] TMDb alternative titles error:', e);
        return [];
    }
}

/**
 * Search TMDb for a series by title name and get alternative titles
 * @param {string} searchTitle - The title to search for
 * @param {string} tmdbApiKey - The TMDb API key
 * @returns {Promise<string[]>} - List of normalized alternative titles
 */
export async function searchTMDbByTitle(searchTitle, tmdbApiKey) {
    if (!tmdbApiKey || !searchTitle) return [];
    
    try {
        // Search for the series by title
        const searchUrl = `https://api.themoviedb.org/3/search/tv?api_key=${tmdbApiKey}&query=${encodeURIComponent(searchTitle)}`;
        const searchResp = await fetch(searchUrl);
        const searchData = await searchResp.json();
        
        if (!searchData.results || searchData.results.length === 0) {
            console.log(`[advanced-search] No search results found for: "${searchTitle}"`);
            return [];
        }
        
        // Use the first search result
        const firstResult = searchData.results[0];
        console.log(`[advanced-search] Found series: "${firstResult.name}" (ID: ${firstResult.id})`);
        
        // Get alternative titles for this series
        return await fetchTMDbAlternativeTitles(firstResult.id, 'series', tmdbApiKey);
    } catch (e) {
        console.warn('[advanced-search] TMDb search error:', e);
        return [];
    }
}

/**
 * Simplified 2-step Trakt API approach for fetching absolute episode numbers
 * @param {string} traktApiKey - The Trakt API key
 * @param {string} imdbId - The IMDb ID
 * @param {number} season - Season number
 * @param {number} episode - Episode number
 * @returns {Promise<number|null>} - Absolute episode number or null
 */
async function getEpisodeMapping(traktApiKey, imdbId, season, episode) {
    if (!traktApiKey || !imdbId || !season || !episode) {
        return null;
    }
    
    try {
        // Step 1: Find Trakt ID using IMDb ID
        const searchUrl = `https://api.trakt.tv/search/imdb/${imdbId}`;
        
        const searchResponse = await fetch(searchUrl, {
            headers: {
                'Content-Type': 'application/json',
                'trakt-api-version': '2',
                'trakt-api-key': traktApiKey
            }
        });
        
        if (!searchResponse.ok) {
            console.warn(`[advanced-search] Trakt search failed: ${searchResponse.status}`);
            return null;
        }
        
        const searchData = await searchResponse.json();
        if (!searchData || searchData.length === 0 || !searchData[0].show) {
            console.warn(`[advanced-search] No Trakt show found for IMDb ${imdbId}`);
            return null;        }
        
        const traktId = searchData[0].show.ids.trakt;
        
        // Step 2: Get the specific season with extended=full to get number_abs
        const seasonUrl = `https://api.trakt.tv/shows/${traktId}/seasons/${season}?extended=full`;
        
        const seasonResponse = await fetch(seasonUrl, {
            headers: {
                'Content-Type': 'application/json',
                'trakt-api-version': '2',
                'trakt-api-key': traktApiKey
            }
        });
        
        if (!seasonResponse.ok) {
            console.warn(`[advanced-search] Trakt season fetch failed: ${seasonResponse.status}`);
            
            // If season fetch fails, try to get all seasons to understand the structure
            const allSeasonsUrl = `https://api.trakt.tv/shows/${traktId}/seasons?extended=episodes`;
            
            try {
                const allSeasonsResponse = await fetch(allSeasonsUrl, {
                    headers: {
                        'Content-Type': 'application/json',
                        'trakt-api-version': '2',
                        'trakt-api-key': traktApiKey
                    }
                });
                
                if (allSeasonsResponse.ok) {
                    const allSeasonsData = await allSeasonsResponse.json();
                    console.log(`[advanced-search] Show has ${allSeasonsData.length} seasons:`, 
                        allSeasonsData.map(s => `S${s.number} (${s.episode_count} episodes)`));
                    
                    // Try to find the episode in any season
                    for (const seasonInfo of allSeasonsData) {
                        if (seasonInfo.episodes) {
                            const foundEpisode = seasonInfo.episodes.find(ep => 
                                ep.season === season && ep.number === episode);
                            if (foundEpisode && foundEpisode.number_abs) {
                                console.log(`[advanced-search] ✅ Found episode in all seasons data: S${season}E${episode} = Episode ${foundEpisode.number_abs}`);
                                return foundEpisode.number_abs;
                            }
                        }
                    }
                }
            } catch (e) {
                console.warn(`[advanced-search] Failed to fetch all seasons:`, e);            }
            
            return null;
        }
        
        const seasonData = await seasonResponse.json();
        console.log(`[advanced-search] Successfully fetched ${seasonData.length} episodes for season ${season}`);
        
        // Find the specific episode and get its absolute number
        const targetEpisode = seasonData.find(ep => {
            return parseInt(ep.number, 10) === parseInt(episode, 10);
        });
        
        if (targetEpisode) {
            if (targetEpisode.number_abs) {
                console.log(`[advanced-search] ✅ Found absolute episode: S${season}E${episode} = Episode ${targetEpisode.number_abs} (Trakt number_abs)`);
                return targetEpisode.number_abs;
            } else if (targetEpisode.number) {
                // Fallback: use episode number when number_abs is null
                console.log(`[advanced-search] ✅ Using episode number as fallback: S${season}E${episode} = Episode ${targetEpisode.number} (Trakt number fallback)`);
                console.log(`[advanced-search] Note: number_abs was null, using 'number' field instead`);
                return targetEpisode.number;
            } else {
                console.log(`[advanced-search] ❌ Episode found but neither number_abs nor number available:`, {
                    title: targetEpisode.title,
                    number: targetEpisode.number,
                    number_abs: targetEpisode.number_abs
                });
            }
        } else {
            console.log(`[advanced-search] Episode S${season}E${episode} not found in season data`);
            console.log(`[advanced-search] Available episodes (${seasonData.length} total):`, 
                seasonData.map(ep => `S${ep.season || season}E${ep.number}`));
            
            // Check if the episode might be in a different season
            if (seasonData.length > 0) {
                const maxEpisode = Math.max(...seasonData.map(ep => ep.number));
                console.log(`[advanced-search] Season ${season} has episodes 1-${maxEpisode}, but looking for episode ${episode}`);
                
                // Suggest checking other seasons if episode number is beyond current season
                if (episode > maxEpisode) {
                    console.log(`[advanced-search] Suggestion: Episode ${episode} might be in season ${season + 1} or later`);
                }
            }
        }
        return null;
        
    } catch (e) {
        console.warn('[advanced-search] Failed to fetch Trakt episode mapping:', e);
        return null;
    }
}

/**
 * Check if two season numbers match, handling various formats and edge cases
 * @param {string|number} foundSeason - The season number found in the torrent
 * @param {string|number} targetSeason - The season number we're looking for
 * @returns {boolean} - Whether the seasons match
 */
function checkSeasonMatch(foundSeason, targetSeason) {
    // Handle null/undefined values, but allow 0 (since season 0 is valid for specials/OVA)
    if ((foundSeason === null || foundSeason === undefined) || 
        (targetSeason === null || targetSeason === undefined)) {
        return false;
    }
    
    // If either is a string, try to parse it as a season number
    if (typeof foundSeason === 'string') {
        const parsed = parseSeason(foundSeason, true); // Use strict mode
        if (parsed) foundSeason = parsed;
    }
    if (typeof targetSeason === 'string') {
        const parsed = parseSeason(targetSeason, true); // Use strict mode
        if (parsed) targetSeason = parsed;
    }
    
    // Convert both to numbers for comparison
    const normalizedTarget = parseInt(targetSeason, 10);
    const normalizedFound = parseInt(foundSeason, 10);
    
    // Check if both are valid numbers within reasonable range (0-30, including season 0 for specials/OVA)
    if (!isNaN(normalizedTarget) && !isNaN(normalizedFound) &&
        normalizedTarget >= 0 && normalizedTarget <= 30 &&
        normalizedFound >= 0 && normalizedFound <= 30) {
        return normalizedFound === normalizedTarget;
    }
    
    return false;
}

/**
 * Enhanced absolute episode number extraction from filename
 * @param {string} filename - The filename to parse
 * @returns {number|null} - Absolute episode number or null
 */
function extractAbsoluteEpisode(filename) {
    if (!filename) return null;
    
    // Clean the filename for better parsing
    const cleanFilename = filename.replace(/\.(mkv|mp4|avi|m4v)$/i, '');    // Patterns to match absolute episode numbers
    const absolutePatterns = [
        // Pattern for "DanMachi 031", "Title 031", etc. (common in anime)
        /(\w+)\s+(\d{3,4})(?:\s|$)/i,
        // Pattern for "Title 001", "Title 031", etc. (common in anime)
        /(\w+)\s+(\d{2,4})(?:\s|$)/i,
        // Pattern for "Title - 001", "Title - 031"
        /(\w+)\s*-\s*(\d{2,4})(?:\s|$)/i,
        // Pattern for "001 - Title", "031 - Title"
        /^(\d{2,4})\s*-\s*(.+)/i,
        // Pattern for "Ep001", "Episode 031", "Episode 1000"
        /(?:ep|episode)\s*(\d{2,4})(?:\s|$)/i,
        // Pattern for numbers after title but before quality/source keywords
        /^([^0-9]*?)(\d{2,4})(?:\s+(?:multi|bluray|1080p|720p|x264|x265|web|dl|hdtv))/i
    ];
      for (const pattern of absolutePatterns) {
        const match = cleanFilename.match(pattern);        if (match) {            
            // For patterns where episode is in group 2, use that
            const episodeStr = match[2] || match[1];
            if (episodeStr && /^\d{2,4}$/.test(episodeStr)) {
                const episode = parseInt(episodeStr, 10);                
                // Reasonable range for absolute episodes (1-9999)
                if (episode >= 1 && episode <= 9999) {
                    return episode;
                }
            }
        }    }
    
    return null;
}

/**
 * Analyze a torrent for episode matching - PHASE 2: Deep content analysis
 * @param {Object} torrent - The torrent to analyze
 * @param {number} targetSeason - Target season number
 * @param {number} targetEpisode - Target episode number
 * @param {number} absoluteEpisode - Absolute episode number from Trakt (optional)
 * @returns {Object} - Analysis result
 */
function analyzeTorrent(torrent, targetSeason, targetEpisode, absoluteEpisode = null) {
    const result = {
        isDirect: false,
        isContainer: false,
        hasMatchingEpisode: false,
        matchingFiles: [],
        details: null,
        seasonInfo: { found: null, target: targetSeason }
    };

    const info = torrent.info || {};
    
    // Function to check episode match accounting for different formats
    const isEpisodeMatch = (videoInfo, videoName = '') => {
        if (!videoInfo) return false;
        
        // Try explicit season/episode first (classic matching)
        if (checkSeasonMatch(videoInfo.season, targetSeason) && 
            parseInt(videoInfo.episode, 10) === parseInt(targetEpisode, 10)) {
            console.log(`[advanced-search] ✅ Classic S${targetSeason}E${targetEpisode} match (found S${videoInfo.season}E${videoInfo.episode}) for: ${videoName}`);
            return true;
        }
        
        // Try absolute episode number ONLY if we couldn't find clear season/episode pattern
        if (absoluteEpisode && !videoInfo.season && !videoInfo.episode) {
            console.log(`[advanced-search] No season/episode found, trying absolute episode matching for: ${videoName}`);
            
            // Check if videoInfo already has absoluteEpisode
            if (videoInfo.absoluteEpisode && 
                parseInt(videoInfo.absoluteEpisode, 10) === parseInt(absoluteEpisode, 10)) {
                console.log(`[advanced-search] ✅ Trakt absolute episode ${absoluteEpisode} match (from videoInfo) for: ${videoName}`);
                return true;
            }

            // Try extracting from filename using enhanced method
            const extractedAbsolute = extractAbsoluteEpisode(videoName || videoInfo.name || '');
            if (extractedAbsolute && extractedAbsolute === parseInt(absoluteEpisode, 10)) {
                console.log(`[advanced-search] ✅ Trakt absolute episode ${absoluteEpisode} match (extracted: ${extractedAbsolute}) for: ${videoName}`);
                return true;
            }

            // Fallback: try parsing absolute episode from filename using original parser
            if (!videoInfo.absoluteEpisode) {
                const parsedInfo = parseTorrentTitle(videoName || videoInfo.name || '');
                if (parsedInfo.episode && parseInt(parsedInfo.episode, 10) === parseInt(absoluteEpisode, 10)) {
                    console.log(`[advanced-search] ✅ Trakt absolute episode ${absoluteEpisode} match (parsed: ${parsedInfo.episode}) for: ${videoName}`);
                    return true;
                }
            }
        }
        
        // NEW: Handle files with absolute numbering but no season/episode pattern
        // This handles cases like "DanMachi 031" where no season/episode pattern is detected
        // but an absolute number is found that could match the target episode
        if (!videoInfo.season && !videoInfo.episode && targetSeason && targetEpisode) {
            console.log(`[advanced-search] No season/episode detected, trying absolute number extraction for: ${videoName}`);
            
            // Extract potential absolute number from filename (not using Trakt absoluteEpisode)
            const extractedNumber = extractAbsoluteEpisode(videoName || videoInfo.name || '');
            if (extractedNumber) {
                console.log(`[advanced-search] Extracted absolute number: ${extractedNumber} from filename: ${videoName}`);
                
                // Method 1: Direct match with target episode (for absolute episode numbering)
                if (parseInt(extractedNumber, 10) === parseInt(targetEpisode, 10)) {
                    console.log(`[advanced-search] ✅ Direct absolute number ${extractedNumber} matches target episode ${targetEpisode}: ${videoName}`);
                    return true;
                }
                
                // Method 2: Estimate based on season/episode (for series with season boundaries)
                // This is a heuristic for anime where absolute numbering continues across seasons
                if (targetSeason > 1) {
                    const estimatedAbsolute = (targetSeason - 1) * 12 + parseInt(targetEpisode, 10); // Assume ~12 episodes per season
                    const tolerance = 6; // Allow some tolerance for varying season lengths
                    
                    if (Math.abs(extractedNumber - estimatedAbsolute) <= tolerance) {
                        console.log(`[advanced-search] ✅ Estimated absolute number match: extracted=${extractedNumber}, estimated=${estimatedAbsolute} (±${tolerance}) for S${targetSeason}E${targetEpisode}: ${videoName}`);
                        return true;
                    }
                }
            }
        }
        
        return false;
    };
    
    // Check if this is a single video file
    if (isVideo(torrent.name)) {
        result.isDirect = true;
          // Parse season/episode from filename if not in info
        if (!info.season || !info.episode) {
            const parsed = parseTorrentTitle(torrent.name);
            console.log(`[advanced-search] parseTorrentTitle for "${torrent.name}": season=${parsed.season}, episode=${parsed.episode}`);
            info.season = info.season || parsed.season;
            info.episode = info.episode || parsed.episode;
            info.absoluteEpisode = info.absoluteEpisode || parsed.episode; // For absolute numbering
              // Enhanced Roman numeral detection for season
            if (!info.season) {
                const romanMatch = torrent.name.match(/\b([IVXLCDM]+)\s*-?\s*(\d+)/i);                if (romanMatch) {
                    const romanNumeral = romanMatch[1].toUpperCase();
                    const episodeNum = parseInt(romanMatch[2], 10);
                    
                    // Convert Roman numeral to season number
                    const seasonFromRoman = romanToNumber(romanNumeral);
                    
                    if (seasonFromRoman) {
                        info.season = seasonFromRoman;
                        info.episode = info.episode || episodeNum;
                    }                }
            }
            
            // Fallback: if still no season and we're looking for season 1, assume it's season 1
            // Note: Check for null/undefined explicitly since season 0 is valid (for OVAs/specials)
            if ((info.season === null || info.season === undefined) && targetSeason === 1 && info.episode) {
                console.log(`[advanced-search] PROBLEMATIC FALLBACK: Setting season=1 for "${torrent.name}" with episode=${info.episode} (originally season=${info.season})`);
                info.season = 1;
            }
        }        if (isEpisodeMatch(info, torrent.name)) {
            result.hasMatchingEpisode = true;
            result.matchingFiles = [torrent];
        }

        return result;
    }    // It's a container, check its video files
    result.isContainer = true;
    if (torrent.videos?.length) {
          // For containers, try to find matching episodes - NO FALLBACK CALCULATIONS
        const matchingVideos = torrent.videos.filter(video => {
            const videoInfo = video.info || {};
              // Only parse if not already parsed (performance improvement)
            if (!videoInfo.season || !videoInfo.episode) {
                const parsed = parseTorrentTitle(video.name);
                console.log(`[advanced-search] parseTorrentTitle for video "${video.name}": season=${parsed.season}, episode=${parsed.episode}`);
                videoInfo.season = videoInfo.season || parsed.season;
                videoInfo.episode = videoInfo.episode || parsed.episode;
                videoInfo.absoluteEpisode = videoInfo.absoluteEpisode || parsed.episode; // For absolute numbering
                  // Enhanced Roman numeral detection for season
                if (!videoInfo.season) {
                    const romanMatch = video.name.match(/\b([IVXLCDM]+)\s*-?\s*(\d+)/i);                    if (romanMatch) {
                        const romanNumeral = romanMatch[1].toUpperCase();
                        const episodeNum = parseInt(romanMatch[2], 10);
                        
                        // Convert Roman numeral to season number
                        const seasonFromRoman = romanToNumber(romanNumeral);
                        
                        if (seasonFromRoman) {
                            videoInfo.season = seasonFromRoman;
                            videoInfo.episode = videoInfo.episode || episodeNum;
                        }
                    }                }
                
                // Fallback: if still no season and we're looking for season 1, assume it's season 1
                // Note: Check for null/undefined explicitly since season 0 is valid (for OVAs/specials)
                if ((videoInfo.season === null || videoInfo.season === undefined) && targetSeason === 1 && videoInfo.episode) {
                    console.log(`[advanced-search] PROBLEMATIC FALLBACK (video): Setting season=1 for video "${video.name}" with episode=${videoInfo.episode} (originally season=${videoInfo.season})`);
                    videoInfo.season = 1;
                }
                
                // Store parsed info for later use
                video.info = videoInfo;
            }

            return isEpisodeMatch(videoInfo, video.name);
        });
        
        if (matchingVideos.length > 0) {
            result.hasMatchingEpisode = true;
            result.matchingFiles = matchingVideos;
        }
    } else {
        console.log(`[advanced-search] Container has no processed videos:`, torrent.name);
    }

    return result;
}

/**
 * Perform advanced search using TMDb/Trakt APIs when available.
 * Uses a two-phase approach: fast title matching, then deep content analysis.
 */
export async function advancedSearch(params) {
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
        console.log('[advanced-search] Using TMDb API key from environment variables');
    }
    
    if (!traktApiKey && process.env.TRAKT_API_KEY) {
        traktApiKey = process.env.TRAKT_API_KEY;
        console.log('[advanced-search] Using Trakt API key from environment variables');
    }
    
    console.log('[advanced-search] Starting two-phase search for:', searchKey);
    console.log('[advanced-search] Normalized search key:', extractKeywords(searchKey));
      // ========== PHASE 0: PREPARE SEARCH TERMS + EPISODE MAPPING ==========
    console.log('[advanced-search] Phase 0: Preparing search terms and episode mapping');
    
    // Get absolute episode number early if Trakt API is available
    let absoluteEpisode = null;
    if (traktApiKey && type === 'series' && season && episode) {
        console.log(`[advanced-search] Fetching absolute episode mapping for S${season}E${episode}`);
        absoluteEpisode = await getEpisodeMapping(traktApiKey, imdbId, season, episode);
        if (absoluteEpisode) {
            console.log(`[advanced-search] ✅ Found absolute episode: ${absoluteEpisode}`);
        } else {
            console.log(`[advanced-search] ❌ No absolute episode found from Trakt API`);
        }
    }
    
    let alternativeTitles = [];
    if (tmdbApiKey && type && imdbId) {
        console.log('[advanced-search] TMDb API available, fetching alternative titles');
        alternativeTitles = await fetchTMDbAlternativeTitles(null, type, tmdbApiKey, imdbId);
    }
    
    // Prepare all search terms - use all titles for provider search
    const normalizedSearchKey = extractKeywords(searchKey);
    const allSearchTerms = [normalizedSearchKey];
    
    if (alternativeTitles.length > 0) {
        // Extract normalized titles from the new format with country info
        const normalizedAlternatives = alternativeTitles.map(alt => alt.normalizedTitle);
        allSearchTerms.push(...normalizedAlternatives);
    }
      // OPTIMIZATION: Deduplicate normalized search terms to reduce redundant Fuse.js searches
    // Use case-insensitive deduplication since Fuse.js searches are case-insensitive anyway
    const termMap = new Map();
    allSearchTerms.filter(term => term && term.trim()).forEach(term => {
        const lowerKey = term.toLowerCase();
        if (!termMap.has(lowerKey)) {
            termMap.set(lowerKey, term); // Keep first occurrence with original casing
        }
    });
    const uniqueSearchTerms = Array.from(termMap.values());
    
    console.log(`[advanced-search] Deduplicated search terms: ${allSearchTerms.length} → ${uniqueSearchTerms.length} unique terms`);
    if (uniqueSearchTerms.length !== allSearchTerms.length) {
        const removedTerms = allSearchTerms.filter(term => 
            term && term.trim() && !uniqueSearchTerms.some(unique => unique.toLowerCase() === term.toLowerCase())
        );
        console.log('[advanced-search] Removed duplicate terms:', removedTerms);
    }// ========== OPTIMIZED PROVIDER SEARCH (SINGLE FETCH + PRE-FILTER) ==========
    console.log('[advanced-search] Optimized provider search - fetching all torrents once');
    
    const providerImpl = providers[provider];
    if (!providerImpl?.searchTorrents) {
        throw new Error(`Invalid provider: ${provider}`);
    }

    // OPTIMIZATION: Get ALL torrents once instead of multiple searches
    let allTorrents = [];
    try {
        console.log(`[advanced-search] Fetching all torrents from ${provider}`);
        
        // Use provider-specific bulk methods when available for maximum performance
        if (provider === 'AllDebrid' && providerImpl.listTorrentsParallel) {
            console.log('[advanced-search] Using AllDebrid bulk torrent fetch');
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
            console.log('[advanced-search] Using DebridLink bulk torrent fetch');
            const torrentsResults = await providerImpl.listTorrentsParallel(apiKey);
            allTorrents = torrentsResults.map(item => ({
                source: 'debridlink',
                id: item.id.split('-')[0],
                name: item.name,
                type: 'other',
                info: parseTorrentTitle(item.name),
                size: item.size,
                created: new Date(item.created * 1000)
            }));        } else if (provider === 'RealDebrid' && providerImpl.listFilesParrallel) {
            console.log('[advanced-search] Using RealDebrid bulk torrent fetch');
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
            console.log('[advanced-search] Using TorBox bulk torrent fetch');
            const torrentsResults = await providerImpl.listFilesParallel(FILE_TYPES.TORRENTS, apiKey, 1, 1000);
            allTorrents = torrentsResults.map(item => ({
                source: 'torbox',
                id: item.id,
                name: item.name,
                type: 'other',
                info: parseTorrentTitle(item.name),
                size: item.size,
                created: new Date(item.created_at)
            }));        } else if (provider === 'Premiumize' && providerImpl.listFiles) {
            console.log('[advanced-search] Using Premiumize bulk file fetch');
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
            console.log(`[advanced-search] Using fallback search with main title for ${provider}`);
            allTorrents = await providerImpl.searchTorrents(apiKey, normalizedSearchKey, threshold);
        }
        
        console.log(`[advanced-search] Retrieved ${allTorrents.length} total torrents`);
    } catch (error) {
        console.warn('[advanced-search] Failed to fetch torrents:', error);
        return [];
    }

    if (allTorrents.length === 0) {
        console.log('❌ [advanced-search] No torrents found');
        return [];
    }    // OPTIMIZATION: Pre-filter torrents by keyword inclusion before expensive Fuse.js
    console.log('[advanced-search] Pre-filtering torrents by keywords');
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
    
    console.log(`[advanced-search] Pre-filter: ${allTorrents.length} → ${relevantTorrents.length} relevant torrents`);
    
    if (relevantTorrents.length === 0) {
        console.log('❌ [advanced-search] No relevant torrents found after pre-filtering');
        return [];
    }

    // Convert to the format expected by Phase 1
    const allRawResults = relevantTorrents;
    
    // ========== PHASE 1: FAST TITLE MATCHING ==========
    console.log('[advanced-search] Phase 1: Fast title matching');
    
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
    });    const titleMatches = [];
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
            console.log(`[advanced-search] Found ${matches.length} matches for normalized term: "${term}"`);
        }
    }
    
    // Log Phase 1 summary
    if (titleMatches.length === 0) {
        console.log('❌ [advanced-search] No title matches found in Phase 1');
        return [];
    }

    console.log(`[advanced-search] Phase 1 complete: ${titleMatches.length} matches out of ${allRawResults.length} total results`);
    
    // For movies or when no episode info needed, return Phase 1 results with fuzzy matching and sorting
    if (type === 'movie' || (!season && !episode)) {
        console.log('[advanced-search] Movie or no episode filtering needed, applying fuzzy matching and sorting Phase 1 results');
        
        // Apply fuzzy matching and sorting to results
        const sortedResults = sortTorrentsByRelevance(
            titleMatches.map(m => m.item),
            searchKey,
            season ? parseInt(season) : null,
            episode ? parseInt(episode) : null,
            alternativeTitles
        );
        
        return {
            results: sortedResults,
            absoluteEpisode: null
        };
    }

    // ========== PHASE 2: DEEP CONTENT ANALYSIS ==========
    console.log('[advanced-search] Phase 2: Deep content analysis for episode matching');
    
    // Batch fetch torrent details to avoid individual API calls
    const torrentsNeedingDetails = titleMatches.filter(match => 
        providers[provider]?.getTorrentDetails && !match.item.videos
    );
    
    if (torrentsNeedingDetails.length > 0) {
        console.log(`[advanced-search] Batch fetching details for ${torrentsNeedingDetails.length} torrents`);
        await Promise.all(
            torrentsNeedingDetails.map(async match => {
                try {
                    const details = await providers[provider].getTorrentDetails(apiKey, match.item.id);
                    Object.assign(match.item, details);
                } catch (e) {
                    console.warn(`[advanced-search] Failed to fetch details for ${match.item.name}:`, e);
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
    });    // Filter to only matching episodes and extract specific video files    
    const matches = analyzedResults
        .filter(result => {
            const hasMatch = result.analysis.hasMatchingEpisode;
            if (!hasMatch) {
                console.log(`[advanced-search] ❌ REJECTED: ${result.torrent.name} - No matching episodes found`);
            }
            return hasMatch;
        }).flatMap(result => {
                // For containers, return each matching video as a separate result
                if (result.analysis.isContainer && result.analysis.matchingFiles.length > 0) {                                const extractedVideos = result.analysis.matchingFiles.map(video => ({
                                    ...result.torrent,
                                    name: video.name,
                                    size: video.size,
                                    info: {
                                        ...(result.torrent.info || {}),
                                        ...(video.info || {})
                                    },
                                    // Keep track that this is from a container
                                    containerName: result.torrent.name,
                                    isExtractedVideo: true
                                }));
                
                return extractedVideos;
            } else {
                // For direct files, return as is
                return [result.torrent];
            }
        });
        
        console.log(`[advanced-search] Phase 2 complete: ${matches.length} matching episodes found`);
    console.log(`[advanced-search] Performance summary: ${allRawResults.length} total → ${titleMatches.length} title matches → ${matches.length} final results`);
    
    // ========== PHASE 3: ANIME SEASON CHECK (Final fallback) ==========
    if (matches.length === 0 && type === 'series' && season && episode) {
        // Check if this is Season 0 (specials/OVA) - don't do anime mapping for S00
        if (parseInt(season) === 0) {
            console.log('[advanced-search] Season 0 (specials/OVA) detected - skipping anime mapping phase');
            console.log('[advanced-search] For S00 episodes, we only look for direct S00E{episode} matches');
            console.log(`[advanced-search] No matches found for S${season}E${episode} - this might be because:`);
            console.log('  1. The torrent uses different OVA/special naming (e.g., "OVA", "Special", "Extra")');
            console.log('  2. The episode number might be different in the torrent');
            console.log('  3. The special might be bundled with a regular season');
            
            // Return empty results for S00 since we don't want anime mapping transformation
            const sortedResults = sortTorrentsByRelevance(
                [],
                searchKey,
                parseInt(season),
                parseInt(episode),
                alternativeTitles
            );
            
            return {
                results: sortedResults,
                absoluteEpisode: absoluteEpisode
            };
        }
        
        console.log('[advanced-search] Phase 3: Trying anime season mapping as final fallback');
        
        try {
            // Use country-aware title selection for anime searches
            const titleVariations = selectTitleVariationsForAnime(
                searchKey, 
                alternativeTitles, 
                'anime'
            );
            
            console.log(`[advanced-search] Country-prioritized anime search with ${titleVariations.length} title variations:`, titleVariations);
            
            // Try each title variation until we find anime seasons
            let animeSeasons = [];
            let successfulTitle = null;
            
            for (const titleVariation of titleVariations) {
                console.log(`[advanced-search] Trying anime search with: "${titleVariation}"`);
                animeSeasons = await fetchAnimeSeasonInfo(titleVariation);
                
                if (animeSeasons.length > 0) {
                    successfulTitle = titleVariation;
                    console.log(`[advanced-search] ✅ Found anime seasons with country-prioritized title: "${titleVariation}"`);
                    break;
                } else {
                    console.log(`[advanced-search] ❌ No anime found for: "${titleVariation}"`);
                }
            }
            
            if (animeSeasons.length > 0) {
                // Try to map the episode to correct season
                const episodeMapping = mapAnimeEpisode(animeSeasons, parseInt(season), parseInt(episode));
                
                if (episodeMapping) {
                    console.log(`[advanced-search] Anime mapping found using "${successfulTitle}": S${season}E${episode} → S${episodeMapping.mappedSeason}E${episodeMapping.mappedEpisode}`);
                    
                    // OPTIMIZATION: Instead of full recursive search, reuse existing data and only re-analyze
                    console.log('[advanced-search] Optimized anime retry: Re-analyzing existing torrents with new season/episode');
                    
                    // Prevent infinite recursion
                    if (!params._animeRetry) {
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
                                    console.log(`[advanced-search] ✅ ANIME MATCH: ${result.torrent.name} - Found S${episodeMapping.mappedSeason}E${episodeMapping.mappedEpisode}`);
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
                                        animeMapping: episodeMapping
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
                            console.log(`[advanced-search] ✅ Optimized anime retry successful: Found ${animeMatches.length} results (no additional API calls needed)`);
                            
                            // Apply fuzzy matching and sorting to anime results
                            const sortedAnimeResults = sortTorrentsByRelevance(
                                animeMatches,
                                searchKey,
                                parseInt(episodeMapping.mappedSeason),
                                parseInt(episodeMapping.mappedEpisode),
                                alternativeTitles
                            );
                            
                            return {
                                results: sortedAnimeResults,
                                absoluteEpisode: absoluteEpisode,
                                animeMapping: episodeMapping
                            };
                        } else {
                            console.log('[advanced-search] ❌ Optimized anime retry failed: No results found with mapped season/episode');
                        }
                    }
                } else {
                    console.log('[advanced-search] No anime episode mapping found');
                }                } else {
                    console.log('[advanced-search] No anime seasons found for any country-prioritized title variation');
                }
        } catch (error) {
            console.warn('[advanced-search] Anime season check failed:', error);
        }
    }
    
    // Return results with fuzzy matching and sorting applied
    console.log(`[advanced-search] Applying fuzzy matching and sorting to ${matches.length} final results`);
    
    // Deduplicate results before sorting (especially important for absolute episode matching)
    const uniqueMatches = deduplicateResults(matches);
    console.log(`[advanced-search] Deduplicated ${matches.length} → ${uniqueMatches.length} unique results`);
    
    const sortedResults = sortTorrentsByRelevance(
        uniqueMatches,
        searchKey,
        season ? parseInt(season) : null,
        episode ? parseInt(episode) : null,
        alternativeTitles
    );
    
    return {
        results: sortedResults,
        absoluteEpisode: absoluteEpisode
    };
}

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
 * Extract movie information from filename for title cleaning
 * @param {string} movieName - Movie filename to analyze  
 * @returns {Object} - Object with title, year, and cleanTitleOnly
 */
function extractMovieInfo(movieName) {
    if (!movieName) return { title: 'Unknown Movie', year: null };
    
    let title = movieName;
    let year = null;
    
    // Extract year first (prefer parentheses, then standalone 4-digit numbers)
    const yearMatch = title.match(/\((\d{4})\)|(\d{4})/);
    if (yearMatch) {
        year = yearMatch[1] || yearMatch[2];
    }
    
    // Remove group tags at the beginning
    title = title.replace(/^[\[\{][^\]\}]+[\]\}]\s*/, '');
    
    // Find where technical info starts (use centralized patterns)
    let titleEndIndex = title.length;
    for (const pattern of TECHNICAL_PATTERNS) {
        const match = title.match(pattern);
        if (match && match.index < titleEndIndex) {
            titleEndIndex = Math.min(titleEndIndex, match.index);
        }
    }
    
    // Extract clean title
    let cleanTitle = title.substring(0, titleEndIndex).trim();
    
    // Clean up the title
    cleanTitle = cleanTitle
        .replace(/[\._]/g, ' ')
        .replace(/\s*-\s*$/, '')
        .replace(/\s+/g, ' ')
        .trim();
    
    // Remove year from title to avoid duplication
    if (year) {
        cleanTitle = cleanTitle.replace(new RegExp(`\\(${year}\\)`, 'g'), '').replace(/\s+/g, ' ').trim();
        cleanTitle = cleanTitle.replace(new RegExp(`\\b${year}\\b`, 'g'), '').replace(/\s+/g, ' ').trim();
    }
    
    if (!cleanTitle || cleanTitle.length < 3) {
        cleanTitle = 'Unknown Movie';
    }
    
    return {
        title: cleanTitle + (year ? ` (${year})` : ''),
        year: year,
        cleanTitleOnly: cleanTitle
    };
}

/**
 * Enhanced title cleaning function for realistic addon output (using real addon logic)
 * @param {string} title - Title to clean
 * @returns {string} - Cleaned title
 */
function cleanTitleForAddon(title) {
    if (!title) return title;
    
    // Use the real addon's movie extraction logic for consistent cleaning
    const movieInfo = extractMovieInfo(title);
    return movieInfo.cleanTitleOnly || '';
}

/**
 * Enhanced variant cleaning function (using real addon logic)
 * @param {string} variant - Variant to clean
 * @returns {string|null} - Cleaned variant or null
 */
function cleanVariantForAddon(variant) {
    if (!variant) return null;
    
    // Apply similar cleaning as title but without year extraction
    let cleaned = variant
        // Remove group tags at the beginning
        .replace(/^[\[\{][^\]\}]+[\]\}]\s*/, '');
    
    // Find where technical info starts (use centralized patterns)
    let titleEndIndex = cleaned.length;
    for (const pattern of TECHNICAL_PATTERNS) {
        const match = cleaned.match(pattern);
        if (match && match.index < titleEndIndex) {
            titleEndIndex = Math.min(titleEndIndex, match.index);
        }
    }
    
    // Extract clean variant
    cleaned = cleaned.substring(0, titleEndIndex).trim();
    
    // Clean up the variant
    cleaned = cleaned
        .replace(/[\._]/g, ' ')
        .replace(/\s*-\s*$/, '')
        .replace(/\s+/g, ' ')
        .trim();
    
    // Additional variant-specific cleaning
    cleaned = cleaned
        // Remove episode numbers and patterns at the start
        .replace(/^(S\d+E\d+|Episode\s+\d+|\d+\s*$)/gi, '')
        // Remove episode-specific patterns
        .replace(/^(EP?\s*\d+|Ch(apter)?\s*\d+)/gi, '')
        // Remove very technical looking strings
        .replace(/^[A-F0-9]{8,}$/gi, '') // Hash-like strings
        .trim();
    
    // Filter out if too short or meaningless
    if (!cleaned || cleaned.length <= 2 || /^\d+$/.test(cleaned)) {
        return null;
    }
    
    return cleaned;
}

/**
 * Simple Levenshtein distance for similarity calculation
 * @param {string} str1 - First string
 * @param {string} str2 - Second string  
 * @returns {number} - Similarity score between 0 and 1
 */
function calculateStringSimilarity(str1, str2) {
    if (!str1 || !str2) return 0;
    
    const distance = levenshteinDistance(str1.toLowerCase(), str2.toLowerCase());
    const maxLength = Math.max(str1.length, str2.length);
    
    if (maxLength === 0) return 1;
    
    return 1 - (distance / maxLength);
}

/**
 * Calculate Levenshtein distance between two strings
 * @param {string} str1 - First string
 * @param {string} str2 - Second string
 * @returns {number} - Edit distance
 */
function levenshteinDistance(str1, str2) {
    const matrix = [];
    
    for (let i = 0; i <= str2.length; i++) {
        matrix[i] = [i];
    }
    
    for (let j = 0; j <= str1.length; j++) {
        matrix[0][j] = j;
    }
    
    for (let i = 1; i <= str2.length; i++) {
        for (let j = 1; j <= str1.length; j++) {
            if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }
    
    return matrix[str2.length][str1.length];
}

/**
 * Fuzzy matching logic for canonical titles and variants
 * @param {string} extractedTitle - Title extracted from torrent name
 * @param {Array} alternativeTitles - Array of alternative titles from TMDb
 * @returns {Object} - Object with canonicalTitle, variant, and confidence
 */
function performFuzzyMatching(extractedTitle, alternativeTitles) {
    if (!extractedTitle) {
        return {
            canonicalTitle: null,
            variant: null,
            confidence: 0,
            isVariant: false
        };
    }
    
    const cleanedExtracted = cleanTitleForAddon(extractedTitle);
    if (!cleanedExtracted || cleanedExtracted.length < 2) {
        return {
            canonicalTitle: extractedTitle,
            variant: null,
            confidence: 0.1,
            isVariant: false
        };
    }
    
    // If no alternative titles, return as-is
    if (!alternativeTitles || alternativeTitles.length === 0) {
        return {
            canonicalTitle: extractedTitle,
            variant: null,
            confidence: 0.5,
            isVariant: false
        };
    }
    
    let bestMatch = null;
    let bestSimilarity = 0;
    let isExactMatch = false;
    
    // Check against all alternative titles
    for (const altTitle of alternativeTitles) {
        const titleToCheck = typeof altTitle === 'string' ? altTitle : altTitle.normalizedTitle || altTitle.title;
        if (!titleToCheck) continue;
        
        const cleanedAlt = cleanTitleForAddon(titleToCheck);
        if (!cleanedAlt) continue;
        
        // Check for exact match (case-insensitive)
        if (cleanedExtracted.toLowerCase() === cleanedAlt.toLowerCase()) {
            bestMatch = {
                title: titleToCheck,
                similarity: 1.0,
                isExact: true
            };
            isExactMatch = true;
            break;
        }
        
        // Calculate similarity
        const similarity = calculateStringSimilarity(cleanedExtracted, cleanedAlt);
        if (similarity > bestSimilarity) {
            bestSimilarity = similarity;
            bestMatch = {
                title: titleToCheck,
                similarity: similarity,
                isExact: false
            };
        }
    }
    
    // Determine if this is a variant (spin-off, different series, etc.)
    const HIGH_SIMILARITY_THRESHOLD = 0.8;
    const MEDIUM_SIMILARITY_THRESHOLD = 0.6;
    const LOW_SIMILARITY_THRESHOLD = 0.3;
    
    if (isExactMatch || (bestMatch && bestMatch.similarity >= HIGH_SIMILARITY_THRESHOLD)) {
        // High confidence match - likely the same series
        return {
            canonicalTitle: bestMatch ? bestMatch.title : extractedTitle,
            variant: null,
            confidence: bestMatch ? bestMatch.similarity : 1.0,
            isVariant: false
        };
    } else if (bestMatch && bestMatch.similarity >= MEDIUM_SIMILARITY_THRESHOLD) {
        // Medium similarity - might be a variant or related series
        const cleanedVariant = cleanVariantForAddon(extractedTitle);
        return {
            canonicalTitle: bestMatch.title,
            variant: cleanedVariant && cleanedVariant !== cleanTitleForAddon(bestMatch.title) ? cleanedVariant : null,
            confidence: bestMatch.similarity,
            isVariant: true
        };
    } else if (bestMatch && bestMatch.similarity >= LOW_SIMILARITY_THRESHOLD) {
        // Low similarity - likely a different series but with some relation
        const cleanedVariant = cleanVariantForAddon(extractedTitle);
        return {
            canonicalTitle: bestMatch.title,
            variant: cleanedVariant || extractedTitle,
            confidence: bestMatch.similarity * 0.5, // Penalize low similarity matches
            isVariant: true
        };
    } else {
        // No good match found - treat as standalone
        return {
            canonicalTitle: extractedTitle,
            variant: null,
            confidence: 0.2,
            isVariant: false
        };
    }
}

/**
 * Simple variant detection - checks if extracted title contains parts not in alternative titles
 * @param {string} extractedTitle - The clean title extracted from torrent (e.g. "DanMachi Sword Oratoria")
 * @param {string} searchTitle - Original search title (e.g. "DanMachi")
 * @param {Array} alternativeTitles - Alternative titles from TMDb
 * @returns {Object} - { isVariant: boolean, variantName: string|null }
 */
export function detectSimpleVariant(extractedTitle, searchTitle, alternativeTitles = []) {
    if (!extractedTitle || !searchTitle) {
        return { isVariant: false, variantName: null };
    }
    
    const normalizeTitle = (title) => {
        return title.toLowerCase()
            .replace(/[^\p{L}\p{N}\s]/gu, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    };
    
    const normalizedExtracted = normalizeTitle(extractedTitle);
    const normalizedSearch = normalizeTitle(searchTitle);
    
    // If the extracted title is exactly the same as search title, it's not a variant
    if (normalizedExtracted === normalizedSearch) {
        return { isVariant: false, variantName: null };
    }
    
    // Check if extracted title matches any alternative title exactly
    const allTitles = [normalizedSearch, ...alternativeTitles.map(alt => normalizeTitle(alt.title || alt.normalizedTitle || alt))];
    
    for (const altTitle of allTitles) {
        if (normalizedExtracted === altTitle) {
            return { isVariant: false, variantName: null };
        }
    }
      // Check if the extracted title contains the search title as a base
    if (normalizedExtracted.includes(normalizedSearch)) {
        // Extract the variant part (what comes after the base title)
        let variantPart = normalizedExtracted
            .replace(normalizedSearch, '')
            .trim()
            .replace(/^[-:\s]+/, '') // Remove leading separators
            .replace(/[-:\s]+$/, ''); // Remove trailing separators
        
        if (variantPart && variantPart.length > 2) {
            // Since extractedTitle is already clean from extractSeriesInfo, 
            // we don't need to re-filter technical details
            console.log(`[detectSimpleVariant] Found variant: "${extractedTitle}" -> variant part: "${variantPart}"`);
            return { 
                isVariant: true, 
                variantName: variantPart.split(' ').map(word => 
                    word.charAt(0).toUpperCase() + word.slice(1)
                ).join(' ')
            };
        }
    }
    
    return { isVariant: false, variantName: null };
}

/**
 * Fuzzy matching patterns for variants and spin-offs
 */
const FUZZY_PATTERNS = {
    // Common variant/spinoff indicators
    VARIANT_INDICATORS: [
        'spin-off', 'spinoff', 'side story', 'side-story',
        'gaiden', 'omake', 'special', 'ova', 'movie',
        'recap', 'summary', 'compilation'
    ],
    
    // Common words to ignore for fuzzy matching
    COMMON_WORDS: [
        'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
        'of', 'with', 'by', 'no', 'ni', 'wa', 'ga', 'wo', 'de', 'series',
        'season', 'part', 'vol', 'volume', 'chapter', 'episode', 'ep'
    ],
    
    // Subtitle/sub-series patterns
    SUBTITLE_PATTERNS: [
        /(.+?)\s*[-:]\s*(.+)/,  // "Main Title - Subtitle" or "Main Title: Subtitle"
        /(.+?)\s*\((.+?)\)/,    // "Main Title (Subtitle)"
        /(.+?)\s*~(.+?)~/,      // "Main Title ~Subtitle~"
        /(.+?)\s+(.+?)$/        // "Main Title Subtitle" (fallback)
    ]
};

/**
 * Calculate fuzzy score for variant/spin-off detection
 * @param {string} searchTitle - The original search title
 * @param {string} torrentTitle - The torrent title to compare
 * @param {Array} alternativeTitles - Alternative titles from TMDb
 * @returns {Object} - Scoring result with match type and score
 */
function calculateFuzzyScore(searchTitle, torrentTitle, alternativeTitles = []) {
    const normalizeForFuzzy = (title) => {
        return title.toLowerCase()
            .normalize("NFKC")
            .replace(/[^\p{L}\p{N}\s]/gu, " ")
            .replace(/\s+/g, " ")
            .trim();
    };
    
    const removeCommonWords = (title) => {
        return title.split(' ')
            .filter(word => !FUZZY_PATTERNS.COMMON_WORDS.includes(word))
            .join(' ');
    };
    
    const normalizedSearch = normalizeForFuzzy(searchTitle);
    const normalizedTorrent = normalizeForFuzzy(torrentTitle);
    
    // Check for exact match first
    if (normalizedSearch === normalizedTorrent) {
        return { matchType: 'exact', score: 1.0, variant: null };
    }
    
    // Check alternative titles for exact matches
    for (const altTitle of alternativeTitles) {
        const normalizedAlt = normalizeForFuzzy(altTitle.normalizedTitle || altTitle);
        if (normalizedAlt === normalizedTorrent) {
            return { matchType: 'alternative', score: 0.95, variant: null };
        }
    }
    
    // Check for subtitle/variant patterns
    let isVariantDetected = false;
    let variantName = null;
    
    for (const pattern of FUZZY_PATTERNS.SUBTITLE_PATTERNS) {
        const match = normalizedTorrent.match(pattern);
        if (match) {
            const mainPart = match[1].trim();
            const subPart = match[2].trim();
            
            // Check if main part matches our search
            const mainPartCleaned = removeCommonWords(mainPart);
            const searchCleaned = removeCommonWords(normalizedSearch);
            
            if (mainPartCleaned.includes(searchCleaned) || searchCleaned.includes(mainPartCleaned)) {
                // Check if sub-part contains variant indicators
                const hasVariantIndicator = FUZZY_PATTERNS.VARIANT_INDICATORS.some(indicator =>
                    subPart.includes(indicator)
                );
                
                if (hasVariantIndicator || subPart.length > 3) {
                    isVariantDetected = true;
                    variantName = subPart;
                    break;
                }
            }
        }
    }
    
    // Generic fuzzy matching using simple string similarity
    const searchWords = removeCommonWords(normalizedSearch).split(' ').filter(w => w.length > 2);
    const torrentWords = removeCommonWords(normalizedTorrent).split(' ').filter(w => w.length > 2);
    
    if (searchWords.length === 0 || torrentWords.length === 0) {
        return { matchType: 'none', score: 0, variant: null };
    }
    
    let matchingWords = 0;
    let totalWords = Math.max(searchWords.length, torrentWords.length);
    
    for (const searchWord of searchWords) {
        for (const torrentWord of torrentWords) {
            // Exact word match
            if (searchWord === torrentWord) {
                matchingWords += 1;
                break;
            }
            // Partial word match (for longer words)
            else if (searchWord.length > 4 && torrentWord.length > 4) {
                if (searchWord.includes(torrentWord) || torrentWord.includes(searchWord)) {
                    matchingWords += 0.7;
                    break;
                }
            }
        }
    }
    
    const baseScore = matchingWords / totalWords;
    
    // Determine match type and adjust score
    if (isVariantDetected) {
        return {
            matchType: 'variant',
            score: Math.max(0.3, baseScore * 0.7), // Lower score for variants
            variant: variantName
        };
    } else if (baseScore >= 0.8) {
        return { matchType: 'high', score: baseScore, variant: null };
    } else if (baseScore >= 0.5) {
        return { matchType: 'medium', score: baseScore, variant: null };
    } else if (baseScore >= 0.3) {
        return { matchType: 'low', score: baseScore, variant: null };
    } else {
        return { matchType: 'none', score: baseScore, variant: null };
    }
}

/**
 * Sort torrents by relevance with fuzzy matching and variant detection
 * @param {Array} torrents - Array of torrent objects
 * @param {string} searchTitle - Original search title
 * @param {number} season - Season number (optional)
 * @param {number} episode - Episode number (optional)
 * @param {Array} alternativeTitles - Alternative titles from TMDb
 * @returns {Array} - Sorted array of torrents with scoring info
 */
function sortTorrentsByRelevance(torrents, searchTitle, season = null, episode = null, alternativeTitles = []) {
    console.log(`[sortTorrentsByRelevance] Sorting ${torrents.length} torrents`);
    console.log(`[sortTorrentsByRelevance] Search title: "${searchTitle}"`);
    console.log(`[sortTorrentsByRelevance] Alternative titles:`, alternativeTitles.map(alt => alt.title || alt.normalizedTitle || alt).slice(0, 3));
    
    // Score each torrent
    const scoredTorrents = torrents.map(torrent => {
        const torrentTitle = torrent.info?.title || torrent.name || '';
        console.log(`[sortTorrentsByRelevance] Processing torrent: "${torrentTitle}" (from ${torrent.info?.title ? 'info.title' : 'name'})`);
        
        const fuzzyResult = calculateFuzzyScore(searchTitle, torrentTitle, alternativeTitles);
        
        // Simple variant detection using the new function
        const variantResult = detectSimpleVariant(torrentTitle, searchTitle, alternativeTitles);
        console.log(`[sortTorrentsByRelevance] Variant check for "${torrentTitle.substring(0, 40)}...": isVariant=${variantResult.isVariant}, variantName="${variantResult.variantName}"`);
        
        if (variantResult.isVariant) {
            console.log(`[sortTorrentsByRelevance] ✅ Detected variant: "${variantResult.variantName}" for torrent: "${torrentTitle}"`);
        }
        
        // Extract quality info for additional scoring
        const qualityInfo = extractQualityInfo(torrentTitle);
        const qualityScore = qualityInfo.score;
        
        // Combine fuzzy score with quality score
        const finalScore = fuzzyResult.score * 0.7 + qualityScore * 0.3;
        
        return {
            ...torrent,
            fuzzyScore: fuzzyResult.score,
            matchType: variantResult.isVariant ? 'variant' : fuzzyResult.matchType,
            variantName: variantResult.variantName || fuzzyResult.variant,
            qualityScore: qualityScore,
            finalScore: variantResult.isVariant ? finalScore * 0.6 : finalScore // Lower score for variants
        };
    });
    
    // Sort by match type priority, then by final score, then by size
    const sorted = scoredTorrents.sort((a, b) => {
        // Define match type priority (lower number = higher priority)
        const matchTypePriority = {
            'exact': 1,
            'alternative': 2,
            'high': 3,
            'medium': 4,
            'low': 5,
            'variant': 6,  // Variants get lower priority
            'none': 7
        };
        
        const aPriority = matchTypePriority[a.matchType] || 7;
        const bPriority = matchTypePriority[b.matchType] || 7;
        
        if (aPriority !== bPriority) {
            return aPriority - bPriority;
        }
        
        // Within same match type, sort by final score
        if (Math.abs(a.finalScore - b.finalScore) > 0.01) {
            return b.finalScore - a.finalScore;
        }
        
        // Finally, sort by size (larger first, assuming better quality)
        return (b.size || 0) - (a.size || 0);
    });
    
    // Log scoring results
    console.log('[sortTorrentsByRelevance] Scoring results:');
    sorted.slice(0, 5).forEach((torrent, index) => {
        const variantInfo = torrent.variantName ? ` (variant: "${torrent.variantName}")` : '';
        console.log(`  ${index + 1}. [${torrent.matchType.toUpperCase()}] ${torrent.name.substring(0, 60)}...`);
        console.log(`     Fuzzy: ${torrent.fuzzyScore.toFixed(3)}, Quality: ${torrent.qualityScore.toFixed(3)}, Final: ${torrent.finalScore.toFixed(3)}${variantInfo}`);
    });
    
    return sorted;
}

/**
 * Deduplicate search results to avoid duplicate streams
 * @param {Array} results - Array of search results
 * @returns {Array} - Deduplicated results
 */
function deduplicateResults(results) {
    const seen = new Set();
    const deduplicated = [];
    
    for (const result of results) {
        // Create a unique key based on name, size, and extracted quality/episode info
        const name = result.name || '';
        const size = result.size || 0;
        const info = result.info || {};
        const key = `${name}|${size}|${info.season}|${info.episode}|${info.quality}`;
        
        if (!seen.has(key)) {
            seen.add(key);
            deduplicated.push(result);
        }
    }
    
    console.log(`[deduplicateResults] Removed ${results.length - deduplicated.length} duplicates`);
    return deduplicated;
}