/**
 * Simple in-memory cache manager for API responses
 * Only caches TMDb and Trakt API responses, not debrid provider data
 */

class CacheManager {
    constructor() {
        this.cache = new Map();
        this.timers = new Map();
    }
    set(key, value, ttlSeconds = 3600) { // 1 hour default TTL
        if (this.timers.has(key)) {
            clearTimeout(this.timers.get(key));
        }

        this.cache.set(key, {
            value,
            timestamp: Date.now()
        });

        const timer = setTimeout(() => {
            this.cache.delete(key);
            this.timers.delete(key);
        }, ttlSeconds * 1000);

        this.timers.set(key, timer);
    }

    get(key) {
        const entry = this.cache.get(key);
        if (!entry) {
            return null;
        }
        return entry.value;
    }

    has(key) {
        return this.cache.has(key);
    }

    delete(key) {
        if (this.timers.has(key)) {
            clearTimeout(this.timers.get(key));
            this.timers.delete(key);
        }
        this.cache.delete(key);
    }

    clear() {
        this.timers.forEach(timer => clearTimeout(timer));
        this.timers.clear();
        this.cache.clear();
    }

    getStats() {
        return {
            size: this.cache.size,
            keys: Array.from(this.cache.keys())
        };
    }
}

const cache = new CacheManager();

export default cache;
