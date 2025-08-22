import crypto from 'crypto';
import { logger } from '../utils/logger.js';

function validateConfig(config) {
    if (!config || typeof config !== 'object') {
        logger.debug('[CONFIG] Validation failed: config is not an object');
        return false;
    }
    
    if (config.DebridProvider && config.DebridApiKey) {
        const validProviders = ['AllDebrid', 'RealDebrid', 'DebridLink', 'Premiumize', 'TorBox'];
        const isValid = validProviders.includes(config.DebridProvider) && config.DebridApiKey.length >= 8;
        logger.debug(`[CONFIG] Validation for encrypted format: ${isValid ? 'PASSED' : 'FAILED'}`);
        return isValid;
    }
    
    logger.debug('[CONFIG] Validation failed: no recognized configuration format found');
    logger.debug('[CONFIG] Expected: DebridProvider and DebridApiKey properties');
    logger.debug('[CONFIG] Config keys:', Object.keys(config));
    return false;
}

const FILE_TYPES = Object.freeze({
    TORRENTS: Symbol("torrents"),
    DOWNLOADS: Symbol("downloads")
});

/**
 * Centralized Configuration Manager
 * Consolidates all configuration-related functionality into a single class
 */
class ConfigurationManager {
    constructor() {
        this.providerConfigs = this.initializeProviderConfigs();
        this._apiConfigCache = null;
        this._hasLoggedApiConfig = false;
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
        const traktApiKey = this.getEnvVar('TRAKT_API_KEY');
        
        if (!this._hasLoggedApiConfig) {
            if (tmdbApiKey) {
                logger.info('[configuration] Using TMDb API key from environment variables');
            }
            
            if (traktApiKey) {
                logger.info('[configuration] Using Trakt API key from environment variables');
            }
            this._hasLoggedApiConfig = true;
        }

        this._apiConfigCache = {
            tmdbApiKey,
            traktApiKey,
            hasApiKeys: !!(tmdbApiKey || traktApiKey),
            hasAdvancedSearch: this.determineSearchCapabilities()
        };

        return this._apiConfigCache;
    }

    initializeProviderConfigs() {        
        return {
            AllDebrid: {
                bulkMethod: 'listTorrentsParallel',
                dataMapper: (item) => ({
                    source: 'AllDebrid',
                    id: item.id,
                    name: item.filename,
                    type: 'other',
                    info: null,
                    size: item.size,
                    created: new Date(item.completionDate)
                })
            },
            DebridLink: {
                bulkMethod: 'listTorrentsParallel',
                dataMapper: (item) => ({
                    source: 'DebridLink',
                    id: item.id.split('-')[0],
                    name: item.name,
                    type: 'other',
                    info: null,
                    size: item.size,
                    created: new Date(item.created * 1000)
                })
            },
            RealDebrid: {
                bulkMethod: 'listFilesParrallel',
                methodArgs: [FILE_TYPES.TORRENTS, null, 1, 1000], // apiKey will be inserted at index 1
                dataMapper: (item) => ({
                    source: 'RealDebrid',
                    id: item.id,
                    name: item.filename,
                    type: 'other',
                    info: null,
                    size: item.bytes, // RealDebrid uses 'bytes' field, not 'size'
                    created: new Date(item.added) // RealDebrid uses 'added' field
                })
            },
            TorBox: {
                bulkMethod: 'listFilesParallel',
                methodArgs: [FILE_TYPES.TORRENTS, null, 1, 1000], // apiKey will be inserted at index 1
                dataMapper: (item) => ({
                    source: 'TorBox',
                    id: item.id,
                    name: item.name,
                    type: 'other',
                    info: null,
                    size: item.size,
                    created: new Date(item.created_at)
                })
            },
            Premiumize: {
                bulkMethod: 'listFiles',
                dataMapper: (item) => ({
                    source: 'Premiumize',
                    id: item.id,
                    name: item.name,
                    type: 'other',
                    info: null,
                    size: item.size,
                    created: new Date(item.created_at * 1000) // Premiumize uses created_at * 1000
                })
            }
        };
    }

    getProviderConfig(provider) {
        return this.providerConfigs[provider] || null;
    }

    getAllProviderConfigs() {
        return this.providerConfigs;
    }

    getIsTmdbEnabled() {
        const { tmdbApiKey, traktApiKey } = this.getApiConfig();
        
        if (tmdbApiKey && traktApiKey) {
            return true; // Scenario 1: Both APIs
        }
        if (tmdbApiKey && !traktApiKey) {
            return true; // Scenario 2: TMDb only
        }
        return false;
    }

    getIsTraktEnabled() {
        const { tmdbApiKey, traktApiKey } = this.getApiConfig();
        
        if (tmdbApiKey && traktApiKey) {
            return true; // Scenario 1: Both APIs
        }
        
        return false;
    }

    determineSearchCapabilities() {
        const tmdbApiKey = this.getEnvVar('TMDB_API_KEY');
        const traktApiKey = this.getEnvVar('TRAKT_API_KEY');
        
        if (tmdbApiKey && traktApiKey) {
            return true;
        }
        if (tmdbApiKey && !traktApiKey) {
            return true;
        }
        if (!tmdbApiKey && traktApiKey) {
            logger.warn('[configuration] Only Trakt API key available. TMDb API key is required for advanced search. Falling back to basic search.');
            return false;
        }
        return false;
    }

    getSearchCapabilities() {
        const isTmdbEnabled = this.getIsTmdbEnabled();
        const isTraktEnabled = this.getIsTraktEnabled();
        
        return {
            alternativeTitles: isTmdbEnabled,
            episodeMapping: isTraktEnabled,
            enhancedMatching: isTmdbEnabled,
            absoluteEpisodes: isTraktEnabled,
            internationalTitles: isTmdbEnabled,
            animeSupport: isTraktEnabled
        };
    }

    /**
     * Get release group processing configuration - Default: false
     */
    getIsReleaseGroupEnabled() {
        const enableReleaseGroup = this.getEnvVar('ENABLE_RELEASE_GROUP', 'false');
        return enableReleaseGroup.toLowerCase() === 'true';
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
        logger.warn('[CONFIG] Encryption failed:', error.message);
        return null;
    }
}

/**
 * Configuration utilities - handles addon configuration parsing and validation
 */
function decryptConfig(encryptedConfig) {
    if (!encryptedConfig || typeof encryptedConfig !== 'string') {
        logger.warn('[CONFIG] Invalid encrypted config provided');
        return null;
    }
    
    if (!isEncryptedConfig(encryptedConfig)) {
        logger.debug('[CONFIG] Configuration does not appear to be encrypted format');
        return null;
    }
    
    try {
        const combined = Buffer.from(encryptedConfig, 'base64url');
        if (combined.length < 32) {
            logger.warn('[CONFIG] Encrypted config too short to be valid');
            return null;
        }
        
        const iv = combined.slice(0, 16);
        const encrypted = combined.slice(16);
        const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
        let decrypted = decipher.update(encrypted, undefined, 'utf8');
        decrypted += decipher.final('utf8');
        const config = JSON.parse(decrypted);
        
        if (validateConfig(config)) {
            logger.debug('[CONFIG] Successfully decrypted with environment-based key');
            return config;
        } else {
            logger.warn('[CONFIG] Decrypted config failed validation');
            return null;
        }
    } catch (error) {
        logger.warn('[CONFIG] Decryption failed - config may be corrupted or from different deployment');
        logger.debug('[CONFIG] Decryption error:', error.message);
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
    if (!configuration || typeof configuration !== 'string') {
        logger.debug('[configuration] Invalid configuration provided, using defaults');
        return {};
    }

    if (configuration.trim() === '') {
        logger.debug('[configuration] Empty configuration provided, using defaults');
        return {};
    }

    if (isEncryptedConfig(configuration)) {
        logger.debug('[configuration] Detected encrypted configuration format');
        
        const decryptedConfig = decryptConfig(configuration);
        if (decryptedConfig && validateConfig(decryptedConfig)) {
            logger.info('[configuration] Successfully decrypted and validated configuration');
            return decryptedConfig;
        } else {
            logger.warn('[configuration] Failed to decrypt or validate encrypted configuration, falling back to legacy format');
            logger.debug(`[configuration] Problematic encrypted config (first 50 chars): ${configuration.substring(0, 50)}`);
            
            if (configuration.length <= 50) {
                logger.warn('[configuration] Encrypted configuration appears truncated - this may indicate URL encoding issues');
            }
        }
    }

    // Try to decode as standard base64-encoded JSON
    try {
        if (configuration.match(/^[A-Za-z0-9+/]+=*$/)) {  // Valid base64 pattern
            logger.debug('[configuration] Attempting to decode as base64-encoded JSON');
            const decoded = Buffer.from(configuration, 'base64').toString('utf8');
            const parsed = JSON.parse(decoded);
            if (parsed && typeof parsed === 'object') {
                logger.debug('[configuration] Successfully parsed base64-encoded JSON configuration');
                return parsed;
            }
        }
    } catch (error) {
        logger.debug(`[configuration] Failed to decode as base64 JSON: ${error.message}`);
    }

    try {
        const parsed = JSON.parse(configuration);
        if (parsed && typeof parsed === 'object') {
            logger.debug('[configuration] Successfully parsed as plain JSON configuration');
            return parsed;
        }
    } catch (error) {
        logger.debug(`[configuration] Failed to parse as plain JSON: ${error.message}`);
    }

    logger.debug('[configuration] Configuration format not recognized or invalid');
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

export function logApiStartupStatus() {
    const apiConfig = configManager.getApiConfig();
    const capabilities = configManager.getSearchCapabilities();
    const isTmdbEnabled = configManager.getIsTmdbEnabled();
    const isTraktEnabled = configManager.getIsTraktEnabled();
    const hasAdvancedSearch = configManager.determineSearchCapabilities();
    const isReleaseGroupEnabled = configManager.getIsReleaseGroupEnabled();
    
    logger.info('[configuration] === 🔑 API Key Status 🔑 ===');
    logger.info(`[configuration] TMDb API: ${isTmdbEnabled ? 'Available ✅' : 'Not configured ❌'}`);
    logger.info(`[configuration] Trakt API: ${isTraktEnabled ? 'Available ✅' : 'Not configured ❌'}`);
    logger.info(`[configuration] ⚡ Advanced search: ${hasAdvancedSearch ? 'Enabled ✅' : 'Disabled ❌'}`);
    logger.info(`[configuration] 👥 Release groups: ${isReleaseGroupEnabled ? 'Enabled ✅' : 'Disabled ❌'}`);
    
    logger.info('[configuration] Search capabilities:');
    logger.info(`  • Alternative titles: ${capabilities.alternativeTitles ? '✅' : '❌'}`);
    logger.info(`  • Anime/absolute episodes: ${capabilities.animeSupport ? '✅' : '❌'}`);
}

export { encryptConfig, decryptConfig, isEncryptedConfig, validateConfig };