const LOG_LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const currentLogLevel = LOG_LEVELS[process.env.LOG_LEVEL?.toLowerCase()] ?? LOG_LEVELS.info;

function requestLogger(req, res, next) {
    if (currentLogLevel < LOG_LEVELS.info) {
        next();
        return;
    }
    
    const start = Date.now();
    const timestamp = new Date().toISOString();
    
    console.log(`📥 ${timestamp} ${req.method} ${req.url}`);
    
    res.on('finish', () => {
        const duration = Date.now() - start;
        const statusEmoji = res.statusCode >= 400 ? '❌' : '✅';
        console.log(`📤 ${statusEmoji} ${res.statusCode} ${req.method} ${req.url} - ${duration}ms`);
    });
    
    next();
}

/**
 * A non-string message is handed to the console as an argument rather than interpolated
 */
const line = (prefix, message, args) => (typeof message === 'string'
    ? [`${prefix} ${message}`, ...args]
    : [prefix, message, ...args]);

const logger = {
    info: (message, ...args) => {
        if (currentLogLevel >= LOG_LEVELS.info) {
            console.log(...line('ℹ️  [INFO]', message, args));
        }
    },

    error: (message, ...args) => {
        console.error(...line('❌ [ERROR]', message, args));
    },

    warn: (message, ...args) => {
        if (currentLogLevel >= LOG_LEVELS.warn) {
            console.warn(...line('⚠️  [WARN]', message, args));
        }
    },

    debug: (message, ...args) => {
        if (currentLogLevel >= LOG_LEVELS.debug) {
            console.log(...line('🐛 [DEBUG]', message, args));
        }
    },

    success: (message, ...args) => {
        if (currentLogLevel >= LOG_LEVELS.info) {
            console.log(...line('✅ [SUCCESS]', message, args));
        }
    }
};

export {
    requestLogger,
    logger
};
