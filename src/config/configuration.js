import { logger } from '../utils/logger.js';

/**
 * Configuration utilities - handles addon configuration parsing and validation
 */

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

export function validateConfiguration(config) {
    const validation = {
        isValid: true,
        errors: [],
        warnings: []
    };

    if (!config || typeof config !== 'object') {
        validation.isValid = false;
        validation.errors.push('Configuration must be an object');
        return validation;
    }

    const hasDebridProvider = config.DebridProvider && config.DebridApiKey;
    const hasDebridLink = config.DebridLinkApiKey;
    
    if (!hasDebridProvider && !hasDebridLink) {
        validation.isValid = false;
        validation.errors.push('No valid debrid provider configuration found');
    }
    return validation;
}

export function getProviderConfig(config) {
    if (!config) return null;

    if (config.DebridLinkApiKey) {
        return {
            provider: 'DebridLink',
            apiKey: config.DebridLinkApiKey
        };
    }

    if (config.DebridProvider && config.DebridApiKey) {
        return {
            provider: config.DebridProvider,
            apiKey: config.DebridApiKey
        };
    }

    return null;
}

export function getApiConfig(config) {
    if (!config) config = {};

    const tmdbApiKey = process.env.TMDB_API_KEY;
    const traktApiKey = process.env.TRAKT_API_KEY;
    
    const hasAdvancedSearch = determineSearchCapabilities(tmdbApiKey, traktApiKey);
    
    const isTmdbEnabled = getIsTmdbEnabled(tmdbApiKey, traktApiKey);
    const isTraktEnabled = getIsTraktEnabled(tmdbApiKey, traktApiKey);
    
    return {
        tmdbApiKey,
        traktApiKey,
        isTmdbEnabled,
        isTraktEnabled,
        hasAdvancedSearch,
        searchCapabilities: getSearchCapabilities(tmdbApiKey, traktApiKey)
    };
}

function getIsTmdbEnabled(tmdbApiKey, traktApiKey) {
    // TMDb is enabled if:
    // 1. TMDb key exists AND (both keys exist OR only TMDb exists)
    // 2. NOT when only Trakt key exists (Scenario 3 fallback)
    if (tmdbApiKey && traktApiKey) {
        return true; // Scenario 1: Both APIs
    }
    
    if (tmdbApiKey && !traktApiKey) {
        return true; // Scenario 2: TMDb only
    }
    
    // Scenario 3: Trakt only - TMDb should be disabled
    // Scenario 4: Neither key - TMDb should be disabled
    return false;
}

function getIsTraktEnabled(tmdbApiKey, traktApiKey) {
    if (tmdbApiKey && traktApiKey) {
        return true; // Scenario 1: Both APIs
    }
    
    return false;
}

function determineSearchCapabilities(tmdbApiKey, traktApiKey) {
    if (tmdbApiKey && traktApiKey) { // Scenario 1: Both APIs available - full advanced search
        return true;
    }
    
    if (tmdbApiKey && !traktApiKey) { // Scenario 2: Only TMDb available - advanced search without Trakt features
        return true;
    }
    
    if (!tmdbApiKey && traktApiKey) { // Scenario 3: Only Trakt available - fallback to basic search
        logger.warn('[configuration] Only Trakt API key available. TMDb API key is required for advanced search. Falling back to basic search.');
        return false;
    }

    if (!tmdbApiKey && !traktApiKey) { // Scenario 4: Neither API available - basic search only
        return false;
    }
    
    return false;
}

function getSearchCapabilities(tmdbApiKey, traktApiKey) {
    const isTmdbEnabled = getIsTmdbEnabled(tmdbApiKey, traktApiKey);
    const isTraktEnabled = getIsTraktEnabled(tmdbApiKey, traktApiKey);
    
    return {
        alternativeTitles: isTmdbEnabled,
        episodeMapping: isTraktEnabled,
        enhancedMatching: isTmdbEnabled,
        absoluteEpisodes: isTraktEnabled,
        internationalTitles: isTmdbEnabled,
        animeSupport: isTraktEnabled
    };
}

export function logApiStartupStatus(config = {}) {
    const apiConfig = getApiConfig(config);
    
    logger.info('[configuration] === 🔑 API Key Status 🔑 ===');
    logger.info(`[configuration] TMDb API: ${apiConfig.isTmdbEnabled ? 'Available ✅' : 'Not configured ❌'}`);
    logger.info(`[configuration] Trakt API: ${apiConfig.isTraktEnabled ? 'Available ✅' : 'Not configured ❌'}`);
    logger.info(`[configuration] ⚡ Advanced search: ${apiConfig.hasAdvancedSearch ? 'Enabled ✅' : 'Disabled ❌'}`);
    
    const caps = apiConfig.searchCapabilities;
    logger.info('[configuration] Search capabilities:');
    logger.info(`  • Alternative titles: ${caps.alternativeTitles ? '✅' : '❌'}`);
    logger.info(`  • Anime/absolute episodes: ${caps.animeSupport ? '✅' : '❌'}`);
}

export function mergeWithDefaults(config, defaults = {}) {
    const defaultConfig = {
        searchThreshold: 0.1,
        maxResults: 100,
        cacheEnabled: true,
        cacheDuration: 3600,
        ...defaults
    };

    return {
        ...defaultConfig,
        ...config
    };
}
