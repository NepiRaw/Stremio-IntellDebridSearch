import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { configManager } from '../config/configuration.js';
import { logger } from '../utils/logger.js';

const RESOLVER_VERSION = 'catalog-resolution-v1';
const METADATA_VERSION = 'catalog-metadata-v1';

let enrichmentCacheSingleton = null;
let enrichmentCacheSignature = null;

function normalizeAliasValue(value) {
    return String(value || '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .replace(/\s+/g, ' ');
}

function parseJson(value, fallbackValue) {
    if (!value) {
        return fallbackValue;
    }

    try {
        return JSON.parse(value);
    } catch {
        return fallbackValue;
    }
}

function getFileSizeSafe(filePath) {
    try {
        return fs.statSync(filePath).size;
    } catch {
        return 0;
    }
}

function mapResolutionRow(row) {
    if (!row) {
        return null;
    }

    return {
        contentKey: row.content_key,
        normalizedTitle: row.normalized_title,
        releaseYear: row.release_year,
        mediaHint: row.media_hint,
        tmdbId: row.tmdb_id ?? null,
        imdbId: row.imdb_id || null,
        mediaType: row.media_type || null,
        matchedTitle: row.matched_title || null,
        score: typeof row.score === 'number' ? row.score : null,
        reason: row.reason || null,
        matchSource: row.match_source || null,
        posterUrl: row.poster_url || null,
        posterPath: row.poster_path || null,
        posterShape: row.poster_shape || 'poster',
        isNegative: Boolean(row.is_negative),
        createdAt: row.created_at,
        lastAccessedAt: row.last_accessed_at,
        expiresAt: row.expires_at,
        resolverVersion: row.resolver_version || RESOLVER_VERSION
    };
}

function mapMetadataRow(row) {
    if (!row) {
        return null;
    }

    return {
        contentKey: row.content_key,
        background: row.background || null,
        logo: row.logo || null,
        descriptionTail: row.description_tail || null,
        releaseInfo: row.release_info || null,
        imdbRating: row.imdb_rating || null,
        genres: parseJson(row.genres_json, null),
        runtime: row.runtime || null,
        links: parseJson(row.links_json, null),
        metaSource: row.meta_source || 'unknown',
        reason: row.reason || null,
        isNegative: Boolean(row.is_negative),
        isSuspect: Boolean(row.is_suspect),
        suspectReason: row.suspect_reason || null,
        createdAt: row.created_at,
        lastAccessedAt: row.last_accessed_at,
        expiresAt: row.expires_at,
        metadataVersion: row.metadata_version || METADATA_VERSION
    };
}

export function buildContentKey({ normalizedTitle, releaseYear = 'none', mediaHint = 'unknown' } = {}) {
    return [normalizedTitle || 'unknown', releaseYear || 'none', mediaHint || 'unknown'].join('|');
}

export function buildFilenameAliasKey(filename) {
    const normalized = normalizeAliasValue(filename);
    return normalized ? `filename:${normalized}` : null;
}

function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) {
        return '0 B';
    }

    const units = ['B', 'KB', 'MB', 'GB'];
    const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / (1024 ** exponent);
    return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

export class CatalogEnrichmentCache {
    constructor(options = {}) {
        this.options = {
            enabled: true,
            dbPath: './data/catalog-enrichment-cache.sqlite',
            resolutionPositiveTtlMs: 14 * 24 * 60 * 60 * 1000, // 14 days
            resolutionNegativeTtlMs: 12 * 60 * 60 * 1000, // 12 hours
            metadataPositiveTtlMs: 48 * 60 * 60 * 1000, // 48 hours
            metadataNegativeTtlMs: 6 * 60 * 60 * 1000, // 6 hours
            metadataSuspectTtlMs: 12 * 60 * 60 * 1000, // 12 hours
            cleanupIntervalSeconds: 6 * 60 * 60, // 6 hours
            walSizeLimitBytes: 32 * 1024 * 1024, // 32 MB
            maxDbSizeBytes: 0, // disabled by default; enable via env when desired
            pruneBatchSize: 100,
            pruneTargetRatio: 0.85,
            ...options
        };

        this.dbPath = path.resolve(this.options.dbPath);
        fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });

        this.dbFileExisted = fs.existsSync(this.dbPath) && getFileSizeSafe(this.dbPath) > 0;

        this.db = new Database(this.dbPath, { timeout: 5000 });
        if (!this.dbFileExisted) {
            this.db.pragma('auto_vacuum = INCREMENTAL');
        }
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('foreign_keys = ON');
        this.db.pragma('synchronous = NORMAL');
        this.db.pragma(`journal_size_limit = ${Math.max(0, this.options.walSizeLimitBytes)}`);

        this.initializeSchema();
        this.prepareStatements();
        this.logStartupReady();
        this.runMaintenance(Date.now(), 'startup');
        this.startCleanupTimer();
    }

    logStartupReady() {
        const stats = this.getStats();
        logger.info(
            `[enrichment-cache] Cache database ${this.dbFileExisted ? 'loaded successfully' : 'created successfully'} ` +
            `(path=${this.dbPath}, resolutions=${stats.resolutions}, metadata=${stats.metadata}, aliases=${stats.aliases}, ` +
            `mainBytes=${formatBytes(stats.mainBytes)}, walLimit=${formatBytes(this.options.walSizeLimitBytes)})`
        );
    }

    initializeSchema() {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS content_resolution_cache (
              content_key TEXT PRIMARY KEY,
              normalized_title TEXT NOT NULL,
              release_year TEXT NOT NULL,
              media_hint TEXT NOT NULL,
              tmdb_id INTEGER,
              imdb_id TEXT,
              media_type TEXT,
              matched_title TEXT,
              score REAL,
              reason TEXT,
              match_source TEXT,
              poster_url TEXT,
              poster_path TEXT,
              poster_shape TEXT,
              is_negative INTEGER NOT NULL DEFAULT 0,
              created_at INTEGER NOT NULL,
              last_accessed_at INTEGER NOT NULL,
              expires_at INTEGER NOT NULL,
              resolver_version TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_content_resolution_expires_at
              ON content_resolution_cache (expires_at);

            CREATE TABLE IF NOT EXISTS metadata_enrichment_cache (
              content_key TEXT PRIMARY KEY,
              background TEXT,
              logo TEXT,
              description_tail TEXT,
              release_info TEXT,
              imdb_rating TEXT,
              genres_json TEXT,
              runtime TEXT,
              links_json TEXT,
              meta_source TEXT NOT NULL,
              reason TEXT,
              is_negative INTEGER NOT NULL DEFAULT 0,
              is_suspect INTEGER NOT NULL DEFAULT 0,
              suspect_reason TEXT,
              created_at INTEGER NOT NULL,
              last_accessed_at INTEGER NOT NULL,
              expires_at INTEGER NOT NULL,
              metadata_version TEXT NOT NULL,
              FOREIGN KEY (content_key) REFERENCES content_resolution_cache(content_key) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_metadata_enrichment_expires_at
              ON metadata_enrichment_cache (expires_at);

            CREATE TABLE IF NOT EXISTS enrichment_alias_cache (
              alias_key TEXT PRIMARY KEY,
              alias_type TEXT NOT NULL,
              content_key TEXT NOT NULL,
              created_at INTEGER NOT NULL,
              last_accessed_at INTEGER NOT NULL,
              expires_at INTEGER NOT NULL,
              FOREIGN KEY (content_key) REFERENCES content_resolution_cache(content_key) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_enrichment_alias_content_key
              ON enrichment_alias_cache (content_key);

            CREATE INDEX IF NOT EXISTS idx_enrichment_alias_expires_at
              ON enrichment_alias_cache (expires_at);
        `);
    }

    prepareStatements() {
        this.statements = {
            getResolutionByContentKey: this.db.prepare(`
                SELECT *
                FROM content_resolution_cache
                WHERE content_key = @contentKey
                  AND expires_at > @now
                LIMIT 1
            `),
            getResolutionByAlias: this.db.prepare(`
                SELECT c.*
                FROM enrichment_alias_cache a
                JOIN content_resolution_cache c ON c.content_key = a.content_key
                WHERE a.alias_key = @aliasKey
                  AND a.expires_at > @now
                  AND c.expires_at > @now
                LIMIT 1
            `),
            touchResolution: this.db.prepare(`
                UPDATE content_resolution_cache
                SET last_accessed_at = @now
                WHERE content_key = @contentKey
            `),
            upsertResolution: this.db.prepare(`
                INSERT INTO content_resolution_cache (
                  content_key,
                  normalized_title,
                  release_year,
                  media_hint,
                  tmdb_id,
                  imdb_id,
                  media_type,
                  matched_title,
                  score,
                  reason,
                  match_source,
                  poster_url,
                  poster_path,
                  poster_shape,
                  is_negative,
                  created_at,
                  last_accessed_at,
                  expires_at,
                  resolver_version
                ) VALUES (
                  @contentKey,
                  @normalizedTitle,
                  @releaseYear,
                  @mediaHint,
                  @tmdbId,
                  @imdbId,
                  @mediaType,
                  @matchedTitle,
                  @score,
                  @reason,
                  @matchSource,
                  @posterUrl,
                  @posterPath,
                  @posterShape,
                  @isNegative,
                  @createdAt,
                  @lastAccessedAt,
                  @expiresAt,
                  @resolverVersion
                )
                ON CONFLICT(content_key) DO UPDATE SET
                  normalized_title = excluded.normalized_title,
                  release_year = excluded.release_year,
                  media_hint = excluded.media_hint,
                  tmdb_id = excluded.tmdb_id,
                  imdb_id = excluded.imdb_id,
                  media_type = excluded.media_type,
                  matched_title = excluded.matched_title,
                  score = excluded.score,
                  reason = excluded.reason,
                  match_source = excluded.match_source,
                  poster_url = excluded.poster_url,
                  poster_path = excluded.poster_path,
                  poster_shape = excluded.poster_shape,
                  is_negative = excluded.is_negative,
                  created_at = excluded.created_at,
                  last_accessed_at = excluded.last_accessed_at,
                  expires_at = excluded.expires_at,
                  resolver_version = excluded.resolver_version
            `),
            getMetadataByContentKey: this.db.prepare(`
                SELECT *
                FROM metadata_enrichment_cache
                WHERE content_key = @contentKey
                  AND expires_at > @now
                LIMIT 1
            `),
            getMetadataByAlias: this.db.prepare(`
                SELECT m.*
                FROM enrichment_alias_cache a
                JOIN metadata_enrichment_cache m ON m.content_key = a.content_key
                WHERE a.alias_key = @aliasKey
                  AND a.expires_at > @now
                  AND m.expires_at > @now
                LIMIT 1
            `),
            touchMetadata: this.db.prepare(`
                UPDATE metadata_enrichment_cache
                SET last_accessed_at = @now
                WHERE content_key = @contentKey
            `),
            upsertMetadata: this.db.prepare(`
                INSERT INTO metadata_enrichment_cache (
                  content_key,
                  background,
                  logo,
                  description_tail,
                  release_info,
                  imdb_rating,
                  genres_json,
                  runtime,
                  links_json,
                  meta_source,
                  reason,
                  is_negative,
                  is_suspect,
                  suspect_reason,
                  created_at,
                  last_accessed_at,
                  expires_at,
                  metadata_version
                ) VALUES (
                  @contentKey,
                  @background,
                  @logo,
                  @descriptionTail,
                  @releaseInfo,
                  @imdbRating,
                  @genresJson,
                  @runtime,
                  @linksJson,
                  @metaSource,
                  @reason,
                  @isNegative,
                  @isSuspect,
                  @suspectReason,
                  @createdAt,
                  @lastAccessedAt,
                  @expiresAt,
                  @metadataVersion
                )
                ON CONFLICT(content_key) DO UPDATE SET
                  background = excluded.background,
                  logo = excluded.logo,
                  description_tail = excluded.description_tail,
                  release_info = excluded.release_info,
                  imdb_rating = excluded.imdb_rating,
                  genres_json = excluded.genres_json,
                  runtime = excluded.runtime,
                  links_json = excluded.links_json,
                  meta_source = excluded.meta_source,
                  reason = excluded.reason,
                  is_negative = excluded.is_negative,
                  is_suspect = excluded.is_suspect,
                  suspect_reason = excluded.suspect_reason,
                  created_at = excluded.created_at,
                  last_accessed_at = excluded.last_accessed_at,
                  expires_at = excluded.expires_at,
                  metadata_version = excluded.metadata_version
            `),
            upsertAlias: this.db.prepare(`
                INSERT INTO enrichment_alias_cache (
                  alias_key,
                  alias_type,
                  content_key,
                  created_at,
                  last_accessed_at,
                  expires_at
                ) VALUES (
                  @aliasKey,
                  @aliasType,
                  @contentKey,
                  @createdAt,
                  @lastAccessedAt,
                  @expiresAt
                )
                ON CONFLICT(alias_key) DO UPDATE SET
                  alias_type = excluded.alias_type,
                  content_key = excluded.content_key,
                  created_at = excluded.created_at,
                  last_accessed_at = excluded.last_accessed_at,
                  expires_at = excluded.expires_at
            `),
            touchAlias: this.db.prepare(`
                UPDATE enrichment_alias_cache
                SET last_accessed_at = @now
                WHERE alias_key = @aliasKey
            `),
            deleteExpiredResolutions: this.db.prepare(`
                DELETE FROM content_resolution_cache
                WHERE expires_at <= ?
            `),
            deleteExpiredMetadata: this.db.prepare(`
                DELETE FROM metadata_enrichment_cache
                WHERE expires_at <= ?
            `),
            deleteExpiredAliases: this.db.prepare(`
                DELETE FROM enrichment_alias_cache
                WHERE expires_at <= ?
            `),
            pruneResolutionBatch: this.db.prepare(`
                DELETE FROM content_resolution_cache
                WHERE content_key IN (
                    SELECT content_key
                    FROM content_resolution_cache
                    ORDER BY is_negative DESC, last_accessed_at ASC, created_at ASC, rowid ASC
                    LIMIT @limit
                )
            `),
            countResolutions: this.db.prepare(`SELECT COUNT(*) AS count FROM content_resolution_cache`),
            countMetadata: this.db.prepare(`SELECT COUNT(*) AS count FROM metadata_enrichment_cache`),
            countAliases: this.db.prepare(`SELECT COUNT(*) AS count FROM enrichment_alias_cache`)
        };
    }

    startCleanupTimer() {
        if (!this.options.cleanupIntervalSeconds || this.options.cleanupIntervalSeconds <= 0) {
            return;
        }

        this.cleanupTimer = setInterval(() => {
            try {
                this.runMaintenance(Date.now(), 'interval');
            } catch (error) {
                logger.warn(`[enrichment-cache] Cleanup failed: ${error.message}`);
            }
        }, this.options.cleanupIntervalSeconds * 1000);

        this.cleanupTimer.unref?.();
    }

    cleanupExpired(now = Date.now()) {
        const cleanup = this.db.transaction((timestamp) => {
            const deletedMetadata = this.statements.deleteExpiredMetadata.run(timestamp).changes;
            const deletedAliases = this.statements.deleteExpiredAliases.run(timestamp).changes;
            const deletedResolutions = this.statements.deleteExpiredResolutions.run(timestamp).changes;

            return {
                deletedMetadata,
                deletedAliases,
                deletedResolutions
            };
        });

        return cleanup(now);
    }

    checkpointWal(mode = 'PASSIVE') {
        try {
            return this.db.pragma(`wal_checkpoint(${mode})`);
        } catch (error) {
            logger.warn(`[enrichment-cache] WAL checkpoint (${mode}) failed: ${error.message}`);
            return null;
        }
    }

    reclaimFreeSpace() {
        const autoVacuumMode = Number(this.db.pragma('auto_vacuum', { simple: true }) || 0);
        const freelistCount = Number(this.db.pragma('freelist_count', { simple: true }) || 0);

        if (freelistCount <= 0) {
            return 0;
        }

        if (autoVacuumMode === 2) {
            this.db.pragma(`incremental_vacuum(${freelistCount})`);
            return freelistCount;
        }

        return 0;
    }

    getStorageMetrics() {
        const pageSize = Number(this.db.pragma('page_size', { simple: true }) || 0);
        const pageCount = Number(this.db.pragma('page_count', { simple: true }) || 0);
        const freelistCount = Number(this.db.pragma('freelist_count', { simple: true }) || 0);
        const livePageCount = Math.max(0, pageCount - freelistCount);
        const walBytes = getFileSizeSafe(`${this.dbPath}-wal`);
        const shmBytes = getFileSizeSafe(`${this.dbPath}-shm`);

        return {
            dbPath: this.dbPath,
            pageSize,
            pageCount,
            freelistCount,
            livePageCount,
            mainBytes: pageCount * pageSize,
            liveBytes: livePageCount * pageSize,
            freeBytes: freelistCount * pageSize,
            walBytes,
            shmBytes,
            totalBytes: (pageCount * pageSize) + walBytes + shmBytes,
            autoVacuumMode: Number(this.db.pragma('auto_vacuum', { simple: true }) || 0),
            journalMode: this.db.pragma('journal_mode', { simple: true }) || 'unknown'
        };
    }

    enforceSizeLimit() {
        const maxDbSizeBytes = Number(this.options.maxDbSizeBytes || 0);
        const pruneBatchSize = Math.max(1, Number(this.options.pruneBatchSize || 100));
        const pruneTargetRatio = Math.min(0.99, Math.max(0.5, Number(this.options.pruneTargetRatio || 0.85)));

        let metrics = this.getStorageMetrics();
        if (!Number.isFinite(maxDbSizeBytes) || maxDbSizeBytes <= 0) {
            return {
                prunedEntries: 0,
                overLimit: false,
                metrics
            };
        }

        if (metrics.walBytes > 0 && metrics.totalBytes > maxDbSizeBytes) {
            this.checkpointWal('TRUNCATE');
            metrics = this.getStorageMetrics();
        }

        const targetLiveBytes = Math.max(metrics.pageSize || 4096, Math.floor(maxDbSizeBytes * pruneTargetRatio));
        let prunedEntries = 0;
        let iterations = 0;

        while (metrics.liveBytes > targetLiveBytes && iterations < 50) {
            const info = this.statements.pruneResolutionBatch.run({ limit: pruneBatchSize });
            if (!info.changes) {
                break;
            }

            prunedEntries += info.changes;
            iterations += 1;
            this.reclaimFreeSpace();
            metrics = this.getStorageMetrics();
        }

        if (prunedEntries > 0) {
            this.checkpointWal('TRUNCATE');
            this.reclaimFreeSpace();
            metrics = this.getStorageMetrics();
        }

        const overLimit = metrics.mainBytes > maxDbSizeBytes;
        if (overLimit) {
            logger.warn(
                `[enrichment-cache] Cache database remains above configured soft limit (${metrics.mainBytes}B > ${maxDbSizeBytes}B). ` +
                'Consider pruning more aggressively or rebuilding the cache database during a maintenance window.'
            );
        }

        return {
            prunedEntries,
            overLimit,
            metrics
        };
    }

    runMaintenance(now = Date.now(), source = 'manual') {
        const cleanup = this.cleanupExpired(now);
        const sizeLimit = this.enforceSizeLimit();
        const stats = this.getStats();

        if (cleanup.deletedResolutions || cleanup.deletedMetadata || cleanup.deletedAliases) {
            logger.info(
                `[enrichment-cache] Removed expired rows ` +
                `(resolutions=${cleanup.deletedResolutions}, metadata=${cleanup.deletedMetadata}, aliases=${cleanup.deletedAliases})`
            );
        }

        if (sizeLimit.prunedEntries > 0) {
            logger.info(
                `[enrichment-cache] Pruned ${sizeLimit.prunedEntries} cached resolution entries ` +
                `to respect the configured soft DB limit (mainBytes=${sizeLimit.metrics.mainBytes}, walBytes=${sizeLimit.metrics.walBytes})`
            );
        }

        logger.info(
            `[enrichment-cache] Maintenance summary ` +
            `(source=${source}, cleanup=res:${cleanup.deletedResolutions}|meta:${cleanup.deletedMetadata}|alias:${cleanup.deletedAliases}, ` +
            `pruned=${sizeLimit.prunedEntries}, resolutions=${stats.resolutions}, metadata=${stats.metadata}, aliases=${stats.aliases}, ` +
            `mainBytes=${stats.mainBytes}, walBytes=${stats.walBytes}, totalBytes=${stats.totalBytes})`
        );

        return {
            cleanup,
            sizeLimit,
            metrics: sizeLimit.metrics,
            stats
        };
    }

    getContentResolution(contentKey, now = Date.now()) {
        if (!contentKey) {
            return null;
        }

        const row = this.statements.getResolutionByContentKey.get({ contentKey, now });
        if (!row) {
            return null;
        }

        this.statements.touchResolution.run({ contentKey, now });
        return mapResolutionRow(row);
    }

    getContentResolutionByAlias(aliasKey, now = Date.now()) {
        if (!aliasKey) {
            return null;
        }

        const row = this.statements.getResolutionByAlias.get({ aliasKey, now });
        if (!row) {
            return null;
        }

        this.statements.touchAlias.run({ aliasKey, now });
        this.statements.touchResolution.run({ contentKey: row.content_key, now });
        return mapResolutionRow(row);
    }

    storeContentResolution(record = {}, now = Date.now()) {
        if (!record.contentKey) {
            return null;
        }

        const existing = this.getContentResolution(record.contentKey, now) || null;
        const merged = {
            ...existing,
            ...record,
            contentKey: record.contentKey,
            normalizedTitle: record.normalizedTitle || existing?.normalizedTitle || 'unknown',
            releaseYear: String(record.releaseYear || existing?.releaseYear || 'none'),
            mediaHint: record.mediaHint || existing?.mediaHint || 'unknown',
            isNegative: Boolean(record.isNegative ?? existing?.isNegative),
            posterShape: record.posterShape || existing?.posterShape || 'poster',
            createdAt: record.createdAt || existing?.createdAt || now,
            lastAccessedAt: now,
            resolverVersion: record.resolverVersion || existing?.resolverVersion || RESOLVER_VERSION
        };

        const ttlMs = record.ttlMs ?? (merged.isNegative ? this.options.resolutionNegativeTtlMs : this.options.resolutionPositiveTtlMs);
        const expiresAt = record.expiresAt || (now + ttlMs);

        this.statements.upsertResolution.run({
            ...merged,
            expiresAt,
            isNegative: merged.isNegative ? 1 : 0
        });

        return this.getContentResolution(record.contentKey, now);
    }

    getMetadata(contentKey, now = Date.now()) {
        if (!contentKey) {
            return null;
        }

        const row = this.statements.getMetadataByContentKey.get({ contentKey, now });
        if (!row) {
            return null;
        }

        this.statements.touchMetadata.run({ contentKey, now });
        return mapMetadataRow(row);
    }

    getMetadataByAlias(aliasKey, now = Date.now()) {
        if (!aliasKey) {
            return null;
        }

        const row = this.statements.getMetadataByAlias.get({ aliasKey, now });
        if (!row) {
            return null;
        }

        this.statements.touchAlias.run({ aliasKey, now });
        this.statements.touchMetadata.run({ contentKey: row.content_key, now });
        return mapMetadataRow(row);
    }

    storeMetadata(record = {}, now = Date.now()) {
        if (!record.contentKey) {
            return null;
        }

        const existing = this.getMetadata(record.contentKey, now) || null;
        const merged = {
            ...existing,
            ...record,
            contentKey: record.contentKey,
            metaSource: record.metaSource || existing?.metaSource || 'unknown',
            reason: record.reason || existing?.reason || null,
            isNegative: Boolean(record.isNegative ?? existing?.isNegative),
            isSuspect: Boolean(record.isSuspect ?? existing?.isSuspect),
            suspectReason: record.suspectReason || existing?.suspectReason || null,
            createdAt: record.createdAt || existing?.createdAt || now,
            lastAccessedAt: now,
            metadataVersion: record.metadataVersion || existing?.metadataVersion || METADATA_VERSION,
            genres: record.genres ?? existing?.genres ?? null,
            links: record.links ?? existing?.links ?? null
        };

        const ttlMs = record.ttlMs ?? (
            merged.isNegative
                ? this.options.metadataNegativeTtlMs
                : merged.isSuspect
                    ? this.options.metadataSuspectTtlMs
                    : this.options.metadataPositiveTtlMs
        );
        const expiresAt = record.expiresAt || (now + ttlMs);

        this.statements.upsertMetadata.run({
            ...merged,
            genresJson: merged.genres ? JSON.stringify(merged.genres) : null,
            linksJson: merged.links ? JSON.stringify(merged.links) : null,
            expiresAt,
            isNegative: merged.isNegative ? 1 : 0,
            isSuspect: merged.isSuspect ? 1 : 0
        });

        return this.getMetadata(record.contentKey, now);
    }

    storeAlias({ aliasKey, aliasType = 'filename', contentKey, expiresAt } = {}, now = Date.now()) {
        if (!aliasKey || !contentKey) {
            return null;
        }

        const effectiveExpiresAt = expiresAt || (now + this.options.resolutionPositiveTtlMs);

        this.statements.upsertAlias.run({
            aliasKey,
            aliasType,
            contentKey,
            createdAt: now,
            lastAccessedAt: now,
            expiresAt: effectiveExpiresAt
        });

        return {
            aliasKey,
            aliasType,
            contentKey,
            createdAt: now,
            lastAccessedAt: now,
            expiresAt: effectiveExpiresAt
        };
    }

    getStats() {
        const metrics = this.getStorageMetrics();

        return {
            dbPath: this.dbPath,
            resolutions: this.statements.countResolutions.get()?.count || 0,
            metadata: this.statements.countMetadata.get()?.count || 0,
            aliases: this.statements.countAliases.get()?.count || 0,
            mainBytes: metrics.mainBytes,
            liveBytes: metrics.liveBytes,
            walBytes: metrics.walBytes,
            totalBytes: metrics.totalBytes,
            freelistCount: metrics.freelistCount,
            autoVacuumMode: metrics.autoVacuumMode
        };
    }

    close() {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }

        if (this.db?.open) {
            this.db.close();
        }
    }
}

function buildCacheSignature(config) {
    return JSON.stringify({
        dbPath: path.resolve(config.dbPath),
        resolutionPositiveTtlMs: config.resolutionPositiveTtlMs,
        resolutionNegativeTtlMs: config.resolutionNegativeTtlMs,
        metadataPositiveTtlMs: config.metadataPositiveTtlMs,
        metadataNegativeTtlMs: config.metadataNegativeTtlMs,
        metadataSuspectTtlMs: config.metadataSuspectTtlMs,
        cleanupIntervalSeconds: config.cleanupIntervalSeconds,
        walSizeLimitBytes: config.walSizeLimitBytes,
        maxDbSizeBytes: config.maxDbSizeBytes,
        pruneBatchSize: config.pruneBatchSize
    });
}

export function getEnrichmentCache() {
    const config = configManager.getCatalogEnrichmentCacheConfig();
    if (!config.enabled) {
        return null;
    }

    const signature = buildCacheSignature(config);
    if (enrichmentCacheSingleton && enrichmentCacheSignature === signature) {
        return enrichmentCacheSingleton;
    }

    if (enrichmentCacheSingleton) {
        enrichmentCacheSingleton.close();
    }

    enrichmentCacheSingleton = new CatalogEnrichmentCache(config);
    enrichmentCacheSignature = signature;
    return enrichmentCacheSingleton;
}

export function initializeEnrichmentCacheForStartup() {
    const postersEnabled = configManager.getIsCatalogPosterEnabled();
    const config = configManager.getCatalogEnrichmentCacheConfig();

    if (!postersEnabled || !config.enabled) {
        return null;
    }

    return getEnrichmentCache();
}

export function resetEnrichmentCache() {
    if (enrichmentCacheSingleton) {
        enrichmentCacheSingleton.close();
        enrichmentCacheSingleton = null;
        enrichmentCacheSignature = null;
    }
}
