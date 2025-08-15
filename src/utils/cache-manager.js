/**
 * Unified Cache Management System
 * 
 * Cached Data Types:
 * ==================
 * 
 * 🎬 API RESPONSES:
 * - TMDb alternative titles (24h TTL) - Country-specific title variations
 * - TMDb search results (6h TTL) - Movie/series search lookups  
 * - Trakt episode mappings (24h TTL) - Season/episode to absolute episode conversion
 * - Trakt show information (24h TTL) - Series metadata and details
 * - Jikan anime season data (24h TTL) - Anime season information from MyAnimeList
 * - Cinemeta metadata (1h TTL) - Basic content metadata from Stremio's catalog
 * 
 * 🔧 PERFORMANCE OPTIMIZATION:
 * - Stream metadata (12h TTL) - Extracted series/movie info for stream building
 * - Stream metadata fuzzy cache (24h TTL) - Shared metadata across similar episodes
 * - Technical details (24h TTL) - Video quality, codecs, file specifications
 * - Pattern matching results (12h TTL) - Regex pattern evaluation outcomes
 * - Torrent parser results (in-memory) - Parsed torrent name information
 * 
 */

class UnifiedCacheManager {
    constructor(options = {}) {
        this.cache = new Map();
        this.timers = new Map();
        this.stats = {
            hits: 0,
            misses: 0,
            sets: 0,
            deletes: 0,
            evictions: 0
        };
        
        this.maxSize = options.maxSize || 1000;
        this.defaultTTL = options.defaultTTL || 3600; // 1 hour default TTL
        this.cleanupInterval = options.cleanupInterval || 300; // 5 minutes cleanup
        
        this.startPeriodicCleanup();
    }

    set(key, value, ttlSeconds = null, metadata = {}) {
        const ttl = ttlSeconds || this.defaultTTL;
        
        if (this.timers.has(key)) {
            clearTimeout(this.timers.get(key));
        }

        if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
            this.evictOldest();
        }

        this.cache.set(key, {
            value,
            timestamp: Date.now(),
            ttl: ttl * 1000,
            accessCount: 0,
            metadata: metadata || {}
        });

        const timer = setTimeout(() => {
            this.delete(key);
        }, ttl * 1000);

        this.timers.set(key, timer);
        this.stats.sets++;
    }

    get(key) {
        const entry = this.cache.get(key);
        if (!entry) {
            this.stats.misses++;
            return null;
        }

        if (Date.now() - entry.timestamp > entry.ttl) {
            this.delete(key);
            this.stats.misses++;
            return null;
        }

        entry.accessCount++;
        entry.lastAccessed = Date.now();
        
        this.stats.hits++;
        return entry.value;
    }

    has(key) {
        const entry = this.cache.get(key);
        if (!entry) {
            return false;
        }

        if (Date.now() - entry.timestamp > entry.ttl) {
            this.delete(key);
            return false;
        }

        return true;
    }

    delete(key) {
        if (this.timers.has(key)) {
            clearTimeout(this.timers.get(key));
            this.timers.delete(key);
        }
        
        const wasDeleted = this.cache.delete(key);
        if (wasDeleted) {
            this.stats.deletes++;
        }
        
        return wasDeleted;
    }

    clear() {
        this.timers.forEach(timer => clearTimeout(timer));
        this.timers.clear();
        this.cache.clear();
        
        this.stats = {
            hits: 0,
            misses: 0,
            sets: 0,
            deletes: 0,
            evictions: 0
        };
    }

    evictOldest() {
        if (this.cache.size === 0) return;

        let oldestKey = null;
        let oldestTimestamp = Date.now();

        for (const [key, entry] of this.cache) {
            if (entry.timestamp < oldestTimestamp) {
                oldestTimestamp = entry.timestamp;
                oldestKey = key;
            }
        }

        if (oldestKey) {
            this.delete(oldestKey);
            this.stats.evictions++;
        }
    }

    startPeriodicCleanup() {
        setInterval(() => {
            this.cleanupExpired();
        }, this.cleanupInterval * 1000);
    }

    cleanupExpired() {
        const now = Date.now();
        const keysToDelete = [];

        for (const [key, entry] of this.cache) {
            if (now - entry.timestamp > entry.ttl) {
                keysToDelete.push(key);
            }
        }

        keysToDelete.forEach(key => this.delete(key));
    }

    getStats() {
        const totalAccess = this.stats.hits + this.stats.misses;
        const hitRate = totalAccess > 0 ? (this.stats.hits / totalAccess) : 0;

        return {
            size: this.cache.size,
            maxSize: this.maxSize,
            hitRate: Math.round(hitRate * 100) / 100,
            stats: { ...this.stats }
        };
    }

    getByPattern(pattern) {
        const regex = new RegExp(pattern);
        const matches = [];
        
        for (const [key, entry] of this.cache) {
            if (regex.test(key)) {
                if (Date.now() - entry.timestamp <= entry.ttl) {
                    matches.push({
                        key,
                        value: entry.value,
                        metadata: entry.metadata
                    });
                }
            }
        }
        
        return matches;
    }

    updateTTL(key, newTTLSeconds) {
        const entry = this.cache.get(key);
        if (!entry) return false;

        if (this.timers.has(key)) {
            clearTimeout(this.timers.get(key));
        }

        entry.ttl = newTTLSeconds * 1000;
        entry.timestamp = Date.now();

        const timer = setTimeout(() => {
            this.delete(key);
        }, newTTLSeconds * 1000);

        this.timers.set(key, timer);
        return true;
    }
}



const cache = new UnifiedCacheManager({
    maxSize: 1000,        // Limit cache entries for memory efficiency
    defaultTTL: 3600,    // 1 hour default TTL
    cleanupInterval: 300 // 5 minute cleanup interval
});

export default cache;
export { UnifiedCacheManager };