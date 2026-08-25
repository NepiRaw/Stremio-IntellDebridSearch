/**
 * The single HTTP path for every provider call: rate limiting, timeout, retry and typed errors.
 * Limits are per token and per endpoint, so each provider and endpoint class owns a limiter group
 * and each API key owns a limiter inside it. maxConcurrent is the load-bearing setting.
 */

import Bottleneck from 'bottleneck';
import http from 'node:http';
import https from 'node:https';
import packageInfo from '../../package.json' with { type: 'json' };
import { createHash } from 'node:crypto';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { logger } from '../utils/logger.js';
import { isTransientNetworkError } from '../api/http.js';
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

const ATTEMPTS = 3;
const RETRY_DELAY_MS = 150;

/** A dropped socket or a failed name lookup says nothing about the answer, so ask again. */
async function withRetry(send, context) {
    for (let attempt = 1; ; attempt++) {
        try {
            return await send();
        } catch (cause) {
            if (!isTransientNetworkError(cause) || attempt === ATTEMPTS) throw classify({ ...context, status: 0, cause });
            logger.debug(`[${context.provider}] ${context.operation} ${cause.code ?? cause.message} on attempt ${attempt}, retrying`);
            await wait(RETRY_DELAY_MS * attempt);
        }
    }
}

const proxyAgents = new Map();
const proxyAgent = proxyUrl => {
    if (!proxyAgents.has(proxyUrl)) proxyAgents.set(proxyUrl, new SocksProxyAgent(proxyUrl));
    return proxyAgents.get(proxyUrl);
};

/**
 * The proxied transport. `fetch` cannot take an http.Agent, and AllDebrid's link/unlock is refused
 * from a datacenter address, so that one call goes through node's client and a SOCKS agent.
 * Answers the same shape the fetch path returns.
 */
function sendThroughProxy(url, { method, headers, body, timeoutMs, proxyUrl }) {
    const payload = body === undefined || body === null ? null : String(body);
    const sent = payload === null ? headers : { ...headers, 'content-length': Buffer.byteLength(payload) };

    const client = url.startsWith('http:') ? http : https;

    return new Promise((resolve, reject) => {
        const call = client.request(url, { method, headers: sent, agent: proxyAgent(proxyUrl), timeout: timeoutMs }, response => {
            let text = '';
            response.setEncoding('utf8');
            response.on('data', chunk => { text += chunk; });
            response.on('end', () => {
                const responseHeaders = new Headers();
                for (const [key, value] of Object.entries(response.headers)) {
                    for (const item of [value].flat()) responseHeaders.append(key, String(item));
                }
                resolve({
                    status: response.statusCode,
                    ok: response.statusCode >= 200 && response.statusCode < 300,
                    headers: responseHeaders,
                    text: async () => text
                });
            });
        });
        call.on('timeout', () => call.destroy(Object.assign(new Error('proxy request timed out'), { code: 'ETIMEDOUT' })));
        call.on('error', reject);
        if (payload !== null) call.write(payload);
        call.end();
    });
}

/**
 * Performs one provider call and returns {data, headers, status}, throwing a typed error for any
 * failure, including the ones that arrive as HTTP 200 or as HTML.
 * Callers build their own auth headers, since the providers disagree on where the key goes, and
 * pass `proxyUrl` for the rare endpoint that must not leave from this machine's address.
 */
export async function request({ provider, operation, endpointClass = 'default', apiKey, url, method = 'GET', headers = {}, body, timeoutMs = DEFAULT_TIMEOUT_MS, proxyUrl }) {
    const context = { provider, operation };
    const limiter = limiterFor(provider, endpointClass, apiKey);
    const options = {
        method,
        body,
        headers: { accept: 'application/json', 'user-agent': USER_AGENT, ...headers }
    };

    for (let attempt = 1; ; attempt++) {
        const send = proxyUrl
            ? () => sendThroughProxy(url, { ...options, timeoutMs, proxyUrl })
            : () => fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
        const response = await limiter.schedule(() => withRetry(send, context));
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
