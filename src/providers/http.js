/**
 * The single HTTP path for every provider call: rate limiting, timeout, retry and typed errors.
 * Limits are per token and per endpoint, so each provider and endpoint class owns a limiter group
 * and each API key owns a limiter inside it. maxConcurrent is the load-bearing setting.
 */

import Bottleneck from 'bottleneck';
import packageInfo from '../../package.json' with { type: 'json' };
import { createHash } from 'node:crypto';
import { logger } from '../utils/logger.js';
import { fetchWithRetry } from '../api/http.js';
import { classify, isErrorBody, retryAfterMs } from './errors.js';

/** A provider behind Cloudflare answers 403 without one. */
export const USER_AGENT = `IntellDebridSearch/${packageInfo.version}`;

/** Measured recovery time after a rate limit or a transient block (5s default). */
export const RATE_LIMIT_PAUSE_MS = 5000;

/** A large listing legitimately takes seconds, so the ceiling is generous (30s default). */
const DEFAULT_TIMEOUT_MS = 30000;

const GROUP_IDLE_MS = 300000;
const RETRIED_STATUSES = new Set([429, 502, 503]);

/** From measured ceilings, not from the published documentation. */
const LIMITS = {
    RealDebrid: {
        list: { maxConcurrent: 2, minTime: 120, reservoir: 200 },
        files: { maxConcurrent: 12, minTime: 30, reservoir: 200 },
        resolve: { maxConcurrent: 2, minTime: 120, reservoir: 200 },
        default: { maxConcurrent: 2, minTime: 120, reservoir: 200 }
    },
    AllDebrid: { default: { maxConcurrent: 8, minTime: 60, reservoir: 500 } },
    TorBox: { default: { maxConcurrent: 8, minTime: 100, reservoir: 280 } },
    DebridLink: { default: { maxConcurrent: 6, minTime: 80, reservoir: 600 } },
    Premiumize: { default: { maxConcurrent: 6, minTime: 80, reservoir: 600 } }
};

const groups = new Map();

/** Key material never leaves this function: only its digest identifies a limiter. */
const keyHash = apiKey => createHash('sha1').update(String(apiKey ?? '')).digest('hex').slice(0, 12);

function limiterFor(provider, endpointClass, apiKey) {
    const profile = LIMITS[provider];
    if (!profile) throw new Error(`[providers/http] no limiter profile for ${provider}`);

    const groupKey = `${provider}:${endpointClass}`;
    if (!groups.has(groupKey)) {
        const { maxConcurrent, minTime, reservoir } = profile[endpointClass] ?? profile.default;
        groups.set(groupKey, new Bottleneck.Group({
            maxConcurrent,
            minTime,
            reservoir,
            reservoirRefreshAmount: reservoir,
            reservoirRefreshInterval: 60000,
            timeout: GROUP_IDLE_MS // idle limiters expire, so the map cannot grow unbounded
        }));
    }
    return groups.get(groupKey).key(keyHash(apiKey));
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function send(url, options, context) {
    try {
        return await fetchWithRetry(url, options, `${context.provider}:${context.operation}`);
    } catch (cause) {
        throw classify({ ...context, status: 0, cause });
    }
}

/**
 * Performs one provider call and returns {data, headers, status}, throwing a typed error for any
 * failure, including the ones that arrive as HTTP 200 or as HTML.
 * Callers build their own auth headers, since the providers disagree on where the key goes.
 */
export async function request({ provider, operation, endpointClass = 'default', apiKey, url, method = 'GET', headers = {}, body, timeoutMs = DEFAULT_TIMEOUT_MS }) {
    const context = { provider, operation };
    const limiter = limiterFor(provider, endpointClass, apiKey);
    const options = {
        method,
        body,
        headers: { accept: 'application/json', 'user-agent': USER_AGENT, ...headers }
    };

    for (let attempt = 1; ; attempt++) {
        const response = await limiter.schedule(() => send(url, { ...options, signal: AbortSignal.timeout(timeoutMs) }, context));
        const text = await response.text().catch(() => '');
        let data = null;
        try {
            data = text ? JSON.parse(text) : null;
        } catch {
            data = null;
        }

        if (RETRIED_STATUSES.has(response.status) && attempt === 1) {
            const pause = retryAfterMs(response.headers) ?? RATE_LIMIT_PAUSE_MS;
            logger.warn(`[${provider}] ${operation} got ${response.status}, retrying once in ${pause}ms`);
            await wait(pause);
            continue;
        }

        if (!response.ok || (data === null && text)) {
            throw classify({ ...context, status: response.status, headers: response.headers, body: data ?? text });
        }
        if (isErrorBody(provider, data)) {
            throw classify({ ...context, status: response.status, headers: response.headers, body: data });
        }

        return { data, headers: response.headers, status: response.status };
    }
}
