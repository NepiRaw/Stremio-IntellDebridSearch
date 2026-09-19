import crypto from 'crypto';
import { logger } from '../utils/logger.js';

const parse = logger.for('CONFIG').at('parse');

function validateConfig(config) {
    if (!config || typeof config !== 'object') return false;
    
    if (config.DebridProvider && config.DebridApiKey) {
        const validProviders = ['AllDebrid', 'RealDebrid', 'DebridLink', 'Premiumize', 'TorBox'];
        return validProviders.includes(config.DebridProvider) && config.DebridApiKey.length >= 8;
    }
    
    return false;
}

/**
 * Centralized Configuration Manager
 * Consolidates all configuration-related functionality into a single class
 */
class ConfigurationManager {
    constructor() {
        this._apiConfigCache = null;
    }

    getEnvVar(key, defaultValue = null) {
        const value = process.env[key];
        return (value && value.trim() !== '') ? value.trim() : defaultValue;
    }

    getApiConfig() {
        if (this._apiConfigCache) {
            return this._apiConfigCache;
        }

        const tmdbApiKey = this.getEnvVar('TMDB_API_KEY');
        const tvdbApiKey = this.getEnvVar('TVDB_API_KEY');

        this._apiConfigCache = {
            tmdbApiKey,
            tvdbApiKey,
            hasApiKeys: !!(tmdbApiKey || tvdbApiKey),
            hasAdvancedSearch: this.determineSearchCapabilities()
        };

        return this._apiConfigCache;
    }

    getIsTmdbEnabled() {
        const { tmdbApiKey } = this.getApiConfig();
        return !!tmdbApiKey;
    }

    // Absolute episode numbering comes from TVDB alone, independently of TMDb.
    getIsTvdbEnabled() {
        const { tvdbApiKey } = this.getApiConfig();
        return !!tvdbApiKey;
    }

    determineSearchCapabilities() {
        const tmdbApiKey = this.getEnvVar('TMDB_API_KEY');
        const tvdbApiKey = this.getEnvVar('TVDB_API_KEY');

        return !!tmdbApiKey;
    }

    getSearchCapabilities() {
        const isTmdbEnabled = this.getIsTmdbEnabled();
        const isTvdbEnabled = this.getIsTvdbEnabled();

        return {
            alternativeTitles: isTmdbEnabled,
            episodeMapping: isTvdbEnabled,
            enhancedMatching: isTmdbEnabled,
            absoluteEpisodes: isTvdbEnabled,
            internationalTitles: isTmdbEnabled,
            animeSupport: isTvdbEnabled
        };
    }

    /**
     * Get release group processing configuration - Default: false
     */
    getIsReleaseGroupEnabled() {
        const enableReleaseGroup = this.getEnvVar('ENABLE_RELEASE_GROUP', 'false');
        return enableReleaseGroup.toLowerCase() === 'true';
    }

    getIsCatalogPosterEnabled() {
        const enableCatalogPosters = this.getEnvVar('ENABLE_CATALOG_POSTERS', 'false');
        return enableCatalogPosters.toLowerCase() === 'true';
    }

    getCatalogEnrichmentCacheConfig() {
        const parseBoolean = (value, defaultValue = false) => {
            if (value === null || value === undefined) {
                return defaultValue;
            }

            return String(value).toLowerCase() === 'true';
        };

        const parseNumber = (value, defaultValue) => {
            const parsed = Number.parseInt(String(value ?? defaultValue), 10);
            return Number.isFinite(parsed) ? parsed : defaultValue;
        };

        return {
            enabled: parseBoolean(this.getEnvVar('CATALOG_ENRICHMENT_CACHE_ENABLED', 'true'), true),
            dbPath: this.getEnvVar('CATALOG_ENRICHMENT_CACHE_DB_PATH', './data/catalog-enrichment-cache.sqlite'),
            resolutionPositiveTtlMs: parseNumber(this.getEnvVar('CATALOG_ENRICHMENT_RESOLUTION_POSITIVE_TTL_DAYS', '14'), 14) * 24 * 60 * 60 * 1000, // Default 14 days for positive poster/content matches
            resolutionNegativeTtlMs: parseNumber(this.getEnvVar('CATALOG_ENRICHMENT_RESOLUTION_NEGATIVE_TTL_HOURS', '12'), 12) * 60 * 60 * 1000, // Default 12 hours for negative poster/content matches
            metadataPositiveTtlMs: parseNumber(this.getEnvVar('CATALOG_ENRICHMENT_METADATA_POSITIVE_TTL_HOURS', '48'), 48) * 60 * 60 * 1000, // Default 48 hours for positive metadata enrichment
            metadataNegativeTtlMs: parseNumber(this.getEnvVar('CATALOG_ENRICHMENT_METADATA_NEGATIVE_TTL_HOURS', '6'), 6) * 60 * 60 * 1000, // Default 6 hours for negative metadata enrichment
            metadataSuspectTtlMs: parseNumber(this.getEnvVar('CATALOG_ENRICHMENT_METADATA_SUSPECT_TTL_HOURS', '12'), 12) * 60 * 60 * 1000, // Default 12 hours for suspect metadata enrichment
            cleanupIntervalSeconds: parseNumber(this.getEnvVar('CATALOG_ENRICHMENT_CACHE_CLEANUP_INTERVAL_SECONDS', '21600'), 21600), // Default 6 hours
            walSizeLimitBytes: parseNumber(this.getEnvVar('CATALOG_ENRICHMENT_CACHE_WAL_SIZE_LIMIT_MB', '32'), 32) * 1024 * 1024, // Default 32 MB WAL size limit before checkpointing
            maxDbSizeBytes: parseNumber(this.getEnvVar('CATALOG_ENRICHMENT_CACHE_MAX_DB_MB', '0'), 0) * 1024 * 1024, // Default 0 (no limit) for maximum SQLite file size before pruning
            pruneBatchSize: parseNumber(this.getEnvVar('CATALOG_ENRICHMENT_CACHE_PRUNE_BATCH_SIZE', '100'), 100) // Default 100 entries to prune in each batch when maxDbSizeBytes is exceeded
        };
    }
}

function generateEncryptionKey() {
    const baseKey = 'StremioAddon-IntellDebridSearch';
    
    const staticVariables = [
        'static_trakt_placeholder',
        'static_tmdb_placeholder',
        'true',
        'false',
        'false',
        'info',
        'IntellDebridSearch'
    ];
    const combined = baseKey + ':' + staticVariables.join(':');
    
    return crypto.createHash('sha256').update(combined).digest('hex');
}

const ENCRYPTION_KEY = generateEncryptionKey();

function encryptConfig(config) {
    try {
        const json = JSON.stringify(config);
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
        let encrypted = cipher.update(json, 'utf8', 'base64');
        encrypted += cipher.final('base64');
        const combined = Buffer.concat([iv, Buffer.from(encrypted, 'base64')]);
        return combined.toString('base64url');
    } catch (error) {
        logger.for('CONFIG').at('rejected').warn('Encryption failed', { error: error.name });
        return null;
    }
}

/**
 * Configuration utilities - handles addon configuration parsing and validation
 */
function decryptConfig(encryptedConfig) {
    if (!encryptedConfig || typeof encryptedConfig !== 'string' || !isEncryptedConfig(encryptedConfig)) return null;
    
    try {
        const combined = Buffer.from(encryptedConfig, 'base64url');
        if (combined.length < 32) return null;
        
        const iv = combined.slice(0, 16);
        const encrypted = combined.slice(16);
        const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
        let decrypted = decipher.update(encrypted, undefined, 'utf8');
        decrypted += decipher.final('utf8');
        const config = JSON.parse(decrypted);
        
        return validateConfig(config) ? config : null;
    } catch {
        return null;
    }
}

function isEncryptedConfig(str) {
    if (!str || typeof str !== 'string') {
        return false;
    }
    
    const base64urlPattern = /^[A-Za-z0-9_-]+$/;
    const minLength = 50; // Encrypted configs should be at least this long
    const maxLength = 2000; // Reasonable upper bound
    
    return str.length >= minLength && 
           str.length <= maxLength && 
           base64urlPattern.test(str) &&
           !str.includes('{') && // Not plain JSON
           !str.includes('%'); // Not URL encoded JSON
}

export const configManager = new ConfigurationManager();

export function parseConfiguration(configuration = '{}') {
    if (!configuration || typeof configuration !== 'string' || configuration.trim() === '') return {};

    if (isEncryptedConfig(configuration)) {
        const decryptedConfig = decryptConfig(configuration);
        if (decryptedConfig) {
            parse.debug('Configuration parsed', { format: 'encrypted', valid: true, provider: decryptedConfig.DebridProvider });
            return decryptedConfig;
        }
        parse.warn('Configuration rejected', { format: 'encrypted', valid: false, code: configuration.length <= 50 ? 'TRUNCATED' : 'UNDECRYPTABLE' });
    }

    // Try to decode as standard base64-encoded JSON
    try {
        if (configuration.match(/^[A-Za-z0-9+/]+=*$/)) {  // Valid base64 pattern
            const decoded = Buffer.from(configuration, 'base64').toString('utf8');
            const parsed = JSON.parse(decoded);
            if (parsed && typeof parsed === 'object') {
                parse.debug('Configuration parsed', { format: 'base64', valid: true, provider: parsed.DebridProvider });
                return parsed;
            }
        }
    } catch {
        // Not base64 JSON; the plain JSON attempt follows.
    }

    try {
        const parsed = JSON.parse(configuration);
        if (parsed && typeof parsed === 'object') {
            parse.debug('Configuration parsed', { format: 'json', valid: true, provider: parsed.DebridProvider });
            return parsed;
        }
    } catch {
        // Fall through: an unreadable configuration means defaults.
    }

    parse.debug('Configuration unreadable', { format: 'unknown', valid: false });
    return {};
}

export function getProviderConfig(config) {
    if (!config) return null;

    // All providers use the standard pattern: DebridProvider + DebridApiKey
    if (config.DebridProvider && config.DebridApiKey) {
        return {
            provider: config.DebridProvider,
            apiKey: config.DebridApiKey
        };
    }

    return null;
}

export function getApiConfig() {
    return configManager.getApiConfig();
}

export function getIsCatalogPosterEnabled() {
    return configManager.getIsCatalogPosterEnabled();
}

/** The capability booleans the startup line reports. */
export function getStartupStatus() {
    const catalogPosters = configManager.getIsCatalogPosterEnabled();
    const enrichmentCache = configManager.getCatalogEnrichmentCacheConfig();
    return {
        tmdb: configManager.getIsTmdbEnabled(),
        tvdb: configManager.getIsTvdbEnabled(),
        advancedSearch: configManager.determineSearchCapabilities(),
        releaseGroups: configManager.getIsReleaseGroupEnabled(),
        catalogPosters,
        cache: catalogPosters && enrichmentCache.enabled ? 'sqlite' : 'off'
    };
}

export { encryptConfig, decryptConfig, isEncryptedConfig, validateConfig };