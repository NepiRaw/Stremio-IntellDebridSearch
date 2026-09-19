import express from 'express'
import cors from 'cors'
import serverless from './serverless.js'
import requestIp from 'request-ip'
import rateLimit from 'express-rate-limit'
import swStats from 'swagger-stats'
import addonInterface from "./addon.js"
import { initializeEnrichmentCacheForStartup } from './src/catalog/enrichment-cache.js';
import { getCacheRecorder } from './src/utils/cache-recorder.js';

import { logger } from './src/utils/logger.js';
import { getStartupStatus } from './src/config/configuration.js';

const app = express()
app.enable('trust proxy')
app.use(cors())
app.use(express.json({ limit: '1mb' }))

app.use(swStats.getMiddleware({
    name: addonInterface.manifest.name,
    version: addonInterface.manifest.version,
    timelineBucketDuration: 60 * 60 * 1000,
    apdexThreshold: 2000,
    authentication: true,
    onAuthenticate: (req, username, password) => {
        return ((username === process.env.SWAGGER_USER
            && (password === process.env.SWAGGER_PASSWORD)))
    },
}))

const RATE_LIMIT = 300
const RATE_WINDOW_MS = 60 * 60 * 1000
const rateLimiter = rateLimit({
    windowMs: RATE_WINDOW_MS,
    limit: RATE_LIMIT,
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    keyGenerator: (req) => requestIp.getClientIp(req),
    handler: (req, res, next, options) => {
        if (req.rateLimit.used === RATE_LIMIT + 1) {
            const segment = req.url.split('/')[1] ?? ''
            logger.for('HTTP').at('limited').warn('Client over the rate limit', { cfg: /^[A-Za-z0-9_-]{60,}$/.test(segment) ? segment.slice(0, 8) : undefined, limit: RATE_LIMIT, window: '1h' })
        }
        res.status(options.statusCode).send(options.message)
    }
})
app.use(rateLimiter)

app.use((req, res, next) => {
    const currentAddonUrl = process.env.ADDON_URL;
    if (!currentAddonUrl || currentAddonUrl === 'http://127.0.0.1' || currentAddonUrl === 'http://localhost') {
        const protocol = req.headers['x-forwarded-proto'] || 
                        (req.connection && req.connection.encrypted ? 'https' : 'http');
        const host = req.headers['x-forwarded-host'] || req.headers.host;
        process.env.ADDON_URL = `${protocol}://${host}`;
        
        if (!req._urlDetected) {
            req._urlDetected = true;
        }
    }
    next();
});

app.use((req, res, next) => serverless(req, res, next))

let rawAddonUrl = process.env.ADDON_URL || 'http://127.0.0.1:3001';

if (rawAddonUrl.endsWith('/')) {
    rawAddonUrl = rawAddonUrl.slice(0, -1);
}

let serverPort = 3001; // Default port for local deployment
try {
    const urlParts = new URL(rawAddonUrl);
    
    serverPort = urlParts.port ? parseInt(urlParts.port) : 3001;
    
    // Handle ADDON_URL: only add port for localhost/127.0.0.1 without port
    if (!urlParts.port && (urlParts.hostname === '127.0.0.1' || urlParts.hostname === 'localhost')) {
        process.env.ADDON_URL = `${urlParts.protocol}//${urlParts.hostname}:3001`;
    } else {
        process.env.ADDON_URL = rawAddonUrl;
    }
} catch (e) {
    // Invalid URL - use defaults
    serverPort = 3001;
    rawAddonUrl = 'http://127.0.0.1:3001';
    process.env.ADDON_URL = rawAddonUrl;
}

app.listen(serverPort, () => {
    const system = logger.for('SYSTEM').at('startup')

    try {
        initializeEnrichmentCacheForStartup();
    } catch (error) {
        system.error('Enrichment cache failed to start', { module: 'enrichment-cache', error: error.name });
    }

    try {
        getCacheRecorder();
    } catch (error) {
        system.error('Cache recorder failed to start', { module: 'cache-recorder', error: error.name });
    }

    system.info('Addon ready', { port: serverPort, environment: process.env.NODE_ENV || 'production', ...getStartupStatus() }, { symbol: 'ready' });
})

export default app;