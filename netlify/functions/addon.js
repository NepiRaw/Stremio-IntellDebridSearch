/**
 * Simple Netlify function using Stremio addon SDK with ES module support
 */

const { getRouter } = require('stremio-addon-sdk');

module.exports.handler = async (event, context) => {
    try {
        // Dynamic import for ES modules
        const addonModule = await import('../../addon.js');
        const addonInterface = addonModule.default || addonModule;
        
        // Create the router using Stremio addon SDK
        const router = getRouter(addonInterface);
        
        return new Promise((resolve, reject) => {
            // Create Express-like request/response objects
            const req = {
                method: event.httpMethod,
                url: event.path + (event.queryStringParameters ? '?' + new URLSearchParams(event.queryStringParameters).toString() : ''),
                path: event.path,
                headers: event.headers || {},
                query: event.queryStringParameters || {}
            };
            
            let responseData = {
                statusCode: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                    'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept, Authorization, Cache-Control'
                },
                body: ''
            };
            
            const res = {
                setHeader: (name, value) => {
                    responseData.headers[name] = value;
                },
                writeHead: (statusCode, headers) => {
                    responseData.statusCode = statusCode;
                    if (headers) {
                        Object.assign(responseData.headers, headers);
                    }
                },
                end: (data) => {
                    responseData.body = data || '';
                    resolve(responseData);
                },
                redirect: (url) => {
                    responseData.statusCode = 302;
                    responseData.headers['Location'] = url;
                    responseData.body = '';
                    resolve(responseData);
                }
            };
            
            // Call the Stremio addon router
            router(req, res, () => {
                // 404 handler
                responseData.statusCode = 404;
                responseData.body = JSON.stringify({ error: 'Not found' });
                resolve(responseData);
            });
        });
        
    } catch (error) {
        console.error('Handler error:', error);
        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({
                error: 'Failed to load addon',
                message: error.message
            })
        };
    }
};
