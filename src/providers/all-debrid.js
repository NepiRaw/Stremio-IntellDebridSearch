/**
 * AllDebrid on the shared core.
 * Magnets and saved links form the library. Magnet files come from a bulk endpoint that takes 20
 * ids at a time, and only link/unlock takes the WARP proxy.
 */

import { request, hostOf } from './http.js';
import { toTorrent, toVideoFile } from './shapes.js';
import { SOURCE_KINDS, makeScopedLibraryIdentity, ownsLibraryItemId, ownsScopedLibraryIdentity, parseLibraryItemId, toLibraryItem } from './library-item.js';
import { normalizeTorrentFiles, flattenTree } from './paths.js';
import { classify, ProviderAuthError, ProviderItemGoneError } from './errors.js';
import { buildResolveUrl } from './resolve-url.js';
import { isVideo } from '../utils/file-types.js';
import { logger } from '../utils/logger.js';

export const name = 'AllDebrid';
export const capabilities = { filesInline: false, bulkFiles: true, directLinks: false };

export const ownsId = (id, apiKey) => {
    if (/^\d+$/.test(id)) return true;
    if (!ownsLibraryItemId(id, name, SOURCE_KINDS.SAVED_LINK)) return false;
    return ownsScopedLibraryIdentity(parseLibraryItemId(id).nativeIdentity, apiKey);
};

export const ownsLink = (link, itemId, apiKey) => {
    if (ownsLibraryItemId(itemId, name, SOURCE_KINDS.SAVED_LINK)) {
        if (!ownsId(itemId, apiKey)) return false;
        return parseLibraryItemId(itemId).nativeIdentity === makeScopedLibraryIdentity(link, apiKey);
    }
    return (itemId === undefined || /^\d+$/.test(itemId)) && hostOf(link) === 'alldebrid.com';
};

const BASE = 'https://api.alldebrid.com';
const AGENT = 'intell-debridsearch';
const FILES_BATCH = 20;
const READY = 4;

const endpoint = (version, path) => `${BASE}/${version}/${path}?agent=${AGENT}`;
const auth = apiKey => ({ authorization: `Bearer ${apiKey}` });
const posted = { 'content-type': 'application/x-www-form-urlencoded' };

const form = fields => {
    const body = new URLSearchParams();
    for (const [key, values] of Object.entries(fields)) {
        for (const value of [values].flat()) body.append(key, String(value));
    }
    return body;
};

const chunk = (items, size) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, i * size + size));

export async function validateKey(apiKey) {
    const { data } = await request({
        provider: name, operation: 'validateKey', apiKey,
        url: endpoint('v4', 'user'), headers: auth(apiKey)
    });
    const user = data.data?.user ?? {};
    return { ok: true, username: user.username, premium: Boolean(user.isPremium), premiumUntil: user.premiumUntil };
}

export async function listTorrents(apiKey) {
    const { data } = await request({
        provider: name, operation: 'listTorrents', endpointClass: 'list', apiKey,
        url: endpoint('v4.1', 'magnet/status'), headers: auth(apiKey)
    });

    return (data.data?.magnets ?? [])
        .filter(magnet => magnet.statusCode === READY && magnet.filename)
        .map(magnet => toTorrent({
            provider: name,
            id: magnet.id,
            name: magnet.filename,
            hash: magnet.hash,
            size: magnet.size,
            created: magnet.completionDate,
            fileCount: magnet.nbLinks
        }));
}

async function savedLinkRows(apiKey) {
    const { data } = await request({
        provider: name, operation: 'listSavedLinks', endpointClass: 'list', apiKey,
        url: endpoint('v4', 'user/links'), headers: auth(apiKey)
    });
    return Array.isArray(data.data?.links) ? data.data.links : [];
}

function toSavedLinkItem(row, apiKey) {
    return toLibraryItem({
        provider: name,
        sourceKind: SOURCE_KINDS.SAVED_LINK,
        nativeIdentity: makeScopedLibraryIdentity(row.link, apiKey),
        name: row.filename,
        size: row.size,
        created: row.date,
        fileCount: 1
    });
}

function toSavedLinkVideo(row, item, apiKey) {
    const [address] = normalizeTorrentFiles([row.filename], row.filename);
    return toVideoFile({
        provider: name,
        torrentId: item.id,
        fileId: 0,
        address,
        size: row.size,
        created: item.created,
        url: buildResolveUrl(name, apiKey, item.id, row.link),
        resolveRef: { link: row.link }
    });
}

export async function listSavedLinks(apiKey) {
    const rows = await savedLinkRows(apiKey);
    const items = rows
        .filter(row => row.link && row.filename && isVideo(row.filename))
        .map(row => toSavedLinkItem(row, apiKey));
    return [...new Map(items.map(item => [item.id, item])).values()];
}

export async function listLibraryItems(apiKey) {
    const savedLinksTask = listSavedLinks(apiKey).catch(error => {
        if (error instanceof ProviderAuthError) throw error;
        logger.warn(`[${name}] saved-link discovery unavailable: ${error.name} ${error.code ?? ''}`);
        return [];
    });
    const [torrents, savedLinks] = await Promise.all([listTorrents(apiKey), savedLinksTask]);
    return [
        ...torrents.map(torrent => ({ ...torrent, sourceKind: SOURCE_KINDS.TORRENT })),
        ...savedLinks
    ];
}

/** One magnet's tree to canonical video files. The tree is the only place folder names exist. */
function toVideos(magnet, torrent, apiKey) {
    const leaves = flattenTree(magnet.files);

    return normalizeTorrentFiles(leaves.map(leaf => leaf.path), torrent?.name)
        .map((address, index) => ({ address, leaf: leaves[index] }))
        .filter(entry => isVideo(entry.address.fileName))
        .map((entry, index) => toVideoFile({
            provider: name,
            torrentId: magnet.id,
            fileId: index,
            address: entry.address,
            size: entry.leaf.size,
            created: torrent?.created,
            url: buildResolveUrl(name, apiKey, magnet.id, entry.leaf.link),
            resolveRef: { link: entry.leaf.link }
        }));
}

export async function fetchFiles(apiKey, torrents) {
    const byId = new Map(torrents.map(torrent => [String(torrent.id), torrent]));
    const files = new Map();
    const savedLinks = [...byId.values()].filter(item => ownsLibraryItemId(item.id, name, SOURCE_KINDS.SAVED_LINK));
    const magnetIds = [...byId.keys()].filter(id => /^\d+$/.test(id));

    const savedLinksTask = savedLinks.length ? savedLinkRows(apiKey).then(rows => {
        const rowsById = new Map(rows
            .filter(row => row.link && row.filename && isVideo(row.filename))
            .map(row => {
                const item = toSavedLinkItem(row, apiKey);
                return [item.id, { item, row }];
            }));

        for (const requested of savedLinks) {
            const found = rowsById.get(String(requested.id));
            files.set(String(requested.id), found ? [toSavedLinkVideo(found.row, requested, apiKey)] : []);
        }
    }).catch(error => {
        if (error instanceof ProviderAuthError) throw error;
        logger.warn(`[${name}] saved-link files unavailable: ${error.name} ${error.code ?? ''}`);
        for (const requested of savedLinks) files.set(String(requested.id), []);
    }) : Promise.resolve();

    await Promise.all([savedLinksTask, ...chunk(magnetIds, FILES_BATCH).map(async batch => {
        const { data } = await request({
            provider: name, operation: 'fetchFiles', endpointClass: 'files', apiKey,
            url: endpoint('v4.1', 'magnet/files'), method: 'POST',
            headers: { ...auth(apiKey), ...posted },
            body: form({ 'id[]': batch })
        });

        for (const magnet of data.data?.magnets ?? []) {
            const torrent = byId.get(String(magnet.id));

            // A magnet deleted between listing and this call fails alone; the batch still answers.
            if (magnet.error) {
                const error = classify({ provider: name, operation: 'fetchFiles', status: 200, body: { status: 'error', error: magnet.error } });
                logger.debug(`[${name}] dropping torrent ${magnet.id}: ${error.name} ${error.code}`);
                continue;
            }

            files.set(String(magnet.id), toVideos(magnet, torrent, apiKey));
        }
    })]);

    return files;
}

/**
 * One library item with its files for the stateless meta route.
 */
export async function fetchTorrent(apiKey, torrentId) {
    if (ownsLibraryItemId(torrentId, name, SOURCE_KINDS.SAVED_LINK)) {
        if (!ownsId(torrentId, apiKey)) return null;
        const identity = parseLibraryItemId(torrentId).nativeIdentity;
        const rows = await savedLinkRows(apiKey);
        const row = rows.find(candidate => candidate.link && candidate.filename && isVideo(candidate.filename)
            && makeScopedLibraryIdentity(candidate.link, apiKey) === identity);
        if (!row) return null;

        const torrent = toSavedLinkItem(row, apiKey);
        return { torrent, videos: [toSavedLinkVideo(row, torrent, apiKey)] };
    }

    if (!/^\d+$/.test(torrentId)) return null;

    const { data } = await request({
        provider: name, operation: 'fetchTorrent', endpointClass: 'files', apiKey,
        url: `${endpoint('v4.1', 'magnet/status')}&id=${encodeURIComponent(torrentId)}`,
        headers: auth(apiKey)
    });

    const found = data.data?.magnets;
    const magnet = Array.isArray(found) ? found[0] : found;
    if (!magnet?.filename) return null;

    const torrent = toTorrent({
        provider: name,
        id: magnet.id,
        name: magnet.filename,
        hash: magnet.hash,
        size: magnet.size,
        created: magnet.completionDate,
        fileCount: magnet.nbLinks
    });

    return { torrent, videos: toVideos(magnet, torrent, apiKey) };
}

export async function resolveStream(apiKey, resolveRef) {
    if (!resolveRef?.link) {
        throw new ProviderItemGoneError(`[${name}] resolveStream: the reference carries no link`, { provider: name, operation: 'resolveStream' });
    }

    const { data } = await request({
        provider: name, operation: 'resolveStream', endpointClass: 'resolve', apiKey,
        url: endpoint('v4', 'link/unlock'), method: 'POST',
        headers: { ...auth(apiKey), ...posted },
        body: form({ link: resolveRef.link }),
        proxyUrl: process.env.ALLDEBRID_PROXY_URL || undefined
    });

    return data.data?.link;
}
