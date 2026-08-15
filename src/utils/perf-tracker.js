/**
 * Request-scoped stage timing.
 *
 * One tracker per request wraps each pipeline stage, so a slow request says which stage
 * was slow instead of only how long it took overall. Disabled unless debug logging is on,
 * where it costs one object and no clock reads.
 */

const NOOP = {
    async span(name, fn) {
        return fn();
    },
    note() {},
    summary() {
        return '';
    }
};

function debugLoggingEnabled() {
    return process.env.LOG_LEVEL?.toLowerCase() === 'debug';
}

/**
 * @param {string} label identifies the request in the emitted line, e.g. `tt0903747:1:7`
 * @param {{enabled?: boolean}} [options] overrides the LOG_LEVEL default, for tests
 */
export function createTracker(label, options = {}) {
    const enabled = options.enabled ?? debugLoggingEnabled();
    if (!enabled) return NOOP;

    const started = performance.now();
    const entries = [];

    return {
        /** Times `fn`, recording the stage whether it resolves or throws. */
        async span(name, fn) {
            const from = performance.now();
            try {
                return await fn();
            } finally {
                entries.push({ name, ms: Math.round(performance.now() - from) });
            }
        },

        /** Records a counter rather than a duration. */
        note(name, value) {
            entries.push({ name, value });
        },

        summary() {
            const total = `total=${Math.round(performance.now() - started)}ms`;
            const stages = entries.map(entry =>
                entry.value === undefined ? `${entry.name}=${entry.ms}ms` : `${entry.name}=${entry.value}`
            );
            return [label, total, ...stages].join(' ');
        }
    };
}
