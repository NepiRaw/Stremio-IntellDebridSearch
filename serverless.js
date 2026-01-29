import Router from 'router'
import addonInterface from "./addon.js"
import landingTemplate from "./public/landing-template.js"
import StreamProvider from './src/stream-provider.js'
import { decode } from 'urlencode'
import qs from 'querystring'
import requestIp from 'request-ip'
import { getManifest } from './src/config/manifest.js'
import { parseConfiguration, encryptConfig } from './src/config/configuration.js'
import { BadTokenError, BadRequestError, AccessDeniedError } from './src/utils/error-handler.js'
import { ApiKeySecurityManager } from './src/providers/BaseProvider.js'
import { logger } from './src/utils/logger.js'

import { RealDebridProvider } from './src/providers/real-debrid.js'
import { AllDebridProvider } from './src/providers/all-debrid.js'
import { DebridLinkProvider } from './src/providers/debrid-link.js'
import { PremiumizeProvider } from './src/providers/premiumize.js'
import { TorBoxProvider } from './src/providers/torbox.js'

const PROVIDER_CLASSES = {
    RealDebrid: RealDebridProvider,
    AllDebrid: AllDebridProvider,
    DebridLink: DebridLinkProvider,
    Premiumize: PremiumizeProvider,
    TorBox: TorBoxProvider
};

const router = new Router();

router.get('/', (_, res) => {
    res.redirect('/configure')
})

router.get('/encryption-data', (req, res) => {
    res.setHeader('content-type', 'application/json')
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
    res.json({
        canEncrypt: true,
        timestamp: Date.now()
    })
})

router.post('/encrypt-config', async (req, res) => {
    res.setHeader('content-type', 'application/json')
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*')
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    
    // Security: Only allow requests from same origin or specific referrers
    const allowedOrigins = [
        req.headers.host,
        `https://${req.headers.host}`,
        `http://${req.headers.host}`,
        'localhost:3001',
        'http://localhost:3001'
    ];
    
    const origin = req.headers.origin;
    const referer = req.headers.referer;
    const host = req.headers.host;
    
    // Allow same-origin requests and direct frontend access
    const isValidOrigin = !origin || 
                         allowedOrigins.some(allowed => origin.includes(allowed.replace('http://', '').replace('https://', ''))) ||
                         (referer && allowedOrigins.some(allowed => referer.includes(allowed.replace('http://', '').replace('https://', ''))));
    
    if (!isValidOrigin) {
        logger.warn(`[security] Encrypt-config access denied from origin: ${origin || 'unknown'}, referer: ${referer || 'unknown'}`);
        return res.status(403).json({ error: 'Access denied - invalid origin' });
    }
    
    try {
        const config = req.body;
        if (!config || typeof config !== 'object') {
            return res.status(400).json({ error: 'Invalid configuration provided' });
        }
        
        if (Object.keys(config).length > 10) {
            return res.status(400).json({ error: 'Configuration too large' });
        }
        
        if (config.DebridProvider && config.DebridApiKey) {
            const ProviderClass = PROVIDER_CLASSES[config.DebridProvider];
            
            if (!ProviderClass) {
                logger.warn(`[encrypt-config] Unknown provider: ${config.DebridProvider}`);
                return res.status(400).json({ 
                    error: `Unknown provider: ${config.DebridProvider}`,
                    validationFailed: true
                });
            }
            
            const validation = await ProviderClass.validateApiKey(config.DebridApiKey);
            
            if (!validation.valid) {
                await new Promise(r => setTimeout(r, 500));
                return res.status(400).json({
                    error: validation.error || 'Invalid API key',
                    validationFailed: true,
                    provider: config.DebridProvider
                });
            }
        }
        
        const encryptedConfig = encryptConfig(config);
        if (!encryptedConfig) {
            return res.status(500).json({ error: 'Encryption failed' });
        }
        
        const baseUrl = process.env.ADDON_URL || `${req.headers['x-forwarded-proto'] || req.protocol}://${req.headers.host}`;
        const manifestUrl = `${baseUrl}/${encryptedConfig}/manifest.json`;
        
        logger.debug(`[encrypt-config] Manifest generated for ${config.DebridProvider} - ${manifestUrl}`);
        
        res.json({
            encrypted: true,
            encryptedConfig: encryptedConfig,
            manifestUrl: manifestUrl,
            desktopUrl: `stremio://${req.headers.host}/${encryptedConfig}/manifest.json`,
            webUrl: `https://web.stremio.com/#/addons?addon=${encodeURIComponent(manifestUrl)}`
        });
    } catch (error) {
        logger.error('[security] Encryption endpoint error:', error.message);
        res.status(500).json({ error: 'Encryption service unavailable' });
    }
})

router.options('/encrypt-config', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*')
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    res.status(200).end()
})

router.get('/:configuration?/configure', (req, res) => {
    const config = parseConfiguration(req.params.configuration)
    const landingHTML = landingTemplate(addonInterface.manifest, config)
    res.setHeader('content-type', 'text/html')
    res.end(landingHTML)
})

router.get('/:configuration?/manifest.json', (req, res) => {
    const configParam = req.params.configuration;
    
    const config = parseConfiguration(configParam)
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.end(JSON.stringify(getManifest(config)))
})

router.options('/:configuration?/resolve/:debridProvider/:debridApiKey/:id/:hostUrl', (req, res) => {
    // Handle preflight OPTIONS request for Vercel CORS compatibility
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, Cache-Control')
    res.setHeader('Access-Control-Allow-Credentials', 'false')
    res.setHeader('Access-Control-Max-Age', '86400')
    res.status(200).end()
})

router.get('/:configuration?/resolve/:debridProvider/:debridApiKey/:id/:hostUrl', (req, res) => {
    const clientIp = requestIp.getClientIp(req)
    
    try {
        let actualApiKey = req.params.debridApiKey;
        
        if (ApiKeySecurityManager.isSecureToken(req.params.debridApiKey)) {
            
            const resolvedKey = ApiKeySecurityManager.resolveSecureToken(req.params.debridProvider, req.params.debridApiKey);
            
            if (resolvedKey === null && req.params.debridApiKey !== 'null') {
                logger.error(`[SECURITY] Secure token resolution failed for ${req.params.debridProvider}: ${req.params.debridApiKey}`);
                res.status(401).json({ error: 'Invalid or expired security token' });
                return;
            }
            
            actualApiKey = resolvedKey || 'null';
        } else {
        }
        
        StreamProvider.resolveUrl(req.params.debridProvider, actualApiKey, req.params.id, decode(req.params.hostUrl), clientIp)
            .then(url => {
                res.redirect(url)
            })
            .catch(err => {
                logger.error(err)
                handleError(err, res)
            })
    } catch (error) {
        logger.error(`[SECURITY] Error in resolve endpoint:`, error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
})

router.get(`/:configuration?/:resource/:type/:id/:extra?.json`, (req, res, next) => {
    const { resource, type, id } = req.params
    const config = parseConfiguration(req.params.configuration)
    const extra = req.params.extra ? qs.parse(req.url.split('/').pop().slice(0, -5)) : {}

    addonInterface.get(resource, type, id, extra, config)
        .then(resp => {
            let cacheHeaders = {
                cacheMaxAge: 'max-age',
                staleRevalidate: 'stale-while-revalidate',
                staleError: 'stale-if-error'
            }

            const cacheControl = Object.keys(cacheHeaders)
                .map(prop => Number.isInteger(resp[prop]) && cacheHeaders[prop] + '=' + resp[prop])
                .filter(val => !!val).join(', ')

            res.setHeader('Cache-Control', `${cacheControl}, private`)
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.end(JSON.stringify(resp))
        })
        .catch(err => {
            logger.error(err)
            handleError(err, res)
        })
})

router.get('/ping', (_, res) => {
    res.statusCode = 200
    res.end()
})

function handleError(err, res) {
    if (err instanceof BadTokenError) {
        res.writeHead(401)
        res.end(JSON.stringify({ err: 'Bad token' }))
    } else if (err instanceof AccessDeniedError) {
        res.writeHead(403)
        res.end(JSON.stringify({ err: 'Access denied' }))
    } else if (err instanceof BadRequestError) {
        res.writeHead(400)
        res.end(JSON.stringify({ err: 'Bad request' }))
    } else {
        res.writeHead(500)
        res.end(JSON.stringify({ err: 'Server error' }))
    }
}

export default function (req, res) {
    router(req, res, function () {
        res.statusCode = 404;
        res.end();
    });
}