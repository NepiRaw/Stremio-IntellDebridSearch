import packageInfo from "../../package.json" with { type: "json" };

// Provider name mapping to short codes
const PROVIDER_SHORT_NAMES = {
    'AllDebrid': 'AD',
    'RealDebrid': 'RD', 
    'Torbox': 'TB',
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
    
    const manifest = {
        id: "community.stremio.intell-debrid-search",
        version: packageInfo.version,
        name: dynamicName,
        description: dynamicDescription,
        logo: `https://img.icons8.com/fluency/256/search-in-cloud.png`,
        catalogs: getCatalogs(config),
        resources: [
            "catalog",
            "stream"
        ],
        types: [
            "movie",
            "series",
            'anime',
            "other"
        ],
        idPrefixes: ['tt'],
        behaviorHints: {
            configurable: true,
            configurationRequired: isConfigurationRequired(config)
        },
    }

    return manifest
}

function getCatalogs(config) {
    if (!(config && config.DebridProvider)) {
        return []
    }

    return [
        {
            "id": `IntellDebridSearch`,
            "name": `Intelligent Debrid Search - ${config.DebridProvider}`,
            "type": "other",
            "extra": [
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