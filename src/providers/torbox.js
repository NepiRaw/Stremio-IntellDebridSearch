import { TorboxApi } from '@torbox/torbox-api'
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
            this.logApiError(err, 'getTorrentDetails');
            return null;
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
                return null;
            })
            .catch(err => {
                this.logApiError(err, 'unrestrictUrl');
                return null;
            })
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
                        const status = err?.response?.status || err?.metadata?.status || err?.status;
                        let errorCode = err?.response?.data?.error || err?.error;
                        
                        // Try to parse raw body for SDK errors
                        if (!errorCode && err?.raw) {
                            try {
                                const rawString = typeof err.raw === 'string' 
                                    ? err.raw 
                                    : new TextDecoder().decode(err.raw);
                                const parsed = JSON.parse(rawString);
                                errorCode = parsed?.error;
                                if (parsed?.detail) {
                                    logger.warn(`[TorBox] API Error: ${parsed.error} - ${parsed.detail}`);
                                }
                            } catch (parseErr) {
                                // Ignore parsing errors
                            }
                        }
                        
                        // Log specific error types
                        if (status === 401 || errorCode === 'BAD_TOKEN' || errorCode === 'invalid_token') {
                            logger.warn('[TorBox] Authentication failed: Invalid or expired API token');
                        } else if (status === 403 || errorCode === 'PLAN_RESTRICTED_FEATURE') {
                            logger.warn('[TorBox] Access denied: API feature not available on your plan');
                        } else {
                            logger.warn('[TorBox] API call failed:', err?.message || errorCode || 'Unknown error');
                        }
                        
                        // Return empty array to allow addon to continue gracefully
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

    /**
     * Log API errors in a consistent format without throwing
     * Use this when you want to log an error but continue execution gracefully
     * @param {Error} err - The error object
     * @param {string} context - The context/method where the error occurred
     */
    logApiError(err, context = 'unknown') {
        const status = err?.response?.status || err?.metadata?.status || err?.status;
        let errorCode = err?.response?.data?.error || err?.error;
        let errorDetail = null;
        
        // Try to parse raw body for SDK errors
        if (!errorCode && err?.raw) {
            try {
                const rawString = typeof err.raw === 'string' 
                    ? err.raw 
                    : new TextDecoder().decode(err.raw);
                const parsed = JSON.parse(rawString);
                errorCode = parsed?.error;
                errorDetail = parsed?.detail;
            } catch (parseErr) {
                // Ignore parsing errors
            }
        }
        
        // Log with appropriate message based on error type
        if (status === 401 || errorCode === 'BAD_TOKEN' || errorCode === 'invalid_token') {
            logger.warn(`[TorBox] ${context}: Authentication failed - Invalid or expired API token`);
        } else if (status === 403 || errorCode === 'PLAN_RESTRICTED_FEATURE') {
            logger.warn(`[TorBox] ${context}: Access denied - API feature not available on your plan`);
        } else if (errorDetail) {
            logger.warn(`[TorBox] ${context}: ${errorCode} - ${errorDetail}`);
        } else {
            logger.warn(`[TorBox] ${context}: API error - ${err?.message || errorCode || 'Unknown error'}`);
        }
    }

    /**
     * Handle TorBox API errors gracefully
     * Supports both standard response format and TorBox SDK HttpError format
     * @param {Error} err - The error object
     * @returns {Promise} Rejected promise with appropriate error type
     */
    handleError(err) {
        // Extract status from multiple possible locations:
        // - Standard fetch: err.response.status
        // - TorBox SDK HttpError: err.metadata.status
        const status = err?.response?.status || err?.metadata?.status || err?.status;
        
        // Extract error code from response body or SDK error
        // - Standard: err.response.data.error
        // - SDK raw body needs parsing
        let errorCode = err?.response?.data?.error || err?.error;
        
        // Try to parse the raw body if it's an ArrayBuffer/Uint8Array (SDK format)
        if (!errorCode && err?.raw) {
            try {
                const rawString = typeof err.raw === 'string' 
                    ? err.raw 
                    : new TextDecoder().decode(err.raw);
                const parsed = JSON.parse(rawString);
                errorCode = parsed?.error;
                
                // Log the detailed error for debugging
                if (parsed?.detail) {
                    logger.warn(`[TorBox] API Error: ${parsed.error} - ${parsed.detail}`);
                }
            } catch (parseErr) {
                // Ignore parsing errors, continue with other checks
            }
        }
        
        logger.debug(`[TorBox] handleError - status: ${status}, errorCode: ${errorCode}`);
        
        // Check for authentication errors (invalid token, bad token)
        if (errorCode === 'invalid_token' || 
            errorCode === 'BAD_TOKEN' || 
            status === 401) {
            logger.warn('[TorBox] Authentication error: Invalid or expired API token');
            return Promise.reject(BadTokenError);
        }
        
        // Check for access denied / plan restricted errors
        if (status === 403 || 
            errorCode === 'PLAN_RESTRICTED_FEATURE' ||
            errorCode === 'Forbidden') {
            logger.warn('[TorBox] Access denied: API feature not available (plan restriction or forbidden)');
            return Promise.reject(AccessDeniedError);
        }
        
        // Log unhandled errors for debugging
        logger.warn(`[TorBox] Unhandled API error:`, err?.message || err);
        return Promise.reject(err);
    }
}

const torBoxProvider = new TorBoxProvider()

export default torBoxProvider;
export { TorBoxProvider };