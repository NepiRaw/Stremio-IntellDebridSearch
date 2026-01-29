import PremiumizeClient from 'premiumize-api'
import BaseProvider, { ApiKeySecurityManager } from './BaseProvider.js'
import { parseUnified } from '../utils/unified-torrent-parser.js'
import { isVideo } from '../stream/metadata-extractor.js'
import { encode } from 'urlencode'

class PremiumizeProvider extends BaseProvider {
    constructor() {
        super('Premiumize');
    }

    /**
     * Validate Premiumize API key before encryption
     * Static method for use in /encrypt-config endpoint
     * @param {string} apiKey - API key to validate
     * @returns {Promise<{valid: boolean, error?: string, customerId?: string, premium?: boolean}>}
     */
    static async validateApiKey(apiKey) {
        const VALIDATION_TIMEOUT = 10000;
        
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), VALIDATION_TIMEOUT);
            
            const response = await fetch(`https://www.premiumize.me/api/account/info?apikey=${apiKey}`, {
                signal: controller.signal
            });
            clearTimeout(timeout);
            
            const data = await response.json();
            
            if (data.status === 'error') {
                return { valid: false, error: data.message || 'Invalid API key' };
            }
            
            return {
                valid: data.status === 'success',
                customerId: data.customer_id,
                premium: data.premium_until > Date.now() / 1000,
                premiumUntil: data.premium_until
            };
        } catch (error) {
            if (error.name === 'AbortError') {
                return { valid: false, error: 'Validation timeout - try again' };
            }
            return { valid: false, error: error.message };
        }
    }

    /**
     * Search files using fuzzy matching
     */
    async searchFiles(apiKey, searchKey, threshold = 0.3) {
        this.log('debug', `Search files with searchKey: ${searchKey}`);

        const files = await this.listFiles(apiKey);
        const torrents = files.map(file => this.normalizeTorrent(file, {
            created: this.parseDate(file.created_at)
        }));

        return this.performFuzzySearch(torrents, searchKey, threshold);
    }

    /**
     * Search torrents (alias for searchFiles)
     */
    async searchTorrents(apiKey, searchKey, threshold = 0.3) {
        return this.searchFiles(apiKey, searchKey, threshold);
    }

    /**
     * List all files
     */
    async listFiles(apiKey, skip = 0) {
        return this.makeApiCall(async () => {
            try {
                const PM = new PremiumizeClient(apiKey);
                const response = await PM.item.listAll();
                
                this.validateApiResponse(response, ['status']);
                
                if (response.status === 'success') {
                    this.log('debug', `Retrieved ${response.files?.length || 0} files`);
                    return response.files || [];
                }
                
                return [];
            } catch (error) {
                this.log('warn', 'Premiumize listFiles failed:', error);
                return [];  // Return empty array on failure
            }
        }, 3, 'listFiles');
    }

    /**
     * List torrents for catalog
     */
    async listTorrents(apiKey) {
        const files = await this.listFiles(apiKey);
        return files.map(file => this.extractCatalogMeta({
            id: file.id,
            name: file.name
        }));
    }

    /**
     * Get detailed torrent information
     */
    async getTorrentDetails(apiKey, id, context = 'stream') {
        return this.makeApiCall(async () => {
            const PM = new PremiumizeClient(apiKey);
            const result = await PM.item.details(id);
            return this.toTorrentDetails(result, apiKey, context);
        }, 3, `getTorrentDetails(${id})`);
    }

    /**
     * Premiumize-specific torrent details processing
     */
    toTorrentDetails(item, apiKey, context = 'stream') {
        let videos = [];
        
        if (this.isVideo(item.name)) {
            const info = context === 'stream' 
                ? this.parseTitle(item.name)
                : { title: item.name };
            
            videos.push({
                id: item.id,
                name: item.name,
                url: this.buildSecureStreamUrl(apiKey, item.id, item),
                size: item.size,
                created: this.parseDate(item.created_at),
                info: info
            });
        }

        return this.normalizeTorrentDetails(item, videos, {
            hash: null, // Premiumize files don't have torrent hashes
            created: this.parseDate(item.created_at)
        });
    }

    /**
     * Premiumize-specific stream URL building - uses stream_link or link
     */
    buildSecureStreamUrl(apiKey, torrentId, file, index = 0) {
        if (!file || (!file.stream_link && !file.link)) {
            return null;
        }

        const hostUrl = file.stream_link || file.link; // Prefer stream_link for Premiumize
        const secureToken = ApiKeySecurityManager.generateSecureToken(this.providerName, apiKey);
        return `${process.env.ADDON_URL}/resolve/${this.providerName}/${secureToken}/${torrentId}/${encode(hostUrl)}`;
    }

    /**
     * Enhanced error handling for Premiumize-specific errors
     */
    handleError(error, context = 'unknown') {
        this.log('debug', `Error in ${context}:`, error);
        
        // Premiumize-specific error handling
        if (error?.response?.status === 401 || error?.message?.includes('401')) {
            return super.handleError(new Error('Invalid API token'), context);
        }
        
        if (error?.response?.status === 403) {
            const accessError = new Error('Access denied by provider');
            accessError.name = 'AccessDeniedError';
            accessError.code = 'ACCESS_DENIED';
            return super.handleError(accessError, context);
        }
        
        return super.handleError(error, context);
    }

    isVideo(filename) {
        return isVideo(filename);
    }
    parseTitle(filename) {
        return parseUnified(filename);
    }

    normalizeTorrent(item, customFields = {}) {
        return {
            source: this.providerName,
            id: item.id,
            name: item.name,
            type: 'other',
            info: null,
            size: item.size,
            created: this.parseDate(item.created_at),
            ...customFields
        };
    }
}

// Create singleton instance
const premiumizeProvider = new PremiumizeProvider();

export default premiumizeProvider;
export { PremiumizeProvider };