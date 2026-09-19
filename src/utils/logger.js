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
    SYSTEM: { symbol: '🖥️', steps: ['startup', 'shutdown', 'cleanup'] },
    HTTP: { symbol: '🌐', steps: ['watchdog', 'aborted', 'failed'] },
    CONFIG: { symbol: '⚙️', steps: ['parse', 'complete', 'rejected'] },
    SECURITY: { symbol: '🔐', steps: ['origin', 'token', 'reject'] },
    CATALOG: { symbol: '📚', steps: ['convert', 'complete', 'failed'] },
    SEARCH: { symbol: '🔎', steps: ['prepare', 'prefilter', 'title', 'content', 'failed'] },
    STREAM: { symbol: '🎬', steps: ['accept', 'prepare', 'build', 'dedupe', 'complete', 'failed'] },
    META: { symbol: '🗂️', steps: ['enrich', 'complete', 'failed'] },
    RESOLVE: { symbol: '🔗', steps: ['link', 'complete', 'failed'] },
    PROVIDER: { symbol: '☁️', steps: ['validate', 'list', 'fetch', 'details', 'resolve', 'retry'] },
    CINEMETA: { symbol: '🎞️', steps: ['fetch'] },
    TMDB: { symbol: '🎞️', steps: ['fetch', 'titles', 'external'] },
    TVDB: { symbol: '🎞️', steps: ['fetch', 'map', 'episodes'] },
    CACHE: { symbol: '💾', steps: ['startup', 'hit', 'miss', 'store', 'record', 'maintenance'] },
    PERF: { symbol: '⏱️', steps: ['summary'] },
    WARP: { symbol: '🛡️', steps: ['startup'] },
    LEGACY: { symbol: '📝', steps: ['log'] }
});

const COMMON_FIELDS = ['cfg', 'duration', 'status', 'code', 'error', 'failedAt', 'module', 'attempt', 'attempts', 'delay', 'truncated'];
const MODULE_FIELDS = Object.freeze({
    SYSTEM: ['port', 'environment', 'advancedSearch', 'episodeMapping', 'catalogPosters', 'cache', 'warp'],
    HTTP: ['route', 'active', 'elapsed'],
    CONFIG: ['format', 'valid', 'configured', 'provider'],
    SECURITY: ['host', 'present', 'direct', 'provider'],
    CATALOG: ['provider', 'mode', 'input', 'metas', 'malformed', 'bytes'],
    SEARCH: ['terms', 'alternatives', 'input', 'candidates', 'identity', 'matches', 'absoluteEpisode', 'selected', 'failed', 'mode', 'type'],
    STREAM: ['provider', 'type', 'id', 'fileIndex', 'input', 'usable', 'yearRejected', 'noVideo', 'torrents', 'built', 'dropped', 'buildFailed', 'duplicates', 'remaining', 'streams', 'bytes'],
    META: ['provider', 'id', 'videos', 'dropped', 'enriched', 'bytes'],
    RESOLVE: ['provider', 'id', 'carried'],
    PROVIDER: ['provider', 'valid', 'torrents', 'dropped', 'found', 'videos', 'input', 'items', 'files', 'page', 'pages'],
    CINEMETA: ['type', 'id', 'found'],
    TMDB: ['type', 'id', 'found', 'titles'],
    TVDB: ['id', 'found', 'episodes'],
    CACHE: ['name', 'entries', 'evicted', 'key'],
    PERF: ['id', 'total', 'stages'],
    WARP: ['mode', 'registered'],
    LEGACY: ['detail']
});

const SENSITIVE_KEY = /(?:api[-_]?key|authorization|cookie|credential|password|secret|token|configuration|hosturl|url)$/i;
const URL_VALUE = /^[a-z][a-z0-9+.-]*:\/\//i;
const URL_IN_TEXT = /\b[a-z][a-z0-9+.-]*:\/\/\S+/gi;
const REQUEST_ID = /^[A-Za-z0-9_-]{8}$/;
const RESET = '\u001b[0m';
const CONTEXT_WIDTH = 8;
const SCOPE_WIDTH = 17;
const MESSAGE_WIDTH = 22;
const MAX_LINE = 400;
export const WATCHDOG_MS = 2000;

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
        return /\s|=/.test(value) ? JSON.stringify(value) : normalizeText(value);
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
        route: context?.route ?? null,
        startedAt: Date.now(),
        scope: null,
        outcome: null
    };
    return storage.run(store, callback);
}

export const getLogContext = () => storage.getStore() ?? null;
export const newRequestId = () => crypto.randomBytes(6).toString('base64url');

export function setLogScope(scope) {
    const context = storage.getStore();
    if (context) context.scope = scope;
}

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
    },

    info: (message, ...args) => legacy('info', message, args),
    warn: (message, ...args) => legacy('warn', message, args),
    error: (message, ...args) => legacy('error', message, args),
    debug: (message, ...args) => legacy('debug', message, args),
    success: (message, ...args) => legacy('info', message, args, { symbol: 'complete' })
};

function legacyText(value) {
    if (value instanceof Error) return `${value.name}: ${value.message}`;
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object' && typeof value.message === 'string') return value.message;
    if (Array.isArray(value)) return `[${value.length} items]`;
    if (value && typeof value === 'object') return '{object}';
    return String(value);
}

function legacy(level, message, args, options = {}) {
    if (!enabled(level)) return;
    const text = [message, ...args].map(legacyText).join(' ').replace(URL_IN_TEXT, '[REDACTED]');
    const { name, module } = resolveScope('LEGACY', 'log');
    const symbol = level === 'warn' ? OUTCOME.warn : level === 'error' ? OUTCOME.error : options.symbol ? OUTCOME[options.symbol] : undefined;
    write(level, formatLine({ level, symbol, name, module, step: 'log', message: text, fields: [] }));
}

export function setLogLevel(level) {
    const resolved = resolveLevel(level);
    currentLevel = resolved.level;
    return resolved.invalid === null;
}

if (configured.invalid !== null) {
    logger.for('SYSTEM').at('startup').warn('Invalid LOG_LEVEL, using info', { code: 'LOG_LEVEL' });
}
