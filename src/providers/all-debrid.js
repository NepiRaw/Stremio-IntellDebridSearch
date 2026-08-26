/**
 * AllDebrid on the shared core.
 * The library is one call, files come from a bulk endpoint that takes 20 ids at a time, and only
 * link/unlock is refused from a datacenter address, so only that call takes the WARP proxy.
 */

import { request } from './http.js';
import { toTorrent, toVideoFile } from './shapes.js';
import { normalizeTorrentFiles, flattenTree } from './paths.js';
import { classify, ProviderItemGoneError } from './errors.js';
import { buildResolveUrl } from './resolve-url.js';
import { isVideo } from '../utils/file-types.js';
import { logger } from '../utils/logger.js';

export const name = 'AllDebrid';
export const capabilities = { filesInline: false, bulkFiles: true, directLinks: false };

/** Magnet ids are integers, so anything else in our id namespace was minted by someone else. */
export const ownsId = id => /^\d+$/.test(id);

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

    await Promise.all(chunk([...byId.keys()], FILES_BATCH).map(async batch => {
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
    }));

    return files;
}

/**
 * One torrent with its files, for the meta route. `magnet/status?id=` answers with the magnet's
 * name and its file tree in a single call.
 */
export async function fetchTorrent(apiKey, torrentId) {
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
