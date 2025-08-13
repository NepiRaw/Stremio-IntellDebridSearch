import { RealDebridProvider } from './providers/real-debrid.js'
import { AllDebridProvider } from './providers/all-debrid.js'
// TODO: Migrate to class imports when these providers are confirmed working with API keys
import DebridLink from './providers/debrid-link.js'
import TorBox from './providers/torbox.js'
import Premiumize from './providers/premiumize.js'
import { coordinateSearch } from './search/coordinator.js'
import { BadRequestError } from './utils/error-handler.js'
import { getApiConfig } from './config/configuration.js'

// Create provider instances once for testable providers to avoid duplicate initialization logging
const sharedProviders = {
    // Migrated to clean class architecture (tested with API keys)
    AllDebrid: new AllDebridProvider(), 
    RealDebrid: new RealDebridProvider(), 
    // TODO: Migrate these to class instances when API testing is available
    DebridLink: DebridLink,  // Using legacy export pattern
    Premiumize: Premiumize,  // Using legacy export pattern
    TorBox: TorBox           // Using legacy export pattern
};

async function searchTorrents(config, searchKey) {
    const apiConfig = getApiConfig();
    
    // All providers use standard DebridProvider + DebridApiKey pattern
    const apiKey = config.DebridApiKey;
    const provider = config.DebridProvider;
    
    if (!provider) {
        throw new Error('No debrid provider configured');
    }
    if (!apiKey) {
        throw new Error('No debrid API key configured');
    }
    
    const providers = sharedProviders;
    
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
    if (config.DebridProvider == "DebridLink") {
        resultsPromise = DebridLink.searchTorrents(config.DebridApiKey, searchKey)
    } else if (config.DebridProvider == "RealDebrid") {
        resultsPromise = sharedProviders.RealDebrid.searchTorrents(config.DebridApiKey, searchKey)
    } else if (config.DebridProvider == "AllDebrid") {
        resultsPromise = sharedProviders.AllDebrid.searchTorrents(config.DebridApiKey, searchKey)
    } else if (config.DebridProvider == "Premiumize") {
        resultsPromise = Premiumize.searchTorrents(config.DebridApiKey, searchKey)
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

    if (config.DebridProvider == "DebridLink") {
        resultsPromise = DebridLink.listTorrents(config.DebridApiKey, skip)
    } else if (config.DebridProvider == "RealDebrid") {
        resultsPromise = sharedProviders.RealDebrid.listTorrents(config.DebridApiKey, skip)
    } else if (config.DebridProvider == "AllDebrid") {
        resultsPromise = sharedProviders.AllDebrid.listTorrents(config.DebridApiKey)
    } else if (config.DebridProvider == "Premiumize") {
        resultsPromise = Premiumize.listTorrents(config.DebridApiKey, skip)
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