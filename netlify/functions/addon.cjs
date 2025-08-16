/**
 * Netlify function that handles Stremio addon routing without ES modules
 * This is a direct implementation that doesn't depend on serverless.js
 */

// Manifest configuration
const addonManifest = {
    id: 'com.stremio.intelldebridsearch',
    name: 'IntellDebrid Search',
    version: '1.0.0',
    description: 'Search for cached content on debrid services',
    types: ['movie', 'series'],
    catalogs: [],
    resources: ['stream'],
    idPrefixes: ['tt'],
    behaviorHints: {
        notWebReady: false
    }
};

function parseConfiguration(configString) {
    if (!configString) return {};
    
    try {
        const decoded = Buffer.from(configString, 'base64').toString('utf-8');
        return JSON.parse(decoded);
    } catch (error) {
        console.error('Failed to parse configuration:', error);
        return {};
    }
}

function createLandingHTML(manifest, config) {
    return `<!DOCTYPE html>
<html>
<head>
    <title>${manifest.name}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; }
        .container { max-width: 600px; margin: 0 auto; }
        .config { background: #f5f5f5; padding: 20px; margin: 20px 0; }
        .addon-url { word-break: break-all; background: #e8f4f8; padding: 10px; }
    </style>
</head>
<body>
    <div class="container">
        <h1>${manifest.name}</h1>
        <p>${manifest.description}</p>
        
        <div class="config">
            <h3>Configuration:</h3>
            <pre>${JSON.stringify(config, null, 2)}</pre>
        </div>
        
        <div class="addon-url">
            <h3>Addon URL for Stremio:</h3>
            <p>https://stremio-intelldebridsearch.netlify.app/[CONFIG]/manifest.json</p>
        </div>
        
        <p>This addon searches for cached content on debrid services.</p>
    </div>
</body>
</html>`;
}

exports.handler = async (event, context) => {
    const { httpMethod, path, queryStringParameters, headers } = event;
    
    console.log(`Request: ${httpMethod} ${path}`);
    
    // CORS headers
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept, Authorization, Cache-Control'
    };
    
    // Handle preflight requests
    if (httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: corsHeaders,
            body: ''
        };
    }
    
    // Parse the path to extract configuration
    const pathParts = path.split('/').filter(part => part.length > 0);
    let configString = '';
    let route = '';
    
    if (pathParts.length === 0) {
        // Root path
        route = 'configure';
    } else if (pathParts.length === 1) {
        // Could be /configure or /manifest.json
        if (pathParts[0] === 'configure' || pathParts[0] === 'manifest.json') {
            route = pathParts[0];
        } else {
            // Treat as configuration with default route
            configString = pathParts[0];
            route = 'configure';
        }
    } else {
        // Multiple parts: first is config, second is route
        configString = pathParts[0];
        route = pathParts[1];
    }
    
    console.log(`Parsed - Config: ${configString ? 'present' : 'none'}, Route: ${route}`);
    
    const config = parseConfiguration(configString);
    
    try {
        switch (route) {
            case '':
            case 'configure':
                return {
                    statusCode: 200,
                    headers: {
                        ...corsHeaders,
                        'Content-Type': 'text/html'
                    },
                    body: createLandingHTML(addonManifest, config)
                };
            
            case 'manifest.json':
                // Return manifest with configuration
                const manifest = {
                    ...addonManifest,
                    name: config.DebridProvider ? 
                        `${addonManifest.name} (${config.DebridProvider})` : 
                        addonManifest.name
                };
                
                return {
                    statusCode: 200,
                    headers: {
                        ...corsHeaders,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(manifest)
                };
            
            default:
                return {
                    statusCode: 404,
                    headers: {
                        ...corsHeaders,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        error: 'Not found',
                        path: path,
                        route: route,
                        available_routes: ['configure', 'manifest.json']
                    })
                };
        }
    } catch (error) {
        console.error('Handler error:', error);
        return {
            statusCode: 500,
            headers: {
                ...corsHeaders,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                error: 'Internal server error',
                message: error.message
            })
        };
    }
};