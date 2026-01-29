/**
 * Abstract Base Provider Class
 * Consolidates common functionality across all debrid providers
 */

import Fuse from 'fuse.js';
import { isVideo } from '../stream/metadata-extractor.js';
import { parseUnified } from '../utils/unified-torrent-parser.js';
import { encode } from 'urlencode';
import { logger } from '../utils/logger.js';
import { configManager } from '../config/configuration.js';
import { errorManager } from '../utils/error-handler.js';
import crypto from 'crypto';

const secureTokenMapping = new Map();

/**
 * API Key Security Manager
 * Provides centralized secure token generation and resolution for all providers
 */
class ApiKeySecurityManager {
    /**
     * Generate a secure token
     */
    static generateSecureToken(providerName, apiKey) {
        const tokenInput = `${providerName}:${apiKey}`;
        const secureToken = crypto.createHash('md5').update(tokenInput).digest('hex').substring(0, 16);
        
        const mappingKey = `${providerName}:${secureToken}`;
        secureTokenMapping.set(mappingKey, apiKey);
        return secureToken;
    }
    
    /**
     * Resolve a secure token
     */
    static resolveSecureToken(providerName, token) {
        if (token === 'null') {
            return null;
        }
        
        const mappingKey = `${providerName}:${token}`;
        const apiKey = secureTokenMapping.get(mappingKey);
        
        if (!apiKey) {
            logger.warn(`[SECURITY] Token resolution failed for ${providerName}:${token}`);
            return null;
        }
        
        return apiKey;
    }
    
    /**
     * Check if a string looks like a secure token (16 hex characters)
     */
    static isSecureToken(str) {
        return str && str.length === 16 && /^[a-f0-9]+$/i.test(str);
    }
}

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
        
        logger.debug(`[BaseProvider-${this.providerName}] BaseProvider initialized`);
    }

    async makeApiCall(apiCall, retries = this.defaultRetries, context = 'api-call') {
        let lastError;
        
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                logger.debug(`[BaseProvider-${this.providerName}] ${context} - Attempt ${attempt}/${retries}`);
                
                const result = await Promise.race([
                    apiCall(),
                    new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('API call timeout')), this.defaultTimeout)
                    )
                ]);
                
                // Universal HTML error detection before processing
                this.detectHtmlErrorResponse(result, context);
                
                logger.debug(`[BaseProvider-${this.providerName}] ${context} - Success on attempt ${attempt}`);
                return result;
                
            } catch (error) {
                lastError = error;
                
                if (attempt === retries) {
                    logger.warn(`[BaseProvider-${this.providerName}] ${context} - All ${retries} attempts failed:`, error.message);
                } else {
                    logger.debug(`[BaseProvider-${this.providerName}] ${context} - Attempt ${attempt}/${retries} failed:`, error.message);
                }
                
                if (this.isAuthenticationError(error)) {
                    break;
                }
                
                if (attempt < retries) {
                    const delay = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s...
                    logger.debug(`[BaseProvider-${this.providerName}] Retrying in ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }
        
        return this.handleError(lastError, context);
    }

    /**
     * Universal HTML error response detection for all providers
     * Detects rate limiting and server error responses that return HTML instead of JSON
     */
    detectHtmlErrorResponse(response, context = 'api-call') {
        if (!response) return; // Allow empty responses to be handled elsewhere
        
        // Enhanced detection for various HTML error responses
        if (typeof response === 'string') {
            const htmlIndicators = ['<html>', '<!DOCTYPE html>', '<HTML>', '<head>', '<body>', '<title>'];
            const isHtmlResponse = htmlIndicators.some(indicator => 
                response.toLowerCase().includes(indicator.toLowerCase())
            );
            
            if (isHtmlResponse) {
                const htmlPreview = response.substring(0, 800).replace(/\s+/g, ' ');
                logger.warn(`[BaseProvider-${this.providerName}] ${context} - HTML error page detected:`);
                logger.warn(`[BaseProvider-${this.providerName}] Response length: ${response.length} characters`);
                logger.warn(`[BaseProvider-${this.providerName}] HTML content preview: ${htmlPreview}...`);
                
                const errorPatterns = [
                    { pattern: '503 Service Temporarily Unavailable', error: 'temporarily unavailable (503) - likely rate limiting' },
                    { pattern: '503 Service Unavailable', error: 'temporarily unavailable (503) - likely rate limiting' },
                    { pattern: '500 Internal Server Error', error: 'internal server error (500)' },
                    { pattern: '429 Too Many Requests', error: 'rate limit exceeded (429)' },
                    { pattern: 'Rate limit exceeded', error: 'rate limit exceeded' },
                    { pattern: 'Too Many Requests', error: 'rate limit exceeded (429)' },
                    { pattern: '502 Bad Gateway', error: 'bad gateway (502)' },
                    { pattern: '504 Gateway Timeout', error: 'gateway timeout (504)' },
                    { pattern: 'Cloudflare', error: 'Cloudflare protection error' },
                    { pattern: 'Access denied', error: 'access denied' }
                ];
                
                for (const { pattern, error } of errorPatterns) {
                    if (response.includes(pattern)) {
                        logger.error(`[BaseProvider-${this.providerName}] Detected error pattern: ${pattern}`);
                        throw new Error(`BaseProvider-${this.providerName} API ${error}. Response: ${htmlPreview}`);
                    }
                }

                logger.error(`[BaseProvider-${this.providerName}] Unknown HTML error - full response length: ${response.length}`);
                logger.error(`[BaseProvider-${this.providerName}] First 1000 chars: ${response.substring(0, 1000)}`);
                throw new Error(`BaseProvider-${this.providerName} API returned HTML error page instead of JSON. Content: ${htmlPreview}`);
            }
            
            if (response.length < 200 && !response.startsWith('{') && !response.startsWith('[')) {
                if (context && context.includes('unrestrictUrl') && response.startsWith('http')) {
                    logger.debug(`[BaseProvider-${this.providerName}] ${context} - Valid direct URL response received`);
                } else {
                    logger.warn(`[BaseProvider-${this.providerName}] ${context} - Unexpected string response: ${response}`);
                }
            }
        }
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
        
        logger.debug(`[BaseProvider-${this.providerName}] Fuzzy search for "${searchKey}": ${searchResults.length} matches`);
        
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
            source: this.providerName,
            id: item.id,
            name: item.name || item.filename,
            type: 'other',
            info: parseUnified(item.name || item.filename),
            size: item.size || item.bytes,
            created: this.parseDate(item.created || item.added || item.completionDate || item.created_at),
            ...customFields
        };
        
        logger.debug(`[BaseProvider-${this.providerName}] Normalized torrent: ${base.name}`);
        return base;
    }

    /**
     * Standard torrent details normalization with video extraction
     */
    normalizeTorrentDetails(item, videos, customFields = {}) {
        return {
            source: this.providerName,
            id: item.id,
            name: item.name || item.filename,
            type: 'other',
            hash: item.hash,
            info: parseUnified(item.name || item.filename),
            size: item.size || item.bytes,
            created: this.parseDate(item.created || item.added || item.completionDate || item.created_at),
            videos: videos || [],
            ...customFields
        };
    }

    /**
     * Standard video file extraction and URL building
     */
    async extractVideoFiles(item, apiKey, urlBuilder) {
        if (!item || !urlBuilder) {
            return [];
        }
        
        // Handle different provider file structures
        const files = item.files || item.links || [];
        
        const videoFiles = files.filter(file => {
            const filename = file.path || file.filename || file.name;
            return filename && isVideo(filename);
        });
        
        const fileParsingPromises = videoFiles.map(async (file, index) => {
            const filename = file.path || file.filename || file.name;
            const [url, info] = await Promise.all([
                Promise.resolve(urlBuilder(apiKey, item.id, file, index)),
                Promise.resolve(parseUnified(filename))
            ]);
            
            return {
                id: `${item.id}:${file.id || index}`,
                name: filename,
                url: url,
                size: file.size || file.bytes,
                created: this.parseDate(item.created || item.added || item.completionDate),
                info: info
            };
        });
        
        return await Promise.all(fileParsingPromises);
    }

    /**
     * Secure stream URL builder with API key protection
     * Generates URLs with secure tokens instead of raw API keys
     */
    buildSecureStreamUrl(apiKey, torrentId, file, index = 0) {
        const hostUrl = file.link || file.download || file.url;
        const secureToken = ApiKeySecurityManager.generateSecureToken(this.providerName, apiKey);
        return `${process.env.ADDON_URL}/resolve/${this.providerName}/${secureToken}/${torrentId}/${encode(hostUrl)}`;
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
            id: `${this.providerName}:${torrent.id}`,
            name: torrent.name || torrent.filename,
            type: 'other'
        };
    }

    /**
     * Standard validation for API responses with universal HTML error detection
     */
    validateApiResponse(response, expectedFields = []) {
        if (!response) {
            throw new Error('Empty API response');
        }

        this.detectHtmlErrorResponse(response, 'validateApiResponse');

        if (typeof response !== 'object' || response === null) {
            // Simple debug logging for the specific string response issue
            if (typeof response === 'string') {
                logger.warn(`AllDebrid returned string instead of object. Content: ${response.substring(0, 500)}`);
            }
            throw new Error(`Invalid API response type: expected object, got ${typeof response}`);
        }
        
        if (response.error) {
            const errorMessage = typeof response.error === 'object' 
                ? JSON.stringify(response.error) 
                : response.error;
            throw new Error(`API Error: ${errorMessage}`);
        }
        
        for (const field of expectedFields) {
            if (!(field in response)) {
                logger.warn(`[BaseProvider-${this.providerName}] Missing expected field: ${field}`);
            }
        }
        
        return true;
    }

    /**
     * Standard logging helper
     */
    log(level, message, data = null) {
        const formattedMessage = `[BaseProvider-${this.providerName}] ${message}`;
        
        if (data) {
            logger[level](formattedMessage, data);
        } else {
            logger[level](formattedMessage);
        }
    }

    // Abstract methods that must be implemented by subclasses
    async searchTorrents(apiKey, searchKey, threshold) {
        throw new Error(`BaseProvider-${this.constructor.name} must implement searchTorrents method`);
    }

    async listTorrents(apiKey, skip) {
        throw new Error(`BaseProvider-${this.constructor.name} must implement listTorrents method`);
    }

    async getTorrentDetails(apiKey, id) {
        throw new Error(`BaseProvider-${this.constructor.name} must implement getTorrentDetails method`);
    }

    // Optional methods with default implementations
    async listTorrentsParallel(apiKey, ...args) {
        // Default implementation falls back to regular listTorrents
        return this.listTorrents(apiKey, ...args);
    }

    async unrestrictUrl(apiKey, hostUrl, ...args) {
        throw new Error(`BaseProvider-${this.constructor.name} does not support URL unrestriction`);
    }

    async searchDownloads(apiKey, searchKey, threshold) {
        throw new Error(`BaseProvider-${this.constructor.name} does not support download search`);
    }
}

export { BaseProvider as default, ApiKeySecurityManager };
