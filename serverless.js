import Router from 'router'
import addonInterface from "./addon.js"
import landingTemplate from "./public/landing-template.js"
import StreamProvider from './src/stream-provider.js'
import { decode } from 'urlencode'
import qs from 'querystring'
import requestIp from 'request-ip'
import { getManifest } from './src/config/manifest.js'
import { parseConfiguration } from './src/config/configuration.js'
import { BadTokenError, BadRequestError, AccessDeniedError } from './src/utils/error-handler.js'

const router = new Router();

router.get('/', (_, res) => {
    res.redirect('/configure')
})

router.get('/:configuration?/configure', (req, res) => {
    const config = parseConfiguration(req.params.configuration)
    const landingHTML = landingTemplate(addonInterface.manifest, config)
    res.setHeader('content-type', 'text/html')
    res.end(landingHTML)
})

router.get('/:configuration?/manifest.json', (req, res) => {
    const config = parseConfiguration(req.params.configuration)
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.end(JSON.stringify(getManifest(config)))
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
            console.error(err)
            handleError(err, res)
        })
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
    // Add CORS headers for Stremio v5/web compatibility
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, Cache-Control')
    res.setHeader('Access-Control-Allow-Credentials', 'false')
    
    const clientIp = requestIp.getClientIp(req)
    StreamProvider.resolveUrl(req.params.debridProvider, req.params.debridApiKey, req.params.id, decode(req.params.hostUrl), clientIp)
        .then(url => {
            res.redirect(url)
        })
        .catch(err => {
            console.log(err)
            handleError(err, res)
        })
})

router.get('/ping', (_, res) => {
    res.statusCode = 200
    res.end()
})

function handleError(err, res) {
    if (err == BadTokenError) {
        res.writeHead(401)
        res.end(JSON.stringify({ err: 'Bad token' }))
    } else if (err == AccessDeniedError) {
        res.writeHead(403)
        res.end(JSON.stringify({ err: 'Access denied' }))
    } else if (err == BadRequestError) {
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