/**
 * Enhanced Error handling with ErrorManager for standardized error handling
 */

import { logger } from './logger.js';

/**
 * Enhanced Error Manager for standardized error handling across all modules
 * Provides unified error handling patterns and reduces boilerplate code
 */
class ErrorManager {
    
    static handle(operation, context = 'unknown') {
        return async (...args) => {
            try {
                return await operation(...args);
            } catch (error) {
                return this.processError(error, context, args);
            }
        };
    }

    static handleProviderError(providerName) {
        return (operation) => this.handle(operation, `provider:${providerName}`);
    }
    
    static handleApiError(apiName) {
        return (operation) => this.handle(operation, `api:${apiName}`);
    }
    
    static handleSearchError(searchType) {
        return (operation) => this.handle(operation, `search:${searchType}`);
    }
    
    static processError(error, context, operationArgs = []) {
        const errorInfo = this.createErrorInfo(error, context, operationArgs);
        this.logError(errorInfo, error);
        return this.createErrorResponse(errorInfo, error);
    }
    
    static createErrorInfo(error, context, operationArgs) {
        return {
            context,
            timestamp: new Date().toISOString(),
            message: error.message,
            name: error.name,
            type: this.classifyError(error),
            provider: error.provider || null,
            statusCode: error.statusCode || null,
            apiName: error.apiName || null,
            searchType: error.searchType || null,
            field: error.field || null,
            operationArgsCount: operationArgs.length
        };
    }
    
    static classifyError(error) {
        if (error instanceof ProviderError) return 'provider_error';
        if (error instanceof ApiError) return 'api_error';
        if (error instanceof SearchError) return 'search_error';
        if (error instanceof ValidationError) return 'validation_error';
        if (error instanceof BadTokenError) return 'authentication_error';
        if (error instanceof AccessDeniedError) return 'authorization_error';
        return 'general_error';
    }
    
    static logError(errorInfo, originalError) {
        const logMessage = `[error-manager] ${errorInfo.context}:`;
        
        if (errorInfo.type === 'validation_error') {
            logger.warn(logMessage, errorInfo);
        } else if (errorInfo.type === 'authentication_error' || errorInfo.type === 'authorization_error') {
            logger.error(logMessage, errorInfo);
        } else {
            logger.error(logMessage, errorInfo);
        }
        
        if (process.env.NODE_ENV === 'development' || process.env.DEBUG) {
            logger.error(`[error-manager] Stack trace:`, originalError.stack);
        }
    }
    
    static createErrorResponse(errorInfo, originalError) {
        if (errorInfo.type === 'provider_error' || errorInfo.type === 'api_error') {
            return null;
        }
        
        if (errorInfo.type === 'validation_error') {
            throw originalError;
        }
        
        if (errorInfo.type === 'authentication_error' || errorInfo.type === 'authorization_error') {
            throw originalError;
        }
        
        return null;
    }
    
    static wrapProviderMethods(provider, providerName) {
        const wrappedProvider = {};
        const errorHandler = this.handleProviderError(providerName);
        
        for (const [methodName, method] of Object.entries(provider)) {
            if (typeof method === 'function') {
                wrappedProvider[methodName] = errorHandler(method.bind(provider));
            } else {
                wrappedProvider[methodName] = method;
            }
        }
        
        return wrappedProvider;
    }
}

export const errorManager = ErrorManager;

export class BadTokenError extends Error {
    constructor(message = 'Invalid or expired API token', provider = null, originalError = null) {
        super(message);
        this.name = 'BadTokenError';
        this.provider = provider;
        this.originalError = originalError;
        
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, BadTokenError);
        }
    }
}

export class AccessDeniedError extends Error {
    constructor(message = 'Access denied by provider', provider = null, originalError = null) {
        super(message);
        this.name = 'AccessDeniedError';
        this.provider = provider;
        this.originalError = originalError;
        
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, AccessDeniedError);
        }
    }
}

export class ProviderError extends Error {
    constructor(message, provider, statusCode = null, originalError = null) {
        super(message);
        this.name = 'ProviderError';
        this.provider = provider;
        this.statusCode = statusCode;
        this.originalError = originalError;
        
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, ProviderError);
        }
    }
}

export class ApiError extends Error {
    constructor(message, apiName, statusCode = null, originalError = null) {
        super(message);
        this.name = 'ApiError';
        this.apiName = apiName;
        this.statusCode = statusCode;
        this.originalError = originalError;
        
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, ApiError);
        }
    }
}

export class SearchError extends Error {
    constructor(message, searchType = null, originalError = null) {
        super(message);
        this.name = 'SearchError';
        this.searchType = searchType;
        this.originalError = originalError;
        
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, SearchError);
        }
    }
}

export class ValidationError extends Error {
    constructor(message, field = null, value = null) {
        super(message);
        this.name = 'ValidationError';
        this.field = field;
        this.value = value;
        
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, ValidationError);
        }
    }
}

export function handleError(err, context = 'unknown', metadata = {}) {
    return errorManager.processError(err, context, [metadata]);
}

export function withErrorHandling(fn, context) {
    return errorManager.handle(fn, context);
}

export async function safeExecute(fn, context = 'safe_execute', defaultValue = null) {
    try {
        return await fn();
    } catch (err) {
        errorManager.processError(err, context);
        return defaultValue;
    }
}

export function validateRequiredFields(obj, requiredFields, objectName = 'object') {
    if (!obj || typeof obj !== 'object') {
        throw new ValidationError(`${objectName} must be an object`, null, obj);
    }

    for (const field of requiredFields) {
        if (!(field in obj) || obj[field] === null || obj[field] === undefined) {
            throw new ValidationError(`Missing required field: ${field}`, field, obj[field]);
        }
    }
}

export function validateSchema(obj, schema, objectName = 'object') {
    if (!obj || typeof obj !== 'object') {
        throw new ValidationError(`${objectName} must be an object`, null, obj);
    }

    for (const [field, rules] of Object.entries(schema)) {
        const value = obj[field];
        
        if (rules.required && (value === null || value === undefined)) {
            throw new ValidationError(`Missing required field: ${field}`, field, value);
        }
        
        if (!rules.required && (value === null || value === undefined)) {
            continue;
        }
        
        if (rules.type && typeof value !== rules.type) {
            throw new ValidationError(`Field ${field} must be of type ${rules.type}`, field, value);
        }
        
        if (rules.minLength && typeof value === 'string' && value.length < rules.minLength) {
            throw new ValidationError(`Field ${field} must be at least ${rules.minLength} characters`, field, value);
        }
        
        if (rules.maxLength && typeof value === 'string' && value.length > rules.maxLength) {
            throw new ValidationError(`Field ${field} must be no more than ${rules.maxLength} characters`, field, value);
        }
        
        if (rules.min !== undefined && typeof value === 'number' && value < rules.min) {
            throw new ValidationError(`Field ${field} must be at least ${rules.min}`, field, value);
        }
        
        if (rules.max !== undefined && typeof value === 'number' && value > rules.max) {
            throw new ValidationError(`Field ${field} must be no more than ${rules.max}`, field, value);
        }
        
        if (rules.enum && !rules.enum.includes(value)) {
            throw new ValidationError(`Field ${field} must be one of: ${rules.enum.join(', ')}`, field, value);
        }
        
        if (rules.validate && typeof rules.validate === 'function') {
            const isValid = rules.validate(value);
            if (!isValid) {
                throw new ValidationError(`Field ${field} failed custom validation`, field, value);
            }
        }
    }
}

export function withRetry(fn, maxRetries = 3, delay = 1000, context = 'retry') {
    return async (...args) => {
        let lastError;
        
        for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
            try {
                return await fn(...args);
            } catch (err) {
                lastError = err;
                
                if (attempt <= maxRetries) {
                    logger.warn(`[error-handler] ${context} attempt ${attempt} failed, retrying in ${delay}ms:`, err.message);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    delay *= 1.5; 
                } else {
                    logger.error(`[error-handler] ${context} failed after ${maxRetries} retries:`, err.message);
                }
            }
        }
        
        throw lastError;
    };
}

export function isRetryableError(err) {
    if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' || err.code === 'ETIMEDOUT') {
        return true;
    }
    
    if (err.statusCode && err.statusCode >= 500 && err.statusCode < 600) {
        return true;
    }
    
    if (err.statusCode === 429) {
        return true;
    }
    
    if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
        return false;
    }
    
    return false;
}

export const BadRequestError = { code: 'BAD_REQUEST' };
export const LEGACY_ACCESS_DENIED_ERROR = { code: 'ACCESS_DENIED' };

export const ERROR_CODES = {
    // Authentication
    BAD_TOKEN: 'BAD_TOKEN',
    ACCESS_DENIED: 'ACCESS_DENIED',
    INVALID_API_KEY: 'INVALID_API_KEY',
    
    // Request/Response
    BAD_REQUEST: 'BAD_REQUEST',
    NOT_FOUND: 'NOT_FOUND',
    TIMEOUT: 'TIMEOUT',
    RATE_LIMITED: 'RATE_LIMITED',
    
    // Provider Specific
    PROVIDER_ERROR: 'PROVIDER_ERROR',
    PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
    TORRENT_NOT_FOUND: 'TORRENT_NOT_FOUND',
    
    // Search/Processing
    SEARCH_FAILED: 'SEARCH_FAILED',
    PARSING_ERROR: 'PARSING_ERROR',
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    
    // Network
    NETWORK_ERROR: 'NETWORK_ERROR',
    CONNECTION_FAILED: 'CONNECTION_FAILED',
    
    // Internal
    INTERNAL_ERROR: 'INTERNAL_ERROR',
    CONFIGURATION_ERROR: 'CONFIGURATION_ERROR'
};