import PremiumizeClient from 'premiumize-api'
import BaseProvider from './BaseProvider.js'
import { parseUnified } from '../utils/unified-torrent-parser.js'
import { encode } from 'urlencode'

class PremiumizeProvider extends BaseProvider {
    constructor() {
        super('Premiumize');
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
            const PM = new PremiumizeClient(apiKey);
            const response = await PM.item.listAll();
            
            this.validateApiResponse(response, ['status']);
            
            if (response.status === 'success') {
                this.log('debug', `Retrieved ${response.files.length} files`);
                return response.files || [];
            }
            
            return [];
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
    async getTorrentDetails(apiKey, id) {
        return this.makeApiCall(async () => {
            const PM = new PremiumizeClient(apiKey);
            const result = await PM.item.details(id);
            return this.toTorrentDetails(result);
        }, 3, `getTorrentDetails(${id})`);
    }

    /**
     * Premiumize-specific torrent details processing
     */
    toTorrentDetails(item) {
        let videos = [];
        
        if (this.isVideo(item.link)) {
            videos.push({
                id: item.id,
                name: item.name,
                url: `${process.env.ADDON_URL}/resolve/Premiumize/null/${item.id}/${encode(item.link)}`,
                size: item.size,
                created: this.parseDate(item.created_at),
                info: this.parseTitle(item.name)
            });
        }

        return this.normalizeTorrentDetails(item, videos, {
            hash: item.id.toLowerCase(),
            created: this.parseDate(item.created_at)
        });
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

    /**
     * Helper for video detection
     */
    isVideo(filename) {
        // Use the imported isVideo from metadata-extractor
        const { isVideo } = require('../stream/metadata-extractor.js');
        return isVideo(filename);
    }

    /**
     * Helper for title parsing
     */
    parseTitle(filename) {
        return parseUnified(filename);
    }
}

// Create singleton instance
const premiumizeProvider = new PremiumizeProvider();

// Legacy function exports for backwards compatibility
// TODO: Remove this section when provider is confirmed working
// 
// MIGRATION INSTRUCTIONS for removing legacy functions:
// 
// 1. In this file (premiumize.js):
//    - Remove the legacy function exports below (searchFiles, listFiles, getTorrentDetails, toTorrent, toTorrentDetails)
//    - Change default export from object to: export default premiumizeProvider;
// 
// 2. In stream-provider.js:
//    - Change import from: import Premiumize from './providers/premiumize.js';
//    - To class import: import { PremiumizeProvider } from './providers/premiumize.js';
//    - Update providers object from: Premiumize: Premiumize,
//    - To class instance: Premiumize: new PremiumizeProvider(),
// 
// 3. In catalog-provider.js:
//    - Change import from: import Premiumize from './providers/premiumize.js'
//    - To class import: import { PremiumizeProvider } from './providers/premiumize.js'
//    - Add provider instance: const premiumizeProvider = new PremiumizeProvider();
//    - Update providers object from: Premiumize: Premiumize,
//    - To class instance: Premiumize: premiumizeProvider,
//    - Note: Currently Premiumize is not actively used in catalog-provider.js method calls
// 
async function searchFiles(apiKey, searchKey, threshold = 0.3) {
    return premiumizeProvider.searchFiles(apiKey, searchKey, threshold);
}

async function listFiles(apiKey, skip = 0) {
    return premiumizeProvider.listFiles(apiKey, skip);
}

async function getTorrentDetails(apiKey, id) {
    return premiumizeProvider.getTorrentDetails(apiKey, id);
}

function toTorrent(item) {
    return premiumizeProvider.normalizeTorrent(item, {
        created: premiumizeProvider.parseDate(item.created_at)
    });
}

function toTorrentDetails(item) {
    return premiumizeProvider.toTorrentDetails(item);
}

export default { listFiles, searchFiles, getTorrentDetails };
export { PremiumizeProvider };