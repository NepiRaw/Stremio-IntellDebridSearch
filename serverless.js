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
import { ProviderItemGoneError } from './src/providers/errors.js'
import { ApiKeySecurityManager } from './src/providers/resolve-url.js'
import { getProvider } from './src/providers/index.js'
import { logger, setLogScope } from './src/utils/logger.js'
import { completeRequest, failRequest, withRequestLog } from './src/utils/request-log.js'

const security = logger.for('SECURITY')
const configLog = logger.for('CONFIG')


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
        security.at('origin').warn('Origin refused', { present: Boolean(origin || referer), status: 403 });
        return res.status(403).json({ error: 'Access denied - invalid origin' });
    }

    setLogScope('encrypt')
    try {
        const config = req.body;
        if (!config || typeof config !== 'object') {
            return res.status(400).json({ error: 'Invalid configuration provided' });
        }
        
        if (Object.keys(config).length > 10) {
            return res.status(400).json({ error: 'Configuration too large' });
        }
        
        if (config.DebridProvider && config.DebridApiKey) {
            const provider = getProvider(config.DebridProvider);

            if (!provider) {
                configLog.at('rejected').warn('Unknown provider', { code: 'UNKNOWN_PROVIDER', status: 400 });
                return res.status(400).json({
                    error: `Unknown provider: ${config.DebridProvider}`,
                    validationFailed: true
                });
            }

            const validation = await provider.validateKey(config.DebridApiKey)
                .then(user => ({ valid: true, username: user.username, premium: user.premium, premiumUntil: user.premiumUntil }))
                .catch(error => ({ valid: false, error: error.userMessage ?? error.message, errorCode: error.code }));
            
            if (!validation.valid) {
                configLog.at('rejected').warn('Key rejected', { provider: config.DebridProvider, code: validation.errorCode, status: 400 });
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

        res.json({
            encrypted: true,
            encryptedConfig: encryptedConfig,
            manifestUrl: manifestUrl,
            desktopUrl: `stremio://${req.headers.host}/${encryptedConfig}/manifest.json`,
            webUrl: `https://web.stremio.com/#/addons?addon=${encodeURIComponent(manifestUrl)}`
        });
        completeRequest('CONFIG', 'complete', 'Install URL created', { provider: config.DebridProvider, status: 200 })
    } catch (error) {
        failRequest('CONFIG', error, 500)
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
    setLogScope('configure')
    const config = parseConfiguration(req.params.configuration)
    const landingHTML = landingTemplate(addonInterface.manifest, config)
    res.setHeader('content-type', 'text/html')
    res.end(landingHTML)
    completeRequest('CONFIG', 'complete', 'Configure page served', { configured: Boolean(config?.DebridProvider), status: 200 }, { debug: true })
})

router.get('/:configuration?/manifest.json', (req, res) => {
    setLogScope('manifest')
    const config = parseConfiguration(req.params.configuration)
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.end(JSON.stringify(getManifest(config)))
    completeRequest('CONFIG', 'complete', 'Manifest served', { configured: Boolean(config?.DebridProvider), status: 200 }, { debug: true })
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
    const { debridProvider: provider, id } = req.params
    const origin = originOf(req)
    setLogScope('resolve', { provider, id, origin })

    try {
        let actualApiKey = req.params.debridApiKey;

        const carried = parseConfiguration(req.params.configuration);
        const carriedKey = carried?.DebridProvider === provider ? carried.DebridApiKey : null;
        logger.for('RESOLVE').at('request').info('Play link requested', { provider, id, origin });

        if (carriedKey) {
            actualApiKey = carriedKey;
        } else if (ApiKeySecurityManager.isSecureToken(req.params.debridApiKey)) {

            const resolvedKey = ApiKeySecurityManager.resolveSecureToken(provider, req.params.debridApiKey);

            if (resolvedKey === null && req.params.debridApiKey !== 'null') {
                security.at('token').warn('Token unknown', { provider, status: 401 });
                res.status(401).json({ error: 'Invalid or expired security token' });
                return;
            }

            actualApiKey = resolvedKey || 'null';
        }

        StreamProvider.resolveUrl(provider, actualApiKey, id, decode(req.params.hostUrl), clientIp)
            .then(url => {
                res.redirect(url)
                completeRequest('RESOLVE', 'complete', 'Link resolved', { provider, id, origin, status: 302 })
            })
            .catch(err => {
                const status = statusFor(err)
                failRequest('RESOLVE', err, status, { provider, id, origin })
                answerError(status, res)
            })
    } catch (error) {
        failRequest('RESOLVE', error, 500, { provider, id, origin })
        res.status(500).json({ error: 'Internal server error' });
    }
})

/** A request with no configuration still fills :configuration, shifting every segment along. */
const RESOURCES = new Set(['catalog', 'meta', 'stream', 'subtitles', 'addon_catalog'])

router.get(`/:configuration?/:resource/:type/:id/:extra?.json`, (req, res, next) => {
    const shifted = RESOURCES.has(req.params.configuration)
    const resource = shifted ? req.params.configuration : req.params.resource
    const type = shifted ? req.params.resource : req.params.type
    const id = shifted ? req.params.type : req.params.id
    const extraSegment = shifted ? req.params.id : req.params.extra

    const config = parseConfiguration(shifted ? undefined : req.params.configuration)
    const extra = extraSegment ? qs.parse(req.url.split('/').pop().slice(0, -5)) : {}
    const module = RESOURCE_MODULE[resource]
    const fields = { configured: config?.DebridProvider ? undefined : false, provider: config?.DebridProvider, type, id }
    setLogScope(resource, fields)
    const quiet = fields.configured === false || (resource === 'meta' && !id.includes(':'))
    if (module) {
        logger.for(module).at('request')[quiet ? 'debug' : 'info'](RESOURCE_REQUEST[resource], { ...fields, catalog: config?.ShowCatalog, ...(resource === 'catalog' ? { mode: extra.search ? 'search' : 'browse', query: extra.search } : {}) })
    }

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

            const body = JSON.stringify(resp)
            if (cacheControl) res.setHeader('Cache-Control', `${cacheControl}, private`)
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.end(body)
            completeRequest(module, 'complete', RESOURCE_MESSAGE[resource], { ...fields, ...answerCounts(resource, resp, extra), bytes: Buffer.byteLength(body) }, { debug: quiet, degradedMessage: RESOURCE_DEGRADED[resource] })
        })
        .catch(err => {
            const status = statusFor(err)
            failRequest(module ?? 'HTTP', err, status, fields)
            answerError(status, res)
        })
})

router.get('/ping', (_, res) => {
    res.statusCode = 200
    res.end()
})

/** The id of the request that built a play URL */
function originOf(req) {
    const value = qs.parse(req.url.split('?')[1] ?? '').r
    return typeof value === 'string' && /^[A-Za-z0-9_-]{8}$/.test(value) ? value : undefined
}

const RESOURCE_MODULE = { catalog: 'CATALOG', meta: 'META', stream: 'STREAM' }
const RESOURCE_REQUEST = { catalog: 'Catalog requested', meta: 'Meta requested', stream: 'Streams requested' }
const RESOURCE_MESSAGE = { catalog: 'Catalog answered', meta: 'Meta answered', stream: 'Streams answered' }
const RESOURCE_DEGRADED = { catalog: 'Catalog answered empty', meta: 'Meta answered empty', stream: 'Streams answered empty' }

function answerCounts(resource, resp, extra) {
    if (resource === 'catalog') return { mode: extra.search ? 'search' : 'browse', metas: resp.metas?.length ?? 0 }
    if (resource === 'meta') return { found: Boolean(resp.meta), videos: resp.meta?.videos?.length ?? 0, enriched: Boolean(resp.meta?.imdb_id) }
    const items = [...new Set((resp.streams ?? []).map(stream => stream.behaviorHints?.bingeGroup?.split('|')[1]).filter(Boolean))]
    return { streams: resp.streams?.length ?? 0, items: items.length ? items.slice(0, 5).join('+') + (items.length > 5 ? '+…' : '') : undefined }
}

const ERROR_STATUS = [[BadTokenError, 401, 'Bad token'], [ProviderItemGoneError, 404, 'Not available'], [AccessDeniedError, 403, 'Access denied'], [BadRequestError, 400, 'Bad request']]

function statusFor(err) {
    return ERROR_STATUS.find(([type]) => err instanceof type)?.[1] ?? 500
}

function answerError(status, res) {
    const message = ERROR_STATUS.find(([, code]) => code === status)?.[2] ?? 'Server error'
    res.writeHead(status)
    res.end(JSON.stringify({ err: message }))
}

export default function (req, res) {
    withRequestLog(req, res, () => router(req, res, function () {
        res.statusCode = 404;
        res.end();
    }));
}