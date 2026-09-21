import { addonBuilder } from "stremio-addon-sdk"
import StreamProvider from './src/stream-provider.js'
import { getManifest } from './src/config/manifest.js'
import { enrichTorrentMeta } from './src/catalog/meta-enricher.js'
import { logger, setLogOutcome } from './src/utils/logger.js';
import { getProvider, listProviderLibrary } from './src/providers/index.js';
import { ProviderItemGoneError, isProviderError } from './src/providers/errors.js';
import { searchProviderLibrary } from './src/search/provider-search.js';

const CACHE_MAX_AGE = parseInt(process.env.CACHE_MAX_AGE) || 1 * 60 // 1 min
const STALE_ERROR_AGE = 1 * 24 * 60 * 60 // 1 days

const UNANSWERED = Symbol('unanswered')

const builder = new addonBuilder(getManifest())
const build = logger.for('STREAM').at('build')
const convert = logger.for('CATALOG').at('convert')

builder.defineCatalogHandler(async (args) => {
    if (args.id == 'debridsearch' || args.id == 'IntellDebridSearch') {
        if (!(args.config?.DebridProvider && args.config?.DebridApiKey)) {
            setLogOutcome({ code: 'UNCONFIGURED' })
            return { metas: [] }
        }

        const providerName = args.config.DebridProvider;
        const provider = getProvider(providerName);
        if (!provider) throw new Error(`Unsupported provider: ${providerName}`);

        let torrents = [];

        try {
            // Search catalog request
            if (args.extra.search) {
                const { coordinateSearch } = await import('./src/search/coordinator.js');
                const { getApiConfig } = await import('./src/config/configuration.js');

                const apiConfig = getApiConfig();

                if (apiConfig.hasAdvancedSearch) {
                    const searchResult = await coordinateSearch({
                        apiKey: args.config.DebridApiKey,
                        searchKey: args.extra.search,
                        provider: providerName,
                        tmdbApiKey: apiConfig.tmdbApiKey,
                        tvdbApiKey: apiConfig.tvdbApiKey
                    });
                    torrents = Array.isArray(searchResult) ? searchResult : searchResult.results;
                    convert.debug('Converting items', { mode: 'search', items: torrents.length });
                } else {
                    torrents = await searchProviderLibrary(providerName, args.config.DebridApiKey, args.extra.search);
                    convert.debug('Converting items', { mode: 'basic', items: torrents.length });
                }
            } else {
                // Standard catalog request
                if (args.config.ShowCatalog) {
                    torrents = await listProviderLibrary(providerName, args.config.DebridApiKey);
                    convert.debug('Converting items', { mode: 'browse', items: torrents.length });
                }
            }
        } catch (error) {
            if (!isProviderError(error)) throw error;
            setLogOutcome({ degraded: true, failedAt: 'provider.list', error: error.name, code: error.code, reason: error.message });
            return { metas: [], ...enrichCacheParams() };
        }

        const { toMetas } = await import('./src/catalog-provider.js');
        const metas = await toMetas(torrents);

        return {
            metas,
            ...enrichCacheParams()
        };
    } else {
        throw new Error('Invalid catalog request')
    }
})

/** `<provider>:<torrentId>` for a catalog item, `:file:<n>` for one of its files. */
function parseMintedId(id) {
    const [providerNameLower, torrentId, marker, index, ...rest] = String(id).split(':');
    if (!providerNameLower || !torrentId || rest.length) return null;
    if (marker === undefined) return { providerNameLower, torrentId, fileIndex: null };
    if (marker !== 'file' || !/^\d+$/.test(index ?? '')) return null;
    return { providerNameLower, torrentId, fileIndex: Number(index) };
}

/**
 * One catalog torrent as the client sees it
 */
async function torrentVideos(config, providerNameLower, torrentId) {
    const providerName = config.DebridProvider;
    const provider = getProvider(providerName);
    if (!provider) throw new Error(`Unsupported provider: ${providerName}`);

    if (providerNameLower !== providerName.toLowerCase() || !provider.ownsId(torrentId, config.DebridApiKey)) {
        setLogOutcome({ code: 'FOREIGN_ID' });
        return null;
    }

    const found = await provider.fetchTorrent(config.DebridApiKey, torrentId)
        .catch(error => {
            if (error instanceof ProviderItemGoneError) return null;
            if (isProviderError(error)) {
                setLogOutcome({ degraded: true, failedAt: 'provider.fetch', error: error.name, code: error.code, reason: error.message });
                return UNANSWERED;
            }
            throw error;
        });

    if (found === UNANSWERED) return UNANSWERED;

    const torrentDetails = found && { ...found.torrent, videos: found.videos };
    if (!torrentDetails) return { providerName, torrentDetails: null, videos: [] };

    const { attachParse } = await import('./src/parsing/parser.js');
    const { toStreams } = await import('./src/stream/stream-builder.js');
    const built = toStreams(attachParse(torrentDetails), 'series', null, null);
    const byFilename = new Map(built.map(stream => [stream.behaviorHints?.filename, stream]));

    const videos = [];
    let dropped = 0;
    (torrentDetails.videos || []).forEach((file, index) => {
        const stream = byFilename.get(file.fileName);
        if (!stream) {
            dropped += 1;
            build.warn('File dropped', { provider: providerName, id: `${providerNameLower}:${torrentId}`, fileIndex: index, code: dropReason(file) });
            return;
        }

        videos.push({
            id: `${providerNameLower}:${torrentId}:file:${index}`,
            title: file.fileName || `File ${index + 1}`,
            streams: [stream]
        });
    });

    if (dropped) setLogOutcome({ dropped });
    return { providerName, torrentDetails, videos };
}

async function mintedStreams(config, { providerNameLower, torrentId, fileIndex }) {
    if (!config?.DebridApiKey) return [];

    const found = await torrentVideos(config, providerNameLower, torrentId);
    if (!found || found === UNANSWERED || !found.torrentDetails) return [];

    const videos = fileIndex === null
        ? found.videos
        : found.videos.filter(video => video.id === `${providerNameLower}:${torrentId}:file:${fileIndex}`);
    return videos.flatMap(video => video.streams);
}

builder.defineMetaHandler(async (args) => {
    if (!args.id.includes(':')) {
        return { meta: null };
    }

    const [providerNameLower, torrentId] = args.id.split(':');

    if (!args.config?.DebridApiKey) {
        throw new Error('No API key configured');
    }

    const found = await torrentVideos(args.config, providerNameLower, torrentId);
    if (!found || found === UNANSWERED) return { meta: null };

    const { providerName, torrentDetails, videos } = found;

    if (!torrentDetails) {
        setLogOutcome({ degraded: true, found: false, code: 'GONE' });
        return { meta: { id: args.id, type: 'other', name: 'Torrent not found', videos: [] } };
    }

    const baseMeta = {
        id: args.id,
        type: 'other',
        name: torrentDetails.name || 'Unknown Torrent',
        description: `${providerName} cached file ➡️ ${torrentDetails.name} 🔍 ${videos.length} video file(s)`,
        videos: videos
    };

    const meta = await enrichTorrentMeta(baseMeta, {
        providerName,
        torrentDetails
    });

    return { meta };
    
})


// Docs: https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/requests/defineStreamHandler.md
builder.defineStreamHandler(args => {
    return new Promise((resolve, reject) => {
        const minted = parseMintedId(args.id)
        if (minted) {
            if (minted.fileIndex !== null) setLogOutcome({ fileIndex: minted.fileIndex })
            mintedStreams(args.config, minted)
                .then(streams => resolve({ streams, ...enrichCacheParams() }))
                .catch(err => reject(err))
            return
        }

        if (!args.id.match(/tt\d+/i)) {
            resolve({ streams: [] })
            return
        }

        switch (args.type) {
            case 'movie':
                StreamProvider.getMovieStreams(args.config, args.type, args.id)
                    .then(streams => resolve({ streams, ...enrichCacheParams() }))
                    .catch(err => reject(err))
                break
            case 'series':
                StreamProvider.getSeriesStreams(args.config, args.type, args.id)
                    .then(streams => resolve({ streams, ...enrichCacheParams() }))
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

function dropReason(file) {
    if (!file?.fileName) return 'NO_NAME'
    if (!file.url) return 'NO_URL'
    return 'NO_STREAM'
}

export default builder.getInterface()