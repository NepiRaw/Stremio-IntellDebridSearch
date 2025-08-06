import { logger } from './logger.js';

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
    
    if (config.TmdbApiKey || config.tmdbApiKey) {
        validation.warnings.push('TMDb API key detected - enhanced search available');
    } else {
        validation.warnings.push('No TMDb API key - limited to basic search');
    }

    if (config.TraktApiKey || config.traktApiKey) {
        validation.warnings.push('Trakt API key detected - enhanced episode mapping available');
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
    if (!config) return {};

    return {
        tmdbApiKey: config.TmdbApiKey || config.tmdbApiKey || process.env.TMDB_API_KEY,
        traktApiKey: config.TraktApiKey || config.traktApiKey || process.env.TRAKT_API_KEY,
        hasAdvancedSearch: !!(
            config.TmdbApiKey || config.tmdbApiKey || process.env.TMDB_API_KEY ||
            config.TraktApiKey || config.traktApiKey || process.env.TRAKT_API_KEY
        )
    };
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
