/**
 * Premiumize on the shared core.
 * A transfer is either one file or a folder, and a folder is opened by id: a transfer's folder can
 * sit anywhere in the drive, so its files carry an ancestor's path and nothing here may be matched
 * by name. The library is one call, and a folder is only opened for the torrents a search keeps.
 */

import { request } from './http.js';
import { toTorrent, toVideoFile } from './shapes.js';
import { normalizeTorrentFiles } from './paths.js';
import { ProviderAuthError, ProviderItemGoneError } from './errors.js';
import { buildResolveUrl } from './resolve-url.js';
import { isVideo } from '../utils/file-types.js';
import { logger } from '../utils/logger.js';

export const name = 'Premiumize';
export const capabilities = { filesInline: false, bulkFiles: false, directLinks: false };

/** Transfer ids are base64url. A broad alphabet, so this rejects little beyond punctuation. */
export const ownsId = id => /^[A-Za-z0-9_-]+$/.test(id);

export const ownsLink = link => /^[A-Za-z0-9_-]+$/.test(link);

const BASE = 'https://www.premiumize.me/api';

const WALK_CONCURRENCY = 6;
const MAX_DEPTH = 4;

/** Which transfer a canonical torrent came from, kept off the shape so nothing serialises it. */
const transfers = new WeakMap();

async function api(apiKey, path, params, operation, endpointClass = 'list') {
    const query = new URLSearchParams({ apikey: apiKey, ...params });
    const { data } = await request({
        provider: name, operation, endpointClass, apiKey,
        url: `${BASE}/${path}?${query}`
    });
    return data;
}

export async function validateKey(apiKey) {
    const data = await api(apiKey, 'account/info', {}, 'validateKey', 'default');
    return { ok: true, username: data?.customer_id, premium: Number(data?.premium_until) * 1000 > Date.now(), premiumUntil: data?.premium_until };
}

/** Runs the tasks with at most `limit` in flight, so one deep folder cannot open every call at once. */
async function pooled(tasks, limit) {
    const results = [];
    for (let index = 0; index < tasks.length; index += limit) {
        results.push(...await Promise.all(tasks.slice(index, index + limit).map(task => task())));
    }
    return results;
}

/**
 * Every file below a folder, addressed by id and carrying the path walked to reach it.
 * The walk is what makes the grouping exact, since the drive path cannot identify a transfer.
 */
async function walk(apiKey, folderId, operation, prefix = null, depth = 0) {
    if (depth > MAX_DEPTH) return [];

    const answer = await api(apiKey, 'folder/list', { id: folderId }, operation, 'files');
    const content = answer?.content ?? [];
    // The transfer's own folder is the container, so it heads every path: without it a first
    // subfolder would look like the container and be stripped as one.
    const here = prefix ?? (answer?.name ? [answer.name] : []);

    const files = content.filter(item => item.type === 'file').map(item => ({ ...item, path: [...here, item.name].join('/') }));
    const folders = content.filter(item => item.type === 'folder');

    const nested = await pooled(
        folders.map(folder => () => walk(apiKey, folder.id, operation, [...here, folder.name], depth + 1)),
        WALK_CONCURRENCY
    );
    return [...files, ...nested.flat()];
}

/**
 * The library, in one call. Sizes and dates live on the files rather than the transfer, and the
 * deployed catalog already sends neither, so nothing is lost by opening a folder only when needed.
 */
export async function listTorrents(apiKey) {
    const rows = (await api(apiKey, 'transfer/list', {}, 'listTorrents'))?.transfers ?? [];

    // The same content can be transferred twice, which leaves two transfers pointing at one folder.
    const unique = new Map();
    for (const row of rows) {
        if (row.status !== 'finished' || !row.name || !(row.folder_id || row.file_id)) continue;
        const id = String(row.folder_id ?? row.file_id);
        if (!unique.has(id)) unique.set(id, row);
    }

    return [...unique.values()].map(row => {
        const torrent = toTorrent({ provider: name, id: row.folder_id ?? row.file_id, name: row.name, size: 0 });
        transfers.set(torrent, { folderId: row.folder_id ?? null, fileId: row.file_id ?? null });
        return torrent;
    });
}

function toVideos(torrent, files, apiKey) {
    const addresses = normalizeTorrentFiles(files.map(file => file.path ?? file.name), torrent.name);

    return files
        .map((file, index) => ({ file, address: addresses[index] }))
        .filter(entry => isVideo(entry.address.fileName))
        .map(entry => toVideoFile({
            provider: name,
            torrentId: torrent.id,
            fileId: entry.file.id,
            address: entry.address,
            size: entry.file.size,
            created: entry.file.created_at,
            url: buildResolveUrl(name, apiKey, torrent.id, String(entry.file.id)),
            resolveRef: { fileId: String(entry.file.id) }
        }));
}

async function details(apiKey, fileId, operation) {
    const found = await api(apiKey, 'item/details', { id: fileId }, operation, 'files');
    return found?.name ? [{ id: fileId, name: found.name, size: found.size, created_at: found.created_at, path: found.name }] : [];
}

/**
 * The files of one transfer. A folder is walked, a single file is asked for directly, and when the
 * caller hands over a copy rather than the object the listing returned, both are tried in turn.
 */
async function filesOf(apiKey, torrent, operation) {
    const known = transfers.get(torrent);
    const id = String(torrent.id);

    if (known?.folderId) return walk(apiKey, known.folderId, operation);
    if (known?.fileId) return details(apiKey, known.fileId, operation);

    const walked = await walk(apiKey, id, operation).catch(() => []);
    return walked.length ? walked : details(apiKey, id, operation).catch(() => []);
}

export async function fetchFiles(apiKey, torrentList) {
    const files = new Map();

    await pooled(torrentList.map(torrent => async () => {
        const id = String(torrent.id);
        try {
            files.set(id, toVideos(torrent, await filesOf(apiKey, torrent, 'fetchFiles'), apiKey));
        } catch (error) {
            if (error instanceof ProviderAuthError) throw error;
            logger.debug(`[${name}] dropping torrent ${id}: ${error.name} ${error.code ?? error.status ?? ''}`);
            files.set(id, []);
        }
    }), WALK_CONCURRENCY);

    return files;
}

/** One torrent with its files, for the meta route. The id is a folder id or a file id. */
export async function fetchTorrent(apiKey, torrentId) {
    const folder = await api(apiKey, 'folder/list', { id: torrentId }, 'fetchTorrent', 'files').catch(() => null);

    if (folder?.content) {
        const files = await walk(apiKey, torrentId, 'fetchTorrent');
        if (files.length) {
            const torrent = toTorrent({ provider: name, id: torrentId, name: folder.name ?? '', size: files.reduce((total, file) => total + (Number(file.size) || 0), 0) });
            return { torrent, videos: toVideos(torrent, files, apiKey) };
        }
    }

    const single = await details(apiKey, torrentId, 'fetchTorrent').catch(() => []);
    if (!single.length) return null;

    const torrent = toTorrent({ provider: name, id: torrentId, name: single[0].name, size: single[0].size, created: single[0].created_at });
    return { torrent, videos: toVideos(torrent, single, apiKey) };
}

export async function resolveStream(apiKey, resolveRef) {
    // At play time the reference is rebuilt from the URL, so the file id arrives as `link`.
    const fileId = resolveRef?.fileId ?? resolveRef?.link;
    if (!fileId) {
        throw new ProviderItemGoneError(`[${name}] resolveStream: the reference names no file`, { provider: name, operation: 'resolveStream' });
    }

    const found = await api(apiKey, 'item/details', { id: fileId }, 'resolveStream', 'resolve');
    return found?.stream_link || found?.link;
}
