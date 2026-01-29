import DebridLinkClient from 'debrid-link-api'
import { isVideo } from '../stream/metadata-extractor.js'
import { parseUnified } from '../utils/unified-torrent-parser.js'
import { BadTokenError, AccessDeniedError } from '../utils/error-handler.js'
import { logger } from '../utils/logger.js'
import { BaseProvider } from './BaseProvider.js'

class DebridLinkProvider extends BaseProvider {
    constructor() {
        super('DebridLink')
    }

    /**
     * Validate DebridLink API key before encryption
     * Static method for use in /encrypt-config endpoint
     * @param {string} apiKey - API key to validate
     * @returns {Promise<{valid: boolean, error?: string, username?: string, premium?: boolean}>}
     */
    static async validateApiKey(apiKey) {
        const VALIDATION_TIMEOUT = 10000;
        
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), VALIDATION_TIMEOUT);
            
            const response = await fetch('https://debrid-link.com/api/v2/account/infos', {
                headers: { 'Authorization': `Bearer ${apiKey}` },
                signal: controller.signal
            });
            clearTimeout(timeout);
            
            const data = await response.json();
            
            if (!data.success) {
                return {
                    valid: false,
                    error: data.error || 'Invalid API key'
                };
            }
            
            return {
                valid: true,
                username: data.value?.username,
                premium: data.value?.premiumLeft > 0,
                premiumLeft: data.value?.premiumLeft
            };
        } catch (error) {
            if (error.name === 'AbortError') {
                return { valid: false, error: 'Validation timeout - try again' };
            }
            return { valid: false, error: error.message };
        }
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
            .catch(err => {
                if (err === 'badToken') {
                    logger.warn('[DebridLink] Invalid or expired API token');
                } else {
                    logger.warn('[DebridLink] API error:', err?.message || err);
                }
            })

        return torrents.map(torrent => this.extractCatalogMeta({
            id: torrent.id.split('-')[0],
            name: torrent.name
        })) || []
    }

    async listTorrentsParallel(apiKey) {
        try {
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
                .catch(err => {
                    if (err === 'badToken') {
                        logger.warn('[DebridLink] Invalid or expired API token');
                    } else {
                        logger.warn('[DebridLink] API error:', err?.message || err);
                    }
                })

            while (nextPage != -1 && nextPage < totalPages) {
                promises.push(
                    DL.files.list(idParent, nextPage)
                        .then(result => {
                            if (result.success) {
                                const additionalTorrents = result.value || [];
                                torrents = torrents.concat(additionalTorrents)
                            }
                        })
                        .catch(err => {
                            if (err === 'badToken') {
                                logger.warn('[DebridLink] Invalid or expired API token');
                            }
                        })
                )
                nextPage = nextPage + 1
            }

            await Promise.all(promises)
                .catch(err => {
                    logger.warn('[DebridLink] Batch fetch error:', err?.message || err);
                })

            return torrents || []
        } catch (error) {
            logger.warn(`[DebridLink] listTorrentsParallel failed: ${error?.message || error}`);
            return [];
        }
    }

    async getTorrentDetails(apiKey, ids) {
        const DL = new DebridLinkClient(apiKey)

        const idArray = Array.isArray(ids) ? ids : [ids];

        return await DL.seedbox.list()
            .then(result => result.value)
            .then(async torrents => {
                const filteredTorrents = torrents.filter(torrent => 
                    idArray.includes(torrent.id)
                );
                
                
                const detailsPromises = filteredTorrents.map(torrent => this.toTorrentDetails(torrent, apiKey, 'stream'));
                const detailsArray = await Promise.all(detailsPromises);
                
                return Array.isArray(ids) ? detailsArray : (detailsArray[0] || null);
            })
            .catch(err => {
                if (err === 'badToken') {
                    logger.warn('[DebridLink] Invalid or expired API token');
                } else {
                    logger.warn('[DebridLink] API error:', err?.message || err);
                }
                return null;
            })
    }

    toTorrent(item) {
        return {
            source: 'DebridLink',
            id: item.id.split('-')[0],
            name: item.name,
            type: 'other',
            info: parseUnified(item.name),
            size: item.size,
            created: new Date(item.created * 1000),
        }
    }

    async toTorrentDetails(item, apiKey, context = 'stream') {
        const videoFiles = item.files.filter(file => isVideo(file.name));
        
        const videoParsingPromises = videoFiles.map(async (file) => {
            const url = this.buildSecureStreamUrl(apiKey, item.id, { link: file.downloadUrl });
            
            const info = context === 'stream' 
                ? parseUnified(file.name)
                : { title: file.name };
            
            return {
                id: file.id,
                name: file.name,
                url: url,
                size: file.size,
                created: new Date(item.created * 1000),
                info: info
            };
        });
        
        const videos = await Promise.all(videoParsingPromises);
        
        return {
            source: 'DebridLink',
            id: item.id,
            name: item.name,
            type: 'other',
            hash: item.hashString?.toLowerCase() || '',
            size: item.totalSize || item.size || 0,
            created: new Date(item.created * 1000),
            videos: videos || []
        };
    }

    handleError(err) {
        if (err === 'badToken') {
            logger.warn('[DebridLink] Invalid or expired API token');
            return Promise.reject(new BadTokenError('Invalid API token', 'DebridLink'))
        }

        logger.error('[DebridLink] API error:', err?.message || err);
        return Promise.reject(err)
    }

    normalizeTorrent(item, customFields = {}) {
        return {
            source: this.providerName,
            id: item.id,
            name: item.name || item.filename,
            type: 'other',
            info: null,
            size: item.size || item.bytes,
            created: this.parseDate(item.created || item.added || item.completionDate || item.created_at),
            ...customFields
        };
    }
}

const debridLinkProvider = new DebridLinkProvider()

export default debridLinkProvider;
export { DebridLinkProvider };