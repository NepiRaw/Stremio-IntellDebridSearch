/**
 * Configuration utilities - handles addon configuration parsing and validation
 */

import { logger } from '../utils/logger.js';
import { parseUnified } from '../utils/unified-torrent-parser.js';
import { FILE_TYPES } from '../stream/metadata-extractor.js';

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
            hasApiKeys: !!(tmdbApiKey || traktApiKey)
        };

        return this._apiConfigCache;
    }

    initializeProviderConfigs() {        
        return {
            AllDebrid: {
                bulkMethod: 'listTorrentsParallel',
                dataMapper: (item) => ({
                    source: 'alldebrid',
                    id: item.id,
                    name: item.filename,
                    type: 'other',
                    info: parseUnified(item.filename),
                    size: item.size,
                    created: new Date(item.completionDate)
                })
            },
            DebridLink: {
                bulkMethod: 'listTorrentsParallel',
                dataMapper: (item) => ({
                    source: 'debridlink',
                    id: item.id.split('-')[0],
                    name: item.name,
                    type: 'other',
                    info: parseUnified(item.name),
                    size: item.size,
                    created: new Date(item.created * 1000)
                })
            },
            RealDebrid: {
                bulkMethod: 'listFilesParrallel',
                methodArgs: [FILE_TYPES.TORRENTS, null, 1, 1000], // apiKey will be inserted at index 1
                dataMapper: (item) => ({
                    source: 'realdebrid',
                    id: item.id,
                    name: item.filename,
                    type: 'other',
                    info: parseUnified(item.filename),
                    size: item.bytes, // RealDebrid uses 'bytes' field, not 'size'
                    created: new Date(item.added) // RealDebrid uses 'added' field
                })
            },
            TorBox: {
                bulkMethod: 'listFilesParallel',
                methodArgs: [FILE_TYPES.TORRENTS, null, 1, 1000], // apiKey will be inserted at index 1
                dataMapper: (item) => ({
                    source: 'torbox',
                    id: item.id,
                    name: item.name,
                    type: 'other',
                    info: parseUnified(item.name),
                    size: item.size,
                    created: new Date(item.created_at)
                })
            },
            Premiumize: {
                bulkMethod: 'listFiles',
                dataMapper: (item) => ({
                    source: 'premiumize',
                    id: item.id,
                    name: item.name,
                    type: 'other',
                    info: parseUnified(item.name),
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
        const { tmdbApiKey, traktApiKey } = this.getApiConfig();
        
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

    let configToParse = configuration;

    try {
        if (isBase64String(configToParse)) {
            try {
                configToParse = Buffer.from(configToParse, 'base64').toString('utf8');
            } catch (base64Error) {
                configToParse = configuration;
            }
        }

        if (configuration.includes('%')) {
            try {
                configToParse = decodeURIComponent(configuration);
                logger.debug('[configuration] URL decoded configuration string');
                
                if (configToParse.includes('%')) {
                    configToParse = decodeURIComponent(configToParse);
                    logger.debug('[configuration] Double URL decoded configuration string');
                }
            } catch (decodeError) {
                logger.debug('[configuration] URL decoding failed, using original string');
                configToParse = configuration;
            }
        }

        if (isObviouslyNotJSON(configToParse)) {
            logger.debug(`[configuration] Non-JSON string detected: "${configToParse.substring(0, 50)}...", using defaults`);
            return {};
        }

        const config = JSON.parse(configToParse);
        logger.debug('[configuration] Successfully parsed configuration');
        return config;
        
    } catch (err) {
        if (err.message.includes('Unexpected token')) {
            logger.debug(`[configuration] Invalid JSON format detected: ${err.message.substring(0, 100)}`);
        } else {
            logger.warn(`[configuration] Configuration parsing failed: ${err.message}`);
        }
        return {};
    }
}

function isBase64String(str) {
    const base64Pattern = /^[A-Za-z0-9+/]*={0,2}$/;
    const minLength = 8; // Minimum reasonable length for a JSON config in base64
    
    return str.length >= minLength && 
           str.length % 4 === 0 && 
           base64Pattern.test(str) &&
           !str.includes(' ') && // Base64 doesn't contain spaces
           !str.includes('.') && // Base64 doesn't contain dots
           !str.includes(':');   // Base64 doesn't contain colons
}

function isObviouslyNotJSON(str) {
    const trimmed = str.trim();
    
    const nonJsonPatterns = [
        /^[a-zA-Z][a-zA-Z0-9]*$/, // Single word like "stream", "series", etc.
        /^[a-zA-Z][a-zA-Z0-9]*[:=]/,  // Key-value without proper JSON structure
        /^[^{"\[]/, // Doesn't start with JSON opening characters
        /^"?[a-zA-Z][a-zA-Z0-9]*"?[:=]/ // Basic key:value or key=value
    ];
    
    return nonJsonPatterns.some(pattern => pattern.test(trimmed));
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