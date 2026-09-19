/**
 * Request-scoped stage timing and funnel counters.
 *
 * One tracker per request wraps each pipeline stage, so a slow request says which stage
 * was slow instead of only how long it took overall. Counters are always kept because the
 * terminal line prints them; stage timing costs clock reads and is kept only at debug level.
 */

import { logger } from './logger.js';

const perf = logger.for('PERF').at('summary');
const FUNNEL = { torrents: 'library', candidates: 'keywordHits', matches: 'titleMatches', selected: 'episodeMatches' };

/** Shared inert tracker, for stages reached by a caller that tracks nothing. */
export const disabledTracker = {
    async span(name, fn) {
        return fn();
    },
    note() {},
    summary() {
        return '';
    },
    funnel() {
        return {};
    },
    report() {}
};

function debugLoggingEnabled() {
    return process.env.LOG_LEVEL?.toLowerCase() === 'debug';
}

/**
 * @param {string} label identifies the request in the emitted line, e.g. `tt0903747:1:7`
 * @param {{enabled?: boolean}} [options] overrides the LOG_LEVEL default for timing, for tests
 */
export function createTracker(label, options = {}) {
    const timed = options.enabled ?? debugLoggingEnabled();
    const started = performance.now();
    const entries = [];

    return {
        /** Times `fn`, recording the stage whether it resolves or throws. */
        async span(name, fn) {
            if (!timed) return fn();
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
            if (!timed) return '';
            const total = `total=${Math.round(performance.now() - started)}ms`;
            const stages = entries.map(entry =>
                entry.value === undefined ? `${entry.name}=${entry.ms}ms` : `${entry.name}=${entry.value}`
            );
            return [label, total, ...stages].join(' ');
        },

        /** The counters the terminal line prints, in pipeline order. */
        funnel() {
            const fields = {};
            for (const entry of entries) {
                if (entry.name in FUNNEL) fields[FUNNEL[entry.name]] = entry.value;
            }
            return fields;
        },

        report() {
            if (!timed) return;
            const [, total, ...stages] = this.summary().split(' ');
            perf.debug('Stages timed', { id: label, total: total.slice('total='.length), stages: stages.join(' ') });
        }
    };
}
