import { advancedSearch } from './advanced-search.js'
import { fetchTMDbAlternativeTitles } from './advanced-search.js'
import { detectSimpleVariant } from './advanced-search.js'
import Cinemeta from './util/cinemeta.js'
import DebridLink from './debrid-link.js'
import RealDebrid from './real-debrid.js'
import AllDebrid from './all-debrid.js'
import Premiumize from './premiumize.js'
import TorBox from './torbox.js'
import { BadRequestError } from './util/error-codes.js'
import { FILE_TYPES } from './util/file-types.js'
import { isVideo } from './util/extension-util.js'
import { extractReleaseGroup, isValidReleaseGroup } from './util/groups-util.js'
import { extractQualityDisplay, extractQualityInfo, TECHNICAL_PATTERNS, CLEANUP_PATTERNS, createLanguageMap, createCodecMap, SOURCE_PATTERNS, CODEC_PATTERNS, AUDIO_PATTERNS, LANGUAGE_PATTERNS, COMPREHENSIVE_TECH_PATTERNS } from './util/media-patterns.js'

const STREAM_NAME_MAP = {
    debridlink: "[DL+] DebridSearch",
    realdebrid: "[RD+] DebridSearch",
    alldebrid: "[AD⚡] DebridSearch",
    premiumize: "[PM+] DebridSearch",
    torbox: "[TB+] DebridSearch"
}

// Common setup for both movie and series streams
function setupSearch(config) {
    let tmdbApiKey = config.TmdbApiKey || config.tmdbApiKey
    let traktApiKey = config.TraktApiKey || config.traktApiKey
    
    // Fallback to environment variables if API keys are not provided in config
    if (!tmdbApiKey && process.env.TMDB_API_KEY) {
        tmdbApiKey = process.env.TMDB_API_KEY;
        console.log('[stream-provider] Using TMDb API key from environment variables');
    }
    
    if (!traktApiKey && process.env.TRAKT_API_KEY) {
        traktApiKey = process.env.TRAKT_API_KEY;
        console.log('[stream-provider] Using Trakt API key from environment variables');
    }
    
    const apiKey = config.DebridLinkApiKey ? config.DebridLinkApiKey : config.DebridApiKey
    const provider = config.DebridLinkApiKey ? 'DebridLink' : (config.DebridProvider || 'DebridLink')
    const providers = { AllDebrid, RealDebrid, DebridLink, Premiumize, TorBox }

    // Log API key availability
    console.log('[stream-provider] TMDb API:', tmdbApiKey ? 'Available ✅' : 'Not configured ❌')
    console.log('[stream-provider] Trakt API:', traktApiKey ? 'Available ✅' : 'Not configured ❌')

    const useAdvancedSearch = !!(tmdbApiKey || traktApiKey)
    console.log('[stream-provider] Advanced search:', useAdvancedSearch ? 'Enabled ✅' : 'Disabled ❌')

    return {
        tmdbApiKey,
        traktApiKey,
        apiKey,
        provider,
        providers,
        useAdvancedSearch
    }
}

async function getMovieStreams(config, type, id) {
    const { tmdbApiKey, traktApiKey, apiKey, provider, providers, useAdvancedSearch } = setupSearch(config)
    const cinemetaDetails = await Cinemeta.getMeta(type, id)
    const searchKey = cinemetaDetails.name

    let results = []

    // Try advanced search first if APIs are available
    if (useAdvancedSearch) {
        console.log('Using advanced search with TMDb/Trakt APIs')        
        try {            const searchParams = {
                apiKey, provider, searchKey, type: 'movie',
                imdbId: id, tmdbApiKey, traktApiKey, threshold: 0.1,
                providers
            }
            const advancedSearchResult = await advancedSearch(searchParams)
            const advancedResults = advancedSearchResult?.results || advancedSearchResult
              if (advancedResults?.length) {
                // Advanced search results need detail fetching like classic search
                const detailedResults = await Promise.all(
                    advancedResults
                        .filter(torrent => filterYear(torrent, cinemetaDetails))
                        .map(async (torrent) => {
                            try {
                                // Fetch full torrent details with video files
                                const torrentDetails = await providers[provider].getTorrentDetails(apiKey, torrent.id)
                                
                                // Prepare variant information from fuzzy matching
                                const variantInfo = {
                                    isVariant: torrent.matchType === 'variant',
                                    variantName: torrent.variantName,
                                    matchType: torrent.matchType,
                                    confidence: torrent.fuzzyScore
                                };
                                
                                return toStream(torrentDetails, 'movie', null, variantInfo)
                            } catch (err) {
                                console.warn(`Failed to get details for torrent ${torrent.id}:`, err)
                                return null
                            }
                        })
                )
                
                const validStreams = detailedResults.filter(Boolean)
                if (validStreams.length) {
                    // Sort movies by quality (highest quality first)
                    const sortedStreams = sortMovieStreamsByQuality(validStreams);
                    console.log(`[stream-provider] ✅ Returning ${sortedStreams.length} sorted movie streams from advanced search`)
                    return sortedStreams
                } else {
                    console.log('[stream-provider] ❌ Advanced search found results but none passed filtering')
                    // When advanced search is enabled but returns no valid results, don't fall back to classic search
                    console.log('[stream-provider] 🚫 Advanced search enabled: Not falling back to classic search (empty is the truth)')
                    return []
                }
            } else {
                console.log('[stream-provider] ❌ Advanced search failed: No results found')
                // When advanced search is enabled but returns no results, don't fall back to classic search
                console.log('[stream-provider] 🚫 Advanced search enabled: Not falling back to classic search (empty is the truth)')
                return []
            }
        } catch (e) {
            console.warn('Advanced search failed:', e)
            // When advanced search is enabled but fails, don't fall back to classic search
            console.log('[stream-provider] 🚫 Advanced search enabled but failed: Not falling back to classic search (empty is the truth)')
            return []
        }
    }

    // Classic search - only used when advanced search is disabled
    console.log('[stream-provider] Advanced search disabled - Using classic search')
    if (config.DebridLinkApiKey || config.DebridProvider == "DebridLink") {
        const torrents = await DebridLink.searchTorrents(apiKey, searchKey, 0.1)
        if (torrents && torrents.length) {
            const torrentIds = torrents
                .filter(torrent => filterYear(torrent, cinemetaDetails))
                .map(torrent => torrent.id)

            if (torrentIds && torrentIds.length) {
                return await DebridLink.getTorrentDetails(apiKey, torrentIds.join())
                    .then(torrentDetailsList => {
                        const streams = torrentDetailsList.map(torrentDetails => toStream(torrentDetails))
                        return sortMovieStreamsByQuality(streams)
                    })
            }
        }
    } else if (config.DebridProvider == "RealDebrid") {
        let results = []
        const torrents = await RealDebrid.searchTorrents(apiKey, searchKey, 0.1)
        if (torrents && torrents.length) {
            const streams = await Promise.all(torrents
                .filter(torrent => filterYear(torrent, cinemetaDetails))
                .map(torrent => {
                return RealDebrid.getTorrentDetails(apiKey, torrent.id)
                    .then(torrentDetails => toStream(torrentDetails))
                    .catch(err => {
                        console.warn('Failed to get torrent details:', err)
                        Promise.resolve()
                    })
            }))
            results.push(...streams)
        }

        const downloads = await RealDebrid.searchDownloads(apiKey, searchKey, 0.1)
        if (downloads && downloads.length) {
            const streams = await Promise.all(downloads
                .filter(download => filterYear(download, cinemetaDetails))
                .map(download => {return toStream(download, type)}))
            results.push(...streams)
        }
        const filteredResults = results.filter(stream => stream)
        return sortMovieStreamsByQuality(filteredResults)
    } else if (config.DebridProvider == "AllDebrid") {
        const torrents = await AllDebrid.searchTorrents(apiKey, searchKey, 0.1)
        if (torrents && torrents.length) {
            const streams = await Promise.all(
                torrents
                    .filter(torrent => filterYear(torrent, cinemetaDetails))
                    .map(torrent => {
                        return AllDebrid.getTorrentDetails(apiKey, torrent.id)
                            .then(torrentDetails => toStream(torrentDetails))
                            .catch(err => {
                                console.warn('Failed to get AllDebrid torrent details:', err)
                                Promise.resolve()
                            })
                    })
            )

            const filteredStreams = streams.filter(stream => stream)
            return sortMovieStreamsByQuality(filteredStreams)
        }
    } else if (config.DebridProvider == "Premiumize") {
        const files = await Premiumize.searchFiles(apiKey, searchKey, 0.1)
        if (files && files.length) {
            const streams = await Promise.all(
                files
                    .filter(file => filterYear(file, cinemetaDetails))
                    .map(torrent => {                        return Premiumize.getTorrentDetails(apiKey, torrent.id)
                            .then(torrentDetails => toStream(torrentDetails))
                            .catch(err => {
                                console.warn('Failed to get Premiumize torrent details:', err)
                                Promise.resolve()
                            })
                    })
            )

            const filteredStreams = streams.filter(stream => stream)
            return sortMovieStreamsByQuality(filteredStreams)
        }
    } else if (config.DebridProvider == "TorBox") {
        const torrents = await TorBox.searchTorrents(apiKey, searchKey, 0.1)
        if (torrents && torrents.length) {
            const streams = await Promise.all(
                torrents
                    .filter(torrent => filterYear(torrent, cinemetaDetails))
                    .map(torrentDetails => toStream(torrentDetails))
            )

            const filteredStreams = streams.filter(stream => stream)
            return sortMovieStreamsByQuality(filteredStreams)
        }
    } else {
        return Promise.reject(BadRequestError)
    }

    return []
}

async function getSeriesStreams(config, type, id, _animeRetry = false) {
    const [imdbId, season, episode] = id.split(":")
    const { tmdbApiKey, traktApiKey, apiKey, provider, providers, useAdvancedSearch } = setupSearch(config)
    const cinemetaDetails = await Cinemeta.getMeta(type, imdbId)
    
    if (!cinemetaDetails || !cinemetaDetails.name) {
        return []
    }
    
    const searchKey = cinemetaDetails.name

    if (!apiKey) {
        return []
    }

    let results = []

    // ========== ADVANCED SEARCH WITH BUILT-IN ANIME FALLBACK ==========
    // Advanced search now includes optimized anime fallback in Phase 3
    if (useAdvancedSearch) {
        console.log('[stream-provider] Using advanced search with built-in anime fallback')
        try {
            const advancedSearchResults = await advancedSearch({
                apiKey,
                provider,
                searchKey,
                type: 'series',
                imdbId,
                season,
                episode,
                tmdbApiKey,
                traktApiKey,
                threshold: 0.1,
                providers
            })

            if (advancedSearchResults.results && advancedSearchResults.results.length > 0) {
                console.log(`[stream-provider] ✅ Advanced search successful: Found ${advancedSearchResults.results.length} results`)
                
                // Determine which season/episode to filter by (use mapped values if anime mapping was used)
                let targetSeason = season;
                let targetEpisode = episode;
                
                if (advancedSearchResults.animeMapping) {
                    targetSeason = advancedSearchResults.animeMapping.mappedSeason;
                    targetEpisode = advancedSearchResults.animeMapping.mappedEpisode;
                    console.log(`[stream-provider] Using anime mapped filter: S${targetSeason}E${targetEpisode} (original: S${season}E${episode})`);
                }
                
                // Process results and add anime mapping indicator if present
                console.log(`[stream-provider] Processing ${advancedSearchResults.results.length} results with target S${targetSeason}E${targetEpisode}`)
                
                // Debug: Log the structure of each result
                advancedSearchResults.results.forEach((result, index) => {
                    console.log(`[stream-provider] Result ${index + 1}:`, {
                        name: result?.name || 'UNDEFINED',
                        videoCount: result?.videos?.length || 0,
                    });
                });
                
                const detailedResults = await Promise.all(
                    advancedSearchResults.results
                        .filter((torrent, index) => {
                            const torrentName = torrent?.name || torrent?.filename || 'Unknown';
                            const seasonMatch = filterSeason(torrent, targetSeason);
                            console.log(`[stream-provider] Torrent ${index + 1}: "${torrentName}" - Season filter (S${targetSeason}): ${seasonMatch ? '✅ PASS' : '❌ FAIL'}`);
                            return seasonMatch;
                        })
                        .map(async (torrent, index) => {
                            try {
                                const torrentName = torrent?.name || torrent?.filename || 'Unknown';
                                console.log(`[stream-provider] Processing torrent after season filter: "${torrentName}"`);
                                
                                // Check if torrent already has details (from advanced search optimization)
                                const torrentDetails = torrent.videos ? torrent : await providers[provider].getTorrentDetails(apiKey, torrent.id)
                                
                                console.log(`[stream-provider] Torrent details - videos count: ${torrentDetails.videos?.length || 0}`);
                                if (torrentDetails.videos?.length > 0) {
                                    console.log(`[stream-provider] First video: "${torrentDetails.videos[0].name}"`);
                                }
                                
                                const episodeMatch = filterEpisode(torrentDetails, targetSeason, targetEpisode, advancedSearchResults.absoluteEpisode);
                                console.log(`[stream-provider] Episode filter (S${targetSeason}E${targetEpisode}): ${episodeMatch ? '✅ PASS' : '❌ FAIL'}`);
                                
                                if (episodeMatch) {
                                    // Pass the known season/episode info to toStream for proper formatting
                                    const knownSeasonEpisode = {
                                        season: targetSeason,
                                        episode: targetEpisode,
                                        absoluteEpisode: advancedSearchResults.absoluteEpisode
                                    };
                                    
                                    // Prepare variant information from fuzzy matching
                                    const variantInfo = {
                                        isVariant: torrent.matchType === 'variant',
                                        variantName: torrent.variantName,
                                        matchType: torrent.matchType,
                                        confidence: torrent.fuzzyScore
                                    };
                                    
                                    let stream = toStream(torrentDetails, type, knownSeasonEpisode, variantInfo);
                                    
                                    // Add anime mapping indicator if present
                                    if (torrent.animeMapping || advancedSearchResults.animeMapping) {
                                        const mapping = torrent.animeMapping || advancedSearchResults.animeMapping
                                        stream.name = `${stream.name}\n🎌 Anime S${mapping.originalSeason}E${mapping.originalEpisode}→S${mapping.mappedSeason}E${mapping.mappedEpisode}`
                                    }
                                    
                                    console.log(`[stream-provider] ✅ Successfully created stream for: "${torrentName}"`);
                                    return stream;
                                } else {
                                    // Advanced search already found this video as a match, so if normal filtering fails,
                                    // let's trust the advanced search and use the video anyway but with a warning
                                    console.log(`[stream-provider] ⚠️ Episode filter failed but advanced search selected this video - using anyway`);
                                    
                                    const knownSeasonEpisode = {
                                        season: targetSeason,
                                        episode: targetEpisode,
                                        absoluteEpisode: advancedSearchResults.absoluteEpisode
                                    };
                                    
                                    // Prepare variant information from fuzzy matching
                                    const variantInfo = {
                                        isVariant: torrent.matchType === 'variant',
                                        variantName: torrent.variantName,
                                        matchType: torrent.matchType,
                                        confidence: torrent.fuzzyScore
                                    };
                                    
                                    let stream = toStream(torrentDetails, type, knownSeasonEpisode, variantInfo);
                                    
                                    // Add anime mapping indicator if present
                                    if (torrent.animeMapping || advancedSearchResults.animeMapping) {
                                        const mapping = torrent.animeMapping || advancedSearchResults.animeMapping
                                        stream.name = `${stream.name}\n🎌 Anime S${mapping.originalSeason}E${mapping.originalEpisode}→S${mapping.mappedSeason}E${mapping.mappedEpisode}`
                                    }
                                    
                                    console.log(`[stream-provider] ✅ Successfully created stream for: "${torrentName}" (trusted advanced search)`);
                                    return stream;
                                }
                            } catch (err) {
                                console.warn(`[stream-provider] ❌ Failed to get details for torrent "${torrentName}":`, err)
                                return null
                            }
                        })
                )
                
                const validStreams = detailedResults.filter(Boolean)
                if (validStreams.length) {
                    // Deduplicate streams by video file name and torrent name to avoid duplicates
                    const deduplicatedStreams = deduplicateStreams(validStreams);
                    
                    // Sort series streams by quality (same as movies - highest quality first)
                    const sortedStreams = sortMovieStreamsByQuality(deduplicatedStreams);
                    console.log(`[stream-provider] ✅ Returning ${sortedStreams.length} sorted series streams from advanced search (deduplicated from ${validStreams.length})`)
                    return sortedStreams
                } else {
                    console.log(`[stream-provider] ❌ Advanced search found ${advancedSearchResults.results.length} results but none passed filtering`)
                    // When advanced search is enabled but returns no valid results, don't fall back to classic search
                    console.log('[stream-provider] 🚫 Advanced search enabled: Not falling back to classic search (empty is the truth)')
                    return []
                }
            } else {
                console.log('[stream-provider] ❌ Advanced search with anime fallback failed: No results found')
                // When advanced search is enabled but returns no results, don't fall back to classic search
                console.log('[stream-provider] 🚫 Advanced search enabled: Not falling back to classic search (empty is the truth)')
                return []
            }
        } catch (e) {
            console.warn('[stream-provider] Advanced search failed:', e)
            // When advanced search is enabled but fails, don't fall back to classic search
            console.log('[stream-provider] 🚫 Advanced search enabled but failed: Not falling back to classic search (empty is the truth)')
            return []
        }
    }

    // Classic search - only used when advanced search is disabled
    console.log('[stream-provider] Advanced search disabled - Using classic search')
    let classicResults = []
    
    if (config.DebridLinkApiKey || config.DebridProvider == "DebridLink") {
        const torrents = await DebridLink.searchTorrents(apiKey, searchKey, 0.1)
        if (torrents && torrents.length) {
            const torrentIds = torrents
                .filter(torrent => filterSeason(torrent, season))
                .map(torrent => torrent.id)

            if (torrentIds && torrentIds.length) {
                classicResults = await DebridLink.getTorrentDetails(apiKey, torrentIds.join())
                    .then(torrentDetailsList => {
                        return torrentDetailsList
                            .filter(torrentDetails => filterEpisode(torrentDetails, season, episode))
                            .map(torrentDetails => toStream(torrentDetails, type))
                    })
            }
        }
    } else if (config.DebridProvider == "RealDebrid") {
        let results = []
        const torrents = await RealDebrid.searchTorrents(apiKey, searchKey, 0.1)
        if (torrents && torrents.length) {
            const streams = await Promise.all(torrents
                .filter(torrent => filterSeason(torrent, season))
                .map(torrent => {                    return RealDebrid.getTorrentDetails(apiKey, torrent.id)
                        .then(torrentDetails => {
                            if (filterEpisode(torrentDetails, season, episode)) {
                                return toStream(torrentDetails, type)
                            }
                        })
                        .catch(err => {
                            console.warn('Failed to get RealDebrid torrent details:', err)
                            Promise.resolve()
                        })
                }))
            results.push(...streams)
        }

        const downloads = await RealDebrid.searchDownloads(apiKey, searchKey, 0.1)
        if (downloads && downloads.length) {
            const streams = await Promise.all(downloads
                .filter(download => filterDownloadEpisode(download, season, episode))
                .map(download => {return toStream(download, type)}))
            results.push(...streams)
        }
        classicResults = results.filter(stream => stream)
    } else if (config.DebridProvider == "AllDebrid") {
        const torrents = await AllDebrid.searchTorrents(apiKey, searchKey, 0.1)
        if (torrents && torrents.length) {
            const streams = await Promise.all(torrents
                .filter(torrent => filterSeason(torrent, season))
                .map(torrent => {                    return AllDebrid.getTorrentDetails(apiKey, torrent.id)
                        .then(torrentDetails => {
                            if (filterEpisode(torrentDetails, season, episode)) {
                                return toStream(torrentDetails, type)
                            }
                        })
                        .catch(err => {
                            console.warn('Failed to get AllDebrid torrent details:', err)
                            Promise.resolve()
                        })
                })
            )

            classicResults = streams.filter(stream => stream)
        }
    } else if (config.DebridProvider == "Premiumize") {
        const torrents = await Premiumize.searchFiles(apiKey, searchKey, 0.1)
        if (torrents && torrents.length) {
            const streams = await Promise.all(torrents
                .filter(torrent => filterSeason(torrent, season))
                .map(torrent => {                    return Premiumize.getTorrentDetails(apiKey, torrent.id)
                        .then(torrentDetails => {
                            if (filterEpisode(torrentDetails, season, episode)) {
                                return toStream(torrentDetails, type)
                            }
                        })
                        .catch(err => {
                            console.warn('Failed to get Premiumize torrent details:', err)
                            Promise.resolve()
                        })
                })
            )

            classicResults = streams.filter(stream => stream)
        }
    } else if (config.DebridProvider == "TorBox") {
        const torrents = await TorBox.searchTorrents(apiKey, searchKey, 0.1)
        if (torrents && torrents.length) {
            const streams = await Promise.all(
                torrents
                    .filter(torrent => filterEpisode(torrent, season, episode))
                    .map(torrentDetails => toStream(torrentDetails, type))
            )
            classicResults = streams.filter(stream => stream)
        }
    } else {
        return Promise.reject(BadRequestError)
    }
    
    // If classic search found results, sort and return them
    if (classicResults && classicResults.length > 0) {
        const sortedClassicResults = sortMovieStreamsByQuality(classicResults);
        console.log(`[stream-provider] ✅ Returning ${sortedClassicResults.length} sorted series streams from classic search`)
        return sortedClassicResults
    }

    // If neither advanced nor classic search found results, return empty array
    console.log('[stream-provider] ❌ No results found from either advanced or classic search')
    return []
}

async function resolveUrl(debridProvider, debridApiKey, itemId, hostUrl, clientIp) {
    if (debridProvider == "DebridLink" || debridProvider == "Premiumize") {
        return hostUrl
    } else if (debridProvider == "RealDebrid") {
        return RealDebrid.unrestrictUrl(debridApiKey, hostUrl, clientIp)
    } else if (debridProvider == "AllDebrid") {
        return AllDebrid.unrestrictUrl(debridApiKey, hostUrl)
    } else if (debridProvider == "TorBox") {
        return TorBox.unrestrictUrl(debridApiKey, itemId, hostUrl, clientIp)
    } else {
        return Promise.reject(BadRequestError)
    }
}

function filterSeason(torrent, season) {
    const torrentSeason = torrent?.info?.season;
    const torrentSeasons = torrent?.info?.seasons;
    const seasonMatch = torrentSeason == season || torrentSeasons?.includes(Number(season));
    
    // Debug logging for season filtering
    console.log(`[filterSeason] Checking torrent: "${torrent?.name || 'UNKNOWN'}" | Target season: ${season} | Torrent season: ${torrentSeason} | Torrent seasons: ${JSON.stringify(torrentSeasons)} | Match: ${seasonMatch}`);
    
    return seasonMatch;
}

function filterEpisode(torrentDetails, season, episode, absoluteEpisode = null) {
    // Enhanced episode filtering to handle both classic and absolute episode numbering
    // Two-pass approach: first check for classic matches, only try absolute if no classic found
    
    let classicMatches = [];
    let potentialAbsoluteMatches = [];
    
    // PASS 1: Find all classic S##E## matches
    torrentDetails.videos.forEach(video => {
        const videoSeason = video.info.season;
        const videoEpisode = video.info.episode;
        
        if (season == videoSeason && episode == videoEpisode) {
            console.log(`[filterEpisode] ✅ Classic match: S${videoSeason}E${videoEpisode} matches S${season}E${episode}`);
            classicMatches.push(video);
        }
    });
    
    // If we found classic matches, use only those and skip absolute matching
    if (classicMatches.length > 0) {
        console.log(`[filterEpisode] Using ${classicMatches.length} classic matches, skipping absolute matching`);
        torrentDetails.videos = classicMatches;
        return true;
    }
    
    // PASS 2: Only try absolute episode matching if no classic matches were found
    if (typeof absoluteEpisode === 'number') {
        console.log(`[filterEpisode] No classic matches found, trying absolute episode matching for ${absoluteEpisode}`);
        
        torrentDetails.videos.forEach(video => {
            const videoSeason = video.info.season;
            
            // First check: if we have season info and it doesn't match, skip absolute matching
            if (videoSeason && videoSeason != season) {
                console.log(`[filterEpisode] ❌ Skipping absolute matching: video is S${videoSeason}, looking for S${season}`);
                return;
            }
            
            // Only proceed with absolute matching if:
            // 1. No season info (videoSeason is null/undefined), OR
            // 2. Season matches what we're looking for
            
            // Pattern matching for absolute episodes in filename (more restrictive)
            const absolutePattern = new RegExp(`\\b0*${absoluteEpisode}\\b`);
            if (absolutePattern.test(video.name)) {
                // Extra validation: make sure it's not just matching episode numbers in wrong season
                const seasonPattern = new RegExp(`[Ss]0*(\\d+)`, 'i');
                const seasonMatch = video.name.match(seasonPattern);
                
                if (seasonMatch) {
                    const fileSeason = parseInt(seasonMatch[1], 10);
                    if (fileSeason !== parseInt(season, 10)) {
                        console.log(`[filterEpisode] ❌ Absolute pattern matched but wrong season: file has S${fileSeason}, looking for S${season}`);
                        return;
                    }
                }
                
                console.log(`[filterEpisode] ✅ Absolute match: episode ${absoluteEpisode} in "${video.name}"`);
                potentialAbsoluteMatches.push(video);
                return;
            }
            
            // Check if video has absolute episode info that matches
            if (video.info.absoluteEpisode && 
                parseInt(video.info.absoluteEpisode, 10) === parseInt(absoluteEpisode, 10)) {
                console.log(`[filterEpisode] ✅ Absolute info match: ${video.info.absoluteEpisode} = ${absoluteEpisode}`);
                potentialAbsoluteMatches.push(video);
                return;
            }
        });
        
        if (potentialAbsoluteMatches.length > 0) {
            console.log(`[filterEpisode] Using ${potentialAbsoluteMatches.length} absolute matches`);
            torrentDetails.videos = potentialAbsoluteMatches;
            return true;
        }
    }
    
    // No matches found
    console.log(`[filterEpisode] ❌ No matches found for S${season}E${episode} (abs: ${absoluteEpisode})`);
    torrentDetails.videos = [];
    return false;
}

function filterYear(torrent, cinemetaDetails) {
    if (torrent?.info?.year && cinemetaDetails?.year) {
        return torrent.info.year == cinemetaDetails.year
    }

    return true
}

function filterDownloadEpisode(download, season, episode) {
    return download && download.info.season == season && download.info.episode == episode
}

function toStream(details, type, knownSeasonEpisode = null, variantInfo = null, searchContext = null) {
    if (!details) return null;

    let video, icon
    if (details.fileType == FILE_TYPES.DOWNLOADS) {
        icon = '⬇️'
        video = details
    } else {
        icon = '💾'
        // Safely handle videos array
        if (!details.videos?.length) return null;
        
        // After episode filtering, videos array should contain only matching episodes
        // Take the first video (don't re-sort by size as it might pick wrong episode)
        video = details.videos[0];
        
        // Only sort by size if there are multiple videos of the same episode
        if (details.videos.length > 1) {
            // Check if all videos are for the same episode
            const firstEpisodeId = `${details.videos[0].info?.season}x${details.videos[0].info?.episode}`;
            const allSameEpisode = details.videos.every(v => 
                `${v.info?.season}x${v.info?.episode}` === firstEpisodeId
            );
            
            if (allSameEpisode) {
                // All videos are same episode, pick largest
                details.videos.sort((a, b) => b.size - a.size);
                video = details.videos[0];
            }
            // If not all same episode, keep the first one (episode filtering should have handled this)
        }
    }

    if (!video) return null;

    // Enhanced quality extraction with emojis
    const quality = extractQuality(video, details);
    
    // Enhanced name with quality emojis
    let name = STREAM_NAME_MAP[details.source] || 'Unknown'
    name = name + '\n' + quality

    // Enhanced title formatting - pass known season/episode info and variant info if available
    let title = formatStreamTitle(details, video, type, icon, knownSeasonEpisode, variantInfo, searchContext);

    let bingeGroup = details.source + '|' + details.id

    return {
        name,
        title,
        url: video.url,
        behaviorHints: {
            bingeGroup: bingeGroup
        }
    }
}

/**
 * Extract quality information from video and torrent details with emoji indicators
 * @param {Object} video - Video file details
 * @param {Object} details - Torrent details
 * @returns {string} - Formatted quality string with emoji
 */
function extractQuality(video, details) {
    const videoName = video.name || '';
    const torrentName = details.name || '';
    const combinedName = `${torrentName} ${videoName}`;
    
    console.log(`[extractQuality] Analyzing: "${combinedName}"`);
    
    // Use centralized quality extraction with fallback support
    const fallbackInfo = {
        resolution: video.info?.resolution || details.info?.resolution
    };
    
    const quality = extractQualityDisplay(combinedName, fallbackInfo);
    console.log(`[extractQuality] Found quality: ${quality}`);
    
    return quality;
}

function formatSize(size) {
    if (!size) {
        return undefined
    }

    const i = size === 0 ? 0 : Math.floor(Math.log(size) / Math.log(1024))
    return Number((size / Math.pow(1024, i)).toFixed(2)) + ' ' + ['B', 'kB', 'MB', 'GB', 'TB'][i]
}

/**
 * Calculate string similarity using a simple algorithm
 * @param {string} str1 - First string
 * @param {string} str2 - Second string
 * @returns {number} - Similarity ratio between 0 and 1
 */
function calculateStringSimilarity(str1, str2) {
    if (!str1 || !str2) return 0;
    if (str1 === str2) return 1;
    
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;
    
    if (longer.length === 0) return 1;
    
    const editDistance = levenshteinDistance(longer, shorter);
    return (longer.length - editDistance) / longer.length;
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
 * Extract series information (title, season, episode) from filename
 * @param {string} videoName - Video filename
 * @param {string} containerName - Container name
 * @returns {Object} - Extracted series info
 */
function extractSeriesInfo(videoName, containerName) {
    const name = videoName || containerName || '';
    
    let seasonEpisode = 'Unknown Episode';
    let title = name;
    let episodeName = null;
    
    // Try multiple season/episode patterns (order matters - most specific first)
    const patterns = [
        { regex: /[Ss](\d+)[Ee](\d+)/, type: 'standard' },           // S01E01
        { regex: /[Ss](\d+)\s*-\s*(\d+)/, type: 'dash' },            // S5 - 14
        { regex: /\b([IVX]+)\s*-\s*(\d+)/, type: 'roman' },          // III - 06
        { regex: /\b([IVX]+)\s+(\d+)/, type: 'roman_space' },        // I 04
        { regex: /(\d+)x(\d+)/, type: 'standard' },                  // 1x01
        { regex: /[Ee](\d+)/, type: 'episode_only' },                // E07 (assume season 1)
        // Add absolute episode patterns for anime-style filenames
        { regex: /\b(\d{3})\s/, type: 'absolute' }                   // DanMachi 031 MULTI
    ];
    
    let seasonEpisodeMatch = null;
    let matchType = null;
    
    for (const pattern of patterns) {
        seasonEpisodeMatch = name.match(pattern.regex);
        if (seasonEpisodeMatch) {
            matchType = pattern.type;
            break;
        }
    }
    
    if (seasonEpisodeMatch) {
        let season, episode;
        
        if (matchType === 'roman' || matchType === 'roman_space') {
            season = romanToNumber(seasonEpisodeMatch[1]) || 1;
            episode = parseInt(seasonEpisodeMatch[2]);
        } else if (matchType === 'episode_only') {
            season = 1; // Default to season 1 when only episode is found
            episode = parseInt(seasonEpisodeMatch[1]);
        } else if (matchType === 'absolute') {
            // For absolute episodes, we don't know the exact season/episode
            // This will be handled by advanced search later
            seasonEpisode = 'Unknown Episode';
            // Extract only the series name (everything before the absolute episode number)
            title = name.substring(0, seasonEpisodeMatch.index).trim();
        } else {
            season = parseInt(seasonEpisodeMatch[1]);
            episode = parseInt(seasonEpisodeMatch[2]);
        }
        
        if (matchType !== 'absolute') {
            seasonEpisode = `S${season.toString().padStart(2, '0')}E${episode.toString().padStart(2, '0')}`;
            // Extract title (everything before the season/episode pattern)
            title = name.substring(0, seasonEpisodeMatch.index).trim();
        }
    } else {
        // For files without clear patterns, try to extract a reasonable series title
        // Look for common series title patterns at the beginning
        const titleMatch = name.match(/^([A-Za-z][A-Za-z0-9\s]*?)(?:\s+\d{3,}|\s+[Ss]\d+|\s+[IVX]+|\s*[\[\(])/);
        if (titleMatch) {
            title = titleMatch[1].trim();
        }
    }
    
    // Clean up the title - remove group tags and clean separators
    title = title
        .replace(/^[\[\(][^\]\)]*[\]\)]\s*/, '') // Remove group tags at start like [Group]
        .replace(/[\._]/g, ' ')                   // Replace dots and underscores with spaces
        .replace(/\s*-\s*$/, '')                  // Remove trailing dash
        .replace(/\s+/g, ' ')                     // Collapse multiple spaces
        .trim();
    
    // If title is still too long or contains technical terms, try to shorten it
    if (title.length > 50 || title.match(/\b(MULTI|BluRay|1080p|720p|x264|x265|HEVC|mkv)\b/i)) {
        // Try to extract just the actual series name from the beginning
        const shortTitleMatch = title.match(/^([A-Za-z][A-Za-z0-9\s]{2,25}?)(?:\s+\d+|\s+(MULTI|BluRay|1080p|720p|x264|x265|HEVC))/i);
        if (shortTitleMatch) {
            title = shortTitleMatch[1].trim();
        }
    }
    
    // If title is too short, try container name
    if (!title || title.length < 3) {
        title = (containerName || 'Unknown Series')
            .replace(/^[\[\(][^\]\)]*[\]\)]\s*/, '')
            .replace(/[\._]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim() || 'Unknown Series';
    }
    
    // Extract episode name from various patterns
    const episodePatterns = [
        /"([^"]+)"/,           // Double quotes: "Episode Name"
        /'([^']+)'/,           // Single quotes: 'Episode Name'
        // Pattern for: Series - SxxExx - Episode Name (technical info)
        /- [Ss]\d+[Ee]\d+ - ([^(]+?)(?:\s*\([^)]*\)|$)/
    ];
    
    console.log(`[extractSeriesInfo] Checking for episode names in: "${name}"`);
    console.log(`[extractSeriesInfo] Series title: "${title}"`);
    
    for (const pattern of episodePatterns) {
        const match = name.match(pattern);
        if (match && match[1] && match[1].trim().length > 2) {
            const content = match[1].trim();
            console.log(`[extractSeriesInfo] Found episode name pattern: "${content}"`);
            
            // Skip technical patterns
            if (content.match(/^\d+p$|^x26[45]$|^hevc$|^avc$|^10bits?$/i) || 
                content.match(/^[A-Z0-9]{8}$/i) || // Skip hashes
                content.match(/^(VRV|Multiple Subtitle|1080p|720p|480p)$/i)) {
                console.log(`[extractSeriesInfo] Skipping technical pattern: "${content}"`);
                continue;
            }
            
            // For redundancy check, use only the clean series title, not the whole filename
            // This fixes the issue where "DanMachi 031 MULTI..." was being used as the title
            const cleanTitleForComparison = title.replace(/\d+/g, '').replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
            const normalizedTitle = cleanTitleForComparison.toLowerCase();
            const normalizedContent = content.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
            
            console.log(`[extractSeriesInfo] Normalized title for comparison: "${normalizedTitle}"`);
            console.log(`[extractSeriesInfo] Normalized content: "${normalizedContent}"`);
            
            // Check if the episode name is too similar to the series title
            const titleWords = normalizedTitle.split(' ').filter(word => word.length > 3);
            const isRedundant = titleWords.some(word => {
                if (word.length > 4 && normalizedContent.includes(word)) {
                    console.log(`[extractSeriesInfo] Found redundant word: "${word}" in "${normalizedContent}"`);
                    return true;
                }
                return false;
            });
            
            // Also skip if episode name is just the series title or contains too much of it
            const similarity = calculateStringSimilarity(normalizedTitle, normalizedContent);
            console.log(`[extractSeriesInfo] Similarity: ${similarity}, Redundant: ${isRedundant}`);
            
            if (!isRedundant && similarity < 0.7 && content.length > 3) {
                console.log(`[extractSeriesInfo] ✅ Using episode name: "${content}"`);
                episodeName = content;
                break;
            } else {
                console.log(`[extractSeriesInfo] ❌ Rejecting episode name: "${content}" (redundant: ${isRedundant}, similarity: ${similarity})`);
            }
        }
    }
    
    return {
        title: title,
        seasonEpisode: seasonEpisode,
        episodeName: episodeName
    };
}

/**
 * Extract movie information (title, year) from filename
 * @param {string} movieName - Movie filename
 * @returns {Object} - Extracted movie info
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
        cleanTitleOnly: cleanTitle  // For technical details filtering
    };
}

/**
 * Extract and enhance technical details
 * @param {string} name - Filename to analyze
 * @param {string} titleToRemove - Title to remove from details
 * @param {string} releaseGroupToRemove - Release group to remove from details
 * @returns {string} - Enhanced technical details
 */
function extractTechnicalDetails(name, titleToRemove = '', releaseGroupToRemove = '', episodeNameToRemove = '') {
    // New approach: Extract only recognized technical details instead of removing everything else
    // Note: Quality is already shown in the stream name, so we skip it here
    
    // Separate arrays for different types of details to control ordering
    const languageDetails = [];
    const sourceDetails = [];
    const codecDetails = [];
    const audioDetails = [];
    const techDetails = [];
    
    // 1. Extract Languages FIRST using centralized patterns
    for (const pattern of LANGUAGE_PATTERNS) {
        if (pattern.pattern.test(name) && !languageDetails.some(detail => detail.includes(pattern.displayName))) {
            languageDetails.push(`${pattern.emoji} ${pattern.displayName}`);
        }
    }
    
    // 2. Extract Source (BluRay, WEB-DL, etc.) using centralized patterns
    for (const pattern of SOURCE_PATTERNS) {
        if (pattern.pattern.test(name)) {
            sourceDetails.push(`${pattern.emoji} ${pattern.displayName}`);
            break; // Only match first source
        }
    }
    
    // 3. Extract Codecs using centralized patterns
    for (const pattern of CODEC_PATTERNS) {
        if (pattern.pattern.test(name)) {
            codecDetails.push(`${pattern.emoji} ${pattern.codec}`);
            // Don't break - can have multiple codecs (video + audio)
        }
    }
    
    // 4. Extract Audio information - prioritize more specific patterns over generic ones
    const foundAudio = new Set();
    const audioMatches = [];
    
    // First pass: collect all matching audio patterns
    for (const pattern of AUDIO_PATTERNS) {
        if (pattern.pattern.test(name)) {
            audioMatches.push(pattern);
        }
    }
    
    // Second pass: filter out generic patterns if specific ones exist
    for (const pattern of audioMatches) {
        const isGeneric = audioMatches.some(otherPattern => {
            if (otherPattern === pattern) return false;
            
            // Check if this pattern is a subset/generic version of another more specific pattern
            const currentAudio = pattern.audio.toLowerCase().replace(/[^\w]/g, '');
            const otherAudio = otherPattern.audio.toLowerCase().replace(/[^\w]/g, '');
            
            // If current audio is contained in other audio, it's generic
            // e.g., "dts" is contained in "dtsx"
            return otherAudio.includes(currentAudio) && currentAudio.length < otherAudio.length;
        });
        
        if (!isGeneric && !foundAudio.has(pattern.audio)) {
            audioDetails.push(`${pattern.emoji} ${pattern.audio}`);
            foundAudio.add(pattern.audio);
        }
    }
    
    // 5. Extract comprehensive technical terms using centralized patterns
    // Since overlapping audio patterns have been removed from COMPREHENSIVE_TECH_PATTERNS,
    // we can use simpler logic here
    for (const tech of COMPREHENSIVE_TECH_PATTERNS) {
        if (tech.pattern.test(name) && !techDetails.some(detail => detail.includes(tech.display))) {
            techDetails.push(tech.display);
        }
    }
    
    // Combine all details with languages first
    const detectedDetails = [
        ...languageDetails,
        ...sourceDetails, 
        ...codecDetails,
        ...audioDetails,
        ...techDetails
    ];
    
    // 6. Remove duplicates while preserving order
    const uniqueDetails = [];
    const seenDetails = new Set();
    
    for (const detail of detectedDetails) {
        const normalized = detail.toLowerCase().replace(/[^\w]/g, '');
        if (!seenDetails.has(normalized)) {
            seenDetails.add(normalized);
            uniqueDetails.push(detail);
        }
    }
    
    return uniqueDetails.join(' • ');
}

/**
 * Remove file extension from filename
 * @param {string} filename - Filename to process
 * @returns {string} - Filename without extension
 */
function removeExtension(filename) {
    if (!filename) return filename;
    
    // Remove common video extensions
    return filename.replace(/\.(mkv|mp4|avi|m4v|mov|wmv|flv|webm|ogm|ts|m2ts|3g2|3gp|mpe|mpeg|mpg|mpv|mk3d|mp2)$/i, '');
}

/**
 * Roman numeral conversion
 * @param {string} roman - Roman numeral string
 * @returns {number|null} - Converted number or null
 */
function romanToNumber(roman) {
    const romanMap = { 
        'I': 1, 'II': 2, 'III': 3, 'IV': 4, 'V': 5, 
        'VI': 6, 'VII': 7, 'VIII': 8, 'IX': 9, 'X': 10 
    };
    return romanMap[roman.toUpperCase()] || null;
}

/**
 * Format stream title with enhanced multi-line layout
 * @param {Object} details - Torrent details
 * @param {Object} video - Video file details
 * @param {string} type - Content type (movie/series)
 * @param {string} icon - File type icon
 * @returns {string} - Formatted title
 */
function formatStreamTitle(details, video, type, icon, knownSeasonEpisode = null, variantInfo = null, searchContext = null) {
    const containerName = details.containerName || details.name || 'Unknown';
    const videoName = video.name || '';
    const size = formatSize(video?.size || 0);
    
    if (type === 'series') {
        const seriesInfo = extractSeriesInfo(videoName, containerName);
        const releaseGroup = extractReleaseGroup(videoName || containerName);
        
        // Detect variants using the clean series title if search context is available
        let detectedVariant = null;
        if (searchContext && searchContext.searchTitle && searchContext.alternativeTitles) {
            detectedVariant = detectSimpleVariant(seriesInfo.title, searchContext.searchTitle, searchContext.alternativeTitles);
        }
        
        // Use known season/episode info if provided (from advanced search), but be conservative
        let seasonEpisode = seriesInfo.seasonEpisode;
        if (knownSeasonEpisode && knownSeasonEpisode.season && knownSeasonEpisode.episode) {
            const season = String(knownSeasonEpisode.season).padStart(2, '0');
            const episode = String(knownSeasonEpisode.episode).padStart(2, '0');
            const knownSeasonEpisodeStr = `S${season}E${episode}`;
            
            // Only override if the filename doesn't have clear season/episode info or if it's season 0
            const shouldOverride = 
                seriesInfo.seasonEpisode === 'Unknown Episode' ||
                seriesInfo.seasonEpisode.startsWith('S00E');
            
            if (shouldOverride) {
                seasonEpisode = knownSeasonEpisodeStr;
                console.log(`[formatStreamTitle] Using advanced search season/episode: ${knownSeasonEpisodeStr} (filename had: ${seriesInfo.seasonEpisode})`);
            } else {
                console.log(`[formatStreamTitle] Keeping filename season/episode: ${seriesInfo.seasonEpisode} (advanced search: ${knownSeasonEpisodeStr})`);
            }
        }
        
        const lines = [];
        
        // Line 1: Original video torrent name as it comes from debrid provider (with folder emoji)
        lines.push(`📁 ${videoName || containerName}`);
        
        // Line 2: Clean series title with season/episode
        const cleanTitle = seriesInfo.title.replace(/[\[\]()]/g, '').trim();
        lines.push(`${cleanTitle} - ${seasonEpisode}`);
        
        // Line 3: Variant information if this is a spin-off or variant
        if (detectedVariant && detectedVariant.isVariant && detectedVariant.variantName) {
            lines.push(`🔄 Variant: ${detectedVariant.variantName}`);
        } else if (variantInfo && variantInfo.isVariant && variantInfo.variantName) {
            lines.push(`🔄 Variant: ${variantInfo.variantName}`);
        }
        
        // Line 3 or 4: Episode name if found
        if (seriesInfo.episodeName) {
            lines.push(`📺 "${seriesInfo.episodeName}"`);
        }
        
        // Line 4 or 5: Enhanced technical details with good emojis for easy reading
        const techDetails = extractTechnicalDetails(removeExtension(videoName || containerName), seriesInfo.title, releaseGroup, seriesInfo.episodeName);
        if (techDetails && techDetails.length > 0) {
            lines.push(`⚙️ ${techDetails}`);
        }
        
        // Final line: Season/Episode formatted as "Sxx - Exx" + Size with icon + Release Group
        const seasonPart = seasonEpisode.substring(0, 3); // S01
        const episodePart = seasonEpisode.substring(3);    // E04
        let sizeLine = `${seasonPart} - ${episodePart} • ${icon} ${size}`;
        if (releaseGroup && releaseGroup.trim().length > 0 && isValidReleaseGroup(releaseGroup)) {
            sizeLine += ` • 👥 [${releaseGroup}]`;
        }
        lines.push(sizeLine);
        
        return lines.join('\n');
        
    } else {
        // Movie format - keep original structure but improved
        const movieInfo = extractMovieInfo(removeExtension(videoName || containerName));
        const releaseGroup = extractReleaseGroup(videoName || containerName);
        
        const lines = [];
        
        // Line 1: Original video torrent name as it comes from debrid provider (with folder emoji)
        lines.push(`📁 ${videoName || containerName}`);
        
        // Line 2: Clean movie title with year
        lines.push(movieInfo.title);
        
        // Line 3: Variant information if this is a spin-off or variant
        if (variantInfo && variantInfo.isVariant && variantInfo.variantName) {
            lines.push(`🔄 Variant: ${variantInfo.variantName}`);
        }
        
        // Line 3 or 4: Enhanced technical details with good emojis for easy reading
        const techDetails = extractTechnicalDetails(removeExtension(videoName || containerName), movieInfo.cleanTitleOnly, releaseGroup, '');
        if (techDetails && techDetails.length > 0) {
            lines.push(`⚙️ ${techDetails}`);
        }
        
        // Final line: Size with icon + Release Group
        let sizeLine = `${icon} ${size}`;
        if (releaseGroup && releaseGroup.trim().length > 0 && isValidReleaseGroup(releaseGroup)) {
            sizeLine += ` • 👥 [${releaseGroup}]`;
        }
        lines.push(sizeLine);
        
        return lines.join('\n');
    }
}

/**
 * Extract canonical title and variant using fuzzy matching with TMDb alternative titles
 * @param {string} torrentTitle - The title extracted from the torrent name
 * @param {string} tmdbApiKey - TMDb API key
 * @param {string} imdbId - IMDb ID for the series
 * @returns {Promise<Object>} - { canonicalTitle, variant }
 */
async function extractCanonicalTitleWithFuzzyMatching(torrentTitle, tmdbApiKey, imdbId) {
    if (!tmdbApiKey || !imdbId || !torrentTitle) {
        return { canonicalTitle: torrentTitle, variant: null };
    }
    
    try {
        console.log(`[extractCanonicalTitle] Analyzing torrent title: "${torrentTitle}"`);
        
        // Get alternative titles from TMDb
        const alternativeTitles = await fetchTMDbAlternativeTitles(null, 'series', tmdbApiKey, imdbId);
        
        if (!alternativeTitles || alternativeTitles.length === 0) {
            console.log(`[extractCanonicalTitle] No alternative titles found from TMDb`);
            return { canonicalTitle: torrentTitle, variant: null };
        }
        
        // Extract just the title strings from the TMDb response
        const titleStrings = alternativeTitles.map(alt => alt.title || alt.normalizedTitle || alt).filter(Boolean);
        console.log(`[extractCanonicalTitle] Found ${titleStrings.length} alternative titles from TMDb:`, titleStrings);
        
        const normalizedTorrentTitle = torrentTitle.toLowerCase().trim();
        let bestMatch = null;
        let bestSimilarity = 0;
        let remainingVariant = null;
        
        // Try to find the best matching canonical title
        for (const altTitle of titleStrings) {
            const normalizedAlt = altTitle.toLowerCase().trim();
            
            // Check if the alternative title is a prefix of the torrent title
            if (normalizedTorrentTitle.startsWith(normalizedAlt)) {
                const similarity = normalizedAlt.length / normalizedTorrentTitle.length;
                console.log(`[extractCanonicalTitle] Prefix match: "${altTitle}" (similarity: ${similarity.toFixed(3)})`);
                
                if (similarity > bestSimilarity && similarity >= 0.5) {
                    bestMatch = altTitle;
                    bestSimilarity = similarity;
                    
                    // Extract the remaining part after the canonical title
                    const remaining = torrentTitle.substring(altTitle.length).trim();
                    if (remaining) {
                        // Clean up the remaining part
                        remainingVariant = remaining
                            .replace(/^[\s\-:]+/, '')  // Remove leading separators
                            .replace(/[\s\-:]+$/, '')  // Remove trailing separators
                            .trim();
                        
                        if (remainingVariant.length <= 2) {
                            remainingVariant = null; // Ignore very short variants
                        }
                    }
                }
            }
            
            // Also check overall similarity for exact or near-exact matches
            const overallSimilarity = calculateStringSimilarity(normalizedTorrentTitle, normalizedAlt);
            if (overallSimilarity > bestSimilarity && overallSimilarity >= 0.85) {
                console.log(`[extractCanonicalTitle] High similarity match: "${altTitle}" (similarity: ${overallSimilarity.toFixed(3)})`);
                bestMatch = altTitle;
                bestSimilarity = overallSimilarity;
                remainingVariant = null; // If it's a very close match, no variant
            }
        }
        
        if (bestMatch) {
            console.log(`[extractCanonicalTitle] ✅ Best match: "${bestMatch}" (similarity: ${bestSimilarity.toFixed(3)})`);
            console.log(`[extractCanonicalTitle] Extracted variant: "${remainingVariant || 'none'}"`);
            return { canonicalTitle: bestMatch, variant: remainingVariant };
        }
        
        console.log(`[extractCanonicalTitle] ❌ No good match found, using original title`);
        return { canonicalTitle: torrentTitle, variant: null };
        
    } catch (error) {
        console.log(`[extractCanonicalTitle] Error during fuzzy matching: ${error.message}`);
        return { canonicalTitle: torrentTitle, variant: null };
    }
}

/**
 * Deduplicate streams to prevent duplicate entries for the same episode
 * @param {Array} streams - Array of stream objects
 * @returns {Array} - Deduplicated array of streams
 */
function deduplicateStreams(streams) {
    const seen = new Set();
    const deduplicated = [];
    
    for (const stream of streams) {
        // Create a unique key based on the video file name (first line of title)
        const titleLines = stream.title.split('\n');
        const videoFileName = titleLines[0] || '';
        
        // Extract a more specific key - combine file name + quality + size for uniqueness
        const qualityLine = stream.name.split('\n')[1] || '';
        const sizeLine = titleLines[titleLines.length - 1] || '';
        const sizeMatch = sizeLine.match(/(\d+\.?\d*\s*[KMGT]B)/);
        const size = sizeMatch ? sizeMatch[1] : '';
        
        const uniqueKey = `${videoFileName}|${qualityLine}|${size}`.toLowerCase();
        
        if (!seen.has(uniqueKey)) {
            seen.add(uniqueKey);
            deduplicated.push(stream);
        } else {
            console.log(`[deduplicateStreams] Skipping duplicate: ${videoFileName}`);
        }
    }
    
    return deduplicated;
}

/**
 * Sort movie streams by quality (highest quality first)
 * @param {Array} streams - Array of stream objects
 * @returns {Array} - Sorted array of streams
 */
function sortMovieStreamsByQuality(streams) {
    return streams.sort((a, b) => {
        // Extract quality info from stream names
        const aQualityLine = a.name.split('\n')[1] || '';
        const bQualityLine = b.name.split('\n')[1] || '';
        
        // Get quality scores
        const aQualityInfo = extractQualityInfo(aQualityLine);
        const bQualityInfo = extractQualityInfo(bQualityLine);
        
        const aScore = aQualityInfo.score || -1;
        const bScore = bQualityInfo.score || -1;
        
        // Sort by quality score (highest first)
        if (aScore !== bScore) {
            return bScore - aScore;
        }
        
        // If quality scores are the same, sort by file size (largest first)
        const aTitleLines = a.title.split('\n');
        const bTitleLines = b.title.split('\n');
        const aSizeLine = aTitleLines[aTitleLines.length - 1] || '';
        const bSizeLine = bTitleLines[bTitleLines.length - 1] || '';
        
        const aSizeMatch = aSizeLine.match(/(\d+\.?\d*)\s*([KMGT]B)/);
        const bSizeMatch = bSizeLine.match(/(\d+\.?\d*)\s*([KMGT]B)/);
        
        if (aSizeMatch && bSizeMatch) {
            const aSize = parseFloat(aSizeMatch[1]);
            const bSize = parseFloat(bSizeMatch[1]);
            const aUnit = aSizeMatch[2];
            const bUnit = bSizeMatch[2];
            
            // Convert to bytes for comparison
            const unitMultiplier = { 'B': 1, 'KB': 1024, 'MB': 1024*1024, 'GB': 1024*1024*1024, 'TB': 1024*1024*1024*1024 };
            const aSizeBytes = aSize * (unitMultiplier[aUnit] || 1);
            const bSizeBytes = bSize * (unitMultiplier[bUnit] || 1);
            
            return bSizeBytes - aSizeBytes;
        }
        
        return 0;
    });
}

export default { getMovieStreams, getSeriesStreams, resolveUrl }
export { extractQuality, extractTechnicalDetails, formatStreamTitle, sortMovieStreamsByQuality } // Export for testing