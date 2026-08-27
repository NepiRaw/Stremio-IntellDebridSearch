/**
 * The provider registry, the only import site consumers need.
 * Every provider is a module here, keyed by the name its config blob and its resolve URL use.
 */

import * as allDebrid from './all-debrid.js';
import * as realDebrid from './real-debrid.js';
import * as torBox from './torbox.js';
import * as debridLink from './debrid-link.js';
import * as premiumize from './premiumize.js';
import { SOURCE_KINDS } from './library-item.js';

const registry = new Map([
    [allDebrid.name, allDebrid],
    [realDebrid.name, realDebrid],
    [torBox.name, torBox],
    [debridLink.name, debridLink],
    [premiumize.name, premiumize]
]);

export function getProvider(name) {
    return registry.get(name);
}

export function migratedProviders() {
    return [...registry.keys()];
}

export async function listProviderLibrary(name, apiKey) {
    const module = registry.get(name);
    if (!module) return null;

    const items = module.listLibraryItems
        ? await module.listLibraryItems(apiKey)
        : await module.listTorrents(apiKey);
    return items.map(item => item.sourceKind ? item : { ...item, sourceKind: SOURCE_KINDS.TORRENT });
}

/**
 * Files for a batch of torrents, in the {id -> torrent with videos} form the stream and search
 * phases already consume. Returns null for a name the registry does not hold.
 */
export async function fetchTorrentDetails(name, apiKey, torrents) {
    const module = registry.get(name);
    if (!module) return null;

    const files = await module.fetchFiles(apiKey, torrents);
    return new Map(torrents.map(torrent => [String(torrent.id), { ...torrent, videos: files.get(String(torrent.id)) ?? [] }]));
}
