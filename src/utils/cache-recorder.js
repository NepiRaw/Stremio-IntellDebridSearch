/**
 * Cache Recorder — Records debrid cache data to SQLite
 * Fire-and-forget: recording never blocks stream responses.
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { logger } from './logger.js';

const DEDUP_CACHE_MAX = 10000;
const DEDUP_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const BATCH_FLUSH_INTERVAL_MS = 5000; // 5 seconds
const BATCH_MAX_SIZE = 50;
const STALENESS_HOURS_DEFAULT = 72;
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

let recorderSingleton = null;

class DedupCache {
    constructor(maxSize = DEDUP_CACHE_MAX) {
        this.map = new Map();
        this.maxSize = maxSize;
    }

    has(key) {
        const entry = this.map.get(key);
        if (!entry) return false;
        if (Date.now() - entry > DEDUP_TTL_MS) {
            this.map.delete(key);
            return false;
        }
        return true;
    }

    set(key) {
        if (this.map.size >= this.maxSize) {
            // Evict oldest 20%
            const evictCount = Math.floor(this.maxSize * 0.2);
            const iterator = this.map.keys();
            for (let i = 0; i < evictCount; i++) {
                const oldest = iterator.next().value;
                if (oldest !== undefined) this.map.delete(oldest);
            }
        }
        this.map.set(key, Date.now());
    }
}

export class CacheRecorder {
    constructor(options = {}) {
        this.enabled = options.enabled !== false;
        this.db = null;

        if (!this.enabled) {
            logger.info('[cache-recorder] Recording disabled via CACHE_RECORDING_ENABLED=false');
            return;
        }

        this.dbPath = path.resolve(options.dbPath || './data/debrid-cache.sqlite');
        this.stalenessHours = options.stalenessHours || STALENESS_HOURS_DEFAULT;
        this.dedup = new DedupCache();
        this.writeBuffer = [];
        this.flushTimer = null;

        this._initDb();
        this._startFlushTimer();
        this._startCleanupTimer();

        logger.info(`[cache-recorder] Initialized (db=${this.dbPath}, staleness=${this.stalenessHours}h)`);
    }

    _initDb() {
        fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });

        const existed = fs.existsSync(this.dbPath);
        this.db = new Database(this.dbPath, { timeout: 5000 });

        if (!existed) {
            this.db.pragma('auto_vacuum = INCREMENTAL');
        }
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('synchronous = NORMAL');
        this.db.pragma('journal_size_limit = 33554432'); // 32 MB
        this.db.pragma('cache_size = -8000'); // 8 MB page cache

        this._createSchema();
        this._prepareStatements();
    }

    _createSchema() {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS torrent_cache (
                hash TEXT NOT NULL,
                provider TEXT NOT NULL,
                is_cached INTEGER NOT NULL DEFAULT 1,
                torrent_name TEXT,
                total_size INTEGER,
                resolution TEXT,
                quality_source TEXT,
                codec TEXT,
                audio TEXT,
                languages TEXT,
                release_group TEXT,
                parsed_title TEXT,
                year INTEGER,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                PRIMARY KEY (hash, provider)
            );

            CREATE TABLE IF NOT EXISTS content_hash (
                imdb_id TEXT NOT NULL,
                hash TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                PRIMARY KEY (imdb_id, hash)
            );

            CREATE TABLE IF NOT EXISTS torrent_files (
                hash TEXT NOT NULL,
                file_idx INTEGER NOT NULL,
                file_path TEXT,
                file_size INTEGER,
                strem_id TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                PRIMARY KEY (hash, file_idx)
            );

            CREATE INDEX IF NOT EXISTS idx_torrent_cache_provider ON torrent_cache(provider);
            CREATE INDEX IF NOT EXISTS idx_torrent_cache_updated ON torrent_cache(updated_at);
            CREATE INDEX IF NOT EXISTS idx_content_hash_imdb ON content_hash(imdb_id);
            CREATE INDEX IF NOT EXISTS idx_torrent_files_hash ON torrent_files(hash);
            CREATE INDEX IF NOT EXISTS idx_torrent_files_strem_id ON torrent_files(strem_id);
        `);
    }

    _prepareStatements() {
        this.stmts = {
            upsertTorrentCache: this.db.prepare(`
                INSERT INTO torrent_cache (hash, provider, is_cached, torrent_name, total_size,
                    resolution, quality_source, codec, audio, languages, release_group, parsed_title, year)
                VALUES (@hash, @provider, 1, @torrent_name, @total_size,
                    @resolution, @quality_source, @codec, @audio, @languages, @release_group, @parsed_title, @year)
                ON CONFLICT(hash, provider) DO UPDATE SET
                    is_cached = 1,
                    updated_at = datetime('now'),
                    torrent_name = COALESCE(@torrent_name, torrent_name),
                    total_size = COALESCE(@total_size, total_size),
                    resolution = COALESCE(@resolution, resolution),
                    quality_source = COALESCE(@quality_source, quality_source),
                    codec = COALESCE(@codec, codec),
                    audio = COALESCE(@audio, audio),
                    languages = COALESCE(@languages, languages),
                    release_group = COALESCE(@release_group, release_group),
                    parsed_title = COALESCE(@parsed_title, parsed_title),
                    year = COALESCE(@year, year)
            `),

            upsertContentHash: this.db.prepare(`
                INSERT OR IGNORE INTO content_hash (imdb_id, hash) VALUES (@imdb_id, @hash)
            `),

            upsertTorrentFile: this.db.prepare(`
                INSERT INTO torrent_files (hash, file_idx, file_path, file_size, strem_id)
                VALUES (@hash, @file_idx, @file_path, @file_size, @strem_id)
                ON CONFLICT(hash, file_idx) DO UPDATE SET
                    file_path = COALESCE(@file_path, file_path),
                    file_size = COALESCE(@file_size, file_size),
                    strem_id = COALESCE(@strem_id, strem_id)
            `),

            deleteStale: this.db.prepare(`
                DELETE FROM torrent_cache
                WHERE updated_at < datetime('now', '-' || @hours || ' hours')
            `),

            cleanOrphanContentHash: this.db.prepare(`
                DELETE FROM content_hash
                WHERE hash NOT IN (SELECT DISTINCT hash FROM torrent_cache)
            `),

            cleanOrphanFiles: this.db.prepare(`
                DELETE FROM torrent_files
                WHERE hash NOT IN (SELECT DISTINCT hash FROM torrent_cache)
            `),

            getStats: this.db.prepare(`
                SELECT
                    (SELECT COUNT(*) FROM torrent_cache) AS cache_entries,
                    (SELECT COUNT(*) FROM content_hash) AS content_mappings,
                    (SELECT COUNT(*) FROM torrent_files) AS file_entries
            `)
        };
    }

    /**
     * Record cache data from a stream response
     */
    recordStreamData({ imdbId, season, episode, provider, torrents }) {
        if (!this.enabled || !this.db) return;
        if (!imdbId || !provider || !torrents?.length) return;

        const providerLower = provider.toLowerCase();

        for (const torrent of torrents) {
            if (!torrent.hash) continue; // Skip torrents without hash (e.g., Premiumize)

            const hash = torrent.hash.toLowerCase();
            const dedupKey = `${providerLower}:${hash}`;

            if (this.dedup.has(dedupKey)) continue;
            this.dedup.set(dedupKey);

            const info = torrent.info || {};
            const languages = info.languages?.length ? JSON.stringify(info.languages) : null;

            this.writeBuffer.push({
                type: 'stream',
                hash,
                provider: providerLower,
                imdbId,
                season,
                episode,
                torrent_name: torrent.name || null,
                total_size: torrent.size || null,
                resolution: info.resolution || null,
                quality_source: info.source || null,
                codec: info.codec || null,
                audio: info.audio || null,
                languages,
                release_group: info.group || null,
                parsed_title: info.title || null,
                year: info.year || null,
                videos: torrent.videos || []
            });
        }

        if (this.writeBuffer.length >= BATCH_MAX_SIZE) {
            this._flush();
        }
    }

    /**
     * Flush buffered writes to DB in a single transaction.
     */
    _flush() {
        if (!this.enabled || !this.db || this.writeBuffer.length === 0) return;

        const batch = this.writeBuffer.splice(0);
        const startTime = Date.now();

        try {
            const runBatch = this.db.transaction(() => {
                for (const entry of batch) {
                    // 1. Upsert torrent_cache
                    this.stmts.upsertTorrentCache.run({
                        hash: entry.hash,
                        provider: entry.provider,
                        torrent_name: entry.torrent_name,
                        total_size: entry.total_size,
                        resolution: entry.resolution,
                        quality_source: entry.quality_source,
                        codec: entry.codec,
                        audio: entry.audio,
                        languages: entry.languages,
                        release_group: entry.release_group,
                        parsed_title: entry.parsed_title,
                        year: entry.year
                    });

                    // 2. Upsert content_hash mapping
                    this.stmts.upsertContentHash.run({
                        imdb_id: entry.imdbId,
                        hash: entry.hash
                    });

                    // 3. Upsert torrent_files
                    if (entry.videos?.length) {
                        for (const video of entry.videos) {
                            // Build strem_id: for series = imdbId:season:episode, for movies = imdbId
                            let stremId = entry.imdbId;
                            if (entry.season != null && entry.episode != null) {
                                stremId = `${entry.imdbId}:${entry.season}:${entry.episode}`;
                            }

                            // Extract file index from video.id (format: "torrentId:fileId")
                            const fileIdx = this._extractFileIdx(video);

                            this.stmts.upsertTorrentFile.run({
                                hash: entry.hash,
                                file_idx: fileIdx,
                                file_path: video.name || null,
                                file_size: video.size || null,
                                strem_id: stremId
                            });
                        }
                    }
                }
            });

            runBatch();

            const duration = Date.now() - startTime;
            logger.debug(`[cache-recorder] Flushed ${batch.length} entries in ${duration}ms`);
        } catch (err) {
            logger.warn(`[cache-recorder] Batch write failed: ${err.message}`);
            // Don't re-add to buffer — lost writes are acceptable for cache data
        }
    }

    _extractFileIdx(video) {
        if (!video.id) return 0;
        // video.id format is typically "torrentId:fileId"
        const parts = String(video.id).split(':');
        if (parts.length >= 2) {
            const idx = parseInt(parts[parts.length - 1], 10);
            return isNaN(idx) ? 0 : idx;
        }
        return 0;
    }

    _startFlushTimer() {
        this.flushTimer = setInterval(() => {
            this._flush();
        }, BATCH_FLUSH_INTERVAL_MS);

        // Allow Node to exit without waiting for this timer
        if (this.flushTimer.unref) {
            this.flushTimer.unref();
        }
    }

    _startCleanupTimer() {
        // Run cleanup once at startup after a short delay
        setTimeout(() => this._runCleanup(), 30000);

        // Then run periodically
        this.cleanupTimer = setInterval(() => this._runCleanup(), CLEANUP_INTERVAL_MS);
        if (this.cleanupTimer.unref) {
            this.cleanupTimer.unref();
        }
    }

    _runCleanup() {
        if (!this.enabled || !this.db) return;

        try {
            const startTime = Date.now();

            // Delete stale torrent_cache entries
            const staleResult = this.stmts.deleteStale.run({ hours: this.stalenessHours });

            // Clean orphaned content_hash and torrent_files
            const orphanContent = this.stmts.cleanOrphanContentHash.run();
            const orphanFiles = this.stmts.cleanOrphanFiles.run();

            // Incremental VACUUM
            this.db.pragma('incremental_vacuum(100)');

            const duration = Date.now() - startTime;
            logger.info(
                `[cache-recorder] Cleanup completed in ${duration}ms: ` +
                `stale=${staleResult.changes}, orphan_content=${orphanContent.changes}, ` +
                `orphan_files=${orphanFiles.changes}`
            );
        } catch (err) {
            logger.warn(`[cache-recorder] Cleanup failed: ${err.message}`);
        }
    }

    getStats() {
        if (!this.enabled || !this.db) return { cache_entries: 0, content_mappings: 0, file_entries: 0 };
        try {
            return this.stmts.getStats.get();
        } catch {
            return { cache_entries: 0, content_mappings: 0, file_entries: 0 };
        }
    }

    close() {
        if (this.flushTimer) clearInterval(this.flushTimer);
        if (this.cleanupTimer) clearInterval(this.cleanupTimer);
        this._flush(); // Final flush
        if (this.db) {
            try { this.db.close(); } catch { /* ignore */ }
            this.db = null;
        }
    }
}

/**
 * Get or create the singleton cache recorder instance.
 */
export function getCacheRecorder() {
    if (recorderSingleton) return recorderSingleton;

    const enabled = (process.env.CACHE_RECORDING_ENABLED || 'true').toLowerCase() !== 'false';
    const dbPath = process.env.CACHE_DB_PATH || './data/debrid-cache.sqlite';
    const stalenessHours = parseInt(process.env.CACHE_STALENESS_HOURS || String(STALENESS_HOURS_DEFAULT), 10);

    recorderSingleton = new CacheRecorder({
        enabled,
        dbPath,
        stalenessHours: isNaN(stalenessHours) ? STALENESS_HOURS_DEFAULT : stalenessHours
    });

    return recorderSingleton;
}
