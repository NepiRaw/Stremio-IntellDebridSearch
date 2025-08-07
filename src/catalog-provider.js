import DebridLink from './providers/debrid-link.js'
import RealDebrid from './providers/real-debrid.js'
import AllDebrid from './providers/all-debrid.js'
import TorBox from './providers/torbox.js'
import Premiumize from './providers/premiumize.js'
import { coordinateSearch } from './search/coordinator.js'
import { BadRequestError } from './utils/error-handler.js'
import { logger } from './utils/logger.js'
import { getApiConfig } from './utils/configuration.js'

async function searchTorrents(config, searchKey) {
    // Get API configuration using the centralized system
    const apiConfig = getApiConfig(config);
    
    const apiKey = config.DebridLinkApiKey ? config.DebridLinkApiKey : config.DebridApiKey
    const provider = config.DebridLinkApiKey ? 'DebridLink' : (config.DebridProvider || 'DebridLink')
    const providers = { AllDebrid, RealDebrid, DebridLink, Premiumize, TorBox }
    
    if (apiConfig.hasAdvancedSearch) {
        const params = { 
            apiKey, 
            searchKey, 
            provider, 
            tmdbApiKey: apiConfig.tmdbApiKey, 
            traktApiKey: apiConfig.traktApiKey, 
            providers
        }
        const searchResult = await coordinateSearch(params)
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
    }
}


export default { searchTorrents, listTorrents }