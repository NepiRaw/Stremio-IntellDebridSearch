import { addonBuilder } from "stremio-addon-sdk"
import StreamProvider from './src/stream-provider.js'
import CatalogProvider from './src/catalog-provider.js'
import { getManifest } from './src/config/manifest.js'

import { logger } from './src/utils/logger.js';
const CACHE_MAX_AGE = parseInt(process.env.CACHE_MAX_AGE) || 1 * 60 // 1 min
const STALE_ERROR_AGE = 1 * 24 * 60 * 60 // 1 days

const builder = new addonBuilder(getManifest())

builder.defineCatalogHandler((args) => {
    return new Promise((resolve, reject) => {
        const debugArgs = structuredClone(args)
        if (args.config?.DebridApiKey)
            debugArgs.config.DebridApiKey = '*'.repeat(args.config.DebridApiKey.length)
        logger.info("Request for catalog with args: " + JSON.stringify(debugArgs))

        // Request to Debrid Search
        if (args.id == 'debridsearch' || args.id == 'IntellDebridSearch') {
            if (!(args.config?.DebridProvider && args.config?.DebridApiKey)) {
                reject(new Error('Invalid Debrid configuration: Missing configs'))
            }

            // Search catalog request
            if (args.extra.search) {
                CatalogProvider.searchTorrents(args.config, args.extra.search)
                    .then(metas => {
                        logger.info("Response metas: " + JSON.stringify(metas))
                        resolve({
                            metas,
                            ...enrichCacheParams()
                        })
                    })
                    .catch(err => reject(err))
            } else {
                // Standard catalog request
                CatalogProvider.listTorrents(args.config, args.extra.skip)
                    .then(metas => {
                        logger.info("Response metas: " + JSON.stringify(metas))
                        resolve({
                            metas
                        })
                    })
                    .catch(err => reject(err))
            }
        } else {
            reject(new Error('Invalid catalog request'))
        }
    })
})


// Docs: https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/requests/defineStreamHandler.md
builder.defineStreamHandler(args => {
    return new Promise((resolve, reject) => {
        if (!args.id.match(/tt\d+/i)) {
            resolve({ streams: [] })
            return
        }

        const debugArgs = structuredClone(args)
        if (args.config?.DebridApiKey)
            debugArgs.config.DebridApiKey = '*'.repeat(args.config.DebridApiKey.length)
        logger.info("Request for streams with args: " + JSON.stringify(debugArgs))

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
                results = resolve({ streams: [] })
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
