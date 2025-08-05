import PremiumizeClient from 'premiumize-api'
import Fuse from 'fuse.js'
import { isVideo } from '../stream/metadata-extractor.js'
import PTT from '../utils/parse-torrent-title.js'
import { BadTokenError, AccessDeniedError } from '../utils/error-handler.js'
import { encode } from 'urlencode'
import { logger } from '../utils/logger.js'

async function searchFiles(apiKey, searchKey, threshold = 0.3) {
    logger.debug("Search files with searchKey: " + searchKey)

    let files = await listFiles(apiKey)
    let torrents = files.map(file => toTorrent(file))
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

async function listFiles(apiKey, skip = 0) {
    const PM = new PremiumizeClient(apiKey)
    let files = []

    await PM.item.listAll()
        .then(result => {
            if (result.status == 'success') {
                files = files.concat(result.files)
            }
        })
        .catch(err => handleError(err))

    return files || []
}

async function getTorrentDetails(apiKey, id) {
    const PM = new PremiumizeClient(apiKey)

    return await PM.item.details(id)
        .then(result => toTorrentDetails(result))
        .catch(err => handleError(err))
}

function toTorrent(item) {
    return {
        source: 'premiumize',
        id: item.id,
        name: item.name,
        type: 'other',
        info: PTT.parse(item.name),
        size: item.size,
        created: new Date(item.created_at * 1000),
    }
}

function toTorrentDetails(item) {
    let videos = []
    if (isVideo(item.link)) {
        videos.push({
            id: item.id,
            name: item.name,
            url: `${process.env.ADDON_URL}/resolve/Premiumize/null/${item.id}/${encode(item.link)}`,
            size: item.size,
            created: new Date(item.created_at * 1000),
            info: PTT.parse(item.name)
        })
    }

    return {
        source: 'premiumize',
        id: item.id,
        name: item.name,
        type: 'other',
        hash: item.id.toLowerCase(),
        size: item.size,
        created: new Date(item.created_at * 1000),
        videos: videos || []
    }
}

function handleError(err) {
    logger.debug(err)
    
    // Handle Premiumize-specific error codes
    if (err?.response?.status === 401 || err?.message?.includes('401')) {
        return Promise.reject(BadTokenError)
    }
    if (err?.response?.status === 403) {
        return Promise.reject(AccessDeniedError)
    }
    
    return Promise.reject(err)
}

export default { listFiles, searchFiles, getTorrentDetails }
