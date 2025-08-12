import packageInfo from "../../package.json" with { type: "json" };

function getManifest(config = {}) {
    // Dynamic name and description based on debrid provider
    const providerName = config.DebridProvider || '';
    const dynamicName = providerName ? `Intelligent Debrid Search (${providerName})` : "Intelligent Debrid Search";
    const dynamicDescription = providerName 
        ? `A smarter Stremio add-on to search downloads and torrents in your Debrid cloud (${providerName}).`
        : packageInfo.description;
    
    const manifest = {
        id: "community.stremio.debrid-search",
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