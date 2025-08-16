/**
 * Netlify Functions adapter for Stremio IntellDebrid Search addon
 * This wraps our existing Express router for Netlify's serverless function format
 */

import serverlessApp from '../../serverless.js'

export const handler = async (event, context) => {
    // Convert Netlify event to Express-like request
    const { httpMethod, path, queryStringParameters, headers, body } = event
    
    // Create a mock request object
    const req = {
        method: httpMethod,
        url: path + (queryStringParameters ? '?' + new URLSearchParams(queryStringParameters).toString() : ''),
        path: path,
        query: queryStringParameters || {},
        headers: headers || {},
        body: body,
        params: {}, // Will be filled by router
        ip: headers['x-forwarded-for']?.split(',')[0] || headers['client-ip'] || context.clientContext?.ip || '127.0.0.1'
    }
    
    // Create a mock response object
    let responseData = {
        statusCode: 200,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept, Authorization, Cache-Control'
        },
        body: ''
    }
    
    const res = {
        statusCode: 200,
        writeHead: (code, headers) => {
            responseData.statusCode = code
            if (headers) {
                responseData.headers = { ...responseData.headers, ...headers }
            }
        },
        setHeader: (name, value) => {
            responseData.headers[name] = value
        },
        end: (data) => {
            if (data) {
                responseData.body = data
            }
        },
        redirect: (url) => {
            responseData.statusCode = 302
            responseData.headers['Location'] = url
            responseData.body = ''
        },
        status: (code) => {
            responseData.statusCode = code
            return res
        }
    }
    
    try {
        // Call our existing serverless app
        await new Promise((resolve, reject) => {
            serverlessApp(req, res, (err) => {
                if (err) reject(err)
                else resolve()
            })
        })
        
        return responseData
        
    } catch (error) {
        console.error('Netlify function error:', error)
        
        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({ error: 'Internal server error' })
        }
    }
}
