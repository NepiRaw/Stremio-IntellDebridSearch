import DebridLink from './providers/debrid-link.js'
import RealDebrid from './providers/real-debrid.js'
import AllDebrid from './providers/all-debrid.js'
import TorBox from './providers/torbox.js'
import Premiumize from './providers/premiumize.js'
import { coordinateSearch } from './search/coordinator.js'
import { BadRequestError } from './utils/error-handler.js'
import { logger } from './utils/logger.js'

async function searchTorrents(config, searchKey) {
    let tmdbApiKey = config.TmdbApiKey
    let traktApiKey = config.TraktApiKey
    
    // Fallback to environment variables if API keys are not provided in config
    if (!tmdbApiKey && process.env.TMDB_API_KEY) {
        tmdbApiKey = process.env.TMDB_API_KEY;
        logger.debug('[catalog-provider] Using TMDb API key from environment variables');
    }
    
    if (!traktApiKey && process.env.TRAKT_API_KEY) {
        traktApiKey = process.env.TRAKT_API_KEY;
        logger.debug('[catalog-provider] Using Trakt API key from environment variables');
    }
    
    const apiKey = config.DebridLinkApiKey ? config.DebridLinkApiKey : config.DebridApiKey
    const provider = config.DebridLinkApiKey ? 'DebridLink' : (config.DebridProvider || 'DebridLink')
    const providers = { AllDebrid, RealDebrid, DebridLink, Premiumize, TorBox }
    // If advanced search is possible, use it
    if (tmdbApiKey || traktApiKey) {
        // Catalog search doesn't have type/id, so fallback to searchKey only
        const params = { 
            apiKey, 
            searchKey, 
            provider, 
            tmdbApiKey, 
            traktApiKey, 
            threshold: 0.1,            
            providers // Add providers to params object
        }
        const searchResult = await coordinateSearch(params)
        // Handle both array and object return formats from coordinateSearch
        const torrents = Array.isArray(searchResult) ? searchResult : searchResult.results
        return torrents.map(torrent => toMeta(torrent))
    }

    let resultsPromise
    if (config.DebridLinkApiKey) {
        resultsPromise = DebridLink.searchTorrents(config.DebridLinkApiKey, searchKey)
    } else if (config.DebridProvider == "DebridLink") {
        resultsPromise = DebridLink.searchTorrents(config.DebridApiKey, searchKey)
    } else if (config.DebridProvider == "RealDebrid") {
        resultsPromise = RealDebrid.searchTorrents(config.DebridApiKey, searchKey)
    } else if (config.DebridProvider == "AllDebrid") {
        resultsPromise = AllDebrid.searchTorrents(config.DebridApiKey, searchKey)
    } else if (config.DebridProvider == "TorBox") {
        resultsPromise = Promise.resolve([])
    } else {
        return Promise.reject(BadRequestError)
    }

    return resultsPromise
        .then(torrents => torrents.map(torrent => toMeta(torrent)))
}

async function listTorrents(config, skip = 0) {
    if (!config.ShowCatalog) {
        return Promise.resolve([])
    }

    let resultsPromise

    if (config.DebridLinkApiKey) {
        resultsPromise = DebridLink.listTorrents(config.DebridLinkApiKey, skip)
    } else if (config.DebridProvider == "DebridLink") {
        resultsPromise = DebridLink.listTorrents(config.DebridApiKey, skip)
    } else if (config.DebridProvider == "RealDebrid") {
        resultsPromise = RealDebrid.listTorrents(config.DebridApiKey, skip)
    } else if (config.DebridProvider == "AllDebrid") {
        resultsPromise = AllDebrid.listTorrents(config.DebridApiKey)
    } else if (config.DebridProvider == "TorBox") {
        resultsPromise = Promise.resolve([])
    } else {
        return Promise.reject(BadRequestError)
    }

    return resultsPromise
}

function toMeta(torrent) {
    return {
        id: torrent.source + ':' + torrent.id,
        name: torrent.name,
        type: torrent.type,
        // poster: `https://img.icons8.com/ios/256/video--v1.png`,
        // posterShape: 'square'
    }
}


export default { searchTorrents, listTorrents }