import axios from 'axios';
import Bottleneck from 'bottleneck';
import querystring from 'querystring';
import { encode } from 'urlencode';
import BaseProvider, { ApiKeySecurityManager } from './BaseProvider.js';
import { parseUnified } from '../utils/unified-torrent-parser.js';
import { isVideo } from '../stream/metadata-extractor.js';

// Rate limiter 
const limiter = new Bottleneck({
    minTime: 1000 / 12, // ~12 req/s
    maxConcurrent: 5,
    reservoir: 600, // 600/min
    reservoirRefreshAmount: 600,
    reservoirRefreshInterval: 60 * 1000
});

class AllDebridProvider extends BaseProvider {
    constructor() {
        super('AllDebrid');
        this.baseUrl = 'https://api.alldebrid.com/v4.1'; // Updated to v4.1
    }

    getHeaders(apiKey) {
        return {
            'Authorization': `Bearer ${apiKey}`,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Sec-Fetch-Dest': 'empty',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Site': 'cross-site',
            'Content-Type': 'application/x-www-form-urlencoded'
        };
    }

    // Enhanced API request
    async makeAllDebridRequest(endpoint, params = {}, apiKey) {
        const url = `${this.baseUrl}/${endpoint}`;
        
        const postData = {
            agent: 'intelldebrid',
            ...params
        };

        let retryCount = 0;
        const maxRetries = 3;
        
        while (retryCount <= maxRetries) {
            try {
                const response = await limiter.schedule(() => axios({
                    method: 'POST',
                    url: url,
                    data: querystring.stringify(postData),
                    headers: this.getHeaders(apiKey),
                    timeout: 30000,
                    responseType: 'text',
                    decompress: true
                }));

                // Handle HTTP error status codes
                if (response.status < 200 || response.status >= 300) {
                    const headers = response.headers;
                    if (response.status === 403) {
                        if (headers['cf-ray']) {
                            if (retryCount < maxRetries) {
                                const delay = Math.pow(2, retryCount) * 500 + Math.random() * 500;
                                await new Promise(resolve => setTimeout(resolve, delay));
                                retryCount++;
                                continue;
                            }
                            throw new Error(`Cloudflare blocking detected after ${maxRetries + 1} attempts`);
                        }
                        throw new Error(`HTTP 403 Forbidden - Anti-bot detection triggered`);
                    } else if (response.status === 503 || response.status === 429) {
                        const delay = Math.pow(2, retryCount) * 2000 + Math.random() * 1000;
                        await new Promise(resolve => setTimeout(resolve, delay));
                        retryCount++;
                        continue;
                    }
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }

                const text = response.data;
                
                // Check for HTML responses
                if (typeof text === 'string' && (text.includes('<html>') || text.includes('<!DOCTYPE html>'))) {
                    if (text.includes('cloudflare') || text.includes('Cloudflare')) {
                        if (retryCount < maxRetries) {
                            const delay = Math.pow(2, retryCount) * 1000 + Math.random() * 500;
                            await new Promise(resolve => setTimeout(resolve, delay));
                            retryCount++;
                            continue;
                        }
                        throw new Error('Cloudflare protection detected after retries');
                    }
                    throw new Error('Unexpected HTML response from API');
                }

                let parsedResponse;
                try {
                    parsedResponse = JSON.parse(text);
                } catch (parseError) {
                    throw new Error(`Failed to parse API response: ${parseError.message}`);
                }

                return parsedResponse;

            } catch (error) {
                if (retryCount >= maxRetries) {
                    throw error;
                }
                retryCount++;
                const delay = Math.pow(2, retryCount) * 1000;
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }

    async searchTorrents(apiKey, searchKey = null, threshold = 0.3) {
        const torrentsResults = await this.listTorrentsParallel(apiKey);
        const torrents = torrentsResults.map(item => this.normalizeTorrent(item, {
            name: item.filename // AllDebrid uses 'filename' field
        }));
        
        if (!searchKey) {
            return torrents;
        }
        
        return this.performFuzzySearch(torrents, searchKey, threshold);
    }

    normalizeTorrent(item, customFields = {}) {
        const base = {
            source: this.providerName,
            id: item.id,
            name: item.name || item.filename,
            type: 'other',
            info: null,
            size: item.size || item.bytes,
            created: this.parseDate(item.created || item.added || item.completionDate || item.created_at),
            ...customFields
        };
        
        return base;
    }

    async getTorrentDetails(apiKey, id, context = 'stream') {
        return this.makeApiCall(async () => {
            const statusResponse = await this.makeAllDebridRequest('magnet/status', { id }, apiKey);
            this.validateApiResponse(statusResponse, ['data']);

            if (!statusResponse?.data?.magnets) {
                this.log('error', `No magnets found for ID ${id}`);
                return null;
            }

            const magnetsData = statusResponse.data.magnets;
            let magnetDetails = null;
            
            if (Array.isArray(magnetsData)) {
                magnetDetails = magnetsData.find(m => m.id === parseInt(id));
            } else if (magnetsData && typeof magnetsData === 'object') {
                magnetDetails = magnetsData.id ? magnetsData : Object.values(magnetsData).find(m => m.id === parseInt(id));
            }

            if (!magnetDetails) {
                this.log('error', `No magnet details found for ID ${id}`);
                return null;
            }

            if (magnetDetails.files && Array.isArray(magnetDetails.files)) {
                this.log('debug', `Files included in status response for magnet ${id} - ${magnetDetails.filename}`);
            } else {
                try {
                    const filesResponse = await this.makeAllDebridRequest('magnet/files', { id: [parseInt(id)] }, apiKey);
                    this.validateApiResponse(filesResponse, ['data']);
                    
                    if (filesResponse?.data?.magnets && filesResponse.data.magnets.length > 0) {
                        const magnetFiles = filesResponse.data.magnets[0];
                        if (magnetFiles.files) {
                            magnetDetails.files = magnetFiles.files;
                            this.log('debug', `Got files from files endpoint for magnet ${id}`);
                        }
                    }
                } catch (error) {
                    this.log('warn', `Failed to get files for magnet ${id}: ${error.message}`);
                }
            }

            return await this.toTorrentDetails(apiKey, magnetDetails, context);
        }, 3, `getTorrentDetails(${id})`);
    }

    /**
     * Universal AllDebrid file flattening function
     * Handles all known AllDebrid file structure patterns
     */
    flattenAllDebridFiles(files) {
        const flattenedFiles = [];
        
        if (!files || !Array.isArray(files) || files.length === 0) {
            return flattenedFiles;
        }

        const extractFiles = (items) => {
            if (!items) return;
            
            if (Array.isArray(items)) {
                items.forEach((item) => {
                    extractFiles(item);
                });
                return;
            }
            
            if (typeof items === 'object') {
                if (items.n && items.s && items.l) {
                    flattenedFiles.push({
                        name: items.n,
                        size: items.s,
                        allDebridFile: items
                    });
                }
                
                if (items.e && Array.isArray(items.e)) {
                    extractFiles(items.e);
                }
            }
        };
        extractFiles(files);
        
        return flattenedFiles;
    }

    async toTorrentDetails(apiKey, item, context = 'stream') {
        const flattenedFiles = this.flattenAllDebridFiles(item.files);

        const videoFiles = flattenedFiles.filter(file => isVideo(file.name));
        
        const fileParsingPromises = videoFiles.map(async (file, index) => {
            const url = this.buildSecureStreamUrl(apiKey, item.id, file.allDebridFile, index);
            
            const info = context === 'stream' 
                ? parseUnified(file.name)
                : { title: file.name };
            
            return {
                id: `${item.id}:${index}`,
                name: file.name,
                url: url,
                size: file.size,
                created: this.parseDate(item.completionDate),
                info: info
            };
        });
        
        const videos = await Promise.all(fileParsingPromises);

        return this.normalizeTorrentDetails(item, videos, {
            name: item.filename,
            hash: item.hash,
            created: this.parseDate(item.completionDate)
        });
    }

    buildSecureStreamUrl(apiKey, torrentId, file, index = 0) {
        if (!file || !file.l) {
            return null;
        }

        const hostUrl = file.l; // AllDebrid uses 'l' for file URL
        const secureToken = ApiKeySecurityManager.generateSecureToken(this.providerName, apiKey);
        return `${process.env.ADDON_URL}/resolve/${this.providerName}/${secureToken}/${torrentId}/${encode(hostUrl)}`;
    }

    /**
     * Bulk optimization: Get details for multiple torrents
     */
    async bulkGetTorrentDetails(apiKey, torrentIds) {
        return this.makeApiCall(async () => {
            if (!torrentIds || torrentIds.length === 0) {
                return new Map();
            }

            this.log('info', `Bulk fetching details for ${torrentIds.length} torrents`);
            const resultMap = new Map();
            const batchSize = 20;
            const batches = [];
            for (let i = 0; i < torrentIds.length; i += batchSize) {
                batches.push(torrentIds.slice(i, i + batchSize));
            }
            
            const batchPromises = batches.map(async (batch, batchIndex) => {
                try {
                    const batchPromises = batch.map(async (id) => {
                        try {
                            const statusResponse = await this.makeAllDebridRequest('magnet/status', { id }, apiKey);
                            this.validateApiResponse(statusResponse, ['data']);

                            if (!statusResponse?.data?.magnets) {
                                this.log('debug', `No magnet data found for ID ${id}`);
                                return { id, result: null };
                            }

                            const magnetsData = statusResponse.data.magnets;
                            let magnetDetails = null;
                            
                            if (Array.isArray(magnetsData)) {
                                magnetDetails = magnetsData.find(m => m.id === parseInt(id));
                            } else if (magnetsData && typeof magnetsData === 'object') {
                                magnetDetails = magnetsData.id ? magnetsData : Object.values(magnetsData).find(m => m.id === parseInt(id));
                            }

                            if (!magnetDetails) {
                                this.log('debug', `No magnet details found for ID ${id}`);
                                return { id, result: null };
                            }

                            if (magnetDetails.statusCode !== 4) {
                                this.log('debug', `Skipping magnet ${id} - not ready (status: ${magnetDetails.statusCode})`);
                                return { id, result: null };
                            }

                            if (!magnetDetails.files || magnetDetails.files.length === 0) {
                                try {
                                    const filesResponse = await this.makeAllDebridRequest('magnet/files', 
                                        { id: [parseInt(id)] }, apiKey);
                                    
                                    if (filesResponse?.status === 'success' && 
                                        filesResponse.data?.magnets?.[0]?.files) {
                                        magnetDetails.files = filesResponse.data.magnets[0].files;
                                        this.log('debug', `Got additional files for magnet ${id}`);
                                    }
                                } catch (error) {
                                    this.log('warn', `Failed to get files for magnet ${id}: ${error.message}`);
                                }
                            } else {
                                this.log('debug', `Files included in status response for magnet ${id}`);
                            }

                            const torrentDetails = await this.toTorrentDetails(apiKey, magnetDetails, 'stream');
                            return { id, result: torrentDetails };
                        } catch (error) {
                            this.log('warn', `Failed to process magnet ${id}: ${error.message}`);
                            return { id, result: null };
                        }
                    });
                    
                    const batchResults = await Promise.all(batchPromises);
                    this.log('debug', `Batch ${batchIndex + 1}/${batches.length} completed: ${batchResults.filter(r => r.result !== null).length}/${batch.length} successful`);
                    return batchResults;
                } catch (error) {
                    this.log('warn', `Batch ${batchIndex + 1} failed: ${error.message}`);
                    return batch.map(id => ({ id, result: null }));
                }
            });
            
            const allBatchResults = await Promise.all(batchPromises);
            
            for (const batchResults of allBatchResults) {
                for (const { id, result } of batchResults) {
                    resultMap.set(id, result);
                }
            }

            const successCount = Array.from(resultMap.values()).filter(v => v !== null).length;
            this.log('info', `Bulk operation completed: ${successCount}/${torrentIds.length} successful (${batches.length} parallel batches)`);
            return resultMap;

        }, 3, `bulkGetTorrentDetails(${torrentIds.length} torrents)`);
    }

    async listTorrentsParallel(apiKey) {
        return this.makeApiCall(async () => {
            const response = await this.makeAllDebridRequest('magnet/status', {}, apiKey);
            this.validateApiResponse(response, ['data']);

            const magnets = response.data?.magnets || [];
            
            return magnets
                .filter(magnet => magnet.statusCode === 4) // Ready torrents only
                .filter(magnet => magnet.filename); // Ensure we have a name
        }, 3, 'listTorrentsParallel');
    }

    async unrestrictUrl(apiKey, hostUrl) {
        return this.makeApiCall(async () => {
            const response = await this.makeAllDebridRequest('link/unlock', { link: hostUrl }, apiKey);
            this.validateApiResponse(response, ['data']);
            
            return response.data.link;
        }, 3, `unrestrictUrl(${hostUrl})`);
    }

    async listTorrents(apiKey) {
        const torrents = await this.listTorrentsParallel(apiKey);
        return torrents.map(torrent => this.extractCatalogMeta({
            id: torrent.id,
            name: torrent.filename
        }));
    }
}

const allDebridProvider = new AllDebridProvider();

export default allDebridProvider;
export { AllDebridProvider };
