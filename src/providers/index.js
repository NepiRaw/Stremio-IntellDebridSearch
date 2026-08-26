/**
 * The provider registry, the only import site consumers need.
 * A provider appears here once its module is implemented and tested; until then the consumers fall
 * back to the legacy classes, so the migration runs one provider at a time.
 */

import * as allDebrid from './all-debrid.js';
import * as realDebrid from './real-debrid.js';
import * as torBox from './torbox.js';
import * as debridLink from './debrid-link.js';

const registry = new Map([
    [allDebrid.name, allDebrid],
    [realDebrid.name, realDebrid],
    [torBox.name, torBox],
    [debridLink.name, debridLink]
]);

export function getProvider(name) {
    return registry.get(name);
}

export function migratedProviders() {
    return [...registry.keys()];
}

/**
 * Files for a batch of torrents, in the {id -> torrent with videos} form the stream and search
 * phases already consume. Returns null when the provider has not migrated, so a caller can fall
 * back without knowing anything about the registry.
 */
export async function fetchTorrentDetails(name, apiKey, torrents) {
    const module = registry.get(name);
    if (!module) return null;

    const files = await module.fetchFiles(apiKey, torrents);
    return new Map(torrents.map(torrent => [String(torrent.id), { ...torrent, videos: files.get(String(torrent.id)) ?? [] }]));
}
