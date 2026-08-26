import { logger } from './utils/logger.js'
import { createPosterLookupContext, isCatalogPosterEnabled, resolvePosterFromContext } from './catalog/poster-resolver.js'
import { getCacheRecorder } from './utils/cache-recorder.js'
import { parseName } from './parsing/parser.js'

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

        // Record IMDB→hash mapping when poster resolution identifies content with high confidence
        if (posterResult?.imdbId && torrent.hash) {
            try {
                const recorder = getCacheRecorder();
                recorder.recordStreamData({
                    imdbId: posterResult.imdbId,
                    season: null,
                    episode: null,
                    provider: torrent.id?.split(':')[0] || 'unknown',
                    torrents: [{
                        hash: torrent.hash,
                        name: torrent.name,
                        size: torrent.size || null,
                        parsed: parseName(torrent.name),
                        videos: []
                    }]
                });
            } catch { /* ignore recording errors */ }
        }

        return toMeta(torrent, { posterResult });
    });
}

function toMeta(torrent, options = {}) {
    let metaId;
    if (typeof torrent.id === 'string' && torrent.id.includes(':')) {
        const [currentProvider, currentId] = torrent.id.split(':');
        metaId = `${currentProvider.toLowerCase()}:${currentId}`;
    } else if (torrent.provider && torrent.id) {
        const providerLowercase = torrent.provider.toLowerCase(); // Convert provider name to lowercase for other addon metadata sync
        metaId = providerLowercase + ':' + torrent.id;
    } else {
        console.warn('Warning: torrent object missing proper ID or provider fields:', torrent);
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


export { toMeta, toMetas }

export default { toMeta, toMetas }