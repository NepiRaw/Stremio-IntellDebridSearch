import express from 'express'
import cors from 'cors'
import 'dotenv/config'
import serverless from './serverless.js'
import requestIp from 'request-ip'
import rateLimit from 'express-rate-limit'
import swStats from 'swagger-stats'
import addonInterface from "./addon.js"

import { logger } from './src/utils/logger.js';
import { logApiStartupStatus } from './src/config/configuration.js';

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

const rateLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hours
    limit: 300, // Limit each IP to 300 requests per window
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    keyGenerator: (req) => requestIp.getClientIp(req)
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
    logger.info(`Started addon server on port ${serverPort}`);
    logger.info(`Addon URL: ${process.env.ADDON_URL}`);
    logger.info(`Configure page: ${process.env.ADDON_URL}/configure`);
    
    logApiStartupStatus();
})

export default app;