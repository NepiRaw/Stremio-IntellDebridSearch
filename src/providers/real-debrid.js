import RealDebridClient from 'real-debrid-api';
import { isVideo, FILE_TYPES } from '../stream/metadata-extractor.js';
import BaseProvider from './BaseProvider.js';
import { parseUnified } from '../utils/unified-torrent-parser.js';

class RealDebridProvider extends BaseProvider {
    constructor() {
        super('RealDebrid');
    }

    /**
     * Validate RealDebrid API key before encryption
     * Static method for use in /encrypt-config endpoint
     * @param {string} apiKey - API key to validate
     * @returns {Promise<{valid: boolean, error?: string, username?: string, premium?: boolean}>}
     */
    static async validateApiKey(apiKey) {
        const VALIDATION_TIMEOUT = 10000;
        
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), VALIDATION_TIMEOUT);
            
            const response = await fetch('https://api.real-debrid.com/rest/1.0/user', {
                headers: { 'Authorization': `Bearer ${apiKey}` },
                signal: controller.signal
            });
            clearTimeout(timeout);
            
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                return { 
                    valid: false, 
                    error: errorData.error || `HTTP ${response.status}`,
                    errorCode: errorData.error_code
                };
            }
            
            const data = await response.json();
            return {
                valid: true,
                username: data.username,
                premium: data.premium > 0,
                expiration: data.expiration
            };
        } catch (error) {
            if (error.name === 'AbortError') {
                return { valid: false, error: 'Validation timeout - try again' };
            }
            return { valid: false, error: error.message };
        }
    }

    async searchFiles(fileType, apiKey, searchKey, threshold = 0.3) {
        this.log('debug', `Search ${fileType.description} with searchKey: ${searchKey}`);

        const files = await this.listFilesParrallel(fileType, apiKey);
        let results = [];
        
        if (fileType?.toString() === 'Symbol(torrents)' || fileType === FILE_TYPES.TORRENTS) {
            results = files.map(result => this.toTorrent(result));
        } else if (fileType === FILE_TYPES.DOWNLOADS) {
            results = files.map(result => this.toDownload(result));
        }

        return this.performFuzzySearch(results, searchKey, threshold);
    }

    async searchTorrents(apiKey, searchKey = null, threshold = 0.3) {
        return this.searchFiles(FILE_TYPES.TORRENTS, apiKey, searchKey, threshold);
    }


    async searchDownloads(apiKey, searchKey = null, threshold = 0.3) {
        return this.searchFiles(FILE_TYPES.DOWNLOADS, apiKey, searchKey, threshold);
    }

    async getTorrentDetails(apiKey, id, context = 'stream') {
        return this.makeApiCall(async () => {
            const RD = new RealDebridClient(apiKey);
            const response = await RD.torrents.info(id);
            return this.toTorrentDetails(apiKey, response.data, context);
        }, 3, `getTorrentDetails(${id})`);
    }

    async toTorrentDetails(apiKey, item, context = 'stream') {
        const videos = item.files
            .filter(file => file.selected)
            .filter(file => isVideo(file.path))
            .map((file, index) => {
                const hostUrl = item.links.at(index);
                const url = this.buildSecureStreamUrl(apiKey, item.id, { link: hostUrl });
                
                const info = context === 'stream' 
                    ? this.parseTitle(file.path)
                    : { title: file.path };
                
                return {
                    id: `${item.id}:${file.id}`,
                    name: file.path,
                    url: url,
                    size: file.bytes,
                    created: this.parseDate(item.added),
                    info: info
                };
            });

        return this.normalizeTorrentDetails(item, videos, {
            name: item.filename,
            hash: item.hash,
            size: item.bytes,
            created: this.parseDate(item.added)
        });
    }

    async unrestrictUrl(apiKey, hostUrl, clientIp) {
        return this.makeApiCall(async () => {
            const options = this.getDefaultOptions(clientIp);
            const RD = new RealDebridClient(apiKey, options);
            const response = await RD.unrestrict.link(hostUrl);
            return response.data.download;
        }, 3, `unrestrictUrl(${hostUrl})`);
    }

    async toTorrent(apiKey, item) {
        if (typeof apiKey === 'object' && !item) {
            item = apiKey;
            return this.normalizeTorrent(item, {
                name: item.filename,
                size: item.bytes,
                created: this.parseDate(item.added)
            });
        }
        
        try {
            const details = await this.getTorrentDetails(apiKey, item.id);
            return details.videos || [];
        } catch (error) {
            logger.warn(`[RealDebrid] Failed to get stream details for torrent ${item.id}:`, error);
            return [];
        }
    }

    toDownload(item) {
        return {
            source: 'RealDebrid',
            id: item.id,
            url: item.download,
            name: item.filename,
            type: 'other',
            info: this.parseTitle(item.filename),
            size: item.filesize,
            created: this.parseDate(item.generated)
        };
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

    async listTorrents(apiKey, skip = 0) {
        const nextPage = Math.floor(skip / 50) + 1;
        const torrents = await this.listFilesParrallel(FILE_TYPES.TORRENTS, apiKey, nextPage);
        
        if (!Array.isArray(torrents)) {
            this.log('warn', 'listFilesParrallel returned non-array, defaulting to empty');
            return [];
        }
        return torrents.map(torrent => this.extractCatalogMeta({
            id: torrent.id,
            name: torrent.filename
        }));
    }

    async listFilesParrallel(fileType, apiKey, page = 1, pageSize = 50) {
        return this.makeApiCall(async () => {
            const RD = new RealDebridClient(apiKey, {
                params: { page: 1, limit: pageSize }
            });

            if (fileType?.toString() === 'Symbol(torrents)' || fileType === FILE_TYPES.TORRENTS) {
                return this.fetchTorrentsParallel(RD, pageSize);
            } else if (fileType?.toString() === 'Symbol(downloads)' || fileType === FILE_TYPES.DOWNLOADS) {
                return this.fetchDownloadsParallel(RD, pageSize);
            }
        }, 3, `listFilesParrallel(${fileType.description})`);
    }

    async fetchTorrentsParallel(RD, pageSize) {
        try {
            const firstResp = await RD.torrents.get(0, 1, pageSize);
            const firstPage = firstResp.data || [];
            
            if (firstPage.length === 0) return [];
            if (firstPage.length < pageSize) return firstPage;
            
            const pageNumbers = [];
            let testPage = 2;
            let hasMore = true;
            
            while (hasMore && testPage <= 100) { // Safety limit
                try {
                    const testResp = await RD.torrents.get(0, testPage, pageSize);
                    if (!testResp.data || testResp.data.length === 0) {
                        hasMore = false;
                    } else {
                        pageNumbers.push(testPage);
                        testPage++;
                    }
                } catch (error) {
                    if (error.response?.status === 429) {
                        this.log('warn', 'Rate limited during page discovery, waiting 5 seconds');
                        await new Promise(resolve => setTimeout(resolve, 5000));
                        continue;
                    }
                    hasMore = false;
                }
            }
            
            if (pageNumbers.length === 0) return firstPage;
            
            // Adaptive batch sizing - start with 3 (proven safe threshold)
            const allTorrents = [...firstPage];
            let batchSize = 2;
            const pagesToFetch = [...pageNumbers];
            let rateLimitRetries = 0;
            const maxRateLimitRetries = 2;
            
            while (pagesToFetch.length > 0) {
                const currentBatch = pagesToFetch.splice(0, batchSize);
                
                const batchResults = await Promise.all(
                    currentBatch.map(page => 
                        RD.torrents.get(0, page, pageSize)
                            .then(resp => ({ page, data: resp.data || [], success: true }))
                            .catch(error => ({ 
                                page,
                                status: error.response?.status,
                                error: error.response?.data?.error,
                                success: false
                            }))
                    )
                );
                
                const successful = batchResults.filter(r => r.success);
                const rateLimited = batchResults.filter(r => r.status === 429);
                
                if (rateLimited.length > 0) {
                    rateLimitRetries++;
                    if (rateLimitRetries > maxRateLimitRetries) {
                        this.log('warn', 'Max rate limit retries reached, returning partial results');
                        break;
                    }
                    if (batchSize > 1) {
                        this.log('debug', `Rate limited, reducing batch size from ${batchSize} to ${Math.max(1, Math.floor(batchSize / 2))}`);
                        batchSize = Math.max(1, Math.floor(batchSize / 2));
                    }
                    pagesToFetch.unshift(...currentBatch);
                    const waitTime = rateLimitRetries === 1 ? 2000 : 5000;
                    this.log('warn', `Rate limited (429), waiting ${waitTime/1000}s before retry ${rateLimitRetries}/${maxRateLimitRetries}`);
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                    continue;
                }

                successful.forEach(r => allTorrents.push(...r.data));
                
                if (pagesToFetch.length > 0) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            }
            
            return allTorrents;
        } catch (error) {
            if (error.isAxiosError && !error.response) {
                throw error;
            }
            
            if (error.response?.status === 429) {
                this.log('warn', 'Rate limited (429) on initial request, returning empty');
                return [];
            }
            if (error.response?.status === 401 || 
                error.response?.data?.error === 'bad_token' ||
                error.response?.data?.error_code === 8) {
                
                this.log('error', `RealDebrid authentication failed: ${error.response?.data?.error || 'Invalid or expired API key'}. Please verify your API key in addon settings. Error code: ${error.response?.data?.error_code || 'unknown'}`);
                throw error;
            }
            
            this.log('warn', `fetchTorrentsParallel failed: ${error.message}`);
            return [];  // Return empty array on failure
        }
    }

    async fetchDownloadsParallel(RD, pageSize) {
        try {
            const firstResp = await RD.downloads.get(0, 1, pageSize);
            const firstPage = firstResp.data || [];
            
            if (firstPage.length === 0) return [];
            if (firstPage.length < pageSize) {
                return firstPage.filter(f => f.host !== 'real-debrid.com');
            }
            
            const pageNumbers = [];
            let testPage = 2;
            let hasMore = true;
            
            while (hasMore && testPage <= 100) { // Safety limit
                try {
                    const testResp = await RD.downloads.get(0, testPage, pageSize);
                    if (!testResp.data || testResp.data.length === 0) {
                        hasMore = false;
                    } else {
                        pageNumbers.push(testPage);
                        testPage++;
                    }
                } catch (error) {
                    if (error.response?.status === 429) {
                        this.log('warn', 'Rate limited during downloads page discovery, waiting 5 seconds');
                        await new Promise(resolve => setTimeout(resolve, 5000));
                        continue;
                    }
                    hasMore = false;
                }
            }
            
            if (pageNumbers.length === 0) {
                return firstPage.filter(f => f.host !== 'real-debrid.com');
            }
            
            const allDownloads = [...firstPage];
            let batchSize = 3;
            const pagesToFetch = [...pageNumbers];
            let rateLimitRetries = 0;
            const maxRateLimitRetries = 2;
            
            while (pagesToFetch.length > 0) {
                const currentBatch = pagesToFetch.splice(0, batchSize);
                
                const batchResults = await Promise.all(
                    currentBatch.map(page => 
                        RD.downloads.get(0, page, pageSize)
                            .then(resp => ({ page, data: resp.data || [], success: true }))
                            .catch(error => ({ 
                                page,
                                status: error.response?.status,
                                error: error.response?.data?.error,
                                success: false
                            }))
                    )
                );
                
                const successful = batchResults.filter(r => r.success);
                const rateLimited = batchResults.filter(r => r.status === 429);
                
                if (rateLimited.length > 0) {
                    rateLimitRetries++;
                    if (rateLimitRetries > maxRateLimitRetries) {
                        this.log('warn', 'Max rate limit retries reached for downloads, returning partial results');
                        break;
                    }
                    if (batchSize > 1) {
                        this.log('debug', `Rate limited, reducing batch size from ${batchSize} to ${Math.max(1, Math.floor(batchSize / 2))}`);
                        batchSize = Math.max(1, Math.floor(batchSize / 2));
                    }
                    pagesToFetch.unshift(...currentBatch);
                    const waitTime = rateLimitRetries === 1 ? 2000 : 5000;
                    this.log('warn', `Rate limited (429), waiting ${waitTime/1000}s before retry ${rateLimitRetries}/${maxRateLimitRetries}`);
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                    continue;
                }
                
                successful.forEach(r => allDownloads.push(...r.data));
                
                if (pagesToFetch.length > 0) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            }
            
            return allDownloads.filter(f => f.host !== 'real-debrid.com');
        } catch (error) {
            if (error.isAxiosError && !error.response) {
                throw error;
            }
            
            if (error.response?.status === 429) {
                this.log('warn', 'Rate limited (429) on initial downloads request, returning empty');
                return [];
            }
            if (error.response?.status === 401 || 
                error.response?.data?.error === 'bad_token' ||
                error.response?.data?.error_code === 8) {
                
                this.log('error', `RealDebrid authentication failed: ${error.response?.data?.error || 'Invalid or expired API key'}. Please verify your API key in addon settings. Error code: ${error.response?.data?.error_code || 'unknown'}`);
                throw error;
            }
            
            this.log('warn', `fetchDownloadsParallel failed: ${error.message}`);
            return [];  // Return empty array on failure
        }
    }

    async bulkGetTorrentDetails(apiKey, ids) {
        const detailPromises = ids.map(id => this.getTorrentDetails(apiKey, id));
        const results = await Promise.all(detailPromises);
        
        const detailsMap = new Map();
        ids.forEach((id, index) => {
            detailsMap.set(id, results[index]);
        });
        
        return detailsMap;
    }

    handleError(error, context = 'unknown') {
        this.log('debug', `Error in ${context}:`, error);
        
        const errData = error.response?.data;
        
        if (errData && errData.error_code === 8) {
            return super.handleError(new Error('Invalid API token'), context);
        }
        
        if (errData && this.accessDeniedError(errData)) {
            const accessError = new Error('Access denied by provider');
            accessError.name = 'AccessDeniedError';
            accessError.code = 'ACCESS_DENIED';
            return super.handleError(accessError, context);
        }
        
        return super.handleError(error, context);
    }

    accessDeniedError(errData) {
        return [9, 20].includes(errData && errData.error_code);
    }

    getDefaultOptions(ip) {
        return { ip };
    }

    parseTitle(filename) {
        return parseUnified(filename);
    }
}

const realDebridProvider = new RealDebridProvider();

export default realDebridProvider;
export { RealDebridProvider };