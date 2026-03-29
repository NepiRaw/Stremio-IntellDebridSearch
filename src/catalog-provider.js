import { RealDebridProvider } from './providers/real-debrid.js'
import { AllDebridProvider } from './providers/all-debrid.js'
import { DebridLinkProvider } from './providers/debrid-link.js'
import { TorBoxProvider } from './providers/torbox.js'
import { PremiumizeProvider } from './providers/premiumize.js'
import { coordinateSearch } from './search/coordinator.js'
import { BadRequestError } from './utils/error-handler.js'
import { getApiConfig } from './config/configuration.js'
import { logger } from './utils/logger.js'
import { createPosterLookupContext, isCatalogPosterEnabled, resolvePosterFromContext } from './catalog/poster-resolver.js'

// Create provider instances once for testable providers to avoid duplicate initialization logging
const sharedProviders = {
    // Migrated to clean class architecture (tested with API keys)
    AllDebrid: new AllDebridProvider(), 
    RealDebrid: new RealDebridProvider(), 
    DebridLink: new DebridLinkProvider(),
    TorBox: new TorBoxProvider(),
    Premiumize: new PremiumizeProvider()  // Now using standard provider instance
};

async function mapLimit(items, limit, mapper) {
    const results = new Array(items.length);
    let index = 0;

    async function worker() {
        while (index < items.length) {
            const current = index++;
            results[current] = await mapper(items[current], current);
        }
    }

    const workerCount = Math.max(1, Math.min(limit, items.length));
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return results;
}

async function toMetas(torrents = []) {
    if (!Array.isArray(torrents) || torrents.length === 0) {
        return [];
    }

    if (!isCatalogPosterEnabled()) {
        return torrents.map(torrent => toMeta(torrent));
    }

    const contexts = torrents.map(torrent => createPosterLookupContext(torrent));
    const uniqueContexts = new Map();

    for (const context of contexts) {
        if (context?.cacheKey && !uniqueContexts.has(context.cacheKey)) {
            uniqueContexts.set(context.cacheKey, context);
        }
    }

    const resolvedPosters = await mapLimit([...uniqueContexts.values()], 4, async (context) => {
        const posterResult = await resolvePosterFromContext(context);
        return [context.cacheKey, posterResult];
    });

    const posterByKey = new Map(resolvedPosters);

    return torrents.map((torrent, index) => {
        const context = contexts[index];
        const posterResult = context?.cacheKey ? posterByKey.get(context.cacheKey) || null : null;
        return toMeta(torrent, { posterResult });
    });
}

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
        return toMetas(torrents)
    }

    let resultsPromise

    // Get all available files from provider
    switch (config.DebridProvider) {
        case "DebridLink":
            resultsPromise = sharedProviders.DebridLink.searchTorrents(config.DebridApiKey, searchKey);
            break;
        case "RealDebrid":
            resultsPromise = sharedProviders.RealDebrid.searchTorrents(config.DebridApiKey, searchKey);
            break;
        case "AllDebrid":
            resultsPromise = sharedProviders.AllDebrid.searchTorrents(config.DebridApiKey, searchKey);
            break;
        case "Premiumize":
            resultsPromise = sharedProviders.Premiumize.searchTorrents(config.DebridApiKey, searchKey);
            break;
        case "TorBox":
            resultsPromise = sharedProviders.TorBox.searchTorrents(config.DebridApiKey, searchKey);
            break;
        default:
            return Promise.reject(new BadRequestError(`Unknown provider: ${config.DebridProvider}`));
    }

    return resultsPromise
        .then(torrents => {
            if (!Array.isArray(torrents)) {
                logger.warn('[catalog-provider] searchTorrents returned non-array, defaulting to empty');
                return [];
            }
            return toMetas(torrents);
        })
}

async function listTorrents(config, skip = 0) {
    if (!config.ShowCatalog) {
        return Promise.resolve([])
    }

    let resultsPromise

    switch (config.DebridProvider) {
        case "DebridLink":
            resultsPromise = sharedProviders.DebridLink.listTorrents(config.DebridApiKey, skip);
            break;
        case "RealDebrid":
            resultsPromise = sharedProviders.RealDebrid.listTorrents(config.DebridApiKey, skip);
            break;
        case "AllDebrid":
            resultsPromise = sharedProviders.AllDebrid.listTorrents(config.DebridApiKey);
            break;
        case "Premiumize":
            resultsPromise = sharedProviders.Premiumize.listTorrents(config.DebridApiKey, skip);
            break;
        case "TorBox":
            resultsPromise = sharedProviders.TorBox.listTorrents(config.DebridApiKey, skip);
            break;
        default:
            return Promise.reject(new BadRequestError(`Unknown provider: ${config.DebridProvider}`));
    }

    return resultsPromise
        .then(torrents => {
            if (!Array.isArray(torrents)) {
                logger.warn('[catalog-provider] listTorrents returned non-array, defaulting to empty');
                return [];
            }
            return toMetas(torrents);
        })
}

function toMeta(torrent, options = {}) {
    let metaId;
    if (typeof torrent.id === 'string' && torrent.id.includes(':')) {
        const [currentProvider, currentId] = torrent.id.split(':');
        metaId = `${currentProvider.toLowerCase()}:${currentId}`;
    } else if (torrent.source && torrent.id) {
        const providerLowercase = torrent.source.toLowerCase(); // Convert provider name to lowercase for other addon metadata sync
        metaId = providerLowercase + ':' + torrent.id;
    } else {
        console.warn('Warning: torrent object missing proper ID or source fields:', torrent);
        metaId = torrent.id || 'unknown';
    }

    const posterResult = options.posterResult || null;
    
    const meta = {
        id: metaId,
        name: torrent.name || torrent.filename || 'Unknown Torrent',
        type: torrent.type || 'other'
    };

    if (posterResult?.posterUrl) {
        meta.poster = posterResult.posterUrl;
        meta.posterShape = posterResult.posterShape || 'poster';
    }

    return meta;
}


export { toMeta, toMetas, searchTorrents, listTorrents }

export default { searchTorrents, listTorrents, toMeta, toMetas }