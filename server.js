import express from 'express'
import cors from 'cors'
import 'dotenv/config'
import serverless from './serverless.js'
import requestIp from 'request-ip'
import rateLimit from 'express-rate-limit'
import swStats from 'swagger-stats'
import addonInterface from "./addon.js"

import { logger } from './src/utils/logger.js';
import { logApiStartupStatus } from './src/utils/configuration.js';
const app = express()
app.enable('trust proxy')
app.use(cors())

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

app.use((req, res, next) => serverless(req, res, next))

const ADDON_URL = process.env.ADDON_URL && process.env.ADDON_URL.trim() !== '' ? process.env.ADDON_URL : 'http://127.0.0.1';
const PORT = process.env.PORT && process.env.PORT.toString().trim() !== '' ? process.env.PORT : 3001;

app.listen(PORT, () => {
    const url = ADDON_URL.replace(/:\d+$/, '') + ':' + PORT;
    logger.info(`Started addon at: ${url}`)
    
    logApiStartupStatus();
})
