import { addonBuilder } from "stremio-addon-sdk"
import StreamProvider from './src/stream-provider.js'
import { getManifest } from './src/config/manifest.js'
import { logger } from './src/utils/logger.js';

const CACHE_MAX_AGE = parseInt(process.env.CACHE_MAX_AGE) || 1 * 60 // 1 min
const STALE_ERROR_AGE = 1 * 24 * 60 * 60 // 1 days

const builder = new addonBuilder(getManifest())

builder.defineCatalogHandler(async (args) => {
    try {
        const debugArgs = structuredClone(args)
        if (args.config?.DebridApiKey)
            debugArgs.config.DebridApiKey = '*'.repeat(args.config.DebridApiKey.length)
        logger.info("Request for catalog with args: " + JSON.stringify(debugArgs))

        if (args.id == 'debridsearch' || args.id == 'IntellDebridSearch') {
            if (!(args.config?.DebridProvider && args.config?.DebridApiKey)) {
                throw new Error('Invalid Debrid configuration: Missing configs')
            }

            let provider;
            const providerName = args.config.DebridProvider;
            
            switch (providerName) {
                case 'AllDebrid':
                    const { AllDebridProvider } = await import('./src/providers/all-debrid.js');
                    provider = new AllDebridProvider();
                    break;
                case 'RealDebrid':
                    const { RealDebridProvider } = await import('./src/providers/real-debrid.js');
                    provider = new RealDebridProvider();
                    break;
                case 'DebridLink':
                    const { DebridLinkProvider } = await import('./src/providers/debrid-link.js');
                    provider = new DebridLinkProvider();
                    break;
                case 'TorBox':
                    const { TorBoxProvider } = await import('./src/providers/torbox.js');
                    provider = new TorBoxProvider();
                    break;
                case 'Premiumize':
                    const { PremiumizeProvider } = await import('./src/providers/premiumize.js');
                    provider = new PremiumizeProvider();
                    break;
                default:
                    throw new Error(`Unsupported provider: ${providerName}`);
            }

            let torrents = [];

            // Search catalog request
            if (args.extra.search) {
                const { coordinateSearch } = await import('./src/search/coordinator.js');
                const { getApiConfig } = await import('./src/config/configuration.js');
                
                const apiConfig = getApiConfig();
                
                if (apiConfig.hasAdvancedSearch) {
                    const providers = {
                        AllDebrid: provider,
                        RealDebrid: provider,
                        DebridLink: provider,
                        TorBox: provider,
                        Premiumize: provider
                    };
                    providers[providerName] = provider;
                    
                    const params = { 
                        apiKey: args.config.DebridApiKey, 
                        searchKey: args.extra.search, 
                        provider: providerName, 
                        tmdbApiKey: apiConfig.tmdbApiKey, 
                        traktApiKey: apiConfig.traktApiKey, 
                        providers
                    };
                    const searchResult = await coordinateSearch(params);
                    torrents = Array.isArray(searchResult) ? searchResult : searchResult.results;
                    logger.debug(`[CatalogHandler] Coordinated search returned ${torrents.length} torrents`);
                } else {
                    torrents = await provider.searchTorrents(args.config.DebridApiKey, args.extra.search);
                    logger.debug(`[CatalogHandler] searchTorrents search returned ${torrents.length} torrents`);
                }
            } else {
                // Standard catalog request
                if (args.config.ShowCatalog) {
                    torrents = await provider.listTorrents(args.config.DebridApiKey, args.extra.skip || 0);
                    logger.debug(`[CatalogHandler] listTorrents search returned ${torrents.length} torrents`);
                }
            }

            const metas = torrents.map(torrent => {
                let torrentId;
                let torrentName;
                
                if (torrent.source && torrent.id) {
                    torrentId = `${torrent.source.toLowerCase()}:${torrent.id}`;
                    torrentName = torrent.name;
                } else if (torrent.id && torrent.id.includes(':')) {
                    const [currentProvider, id] = torrent.id.split(':');
                    torrentId = `${currentProvider.toLowerCase()}:${id}`;
                    torrentName = torrent.name;
                } else {
                    torrentId = `${providerName.toLowerCase()}:${torrent.id}`;
                    torrentName = torrent.name;
                }
                
                return {
                    id: torrentId,
                    name: torrentName,
                    type: 'other'
                };
            });

            logger.info(`[CatalogHandler] Returning ${metas.length} catalog metas`);
            
            return {
                metas,
                ...enrichCacheParams()
            };
        } else {
            throw new Error('Invalid catalog request')
        }
    } catch (error) {
        logger.error(`Catalog handler error: ${error.message}`);
        throw error;
    }
})

builder.defineMetaHandler(async (args) => {
    try {
        const debugArgs = structuredClone(args)
        if (args.config?.DebridApiKey)
            debugArgs.config.DebridApiKey = '*'.repeat(args.config.DebridApiKey.length)
        logger.info("Request for meta with args: " + JSON.stringify(debugArgs))

        if (!args.id.includes(':')) {
            return { meta: null };
        }
        
        const [providerNameLower, torrentId] = args.id.split(':');
        
        if (!args.config?.DebridApiKey) {
            throw new Error('No API key configured');
        }

        const providerName = args.config.DebridProvider;
        
        if (!providerName) {
            throw new Error(`Unsupported provider: ${providerNameLower}`);
        }
        
        let provider;
        switch (providerName) {
            case 'AllDebrid':
                const { AllDebridProvider } = await import('./src/providers/all-debrid.js');
                provider = new AllDebridProvider();
                break;
            case 'RealDebrid':
                const { RealDebridProvider } = await import('./src/providers/real-debrid.js');
                provider = new RealDebridProvider();
                break;
            case 'DebridLink':
                const { DebridLinkProvider } = await import('./src/providers/debrid-link.js');
                provider = new DebridLinkProvider();
                break;
            case 'TorBox':
                const { TorBoxProvider } = await import('./src/providers/torbox.js');
                provider = new TorBoxProvider();
                break;
            case 'Premiumize':
                const { PremiumizeProvider } = await import('./src/providers/premiumize.js');
                provider = new PremiumizeProvider();
                break;
            default:
                throw new Error(`Unsupported provider: ${providerName}`);
        }
        
        const torrentDetails = await provider.getTorrentDetails(args.config.DebridApiKey, torrentId, 'meta');
        
        if (!torrentDetails) {
            throw new Error('Torrent not found');
        }
        
        const videoFiles = torrentDetails.videos || [];
        const videos = [];
        
        for (let index = 0; index < videoFiles.length; index++) {
            const file = videoFiles[index];
            const videoId = `${args.id}:file:${index}`;

            logger.info(`[MetaHandler] 🎥 Processing video file: ${file.name}`);

            let streamUrl = file.url;
            
            if (provider.resolveStreamUrl && file.url) {
                logger.info(`[MetaHandler] 🔄 Resolving stream URL for ${file.name}`);
                try {
                    const resolved = await provider.resolveStreamUrl(args.config.DebridApiKey, file.url);
                    if (resolved) {
                        streamUrl = resolved;
                        logger.info(`[MetaHandler] ✅ Resolved to direct stream URL`);
                    }
                } catch (resolveError) {
                    logger.warn(`[MetaHandler] Could not resolve URL, using original: ${resolveError.message}`);
                }
            }
            
            if (streamUrl) {
                const videoEntry = {
                    id: videoId,
                    title: file.name || `File ${index + 1}`,
                    streams: [
                        {
                            name: providerName,
                            title: `${providerName} - ${file.name || `File ${index + 1}`}`,
                            url: streamUrl,
                            behaviorHints: {
                                bingeGroup: `${providerName}-${torrentId}`,
                                filename: file.name || `File ${index + 1}`,
                                videoSize: file.size || null
                            }
                        }
                    ]
                };
                logger.debug(`[MetaHandler] Added video entry with direct stream URL`);
                videos.push(videoEntry);
            } else {
                logger.warn(`[MetaHandler] No stream URL available for ${file.name}`);
            }
        }
        
        const meta = {
            id: args.id,
            type: 'other',
            name: torrentDetails.name || 'Unknown Torrent',
            description: `${providerName} cached file ➡️ ${torrentDetails.name} 🔍 ${videos.length} video file(s)`,
            videos: videos
        };
        return { meta };
        
    } catch (error) {
        logger.error(`Meta handler error: ${error.message}`);
        throw error;
    }
})


// Docs: https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/requests/defineStreamHandler.md
builder.defineStreamHandler(args => {
    return new Promise((resolve, reject) => {
        const debugArgs = structuredClone(args)
        if (args.config?.DebridApiKey)
            debugArgs.config.DebridApiKey = '*'.repeat(args.config.DebridApiKey.length)
        logger.info("Request for streams with args: " + JSON.stringify(debugArgs))

        if (!args.id.match(/tt\d+/i)) {
            resolve({ streams: [] })
            return
        }

        switch (args.type) {
            case 'movie':
                StreamProvider.getMovieStreams(args.config, args.type, args.id)
                    .then(async streams => {
                        const { formatStreamsForDisplay } = await import('./src/stream/stream-builder.js');
                        const formatted = formatStreamsForDisplay(streams);
                        logger.info("Response streams:\n" + formatted);
                        resolve({
                            streams,
                            ...enrichCacheParams()
                        })
                    })
                    .catch(err => reject(err))
                break
            case 'series':
                StreamProvider.getSeriesStreams(args.config, args.type, args.id)
                    .then(async streams => {
                        const { formatStreamsForDisplay } = await import('./src/stream/stream-builder.js');
                        const formatted = formatStreamsForDisplay(streams);
                        logger.info("Response streams:\n" + formatted);
                        resolve({
                            streams,
                            ...enrichCacheParams()
                        })
                    })
                    .catch(err => reject(err))
                break
            default:
                resolve({ streams: [] })
                break
        }
    })
})

function enrichCacheParams() {
    return {
        cacheMaxAge: CACHE_MAX_AGE,
        staleError: STALE_ERROR_AGE
    }
}

export default builder.getInterface()