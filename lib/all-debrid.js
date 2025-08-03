// Ensure ADDON_URL is defined
if (!process.env.ADDON_URL) {
    process.env.ADDON_URL = 'http://127.0.0.1:55771';
}

import AllDebridClient from 'all-debrid-api'
import Fuse from 'fuse.js'
import { isVideo } from './util/extension-util.js'
import PTT from './util/parse-torrent-title.js'
import { processTorrentDetails } from './util/debrid-processor.js'
import { BadTokenError } from './util/error-codes.js'
import { encode } from 'urlencode'

// AllDebrid-specific URL builder
function buildStreamUrl(apiKey, torrentId, file) {
    const hostUrl = file.link || file.download;
    return `${process.env.ADDON_URL}/resolve/AllDebrid/${apiKey}/${torrentId}/${encode(hostUrl)}`;
}

async function searchTorrents(apiKey, searchKey = null, threshold = 0.3) {
    console.log("Search torrents with searchKey: " + searchKey)

    const torrentsResults = await listTorrentsParallel(apiKey, 1, 1000)
    let torrents = torrentsResults.map(torrentsResult => {
        return toTorrent(torrentsResult)
    })
    // console.log("torrents: " + JSON.stringify(torrents))
    const fuse = new Fuse(torrents, {
        keys: ['info.title'],
        threshold: threshold,
        minMatchCharLength: 2
    })

    const searchResults = fuse.search(searchKey)
    if (searchResults && searchResults.length) {
        return searchResults.map(searchResult => searchResult.item)
    } else {
        return []
    }
}

async function getTorrentDetails(apiKey, id) {
    try {
        const AD = new AllDebridClient(apiKey);
        const response = await AD.magnet.status(id);

        if (!response?.data?.magnets) {
            console.error(`[Error AllDebrid] No magnets found for ID ${id}`);
            return null;
        }

        // Use the common processor with AllDebrid-specific data structure
        return processTorrentDetails({
            apiKey,
            rawResponse: response.data,
            item: response.data.magnets,
            source: 'alldebrid',
            urlBuilder: buildStreamUrl
        });
    } catch (err) {
        console.error(`[Error AllDebrid] Failed to fetch details for ID ${id}:`, err);
        return handleError(err);
    }
}

async function toTorrentDetails(apiKey, item) {
    const videos = item.links
        .filter(file => isVideo(file.filename))
        .map((file, index) => {
            const url = buildStreamUrl(apiKey, item.id, file)

            return {
                id: `${item.id}:${index}`,
                name: file.filename,
                url: url,
                size: file.size,
                created: new Date(item.completionDate),
                info: PTT.parse(file.filename)
            }
        })

    return {
        source: 'alldebrid',
        id: item.id,
        name: item.filename,
        type: 'other',        hash: item.hash,
        info: PTT.parse(item.filename),
        size: item.size,
        created: new Date(item.completionDate),
        videos: videos || []
    }
}

async function unrestrictUrl(apiKey, hostUrl) {
    const AD = new AllDebridClient(apiKey)

    return AD.link.unlock(hostUrl)
        .then(res => res.data.link)
        .catch(err => handleError(err))
}

function toTorrent(item) {
    return {
        source: 'alldebrid',
        id: item.id,
        name: item.filename,        type: 'other',
        info: PTT.parse(item.filename),
        size: item.size,
        created: new Date(item.completionDate),
    }
}

async function listTorrents(apiKey) {
    let torrents = await listTorrentsParallel(apiKey)
    const metas = torrents.map(torrent => {
        return {
            id: 'alldebrid:' + torrent.id,
            name: torrent.filename,
            type: 'other',
        }
    })
    return metas || []
}

async function listTorrentsParallel(apiKey) {
    const AD = new AllDebridClient(apiKey);

    const torrents = await AD.magnet.status()
        .then(res => res.data.magnets
            .filter(item => item.statusCode === 4)
        )
        .catch(err => handleError(err))

    return torrents || []
}

function handleError(err) {
    console.log(err)
    if (err && err.code === 'AUTH_BAD_APIKEY') {
        return Promise.reject(BadTokenError)
    }
    return Promise.reject(err)
}

export default { listTorrents, searchTorrents, getTorrentDetails, unrestrictUrl, listTorrentsParallel }