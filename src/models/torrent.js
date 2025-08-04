import { validateSchema, ValidationError } from '../utils/error-handler.js';

/**
 * Torrent model - defines the structure and validation for Torrent objects
 * Standardizes torrent data handling across providers
 */

// Torrent schema definition
const torrentSchema = {
    id: {
        type: 'string',
        required: true,
        minLength: 1
    },
    name: {
        type: 'string',
        required: true,
        minLength: 1
    },
    size: {
        type: 'number',
        required: false,
        min: 0
    },
    files: {
        type: 'object', // Will be array but allowing object for flexibility
        required: false
    }
};

// File schema definition for files within torrents
const fileSchema = {
    name: {
        type: 'string',
        required: true,
        minLength: 1
    },
    size: {
        type: 'number',
        required: false,
        min: 0
    },
    path: {
        type: 'string',
        required: false
    }
};

/**
 * TorrentFile class - represents a file within a torrent
 */
export class TorrentFile {
    constructor(data) {
        this.name = data.name;
        this.size = data.size || 0;
        this.path = data.path || '';
        this.link = data.link || '';
        this.url = data.url || '';
        this.selected = data.selected !== undefined ? data.selected : true;
        
        // Additional metadata
        this.metadata = {
            isVideo: this.isVideoFile(),
            extension: this.getExtension(),
            ...data.metadata
        };
        
        this.validate();
    }
    
    /**
     * Validate the file object
     * @throws {ValidationError} - If validation fails
     */
    validate() {
        validateSchema(this, fileSchema, 'TorrentFile');
    }
    
    /**
     * Check if this is a video file
     * @returns {boolean}
     */
    isVideoFile() {
        const videoExtensions = new Set([
            '.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', 
            '.m4v', '.mpg', '.mpeg', '.3gp', '.ogv', '.ts', '.m2ts'
        ]);
        
        const ext = this.getExtension().toLowerCase();
        return videoExtensions.has(ext);
    }
    
    /**
     * Get file extension
     * @returns {string}
     */
    getExtension() {
        const lastDot = this.name.lastIndexOf('.');
        return lastDot !== -1 ? this.name.substring(lastDot) : '';
    }
    
    /**
     * Get formatted size string
     * @returns {string}
     */
    getFormattedSize() {
        if (!this.size) return '0 B';
        
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        let size = this.size;
        let unitIndex = 0;
        
        while (size >= 1024 && unitIndex < sizes.length - 1) {
            size /= 1024;
            unitIndex++;
        }
        
        return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${sizes[unitIndex]}`;
    }
    
    /**
     * Convert to plain object
     * @returns {object}
     */
    toObject() {
        return {
            name: this.name,
            size: this.size,
            path: this.path,
            link: this.link,
            url: this.url,
            selected: this.selected,
            metadata: this.metadata
        };
    }
}

/**
 * Torrent class with validation
 */
export class Torrent {
    constructor(data) {
        this.id = data.id;
        this.name = data.name;
        this.size = data.size || 0;
        this.status = data.status || 'unknown';
        this.progress = data.progress || 0;
        this.seeders = data.seeders || 0;
        this.leechers = data.leechers || 0;
        this.downloadSpeed = data.downloadSpeed || 0;
        this.uploadSpeed = data.uploadSpeed || 0;
        this.eta = data.eta || null;
        this.ratio = data.ratio || 0;
        this.hash = data.hash || '';
        this.provider = data.provider || 'unknown';
        
        // Process files array
        this.files = [];
        if (data.files) {
            if (Array.isArray(data.files)) {
                this.files = data.files.map(file => 
                    file instanceof TorrentFile ? file : new TorrentFile(file)
                );
            } else if (typeof data.files === 'object') {
                // Handle object format (some providers return files as object)
                this.files = Object.values(data.files).map(file => 
                    file instanceof TorrentFile ? file : new TorrentFile(file)
                );
            }
        }
        
        // Additional metadata
        this.metadata = {
            created: new Date().toISOString(),
            videoFileCount: this.getVideoFileCount(),
            totalFileCount: this.files.length,
            ...data.metadata
        };
        
        this.validate();
    }
    
    /**
     * Validate the torrent object
     * @throws {ValidationError} - If validation fails
     */
    validate() {
        validateSchema(this, torrentSchema, 'Torrent');
        
        // Additional validations
        if (this.progress < 0 || this.progress > 100) {
            throw new ValidationError('Progress must be between 0 and 100', 'progress', this.progress);
        }
        
        if (this.size < 0) {
            throw new ValidationError('Size cannot be negative', 'size', this.size);
        }
    }
    
    /**
     * Get video files only
     * @returns {TorrentFile[]}
     */
    getVideoFiles() {
        return this.files.filter(file => file.isVideoFile());
    }
    
    /**
     * Get video file count
     * @returns {number}
     */
    getVideoFileCount() {
        return this.getVideoFiles().length;
    }
    
    /**
     * Get largest video file
     * @returns {TorrentFile|null}
     */
    getLargestVideoFile() {
        const videoFiles = this.getVideoFiles();
        if (videoFiles.length === 0) return null;
        
        return videoFiles.reduce((largest, current) => 
            current.size > largest.size ? current : largest
        );
    }
    
    /**
     * Check if torrent contains video files
     * @returns {boolean}
     */
    hasVideoFiles() {
        return this.getVideoFileCount() > 0;
    }
    
    /**
     * Check if torrent is ready for streaming (completed or has enough progress)
     * @param {number} minProgress - Minimum progress required (default 5%)
     * @returns {boolean}
     */
    isReadyForStreaming(minProgress = 5) {
        return this.status === 'completed' || 
               this.status === 'seeding' || 
               this.progress >= minProgress;
    }
    
    /**
     * Get formatted size string
     * @returns {string}
     */
    getFormattedSize() {
        if (!this.size) return '0 B';
        
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        let size = this.size;
        let unitIndex = 0;
        
        while (size >= 1024 && unitIndex < sizes.length - 1) {
            size /= 1024;
            unitIndex++;
        }
        
        return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${sizes[unitIndex]}`;
    }
    
    /**
     * Get estimated time remaining
     * @returns {string|null}
     */
    getFormattedEta() {
        if (!this.eta || this.eta <= 0) return null;
        
        const hours = Math.floor(this.eta / 3600);
        const minutes = Math.floor((this.eta % 3600) / 60);
        
        if (hours > 0) {
            return `${hours}h ${minutes}m`;
        }
        return `${minutes}m`;
    }
    
    /**
     * Create a copy of the torrent with updated data
     * @param {object} updates - Data to update
     * @returns {Torrent} - New torrent instance
     */
    update(updates) {
        return new Torrent({
            ...this.toObject(),
            ...updates
        });
    }
    
    /**
     * Convert to plain object
     * @returns {object}
     */
    toObject() {
        return {
            id: this.id,
            name: this.name,
            size: this.size,
            status: this.status,
            progress: this.progress,
            seeders: this.seeders,
            leechers: this.leechers,
            downloadSpeed: this.downloadSpeed,
            uploadSpeed: this.uploadSpeed,
            eta: this.eta,
            ratio: this.ratio,
            hash: this.hash,
            provider: this.provider,
            files: this.files.map(file => file.toObject()),
            metadata: this.metadata
        };
    }
}

/**
 * Validate a torrent object
 * @param {object} obj - Object to validate
 * @throws {ValidationError} - If validation fails
 * @returns {boolean} - True if valid
 */
export function validateTorrent(obj) {
    if (!obj) {
        throw new ValidationError('Torrent object is required');
    }
    
    // Try to create a Torrent instance (this will validate)
    new Torrent(obj);
    return true;
}

/**
 * Create torrent from provider-specific data
 * @param {object} providerData - Provider-specific torrent data
 * @param {string} provider - Provider name
 * @returns {Torrent}
 */
export function createTorrentFromProvider(providerData, provider) {
    if (!providerData) {
        throw new ValidationError('Provider data is required');
    }
    
    // Map common provider fields to our standard format
    const standardData = {
        id: providerData.id || providerData.magnet_id || providerData.hash,
        name: providerData.name || providerData.title || providerData.filename,
        size: providerData.size || providerData.bytes || 0,
        status: mapProviderStatus(providerData.status, provider),
        progress: providerData.progress || 0,
        seeders: providerData.seeders || providerData.seeds || 0,
        leechers: providerData.leechers || providerData.peers || 0,
        hash: providerData.hash || providerData.info_hash || '',
        provider: provider,
        files: providerData.files || providerData.links || [],
        metadata: {
            originalData: providerData,
            provider: provider
        }
    };
    
    return new Torrent(standardData);
}

/**
 * Map provider-specific status to standard status
 * @param {string} providerStatus - Provider status
 * @param {string} provider - Provider name
 * @returns {string} - Standard status
 */
function mapProviderStatus(providerStatus, provider) {
    if (!providerStatus) return 'unknown';
    
    const statusMappings = {
        // Common statuses
        'ready': 'completed',
        'downloaded': 'completed',
        'finished': 'completed',
        'seeding': 'seeding',
        'downloading': 'downloading',
        'paused': 'paused',
        'error': 'error',
        'uploading': 'uploading',
        'waiting': 'queued',
        'queued': 'queued',
        
        // RealDebrid specific
        'magnet_error': 'error',
        'magnet_conversion': 'converting',
        'waiting_files_selection': 'awaiting_selection',
        'compressing': 'processing',
        
        // AllDebrid specific
        'In Queue': 'queued',
        'Downloading': 'downloading',
        'Ready': 'completed',
        'Error': 'error',
        
        // Premiumize specific
        'finished': 'completed',
        'running': 'downloading',
        'waiting': 'queued'
    };
    
    const lowerStatus = providerStatus.toLowerCase();
    return statusMappings[lowerStatus] || statusMappings[providerStatus] || 'unknown';
}

/**
 * Sort torrents by relevance (video files, size, seeders)
 * @param {Torrent[]} torrents - Array of torrents
 * @returns {Torrent[]} - Sorted torrents
 */
export function sortTorrentsByRelevance(torrents) {
    return torrents.sort((a, b) => {
        // Primary: video files count (more is better)
        const videoCountDiff = b.getVideoFileCount() - a.getVideoFileCount();
        if (videoCountDiff !== 0) return videoCountDiff;
        
        // Secondary: size (larger is usually better for quality)
        const sizeDiff = b.size - a.size;
        if (sizeDiff !== 0) return sizeDiff;
        
        // Tertiary: seeders (more is better)
        const seederDiff = b.seeders - a.seeders;
        if (seederDiff !== 0) return seederDiff;
        
        // Quaternary: name alphabetically
        return a.name.localeCompare(b.name);
    });
}
