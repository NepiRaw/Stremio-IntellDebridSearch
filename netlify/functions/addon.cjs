/**
 * Netlify function that wraps the existing serverless.js router
 */

exports.handler = async (event, context) => {
    try {
        console.log(`Netlify request: ${event.httpMethod} ${event.path}`);
        console.log('Working directory:', process.cwd());
        console.log('__dirname:', __dirname);
        
        // Handle CORS preflight requests
        if (event.httpMethod === 'OPTIONS') {
            return {
                statusCode: 200,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                    'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept, Authorization, Cache-Control'
                },
                body: ''
            };
        }
        
        // Import the serverless module dynamically
        const path = require('path');
        const fs = require('fs');
        const { pathToFileURL } = require('url');
        
        // Try multiple possible paths for serverless.js
        const possiblePaths = [
            path.resolve(process.cwd(), 'serverless.js'),
            path.resolve(__dirname, '../../serverless.js'),
            path.resolve(__dirname, '../serverless.js'),
            path.resolve('/var/task', 'serverless.js')
        ];
        
        let serverlessPath = null;
        for (const testPath of possiblePaths) {
            console.log('Testing path:', testPath);
            if (fs.existsSync(testPath)) {
                serverlessPath = testPath;
                console.log('Found serverless.js at:', serverlessPath);
                break;
            }
        }
        
        if (!serverlessPath) {
            throw new Error('serverless.js not found in any expected location');
        }
        
        // Convert to file:// URL for Windows compatibility
        const serverlessURL = pathToFileURL(serverlessPath).href;
        console.log('Importing from URL:', serverlessURL);
        const { default: serverlessRouter } = await import(serverlessURL);
        
        return new Promise((resolve, reject) => {
            const { path, queryStringParameters, headers, httpMethod, body } = event;
            
            const req = {
                method: httpMethod,
                url: path + (queryStringParameters ? '?' + new URLSearchParams(queryStringParameters).toString() : ''),
                path: path,
                originalUrl: path + (queryStringParameters ? '?' + new URLSearchParams(queryStringParameters).toString() : ''),
                headers: headers || {},
                query: queryStringParameters || {},
                body: body || '',
                params: {}, // Will be populated by router during route matching
                ip: headers['x-forwarded-for']?.split(',')[0] || 
                    headers['client-ip'] || 
                    context.clientContext?.ip || 
                    '127.0.0.1'
            };
            
            // Add Express-like methods
            req.get = function(name) {
                return this.headers[name?.toLowerCase()];
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
            
            // Create Express-like response object
            const res = {
                headersSent: false,
                statusCode: 200,
                
                setHeader: function(name, value) {
                    responseData.headers[name] = value;
                },
                
                writeHead: function(statusCode, headers) {
                    this.statusCode = statusCode;
                    responseData.statusCode = statusCode;
                    if (headers) {
                        Object.assign(responseData.headers, headers);
                    }
                    this.headersSent = true;
                },
                
                end: function(data) {
                    if (!this.headersSent) {
                        responseData.statusCode = this.statusCode;
                    }
                    responseData.body = data || '';
                    this.headersSent = true;
                    resolve(responseData);
                },
                
                redirect: function(url) {
                    responseData.statusCode = 302;
                    responseData.headers['Location'] = url;
                    responseData.body = '';
                    this.headersSent = true;
                    resolve(responseData);
                },
                
                status: function(code) {
                    this.statusCode = code;
                    responseData.statusCode = code;
                    return this;
                },
                
                json: function(obj) {
                    responseData.headers['Content-Type'] = 'application/json';
                    responseData.body = JSON.stringify(obj);
                    this.headersSent = true;
                    resolve(responseData);
                },
                
                send: function(data) {
                    responseData.body = data || '';
                    this.headersSent = true;
                    resolve(responseData);
                }
            };
            
            console.log(`Calling serverless router with: ${req.method} ${req.url}`);
            
            // Call the existing serverless router
            serverlessRouter(req, res, (err) => {
                if (err) {
                    console.error('Router error:', err);
                    if (!res.headersSent) {
                        responseData.statusCode = 500;
                        responseData.body = JSON.stringify({ 
                            error: 'Internal server error', 
                            message: err.message 
                        });
                        resolve(responseData);
                    }
                } else {
                    // If we get here and haven't sent a response, it's a 404
                    if (!res.headersSent) {
                        responseData.statusCode = 404;
                        responseData.body = JSON.stringify({ 
                            error: 'Route not found', 
                            path: req.path,
                            method: req.method,
                            available_routes: ['/', '/configure', '/:configuration/configure', '/:configuration/manifest.json']
                        });
                        resolve(responseData);
                    }
                }
            });
            
            // Safety timeout (Netlify has 26s limit)
            setTimeout(() => {
                if (!res.headersSent) {
                    console.error('Request timeout after 25 seconds');
                    responseData.statusCode = 504;
                    responseData.body = JSON.stringify({ 
                        error: 'Request timeout',
                        timeout: '25s' 
                    });
                    resolve(responseData);
                }
            }, 25000);
        });
        
    } catch (error) {
        console.error('Netlify function error:', error);
        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({
                error: 'Function initialization error',
                message: error.message,
                stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
            })
        };
    }
};