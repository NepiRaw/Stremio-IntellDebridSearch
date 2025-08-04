/**
 * Simple in-memory cache manager for API responses
 * Only caches TMDb and Trakt API responses, never debrid provider data
 */

class CacheManager {
    constructor() {
        this.cache = new Map();
        this.timers = new Map();
    }

    /**
     * Set a value in cache with TTL
     * @param {string} key - Cache key
     * @param {any} value - Value to cache
     * @param {number} ttlSeconds - Time to live in seconds (default: 1 hour)
     */
    set(key, value, ttlSeconds = 3600) {
        // Clear existing timer if any
        if (this.timers.has(key)) {
            clearTimeout(this.timers.get(key));
        }

        // Set the value
        this.cache.set(key, {
            value,
            timestamp: Date.now()
        });

        // Set expiration timer
        const timer = setTimeout(() => {
            this.cache.delete(key);
            this.timers.delete(key);
        }, ttlSeconds * 1000);

        this.timers.set(key, timer);
    }

    /**
     * Get a value from cache
     * @param {string} key - Cache key
     * @returns {any|null} - Cached value or null if not found/expired
     */
    get(key) {
        const entry = this.cache.get(key);
        if (!entry) {
            return null;
        }
        return entry.value;
    }

    /**
     * Check if a key exists in cache
     * @param {string} key - Cache key
     * @returns {boolean}
     */
    has(key) {
        return this.cache.has(key);
    }

    /**
     * Delete a specific key from cache
     * @param {string} key - Cache key
     */
    delete(key) {
        if (this.timers.has(key)) {
            clearTimeout(this.timers.get(key));
            this.timers.delete(key);
        }
        this.cache.delete(key);
    }

    /**
     * Clear all cache entries
     */
    clear() {
        // Clear all timers
        this.timers.forEach(timer => clearTimeout(timer));
        this.timers.clear();
        this.cache.clear();
    }

    /**
     * Get cache statistics
     * @returns {object}
     */
    getStats() {
        return {
            size: this.cache.size,
            keys: Array.from(this.cache.keys())
        };
    }
}

// Global cache instance
const cache = new CacheManager();

export default cache;
