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
