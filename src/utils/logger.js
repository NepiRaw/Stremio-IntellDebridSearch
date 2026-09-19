/**
 * The module that writes application events to the console
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import crypto from 'node:crypto';

const LEVELS = Object.freeze({ error: 0, warn: 1, info: 2, debug: 3 });
const LEVEL_LABEL = Object.freeze({ debug: '[DEBUG]', info: '[INFO]', warn: '[WARN]', error: '[ERROR]' });
const LEVEL_COLOR = Object.freeze({ debug: 90, info: 36, warn: 33, error: 31 });
const OUTCOME = Object.freeze({ ready: '🚀', complete: '✓', warn: '⚠', error: '✖' });

/** One glyph and one step list per module  */
export const MODULES = Object.freeze({
    SYSTEM: { symbol: '🖥️', steps: ['startup'] },
    HTTP: { symbol: '🌐', steps: ['limited', 'watchdog', 'aborted', 'failed'] },
    CONFIG: { symbol: '⚙️', steps: ['parse', 'complete', 'rejected'] },
    SECURITY: { symbol: '🔐', steps: ['origin', 'token', 'reject'] },
    CATALOG: { symbol: '📚', steps: ['request', 'convert', 'complete', 'failed'] },
    SEARCH: { symbol: '🔎', steps: ['prepare', 'prefilter', 'title', 'content', 'failed'] },
    STREAM: { symbol: '🎬', steps: ['request', 'prepare', 'build', 'dedupe', 'complete', 'failed'] },
    META: { symbol: '🗂️', steps: ['request', 'enrich', 'complete', 'failed'] },
    RESOLVE: { symbol: '🔗', steps: ['request', 'complete', 'failed'] },
    PROVIDER: { symbol: '☁️', steps: ['validate', 'list', 'fetch', 'details', 'resolve', 'retry'] },
    CINEMETA: { symbol: '🎞️', steps: ['fetch'] },
    TMDB: { symbol: '🎞️', steps: ['fetch', 'titles', 'external'] },
    TVDB: { symbol: '🎞️', steps: ['fetch', 'map', 'episodes'] },
    CACHE: { symbol: '💾', steps: ['startup', 'hit', 'miss', 'store', 'record', 'maintenance'] },
    PERF: { symbol: '⏱️', steps: ['summary'] }
});

const COMMON_FIELDS = ['cfg', 'duration', 'status', 'code', 'error', 'reason', 'failedAt', 'module', 'attempt', 'attempts', 'delay', 'truncated'];
const MODULE_FIELDS = Object.freeze({
    SYSTEM: ['port', 'environment', 'tmdb', 'tvdb', 'advancedSearch', 'releaseGroups', 'catalogPosters', 'cache', 'warp'],
    HTTP: ['provider', 'type', 'id', 'origin', 'active', 'elapsed', 'limit', 'window'],
    CONFIG: ['format', 'valid', 'configured', 'provider'],
    SECURITY: ['present', 'provider'],
    CATALOG: ['configured', 'provider', 'type', 'id', 'catalog', 'mode', 'query', 'items', 'metas', 'bytes'],
    SEARCH: ['terms', 'alternatives', 'input', 'keywordHits', 'titleMatches', 'identityMatches', 'detailsFetched', 'episodeMatches', 'absoluteEpisode', 'mode', 'type'],
    STREAM: ['configured', 'provider', 'type', 'id', 'catalog', 'fileIndex', 'items', 'input', 'library', 'keywordHits', 'titleMatches', 'episodeMatches', 'usable', 'yearRejected', 'noVideo', 'dropped', 'duplicates', 'remaining', 'streams', 'bytes'],
    META: ['configured', 'provider', 'type', 'id', 'catalog', 'found', 'videos', 'dropped', 'enriched', 'bytes'],
    RESOLVE: ['provider', 'id', 'origin'],
    PROVIDER: ['provider', 'valid', 'torrents', 'dropped', 'found', 'videos', 'input', 'items', 'files', 'page', 'pages'],
    CINEMETA: ['type', 'id', 'found'],
    TMDB: ['type', 'id', 'found', 'titles'],
    TVDB: ['id', 'found', 'episodes'],
    CACHE: ['name', 'entries', 'evicted', 'key'],
    PERF: ['id', 'stages']
});

const SENSITIVE_KEY = /(?:api[-_]?key|authorization|cookie|credential|password|secret|token|configuration|hosturl|url)$/i;
const URL_VALUE = /^[a-z][a-z0-9+.-]*:\/\//i;
const URL_IN_TEXT = /\b[a-z][a-z0-9+.-]*:\/\/\S+/gi;
const REQUEST_ID = /^[A-Za-z0-9_-]{8}$/;
const RESET = '\u001b[0m';
const CONTEXT_WIDTH = 8;
const SCOPE_WIDTH = 17;
const MESSAGE_WIDTH = 22;
const MAX_VALUE = 160;
const MAX_LINE = 1000;
export const WATCHDOG_MS = 10000;

const storage = new AsyncLocalStorage();

function resolveLevel(raw) {
    const name = String(raw ?? 'info').toLowerCase();
    if (name in LEVELS) return { level: LEVELS[name], invalid: null };
    return { level: LEVELS.info, invalid: name };
}

const configured = resolveLevel(process.env.LOG_LEVEL);
let currentLevel = configured.level;
const color = Boolean(process.stdout.isTTY);

const enabled = level => LEVELS[level] <= currentLevel;
const colorize = (value, code) => (color ? `\u001b[${code}m${value}${RESET}` : value);
const normalizeText = value => String(value)
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '?');

function formatValue(key, value) {
    if (SENSITIVE_KEY.test(key)) return '[REDACTED]';
    if (value instanceof Error) return value.name;
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (typeof value === 'string') {
        if (URL_VALUE.test(value)) return '[REDACTED]';
        const redacted = value.replace(URL_IN_TEXT, '[REDACTED]');
        const text = redacted.length > MAX_VALUE ? `${redacted.slice(0, MAX_VALUE - 1)}…` : redacted;
        return /\s|=/.test(text) ? JSON.stringify(text) : normalizeText(text);
    }
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
    if (Array.isArray(value)) return `[${value.length} items]`;
    return '{object}';
}

function formatTimestamp(date) {
    const iso = date.toISOString();
    return `${iso.slice(0, 10)} ${iso.slice(11, 23)}Z`;
}

function selectFields(name, fields) {
    const allowed = [...COMMON_FIELDS, ...MODULE_FIELDS[name]];
    const kept = [];
    const rejected = [];
    for (const [key, value] of Object.entries(fields ?? {})) {
        if (value === undefined) continue;
        if (allowed.includes(key)) kept.push([key, value]);
        else rejected.push(key);
    }
    if (rejected.length) kept.push(['rejectedFields', rejected.join('+')]);
    return kept;
}

function resolveScope(component, step) {
    const name = String(component).toUpperCase();
    const module = MODULES[name];
    if (!module) throw new TypeError(`Unknown log module: ${component}`);
    if (!module.steps.includes(step)) throw new TypeError(`Unknown step for ${name}: ${step}`);
    return { name, module };
}

/** Builds the line. `fields` are already allowlisted; the context supplies the request id and the install tag. */
function formatLine({ level, symbol, name, module, step, message, fields, label }) {
    const context = storage.getStore();
    const id = context?.requestId ?? normalizeText(label ?? 'system').slice(0, CONTEXT_WIDTH).padEnd(CONTEXT_WIDTH);
    const withTag = context?.cfg && level !== 'debug' && !fields.some(([key]) => key === 'cfg')
        ? [['cfg', context.cfg], ...fields]
        : fields;
    const scope = `${module.symbol} ${`${name}.${step}`.padEnd(SCOPE_WIDTH)}`;
    const rendered = withTag.map(([key, value]) => `${key}=${formatValue(key, value)}`).join('  ');
    const prefix = `${formatTimestamp(new Date())}  ${colorize(LEVEL_LABEL[level].padEnd(7), LEVEL_COLOR[level])}  [${id}]  ${symbol ? `${symbol} ` : '  '}${colorize(scope, 90)}  ${normalizeText(message).padEnd(MESSAGE_WIDTH)}`;
    const line = rendered ? `${prefix}  ${rendered}` : prefix.trimEnd();
    return line.length > MAX_LINE ? `${line.slice(0, MAX_LINE - 16)}  truncated=true` : line;
}

function write(level, line) {
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
}

function emit(level, component, step, message, fields, options = {}) {
    if (!enabled(level)) return;
    const { name, module } = resolveScope(component, step);
    const symbol = level === 'warn' ? OUTCOME.warn
        : level === 'error' ? OUTCOME.error
            : level === 'info' && options.symbol ? OUTCOME[options.symbol] : undefined;
    write(level, formatLine({ level, symbol, name, module, step, message, fields: selectFields(name, fields), label: options.label }));
}

export function runWithLogContext(context, callback) {
    const requestId = context?.requestId ?? newRequestId();
    if (!REQUEST_ID.test(requestId)) throw new TypeError('requestId must be exactly 8 Base64URL characters');
    const store = {
        requestId,
        cfg: context?.cfg ? String(context.cfg).slice(0, 8) : null,
        segment: context?.cfg ?? null,
        startedAt: Date.now(),
        scope: null,
        fields: {},
        outcome: null
    };
    return storage.run(store, callback);
}

export const getLogContext = () => storage.getStore() ?? null;
export const newRequestId = () => crypto.randomBytes(6).toString('base64url');

/** The stage a request is in and what it is about, so a watchdog or abort line can say both. */
export function setLogScope(scope, fields) {
    const context = storage.getStore();
    if (!context) return;
    context.scope = scope;
    if (fields) context.fields = fields;
}

export function setLogOutcome(fields) {
    const context = storage.getStore();
    if (context) context.outcome = { ...(context.outcome ?? {}), ...fields };
}

export const bindLogContext = fn => AsyncLocalStorage.bind(fn);

export const logger = {
    for(component) {
        if (!MODULES[String(component).toUpperCase()]) throw new TypeError(`Unknown log module: ${component}`);
        return {
            at(step) {
                return {
                    debug: (message, fields) => emit('debug', component, step, message, fields),
                    info: (message, fields, options) => emit('info', component, step, message, fields, options),
                    warn: (message, fields) => emit('warn', component, step, message, fields),
                    error: (message, fields) => emit('error', component, step, message, fields)
                };
            }
        };
    }
};

export function setLogLevel(level) {
    const resolved = resolveLevel(level);
    currentLevel = resolved.level;
    return resolved.invalid === null;
}

if (configured.invalid !== null) {
    logger.for('SYSTEM').at('startup').warn('Invalid LOG_LEVEL, using info', { code: 'LOG_LEVEL' });
}
