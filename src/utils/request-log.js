import { WATCHDOG_MS, bindLogContext, getLogContext, logger, runWithLogContext } from './logger.js';

const http = logger.for('HTTP');
const CONFIG_SEGMENT = /^[A-Za-z0-9_-]{60,}$/;

const elapsed = context => `${Date.now() - context.startedAt}ms`;

/** Opens the log context for one request: id header, install tag, watchdog and abandoned-request detection. */
export function withRequestLog(req, res, run) {
    const first = req.url.split('?')[0].split('/')[1] ?? '';
    return runWithLogContext({ cfg: CONFIG_SEGMENT.test(first) ? first : null }, () => {
        const context = getLogContext();
        res.setHeader('X-Request-Id', context.requestId);

        const watchdog = setTimeout(bindLogContext(() => {
            http.at('watchdog').warn('Still running', { ...context.fields, active: context.scope, elapsed: elapsed(context) });
        }), WATCHDOG_MS);
        watchdog.unref();

        res.on('close', bindLogContext(() => {
            clearTimeout(watchdog);
            if (!res.writableFinished) {
                http.at('aborted').warn('Client disconnected', { ...context.fields, failedAt: context.scope, duration: elapsed(context) });
            }
        }));

        return run();
    });
}

/**
 * Writes the one terminal line of a request unless its owner already did.
 * `outcome.degraded` turns the line into a WARN; the flag itself is not printed.
 */
export function completeRequest(module, step, message, fields, { debug = false, degradedMessage = message } = {}) {
    const context = getLogContext();
    const outcome = context?.outcome ?? {};
    if (outcome.terminal) return;

    const { degraded, terminal, ...ownerFields } = outcome;
    const merged = { ...fields, ...ownerFields, duration: context ? elapsed(context) : undefined };
    const log = logger.for(module).at(step);
    if (degraded) log.warn(degradedMessage, merged);
    else if (debug) log.debug(message, merged);
    else log.info(message, merged, { symbol: 'complete' });
}

/** The terminal line of a request that ended in a thrown error: handled classes are WARN with their status, the rest ERROR. */
export function failRequest(module, error, status, fields) {
    const context = getLogContext();
    const merged = { ...fields, failedAt: context?.scope ?? undefined, status, error: error?.name, code: error?.code, reason: status < 500 ? error?.message : undefined, duration: context ? elapsed(context) : undefined };
    if (status >= 500) logger.for(module).at('failed').error('Request failed', merged);
    else logger.for(module).at('complete').warn('Request refused', merged);
}
