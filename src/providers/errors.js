/**
 * Typed provider failures and the table that produces them.
 * Status alone cannot classify these: some providers report auth failures inside HTTP 200, serve
 * HTML under load, or reuse one status for a bad key and for a blocked request. An unrecognised
 * code falls to unavailable, since telling a user their key is wrong when it is not is the
 * harmful direction.
 */

import { BadTokenError } from '../utils/error-handler.js';

const describe = (error, { provider, operation, status, code }) => {
    error.provider = provider;
    error.operation = operation;
    error.status = status;
    error.code = code;
    return error;
};

/** Extends BadTokenError so the API routes keep answering 401. */
export class ProviderAuthError extends BadTokenError {
    constructor(message, context = {}) {
        super(message, context.provider, context.cause);
        this.name = 'ProviderAuthError';
        this.userMessage = context.userMessage;
        describe(this, context);
    }
}

export class ProviderRateLimitError extends Error {
    constructor(message, context = {}) {
        super(message, { cause: context.cause });
        this.name = 'ProviderRateLimitError';
        this.retryAfterMs = context.retryAfterMs ?? null;
        describe(this, context);
    }
}

export class ProviderUnavailableError extends Error {
    constructor(message, context = {}) {
        super(message, { cause: context.cause });
        this.name = 'ProviderUnavailableError';
        describe(this, context);
    }
}

/** A torrent or file that vanished between listing and fetching: drop it, never fail the search. */
export class ProviderItemGoneError extends Error {
    constructor(message, context = {}) {
        super(message, { cause: context.cause });
        this.name = 'ProviderItemGoneError';
        describe(this, context);
    }
}

/** Reads {failed, code, message} out of each provider's own envelope. */
const ENVELOPES = {
    AllDebrid: body => ({ failed: body?.status === 'error', code: body?.error?.code, message: body?.error?.message }),
    RealDebrid: body => ({ failed: body?.error !== undefined, code: body?.error_code, message: body?.error }),
    TorBox: body => ({ failed: body?.success === false, code: body?.error, message: body?.detail }),
    DebridLink: body => ({ failed: body?.success === false, code: body?.error, message: body?.error_description }),
    Premiumize: body => ({ failed: body?.status === 'error', code: body?.code, message: body?.message })
};

/** Codes meaning the user must act on their key or account. Anything unlisted stays silent. */
const AUTH_CODES = {
    AllDebrid: ['AUTH_BAD_APIKEY', 'AUTH_MISSING_APIKEY', 'AUTH_BLOCKED', 'AUTH_USER_BANNED'],
    RealDebrid: [8, 20],
    TorBox: ['BAD_TOKEN', 'AUTH_ERROR'],
    DebridLink: ['badToken'],
    Premiumize: ['authentication_failed']
};

const GONE_CODES = {
    AllDebrid: ['MAGNET_INVALID_ID'],
    RealDebrid: [19, 35],
    TorBox: [],
    DebridLink: [],
    Premiumize: []
};

const RATE_CODES = { RealDebrid: [34] };

/**
 * A free or expired account calls for a different action than a wrong key
 */
function authMessage(provider, code) {
    return provider === 'RealDebrid' && code === 20
        ? `Your ${provider} account is not premium, so it cannot produce playable links.\nRenew it, then reload the app.`
        : `Your ${provider} API key was rejected.\nOpen the addon configuration page to update it.`;
}

/** Seconds or an HTTP date, per RFC 9110. */
export function retryAfterMs(headers) {
    const raw = headers?.get?.('retry-after') ?? headers?.['retry-after'];
    if (!raw) return null;
    const seconds = Number(raw);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const date = Date.parse(raw);
    return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

/**
 * Turns one provider response into a typed error. Never throws, so a caller can classify freely.
 * `body` is the parsed JSON when there was one, otherwise the raw text.
 */
export function classify({ provider, operation, status, headers, body, cause }) {
    const parsed = body && typeof body === 'object' ? ENVELOPES[provider]?.(body) ?? {} : {};
    const code = parsed.code;
    const context = { provider, operation, status, code, cause };
    const detail = parsed.message || (typeof body === 'string' ? body.slice(0, 200) : '') || cause?.message || `HTTP ${status}`;
    const label = `[${provider}] ${operation}: ${detail}`;

    if (AUTH_CODES[provider]?.includes(code)) {
        return new ProviderAuthError(label, { ...context, userMessage: authMessage(provider, code) });
    }
    if (GONE_CODES[provider]?.includes(code) || status === 404) {
        return new ProviderItemGoneError(label, context);
    }
    if (status === 429 || RATE_CODES[provider]?.includes(code)) {
        return new ProviderRateLimitError(label, { ...context, retryAfterMs: retryAfterMs(headers) });
    }
    return new ProviderUnavailableError(label, context);
}

/** True when a response carried a failure its status does not show. */
export function isErrorBody(provider, body) {
    return body && typeof body === 'object' ? ENVELOPES[provider]?.(body).failed === true : false;
}
