import RealDebridClient from 'real-debrid-api';
import { isVideo, FILE_TYPES } from '../stream/metadata-extractor.js';
import BaseProvider from './BaseProvider.js';
import { parseUnified } from '../utils/unified-torrent-parser.js';

class RealDebridProvider extends BaseProvider {
    constructor() {
        super('RealDebrid');
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
            const total = firstResp.meta?.total || firstPage.length;
            const totalPages = Math.ceil(total / pageSize);
            
            if (totalPages <= 1) return firstPage;

            const pagePromises = [];
            for (let p = 2; p <= totalPages; p++) {
                pagePromises.push(
                    RD.torrents.get(0, p, pageSize).then(resp => resp.data || [])
                );
            }
            
            const otherPages = await Promise.all(pagePromises);
            return firstPage.concat(...otherPages);
        } catch (error) {
            this.log('warn', 'fetchTorrentsParallel failed:', error);
            return [];  // Return empty array on failure
        }
    }

    async fetchDownloadsParallel(RD, pageSize) {
        try {
            const firstResp = await RD.downloads.get(0, 1, pageSize);
            const firstPage = firstResp.data || [];
            const total = firstResp.meta?.total || firstPage.length;
            const totalPages = Math.ceil(total / pageSize);
            
            if (totalPages <= 1) {
                return firstPage.filter(f => f.host !== 'real-debrid.com');
            }

            const pagePromises = [];
            for (let p = 2; p <= totalPages; p++) {
                pagePromises.push(
                    RD.downloads.get(0, p, pageSize).then(resp => resp.data || [])
                );
            }
            
            const otherPages = await Promise.all(pagePromises);
            const allFiles = firstPage.concat(...otherPages);
            return allFiles.filter(f => f.host !== 'real-debrid.com');
        } catch (error) {
            this.log('warn', 'fetchDownloadsParallel failed:', error);
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