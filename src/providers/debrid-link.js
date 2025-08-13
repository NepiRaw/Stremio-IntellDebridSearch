import DebridLinkClient from 'debrid-link-api'
import { isVideo } from '../stream/metadata-extractor.js'
import PTT from '../utils/parse-torrent-title.js'
import { BadTokenError, AccessDeniedError } from '../utils/error-handler.js'
import { encode } from 'urlencode'
import { logger } from '../utils/logger.js'
import { BaseProvider } from './BaseProvider.js'

class DebridLinkProvider extends BaseProvider {
    constructor() {
        super('debridlink')
    }

    async searchTorrents(apiKey, searchKey, threshold = 0.3) {
        logger.debug(`[debridlink] Search torrents with searchKey: ${searchKey}`)

        let torrentsResults = await this.listTorrentsParallel(apiKey)
        let torrents = torrentsResults.map(torrentsResult => this.toTorrent(torrentsResult))
        
        return this.performFuzzySearch(torrents, searchKey, threshold)
    }

    async listTorrents(apiKey, skip = 0) {
        const DL = new DebridLinkClient(apiKey)
        const idParent = 'seedbox'
        let torrents = []

        let nextPage = Math.floor(skip / 50)

        await DL.files.list(idParent, nextPage)
            .then(result => {
                if (result.success) {
                    torrents = torrents.concat(result.value)
                }
            })
            .catch(err => this.handleError(err))

        // Todo: Refactor with toMeta()
        const metas = torrents.map(torrent => {
            return {
                id: 'debridlink:' + torrent.id.split('-')[0],
                name: torrent.name,
                type: 'other',
            }
        })
        return metas || []
    }

    async listTorrentsParallel(apiKey) {
        const DL = new DebridLinkClient(apiKey)
        const idParent = 'seedbox'
        let torrents = []
        let promises = []

        let nextPage = 0
        let totalPages = 0
        await DL.files.list(idParent)
            .then(result => {
                if (result.success) {
                    torrents = torrents.concat(result.value)
                    totalPages = Math.min(10, result.pagination.pages)
                    nextPage = result.pagination.next
                }
            })
            .catch(err => this.handleError(err))

        while (nextPage != -1 && nextPage < totalPages) {
            promises.push(
                DL.files.list(idParent, nextPage)
                    .then(result => {
                        if (result.success) {
                            torrents = torrents.concat(result.value)
                        }
                    })
                    .catch(err => this.handleError(err))
            )
            nextPage = nextPage + 1
        }

        await Promise.all(promises)
            .catch(err => this.handleError(err))

        return torrents
    }

    async getTorrentDetails(apiKey, ids) {
        const DL = new DebridLinkClient(apiKey)

        return await DL.seedbox.list(ids)
            .then(result => result.value)
            .then(torrents => torrents.map(torrent => this.toTorrentDetails(torrent)))
            .catch(err => this.handleError(err))
    }

    toTorrent(item) {
        return {
            source: 'debridlink',
            id: item.id.split('-')[0],
            name: item.name,
            type: 'other',
            info: PTT.parse(item.name),
            size: item.size,
            created: new Date(item.created * 1000),
        }
    }

    toTorrentDetails(item) {
        const videos = item.files
            .filter(file => isVideo(file.name))
            .map(file => {
                const url = `${process.env.ADDON_URL}/resolve/DebridLink/null/${item.id}/${encode(file.downloadUrl)}`
                return {
                    id: file.id,
                    name: file.name,
                    url: url,
                    size: file.size,
                    created: new Date(item.created * 1000),
                    info: PTT.parse(file.name)
                }
            })

        return {
            source: 'debridlink',
            id: item.id,
            name: item.name,
            type: 'other',
            hash: item.hashString.toLowerCase(),
            size: item.totalSize,
            created: new Date(item.created * 1000),
            videos: videos || []
        }
    }

    handleError(err) {
        logger.error(err)
        if (err === 'badToken') {
            return Promise.reject(BadTokenError)
        }

        return Promise.reject(err)
    }
}

const debridLinkProvider = new DebridLinkProvider()

// Legacy function exports for backward compatibility
// TODO: Remove this section when provider is confirmed working
// 
// MIGRATION INSTRUCTIONS for removing legacy functions:
// 
// 1. In this file (debrid-link.js):
//    - Remove the legacy function exports below (lines with const listTorrents, searchTorrents, etc.)
//    - Change default export from object to: export default debridLinkProvider;
// 
// 2. In stream-provider.js:
//    - Change import from: import DebridLink from './providers/debrid-link.js';
//    - To class import: import { DebridLinkProvider } from './providers/debrid-link.js';
//    - Update providers object from: DebridLink: DebridLink,
//    - To class instance: DebridLink: new DebridLinkProvider(),
// 
// 3. In catalog-provider.js:
//    - Change import from: import DebridLink from './providers/debrid-link.js'
//    - To class import: import { DebridLinkProvider } from './providers/debrid-link.js'
//    - Add provider instance: const debridLinkProvider = new DebridLinkProvider();
//    - Update providers object from: DebridLink: DebridLink,
//    - To class instance: DebridLink: debridLinkProvider,
//    - Update method calls from: DebridLink.searchTorrents() and DebridLink.listTorrents()
//    - To class calls: debridLinkProvider.searchTorrents() and debridLinkProvider.listTorrents()
// 
const listTorrents = (apiKey, skip) => debridLinkProvider.listTorrents(apiKey, skip)
const searchTorrents = (apiKey, searchKey, threshold) => debridLinkProvider.searchTorrents(apiKey, searchKey, threshold)
const getTorrentDetails = (apiKey, ids) => debridLinkProvider.getTorrentDetails(apiKey, ids)
const listTorrentsParallel = (apiKey) => debridLinkProvider.listTorrentsParallel(apiKey)

export default { listTorrents, searchTorrents, getTorrentDetails, listTorrentsParallel }
export { DebridLinkProvider };