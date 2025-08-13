/**
 * Abstract Base Provider Class
 * Consolidates common functionality across all debrid providers
 */

import Fuse from 'fuse.js';
import { isVideo } from '../stream/metadata-extractor.js';
import PTT from '../utils/parse-torrent-title.js';
import { encode } from 'urlencode';
import { logger } from '../utils/logger.js';
import { configManager } from '../config/configuration.js';
import { errorManager } from '../utils/error-handler.js';

/**
 * Abstract base class for all debrid providers
 * Provides common functionality while allowing provider-specific implementations
 */
export class BaseProvider {
    constructor(providerName) {
        if (this.constructor === BaseProvider) {
            throw new Error("BaseProvider is abstract and cannot be instantiated directly");
        }
        
        this.providerName = providerName;
        this.providerConfig = configManager.getProviderConfig(providerName);
        this.defaultThreshold = 0.3;
        this.defaultRetries = 3;
        this.defaultTimeout = 30000; // 30 seconds
        
        logger.debug(`[${this.providerName}] BaseProvider initialized`);
    }

    async makeApiCall(apiCall, retries = this.defaultRetries, context = 'api-call') {
        let lastError;
        
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                logger.debug(`[${this.providerName}] ${context} - Attempt ${attempt}/${retries}`);
                
                const result = await Promise.race([
                    apiCall(),
                    new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('API call timeout')), this.defaultTimeout)
                    )
                ]);
                
                logger.debug(`[${this.providerName}] ${context} - Success on attempt ${attempt}`);
                return result;
                
            } catch (error) {
                lastError = error;
                logger.warn(`[${this.providerName}] ${context} - Attempt ${attempt} failed:`, error.message);
                
                if (this.isAuthenticationError(error)) {
                    break;
                }
                
                if (attempt < retries) {
                    const delay = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s...
                    logger.debug(`[${this.providerName}] Retrying in ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }
        
        return this.handleError(lastError, context);
    }

    /**
     * Standard fuzzy search implementation using Fuse.js
     */
    performFuzzySearch(items, searchKey, threshold = this.defaultThreshold) {
        if (!items || !Array.isArray(items) || !searchKey) {
            return [];
        }
        
        const fuse = new Fuse(items, {
            keys: ['info.title', 'name', 'filename'],
            threshold: threshold,
            minMatchCharLength: 2,
            includeScore: true
        });

        const searchResults = fuse.search(searchKey);
        
        logger.debug(`[${this.providerName}] Fuzzy search for "${searchKey}": ${searchResults.length} matches`);
        
        return searchResults.map(result => ({
            ...result.item,
            searchScore: result.score
        }));
    }

    /**
     * Standard torrent object normalization
     */
    normalizeTorrent(item, customFields = {}) {
        const base = {
            source: this.providerName.toLowerCase(),
            id: item.id,
            name: item.name || item.filename,
            type: 'other',
            info: PTT.parse(item.name || item.filename),
            size: item.size || item.bytes,
            created: this.parseDate(item.created || item.added || item.completionDate || item.created_at),
            ...customFields
        };
        
        logger.debug(`[${this.providerName}] Normalized torrent: ${base.name}`);
        return base;
    }

    /**
     * Standard torrent details normalization with video extraction
     */
    normalizeTorrentDetails(item, videos, customFields = {}) {
        return {
            source: this.providerName.toLowerCase(),
            id: item.id,
            name: item.name || item.filename,
            type: 'other',
            hash: item.hash,
            info: PTT.parse(item.name || item.filename),
            size: item.size || item.bytes,
            created: this.parseDate(item.created || item.added || item.completionDate || item.created_at),
            videos: videos || [],
            ...customFields
        };
    }

    /**
     * Standard video file extraction and URL building
     */
    extractVideoFiles(item, apiKey, urlBuilder) {
        if (!item || !urlBuilder) {
            return [];
        }
        
        // Handle different provider file structures
        const files = item.files || item.links || [];
        
        return files
            .filter(file => {
                const filename = file.path || file.filename || file.name;
                return filename && isVideo(filename);
            })
            .map((file, index) => {
                const filename = file.path || file.filename || file.name;
                const url = urlBuilder(apiKey, item.id, file, index);
                
                return {
                    id: `${item.id}:${file.id || index}`,
                    name: filename,
                    url: url,
                    size: file.size || file.bytes,
                    created: this.parseDate(item.created || item.added || item.completionDate),
                    info: PTT.parse(filename)
                };
            });
    }

    /**
     * Standard stream URL builder template
     */
    buildStreamUrl(apiKey, torrentId, file, index = 0) {
        const hostUrl = file.link || file.download || file.url;
        const providerName = this.providerName;
        return `${process.env.ADDON_URL}/resolve/${providerName}/${apiKey}/${torrentId}/${encode(hostUrl)}`;
    }

    /**
     * Standard date parsing with fallbacks
     */
    parseDate(dateValue) {
        if (!dateValue) return new Date();
        
        // Handle Unix timestamps
        if (typeof dateValue === 'number') {
            return new Date(dateValue < 1e10 ? dateValue * 1000 : dateValue);
        }
        
        // Handle date strings
        if (typeof dateValue === 'string') {
            return new Date(dateValue);
        }
        
        // Already a Date object
        if (dateValue instanceof Date) {
            return dateValue;
        }
        
        return new Date();
    }

    /**
     * Check if error is authentication-related
     */
    isAuthenticationError(error) {
        if (!error) return false;
        
        const errorMessage = error.message?.toLowerCase() || '';
        const statusCode = error.response?.status;
        const errorCode = error.code;
        
        return (
            statusCode === 401 ||
            statusCode === 403 ||
            errorCode === 'AUTH_BAD_APIKEY' ||
            errorMessage.includes('auth') ||
            errorMessage.includes('token') ||
            errorMessage.includes('unauthorized') ||
            errorMessage.includes('forbidden')
        );
    }

    /**
     * Standardized error handling using ErrorManager
     */
    handleError(error, context = 'unknown') {
        return errorManager.handleProviderError(error, this.providerName, context);
    }

    /**
     * Standard metadata extraction for catalog
     */
    extractCatalogMeta(torrent) {
        return {
            id: `${this.providerName.toLowerCase()}:${torrent.id}`,
            name: torrent.name || torrent.filename,
            type: 'other'
        };
    }

    /**
     * Standard validation for API responses
     */
    validateApiResponse(response, expectedFields = []) {
        if (!response) {
            throw new Error('Empty API response');
        }
        
        if (response.error) {
            throw new Error(`API Error: ${response.error}`);
        }
        
        for (const field of expectedFields) {
            if (!(field in response)) {
                logger.warn(`[${this.providerName}] Missing expected field: ${field}`);
            }
        }
        
        return true;
    }

    /**
     * Standard logging helper
     */
    log(level, message, data = null) {
        const formattedMessage = `[${this.providerName}] ${message}`;
        
        if (data) {
            logger[level](formattedMessage, data);
        } else {
            logger[level](formattedMessage);
        }
    }

    // Abstract methods that must be implemented by subclasses
    async searchTorrents(apiKey, searchKey, threshold) {
        throw new Error(`${this.constructor.name} must implement searchTorrents method`);
    }

    async listTorrents(apiKey, skip) {
        throw new Error(`${this.constructor.name} must implement listTorrents method`);
    }

    async getTorrentDetails(apiKey, id) {
        throw new Error(`${this.constructor.name} must implement getTorrentDetails method`);
    }

    // Optional methods with default implementations
    async listTorrentsParallel(apiKey, ...args) {
        // Default implementation falls back to regular listTorrents
        return this.listTorrents(apiKey, ...args);
    }

    async unrestrictUrl(apiKey, hostUrl, ...args) {
        throw new Error(`${this.constructor.name} does not support URL unrestriction`);
    }

    async searchDownloads(apiKey, searchKey, threshold) {
        throw new Error(`${this.constructor.name} does not support download search`);
    }
}

export default BaseProvider;
