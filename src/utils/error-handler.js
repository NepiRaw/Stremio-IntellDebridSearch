/**
 * Error handling utilities and custom error classes
 * Provides consistent error handling across the addon
 */

/**
 * Custom error class for provider-specific issues
 */
export class ProviderError extends Error {
    constructor(message, provider, statusCode = null, originalError = null) {
        super(message);
        this.name = 'ProviderError';
        this.provider = provider;
        this.statusCode = statusCode;
        this.originalError = originalError;
        
        // Maintain proper stack trace for where our error was thrown
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, ProviderError);
        }
    }
}

/**
 * Custom error class for bad token/authentication issues
 */
export class BadTokenError extends Error {
    constructor(message, provider = null, originalError = null) {
        super(message);
        this.name = 'BadTokenError';
        this.provider = provider;
        this.originalError = originalError;
        
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, BadTokenError);
        }
    }
}

/**
 * Custom error class for API-related issues
 */
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

/**
 * Custom error class for search-related issues
 */
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

/**
 * Custom error class for validation issues
 */
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

/**
 * General error handler with logging
 * @param {Error} err - Error to handle
 * @param {string} context - Context where error occurred
 * @param {object} metadata - Additional metadata for logging
 * @returns {object} - Standardized error response
 */
export function handleError(err, context = 'unknown', metadata = {}) {
    const errorInfo = {
        context,
        timestamp: new Date().toISOString(),
        message: err.message,
        name: err.name,
        ...metadata
    };

    // Add specific error details based on error type
    if (err instanceof ProviderError) {
        errorInfo.provider = err.provider;
        errorInfo.statusCode = err.statusCode;
        errorInfo.type = 'provider_error';
    } else if (err instanceof ApiError) {
        errorInfo.apiName = err.apiName;
        errorInfo.statusCode = err.statusCode;
        errorInfo.type = 'api_error';
    } else if (err instanceof SearchError) {
        errorInfo.searchType = err.searchType;
        errorInfo.type = 'search_error';
    } else if (err instanceof ValidationError) {
        errorInfo.field = err.field;
        errorInfo.value = err.value;
        errorInfo.type = 'validation_error';
    } else {
        errorInfo.type = 'general_error';
    }

    // Log error with appropriate level
    if (errorInfo.type === 'validation_error' || err.name === 'ValidationError') {
        logger.warn(`[error-handler] ${context}:`, errorInfo);
    } else {
        logger.error(`[error-handler] ${context}:`, errorInfo);
    }

    // Include stack trace in development
    if (process.env.NODE_ENV === 'development' || process.env.DEBUG) {
        logger.error(`[error-handler] Stack trace:`, err.stack);
    }

    return errorInfo;
}

/**
 * Wrap async functions with error handling
 * @param {Function} fn - Async function to wrap
 * @param {string} context - Context for error logging
 * @returns {Function} - Wrapped function
 */
export function withErrorHandling(fn, context) {
    return async (...args) => {
        try {
            return await fn(...args);
        } catch (err) {
            const errorInfo = handleError(err, context, { args: args.length });
            throw err; // Re-throw the original error
        }
    };
}

/**
 * Safe execution wrapper that catches errors and returns null
 * @param {Function} fn - Function to execute safely
 * @param {string} context - Context for error logging
 * @param {any} defaultValue - Default value to return on error
 * @returns {any} - Result or default value
 */
export async function safeExecute(fn, context = 'safe_execute', defaultValue = null) {
    try {
        return await fn();
    } catch (err) {
        handleError(err, context);
        return defaultValue;
    }
}

/**
 * Validate required fields in an object
 * @param {object} obj - Object to validate
 * @param {string[]} requiredFields - Array of required field names
 * @param {string} objectName - Name of object for error messages
 * @throws {ValidationError} - If validation fails
 */
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

/**
 * Validate object against a schema
 * @param {object} obj - Object to validate
 * @param {object} schema - Schema definition
 * @param {string} objectName - Name of object for error messages
 * @throws {ValidationError} - If validation fails
 */
export function validateSchema(obj, schema, objectName = 'object') {
    if (!obj || typeof obj !== 'object') {
        throw new ValidationError(`${objectName} must be an object`, null, obj);
    }

    for (const [field, rules] of Object.entries(schema)) {
        const value = obj[field];
        
        // Check required fields
        if (rules.required && (value === null || value === undefined)) {
            throw new ValidationError(`Missing required field: ${field}`, field, value);
        }
        
        // Skip validation for optional missing fields
        if (!rules.required && (value === null || value === undefined)) {
            continue;
        }
        
        // Type validation
        if (rules.type && typeof value !== rules.type) {
            throw new ValidationError(`Field ${field} must be of type ${rules.type}`, field, value);
        }
        
        // String length validation
        if (rules.minLength && typeof value === 'string' && value.length < rules.minLength) {
            throw new ValidationError(`Field ${field} must be at least ${rules.minLength} characters`, field, value);
        }
        
        if (rules.maxLength && typeof value === 'string' && value.length > rules.maxLength) {
            throw new ValidationError(`Field ${field} must be no more than ${rules.maxLength} characters`, field, value);
        }
        
        // Numeric range validation
        if (rules.min !== undefined && typeof value === 'number' && value < rules.min) {
            throw new ValidationError(`Field ${field} must be at least ${rules.min}`, field, value);
        }
        
        if (rules.max !== undefined && typeof value === 'number' && value > rules.max) {
            throw new ValidationError(`Field ${field} must be no more than ${rules.max}`, field, value);
        }
        
        // Enum validation
        if (rules.enum && !rules.enum.includes(value)) {
            throw new ValidationError(`Field ${field} must be one of: ${rules.enum.join(', ')}`, field, value);
        }
        
        // Custom validation function
        if (rules.validate && typeof rules.validate === 'function') {
            const isValid = rules.validate(value);
            if (!isValid) {
                throw new ValidationError(`Field ${field} failed custom validation`, field, value);
            }
        }
    }
}

/**
 * Create a retry wrapper for functions that might fail
 * @param {Function} fn - Function to retry
 * @param {number} maxRetries - Maximum number of retries
 * @param {number} delay - Delay between retries in milliseconds
 * @param {string} context - Context for error logging
 * @returns {Function} - Wrapped function with retry logic
 */
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
                    delay *= 1.5; // Exponential backoff
                } else {
                    logger.error(`[error-handler] ${context} failed after ${maxRetries} retries:`, err.message);
                }
            }
        }
        
        throw lastError;
    };
}

/**
 * Check if an error is retryable
 * @param {Error} err - Error to check
 * @returns {boolean} - Whether the error is retryable
 */
export function isRetryableError(err) {
    // Network errors are usually retryable
    if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' || err.code === 'ETIMEDOUT') {
        return true;
    }
    
    // HTTP 5xx errors are retryable
    if (err.statusCode && err.statusCode >= 500 && err.statusCode < 600) {
        return true;
    }
    
    // Rate limiting errors are retryable
    if (err.statusCode === 429) {
        return true;
    }
    
    // Some 4xx errors are not retryable
    if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
        return false;
    }
    
    return false;
}

// Legacy Error Codes (for backward compatibility with existing code)
export const AccessDeniedError = { code: 'ACCESS_DENIED' };
export const BadRequestError = { code: 'BAD_REQUEST' };

// Enhanced Error Codes
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
