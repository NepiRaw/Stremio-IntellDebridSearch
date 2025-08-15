import { TorboxApi } from '@torbox/torbox-api'
import { isVideo, FILE_TYPES } from '../stream/metadata-extractor.js'
import { parseUnified } from '../utils/unified-torrent-parser.js'
import { logger } from '../utils/logger.js'
import { BadTokenError, AccessDeniedError } from '../utils/error-handler.js'
import { BaseProvider } from './BaseProvider.js'

const API_BASE_URL = 'https://api.torbox.app'
const API_VERSION = 'v1'
const API_VALIDATION_OPTIONS = { responseValidation: false }

class TorBoxProvider extends BaseProvider {
    constructor() {
        super('torbox')
    }

    async searchFiles(fileType, apiKey, searchKey, threshold) {
        logger.debug("Search " + fileType.description + " with searchKey: " + searchKey)

        const files = await this.listFilesParallel(fileType, apiKey)
        let results = []
        if (fileType == FILE_TYPES.TORRENTS)
            results = files.map(result => this.toTorrent(apiKey, result))
        else if (fileType == FILE_TYPES.DOWNLOADS)
            results = files.map(result => this.toDownload(result))

        return this.performFuzzySearch(results, searchKey, threshold)
    }

    async searchTorrents(apiKey, searchKey = null, threshold = 0.3) {
        return this.searchFiles(FILE_TYPES.TORRENTS, apiKey, searchKey, threshold)
    }

    async searchDownloads(apiKey, searchKey = null, threshold = 0.3) {
        return this.searchFiles(FILE_TYPES.DOWNLOADS, apiKey, searchKey, threshold)
    }

    async getTorrentDetails(apiKey, id) {
        const torboxApi = new TorboxApi({
            token: apiKey,
            baseUrl: API_BASE_URL,
            validation: API_VALIDATION_OPTIONS
        });

        try {
            const response = await torboxApi.torrents.getTorrentList(API_VERSION, {
                bypassCache: true,
                limit: 1000  // Get enough to find our torrent
            });

            if (response.data?.success && response.data?.data) {
                const torrent = response.data.data.find(t => t.id == id);
                if (torrent && torrent.download_finished && torrent.download_present) {
                    return this.toTorrent(apiKey, torrent);
                }
            }
            return null;
        } catch (err) {
            return this.handleError(err);
        }
    }

    async unrestrictUrl(apiKey, torrentId, fileId, userIp) {
        const torboxApi = new TorboxApi({
            token: apiKey,
            baseUrl: API_BASE_URL,
            validation: API_VALIDATION_OPTIONS
        });

        return torboxApi.torrents
            .requestDownloadLink(API_VERSION, {
                token: apiKey,
                torrentId,
                fileId,
                userIp
            })
            .then(res => res.data)
            .then(res => {
                if (res.success) {
                    return res.data
                }
            })
            .catch(err => this.handleError(err))
    }

    toTorrent(apiKey, item) {
        const videos = item.files
            .filter(file => isVideo(file.short_name))
            .map((file) => {
                const url = `${process.env.ADDON_URL}/resolve/TorBox/${apiKey}/${item.id}/${file.id}`

                return {
                    id: `${item.id}:${file.id}`,
                    name: file.short_name,
                    url: url,
                    size: file.size,
                    created: new Date(item.created_at),
                    info: parseUnified(file.short_name)
                }
        })

        return {
            source: 'torbox',
            id: item.id,
            name: item.name,
            type: 'other',
            fileType: FILE_TYPES.TORRENTS,
            hash: item.hash,
            info: parseUnified(item.name),
            size: item.size,
            created: new Date(item.created_at),
            videos: videos || []
        }
    }

    toDownload(item) {
        return {
            source: 'torbox',
            id: item.id,
            url: item.name,
            name: item.filename,
            type: 'other',
            fileType: FILE_TYPES.DOWNLOADS,
            info: parseUnified(item.name),
            size: item.size,
            created: new Date(item.created_at),
        }
    }

    async listTorrents(apiKey, skip = 0) {
        // Todo: catalogs
        return []
    }

    async listFilesParallel(fileType, apiKey, page = 1, pageSize = 1000) {
        const torboxApi = new TorboxApi({
            token: apiKey,
            baseUrl: API_BASE_URL,
            validation: API_VALIDATION_OPTIONS
        });
        let offset = (page - 1) * pageSize

        try {
            if (fileType == FILE_TYPES.TORRENTS) {
                return torboxApi.torrents
                    .getTorrentList(API_VERSION, {
                        bypassCache: true,
                        offset,
                        limit: pageSize
                    })
                    .then(res => res.data)
                    .then(res => {
                        if (res.success) {
                            return res.data || []
                        }
                        return []
                    })
                    .then(files => files.filter(f => f.download_finished && f.download_present))
                    .catch(err => {
                        this.handleError(err)
                        return []  // Return empty array on error
                    })
            } else if (fileType == FILE_TYPES.DOWNLOADS) {
                // Todo: Web hoster downloads functionality
                return []
            }
            return []
        } catch (error) {
            logger.warn('TorBox listFilesParallel failed:', error);
            return [];  // Return empty array on failure
        }
    }

    handleError(err) {
        logger.debug(err)
        
        if (err?.response?.data?.error === 'invalid_token' || err?.response?.status === 401) {
            return Promise.reject(BadTokenError)
        }
        if (err?.response?.status === 403) {
            return Promise.reject(AccessDeniedError)
        }
        
        return Promise.reject(err)
    }
}

const torBoxProvider = new TorBoxProvider()

// Legacy function exports for backward compatibility
// TODO: Remove this section when provider is confirmed working
// 
// MIGRATION INSTRUCTIONS for removing legacy functions:
// 
// 1. In this file (torbox.js):
//    - Remove the legacy function exports below (listTorrents, searchTorrents, getTorrentDetails, unrestrictUrl, searchDownloads, listFilesParallel)
//    - Change default export from object to: export default torBoxProvider;
// 
// 2. In stream-provider.js:
//    - Change import from: import TorBox from './providers/torbox.js';
//    - To class import: import { TorBoxProvider } from './providers/torbox.js';
//    - Update providers object from: TorBox: TorBox,
//    - To class instance: TorBox: new TorBoxProvider(),
// 
// 3. In catalog-provider.js:
//    - Change import from: import TorBox from './providers/torbox.js'
//    - To class import: import { TorBoxProvider } from './providers/torbox.js'
//    - Add provider instance: const torBoxProvider = new TorBoxProvider();
//    - Update providers object from: TorBox: TorBox,
//    - To class instance: TorBox: torBoxProvider,
//    - Note: Currently TorBox method calls return Promise.resolve([]) in catalog-provider.js
// 
const listTorrents = (apiKey, skip) => torBoxProvider.listTorrents(apiKey, skip)
const searchTorrents = (apiKey, searchKey, threshold) => torBoxProvider.searchTorrents(apiKey, searchKey, threshold)
const getTorrentDetails = (apiKey, id) => torBoxProvider.getTorrentDetails(apiKey, id)
const unrestrictUrl = (apiKey, torrentId, fileId, userIp) => torBoxProvider.unrestrictUrl(apiKey, torrentId, fileId, userIp)
const searchDownloads = (apiKey, searchKey, threshold) => torBoxProvider.searchDownloads(apiKey, searchKey, threshold)
const listFilesParallel = (fileType, apiKey, page, pageSize) => torBoxProvider.listFilesParallel(fileType, apiKey, page, pageSize)

export default { listTorrents, searchTorrents, getTorrentDetails, unrestrictUrl, searchDownloads, listFilesParallel }
export { TorBoxProvider };