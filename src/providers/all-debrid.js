import AllDebridClient from 'all-debrid-api'
import BaseProvider from './BaseProvider.js'
import { processTorrentDetails } from '../utils/debrid-processor.js'
import { encode } from 'urlencode'

class AllDebridProvider extends BaseProvider {
    constructor() {
        super('AllDebrid');
    }

    buildStreamUrl(apiKey, torrentId, file) {
        const hostUrl = file.link || file.download;
        return `${process.env.ADDON_URL}/resolve/AllDebrid/${apiKey}/${torrentId}/${encode(hostUrl)}`;
    }

    async searchTorrents(apiKey, searchKey = null, threshold = 0.3) {
        this.log('debug', `Search torrents with searchKey: ${searchKey}`);

        const torrentsResults = await this.listTorrentsParallel(apiKey, 1, 1000);
        const torrents = torrentsResults.map(item => this.normalizeTorrent(item, {
            name: item.filename // AllDebrid uses 'filename' field
        }));

        return this.performFuzzySearch(torrents, searchKey, threshold);
    }

    async getTorrentDetails(apiKey, id) {
        return this.makeApiCall(async () => {
            const AD = new AllDebridClient(apiKey);
            const response = await AD.magnet.status(id);

            this.validateApiResponse(response, ['data']);

            if (!response?.data?.magnets) {
                this.log('error', `No magnets found for ID ${id}`);
                return null;
            }

            return processTorrentDetails({
                apiKey,
                rawResponse: response.data,
                item: response.data.magnets,
                source: 'alldebrid',
                urlBuilder: (key, torrentId, file) => this.buildStreamUrl(key, torrentId, file)
            });
        }, 3, `getTorrentDetails(${id})`);
    }

    async toTorrentDetails(apiKey, item) {
        const videos = this.extractVideoFiles(item, apiKey, (key, torrentId, file, index) => {
            return this.buildStreamUrl(key, torrentId, file);
        });

        return this.normalizeTorrentDetails(item, videos, {
            name: item.filename, // AllDebrid uses 'filename'
            hash: item.hash,
            created: this.parseDate(item.completionDate)
        });
    }

    async unrestrictUrl(apiKey, hostUrl) {
        return this.makeApiCall(async () => {
            const AD = new AllDebridClient(apiKey);
            const response = await AD.link.unlock(hostUrl);
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

    async listTorrentsParallel(apiKey) {
        return this.makeApiCall(async () => {
            const AD = new AllDebridClient(apiKey);
            const response = await AD.magnet.status();
            
            this.validateApiResponse(response, ['data']);
            
            const torrents = response.data.magnets
                .filter(item => item.statusCode === 4); // Only completed torrents
                
            this.log('debug', `Retrieved ${torrents.length} completed torrents`);
            return torrents || [];
        }, 3, 'listTorrentsParallel');
    }

    handleError(error, context = 'unknown') {
        this.log('debug', `Error in ${context}:`, error);
        
        if (error && error.code === 'AUTH_BAD_APIKEY') {
            return super.handleError(new Error('Invalid API key'), context);
        }
        
        return super.handleError(error, context);
    }
}

const allDebridProvider = new AllDebridProvider();

export default allDebridProvider;
export { AllDebridProvider };