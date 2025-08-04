import { validateSchema, ValidationError } from '../utils/error-handler.js';

/**
 * Stream model - defines the structure and validation for Stream objects
 * Ensures consistent stream data structure across the addon
 */

// Stream schema definition
const streamSchema = {
    url: {
        type: 'string',
        required: true,
        minLength: 1
    },
    title: {
        type: 'string',
        required: true,
        minLength: 1
    },
    size: {
        type: 'number',
        required: false,
        min: 0
    },
    quality: {
        type: 'string',
        required: false
    },
    provider: {
        type: 'string',
        required: false
    },
    behaviorHints: {
        type: 'object',
        required: false
    }
};

/**
 * Stream class with validation
 */
export class Stream {
    constructor(data) {
        this.url = data.url;
        this.title = data.title;
        this.size = data.size || null;
        this.quality = data.quality || null;
        this.provider = data.provider || null;
        this.behaviorHints = data.behaviorHints || null;
        
        // Additional metadata
        this.metadata = {
            created: new Date().toISOString(),
            ...data.metadata
        };
        
        // Validate the stream object
        this.validate();
    }
    
    /**
     * Validate the stream object
     * @throws {ValidationError} - If validation fails
     */
    validate() {
        validateSchema(this, streamSchema, 'Stream');
        
        // Additional custom validations
        if (this.url && !this.isValidUrl(this.url)) {
            throw new ValidationError('Invalid URL format', 'url', this.url);
        }
        
        if (this.size !== null && this.size < 0) {
            throw new ValidationError('Size cannot be negative', 'size', this.size);
        }
    }
    
    /**
     * Check if URL is valid
     * @param {string} url - URL to validate
     * @returns {boolean}
     */
    isValidUrl(url) {
        try {
            new URL(url);
            return true;
        } catch {
            return false;
        }
    }
    
    /**
     * Convert to Stremio stream format
     * @returns {object} - Stremio-compatible stream object
     */
    toStremioFormat() {
        const stream = {
            url: this.url,
            title: this.title
        };
        
        if (this.behaviorHints) {
            stream.behaviorHints = this.behaviorHints;
        }
        
        return stream;
    }
    
    /**
     * Create a copy of the stream with updated data
     * @param {object} updates - Data to update
     * @returns {Stream} - New stream instance
     */
    update(updates) {
        return new Stream({
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
            url: this.url,
            title: this.title,
            size: this.size,
            quality: this.quality,
            provider: this.provider,
            behaviorHints: this.behaviorHints,
            metadata: this.metadata
        };
    }
    
    /**
     * Get formatted size string
     * @returns {string|null}
     */
    getFormattedSize() {
        if (!this.size) return null;
        
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        let size = this.size;
        let unitIndex = 0;
        
        while (size >= 1024 && unitIndex < sizes.length - 1) {
            size /= 1024;
            unitIndex++;
        }
        
        return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${sizes[unitIndex]}`;
    }
}

/**
 * Validate a stream object
 * @param {object} obj - Object to validate
 * @throws {ValidationError} - If validation fails
 * @returns {boolean} - True if valid
 */
export function validateStream(obj) {
    if (!obj) {
        throw new ValidationError('Stream object is required');
    }
    
    // Try to create a Stream instance (this will validate)
    new Stream(obj);
    return true;
}

/**
 * Create a stream from torrent data
 * @param {object} torrentData - Torrent data
 * @param {object} fileData - File data within torrent
 * @param {object} options - Additional options
 * @returns {Stream} - Stream instance
 */
export function createStreamFromTorrent(torrentData, fileData, options = {}) {
    const {
        provider = 'unknown',
        baseUrl = '',
        apiKey = '',
        icon = ''
    } = options;
    
    if (!torrentData || !fileData) {
        throw new ValidationError('Torrent data and file data are required');
    }
    
    const streamUrl = `${baseUrl}/resolve/${provider}/${apiKey}/${torrentData.id}/${encodeURIComponent(fileData.link || fileData.url)}`;
    
    // Build title with quality and size info
    let title = fileData.name || torrentData.name || 'Unknown';
    
    if (fileData.size) {
        const stream = new Stream({
            url: 'temp',
            title: 'temp',
            size: fileData.size
        });
        const sizeStr = stream.getFormattedSize();
        if (sizeStr) {
            title += ` (${sizeStr})`;
        }
    }
    
    if (icon) {
        title = `${icon} ${title}`;
    }
    
    return new Stream({
        url: streamUrl,
        title: title,
        size: fileData.size || null,
        quality: extractQualityFromName(fileData.name || torrentData.name),
        provider: provider,
        metadata: {
            torrentId: torrentData.id,
            fileName: fileData.name,
            torrentName: torrentData.name
        }
    });
}

/**
 * Extract quality information from filename
 * @param {string} name - Filename or torrent name
 * @returns {string|null} - Quality string or null
 */
function extractQualityFromName(name) {
    if (!name) return null;
    
    const qualityPatterns = [
        /\b(4K|2160p)\b/i,
        /\b(1080p|FHD)\b/i,
        /\b(720p|HD)\b/i,
        /\b(480p|SD)\b/i,
        /\b(360p)\b/i
    ];
    
    for (const pattern of qualityPatterns) {
        const match = name.match(pattern);
        if (match) {
            return match[1].toUpperCase();
        }
    }
    
    return null;
}

/**
 * Sort streams by quality (highest first)
 * @param {Stream[]} streams - Array of streams
 * @returns {Stream[]} - Sorted streams
 */
export function sortStreamsByQuality(streams) {
    const qualityOrder = {
        '4K': 4,
        '2160P': 4,
        '1080P': 3,
        'FHD': 3,
        '720P': 2,
        'HD': 2,
        '480P': 1,
        'SD': 1,
        '360P': 0
    };
    
    return streams.sort((a, b) => {
        const qualityA = qualityOrder[a.quality?.toUpperCase()] || -1;
        const qualityB = qualityOrder[b.quality?.toUpperCase()] || -1;
        
        if (qualityA !== qualityB) {
            return qualityB - qualityA; // Higher quality first
        }
        
        // Secondary sort by size (larger first)
        if (a.size && b.size) {
            return b.size - a.size;
        }
        
        // Tertiary sort by title
        return a.title.localeCompare(b.title);
    });
}
