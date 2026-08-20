import { logger } from '../utils/logger.js';

/**
 * Shared transport for the upstream clients.
 *
 * The network here drops a name lookup often enough to matter: measured at 1 failure in 6 sequential
 * lookups, which used to empty a whole search. A blip now costs one retry instead.
 *
 * It calls the global fetch deliberately. That is undici, which pools and keeps connections alive by
 * default, so a host is resolved once rather than once per request, and it is also what the upstream
 * clients' tests intercept.
 */

const TRANSIENT_CODES = new Set([
    // What the operating system reports: a name lookup or a socket that went away.
    'ENOTFOUND', 'ENOENT', 'EAI_AGAIN', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'ECONNABORTED',
    // What undici reports for the same conditions. Only its transport errors are listed: an argument
    // or protocol error is a defect in the caller and repeating it would just be slower.
    'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT'
]);
const ATTEMPTS = 3;
const RETRY_DELAY_MS = 150;

/** A name lookup or a dropped socket says nothing about the answer, so it is worth asking again. */
export function isTransientNetworkError(error) {
    return TRANSIENT_CODES.has(error?.code ?? error?.cause?.code);
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Retries only what a retry can fix, and returns the response with its status untouched.
 *
 * A status is an answer and is never retried, because each caller reads it on its own terms:
 * TheTVDB treats 401 as "re-authenticate", TMDb treats some as "this work is unknown". Rate limiting
 * is deliberately not retried either: none has ever been observed here, and retrying a 429 without a
 * server-directed delay is how a client turns throttling into a ban.
 */
export async function fetchWithRetry(url, options = {}, label = 'http') {
    let lastError;

    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
        try {
            return await fetch(url, options);
        } catch (error) {
            if (!isTransientNetworkError(error)) throw error;
            lastError = error;
            if (attempt < ATTEMPTS) {
                logger.debug(`[${label}] ${error.code ?? error.cause?.code ?? error.message} on attempt ${attempt}, retrying`);
                await wait(RETRY_DELAY_MS * attempt);
            }
        }
    }

    throw lastError;
}

/** The same, for a caller that wants the body and treats any non-2xx as a failure. */
export async function fetchJson(url, options = {}, label = 'http') {
    const response = await fetchWithRetry(url, options, label);
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return response.json();
}
