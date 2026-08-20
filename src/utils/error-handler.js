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

    static handleProviderError(errorOrProviderName, providerName = null, context = 'unknown') {
        if (errorOrProviderName instanceof Error) {
            return this.processError(errorOrProviderName, `provider:${providerName || 'unknown'}:${context}`, []);
        }
        return (operation) => this.handle(operation, `provider:${errorOrProviderName}`);
    }
    
    static handleApiError(errorOrApiName, apiName = null, context = 'unknown') {
        if (errorOrApiName instanceof Error) {
            return this.processError(errorOrApiName, `api:${apiName || 'unknown'}:${context}`, []);
        }
        return (operation) => this.handle(operation, `api:${errorOrApiName}`);
    }
    
    static handleSearchError(errorOrSearchType, searchType = null, context = 'unknown') {
        if (errorOrSearchType instanceof Error) {
            return this.processError(errorOrSearchType, `search:${searchType || 'unknown'}:${context}`, []);
        }
        return (operation) => this.handle(operation, `search:${errorOrSearchType}`);
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

export class BadRequestError extends Error {
    constructor(message = 'Bad request', context = null, originalError = null) {
        super(message);
        this.name = 'BadRequestError';
        this.code = 'BAD_REQUEST';
        this.context = context;
        this.originalError = originalError;
        this.isRecoverable = true;
        
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, BadRequestError);
        }
    }
}

