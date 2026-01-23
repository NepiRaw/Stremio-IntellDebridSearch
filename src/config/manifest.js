import packageInfo from "../../package.json" with { type: "json" };

const PROVIDER_SHORT_NAMES = {
    'AllDebrid': 'AD',
    'RealDebrid': 'RD', 
    'TorBox': 'TB',
    'DebridLink': 'DL',
    'Premiumize': 'PM'
};

function getProviderShortName(providerName) {
    return PROVIDER_SHORT_NAMES[providerName] || providerName;
}

function getManifest(config = {}) {
    const providerName = config.DebridProvider || '';
    const shortProviderName = getProviderShortName(providerName);
    const dynamicName = providerName ? `Intelligent Debrid Search (${shortProviderName})` : "Intelligent Debrid Search";
    const dynamicDescription = providerName 
        ? `A smarter Stremio add-on to search downloads and torrents in your Debrid cloud (${providerName}).`
        : packageInfo.description;
    
    const idPrefixes = ['tt'];
    if (config.DebridProvider) {
        idPrefixes.push(config.DebridProvider.toLowerCase());
    }
    
    const manifest = {
        id: "community.stremio.intell-debrid-search",
        version: packageInfo.version,
        name: dynamicName,
        description: dynamicDescription,
        logo: `https://img.icons8.com/fluency/256/search-in-cloud.png`,
        resources: ['catalog', 'stream', 'meta'],
        types: [
            "movie",
            "series",
            'anime',
            "other"
        ],
        catalogs: getCatalogs(config),
        idPrefixes: idPrefixes,
        behaviorHints: {
            configurable: true,
            configurationRequired: isConfigurationRequired(config)
        },
        stremioAddonsConfig: {
            issuer: "https://stremio-addons.net",
            signature: "eyJhbGciOiJkaXIiLCJlbmMiOiJBMTI4Q0JDLUhTMjU2In0..Ctj1eME09X-XiyOXZr753A.9Mcoi4N9S3iPrzorFKSYXy1CtBPchxhBpizzjEr2DXWQ5McpFkybSkuBD62azwSBx0YJzLS109mjYQjgOMxkXMg6EVP1lyQQtpHLfoajJwCD2pBo6okvbt45aKWKP2WT.kf8IPdPoLTm4YpaL6fQaKA"
        }
    }

    return manifest
}

function getCatalogs(config) {
    return [
        {
            type: 'other',
            id: 'IntellDebridSearch',
            name: config && config.DebridProvider 
                ? `Intelligent Debrid Search - ${config.DebridProvider}`
                : 'Intelligent Debrid Search',
            extra: [
                { "name": "search", "isRequired": false },
                { "name": "skip", "isRequired": false }
            ]
        }
    ]
}

function isConfigurationRequired(config) {
    return !(config && config.DebridProvider)
}

export { getManifest }