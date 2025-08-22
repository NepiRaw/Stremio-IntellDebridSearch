﻿import { TorboxApi } from '@torbox/torbox-api'
import { isVideo, FILE_TYPES } from '../stream/metadata-extractor.js'
import { parseUnified } from '../utils/unified-torrent-parser.js'
import { logger } from '../utils/logger.js'
import { BadTokenError, AccessDeniedError } from '../utils/error-handler.js'
import { BaseProvider } from './BaseProvider.js'

const API_BASE_URL = 'https://api.torbox.app'
const API_VERSION = 'v1'
const API_VALIDATION_OPTIONS = { responseValidation: false }

// TorBox Rate Limiting Configuration (5/s max)
const TORBOX_RATE_LIMIT = {
    maxCalls: 5,           // Max API calls before applying delay
    delayMs: 1100,         // Delay in milliseconds (1.1 seconds to be safe)
    enabled: true          // Enable/disable rate limiting
};

class TorBoxProvider extends BaseProvider {
    constructor() {
        super('TorBox')
        this.lastApiCall = 0;
        this.apiCallCount = 0;
    }

    /**
     * Apply rate limiting to avoid TorBox API limits (5 per second)
     */
    async rateLimit() {
        if (!TORBOX_RATE_LIMIT.enabled) return;

        this.apiCallCount++;
        
        if (this.apiCallCount % TORBOX_RATE_LIMIT.maxCalls === 0) {
            const timeSinceLastCall = Date.now() - this.lastApiCall;
            const delayNeeded = TORBOX_RATE_LIMIT.delayMs - timeSinceLastCall;
            
            if (delayNeeded > 0) {
                logger.debug(`[TorBox] Rate limiting: waiting ${delayNeeded}ms`);
                await new Promise(resolve => setTimeout(resolve, delayNeeded));
            }
        }
        
        this.lastApiCall = Date.now();
    }

    async searchFiles(fileType, apiKey, searchKey, threshold) {
        logger.debug("Search " + fileType.description + " with searchKey: " + searchKey)

        const files = await this.listFilesParallel(fileType, apiKey)
        let results = []
        if (fileType?.toString() === 'Symbol(torrents)' || fileType == FILE_TYPES.TORRENTS)
            results = files.map(result => this.toTorrent(apiKey, result, 'stream'))
        else if (fileType?.toString() === 'Symbol(downloads)' || fileType == FILE_TYPES.DOWNLOADS)
            results = files.map(result => this.toDownload(result, 'stream'))

        return this.performFuzzySearch(results, searchKey, threshold)
    }

    async searchTorrents(apiKey, searchKey = null, threshold = 0.3) {
        return this.searchFiles(FILE_TYPES.TORRENTS, apiKey, searchKey, threshold)
    }

    async searchDownloads(apiKey, searchKey = null, threshold = 0.3) {
        return this.searchFiles(FILE_TYPES.DOWNLOADS, apiKey, searchKey, threshold)
    }

    async getTorrentDetails(apiKey, id, context = 'stream') {
        await this.rateLimit();
        const torboxApi = new TorboxApi({
            token: apiKey,
            baseUrl: API_BASE_URL,
            validation: API_VALIDATION_OPTIONS
        });

        try {
            const response = await torboxApi.torrents.getTorrentList(API_VERSION, {
                bypassCache: true,
                limit: 2000 
            });

            if (response.data?.success && response.data?.data) {
                const torrent = response.data.data.find(t => t.id == id);
                if (torrent && torrent.download_finished && torrent.download_present) {
                    return this.toTorrent(apiKey, torrent, context);
                }
            }
            return null;
        } catch (err) {
            return this.handleError(err);
        }
    }

    async unrestrictUrl(apiKey, torrentId, hostUrl, userIp) {
        await this.rateLimit();
        
        let fileId;
        if (typeof hostUrl === 'string' && hostUrl.startsWith('torbox_file_')) {
            const fileIdMatch = hostUrl.match(/torbox_file_(\d+)/);
            if (fileIdMatch) {
                fileId = parseInt(fileIdMatch[1]);
            } else {
                logger.error(`[TorBox] Failed to extract file ID from hostUrl: ${hostUrl}`);
                throw new Error(`Invalid TorBox hostUrl format: ${hostUrl}`);
            }
        } else {
            fileId = hostUrl;
        }
        
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

    async toTorrent(apiKey, item, context = 'stream') {
        const videoFiles = item.files.filter(file => isVideo(file.short_name));
        
        const videos = [];
        
        logger.debug(`[TorBox] Processing ${videoFiles.length} video files for torrent ${item.id}`);
        
        for (let i = 0; i < Math.min(videoFiles.length, 10); i++) { // Limit to first 10 files to avoid excessive API calls
            const file = videoFiles[i];
            try {
                const url = this.buildSecureStreamUrl(apiKey, item.id, { link: `torbox_file_${file.id}` });
                
                const info = context === 'stream' 
                    ? parseUnified(file.short_name)
                    : { title: file.short_name };
                
                videos.push({
                    id: `${item.id}:${file.id}`,
                    name: file.short_name,
                    url: url,
                    size: file.size,
                    created: new Date(item.created_at),
                    info: info
                });
            } catch (error) {
                logger.warn(`[TorBox] Failed to process file ${file.id}:`, error.message);
            }
        }

        logger.debug(`[TorBox] Processed ${videos.length} video files for torrent ${item.name}`);

        return {
            source: 'TorBox',
            id: item.id,
            name: item.name,
            type: 'other',
            fileType: FILE_TYPES.TORRENTS,
            hash: item.hash,
            info: context === 'stream' ? parseUnified(item.name) : null,
            size: item.size,
            created: new Date(item.created_at),
            videos: videos || []
        }
    }

    toDownload(item, context = 'stream') {
        return {
            source: 'TorBox',
            id: item.id,
            url: item.name,
            name: item.filename,
            type: 'other',
            fileType: FILE_TYPES.DOWNLOADS,
            info: context === 'stream' ? parseUnified(item.name) : null,
            size: item.size,
            created: new Date(item.created_at),
        }
    }

    async listTorrents(apiKey, skip = 0) {
        const torrents = await this.listFilesParallel(FILE_TYPES.TORRENTS, apiKey, 1);
        return torrents.map(torrent => this.extractCatalogMeta({
            id: torrent.id,
            name: torrent.name
        }));
    }

    async listFilesParallel(fileType, apiKey, page = 1, pageSize = 1000) {
        await this.rateLimit();
        
        const torboxApi = new TorboxApi({
            token: apiKey,
            baseUrl: API_BASE_URL,
            validation: API_VALIDATION_OPTIONS
        });
        let offset = (page - 1) * pageSize

        try {
            if (fileType?.toString() === 'Symbol(torrents)' || fileType == FILE_TYPES.TORRENTS) {
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
                        return []
                    })
            } else if (fileType?.toString() === 'Symbol(downloads)' || fileType == FILE_TYPES.DOWNLOADS) {
                return []
            }
            return []
        } catch (error) {
            logger.warn('TorBox listFilesParallel failed:', error);
            return [];
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

export default torBoxProvider;
export { TorBoxProvider };