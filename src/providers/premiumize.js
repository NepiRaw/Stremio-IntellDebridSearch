/**
 * Premiumize on the shared core.
 * The durable drive is the library: transfer history is job state that can be cleared while the
 * files remain, so it says what was downloaded rather than what the account holds. One listing
 * carries every file with its path, size and date, which makes the file phase free.
 *
 * Videos are grouped by their top-level folder, because that folder is what was downloaded and its
 * name is what the parser and title matching read; a deeper folder is named for a season and states
 * no title. A video at the drive root is its own item, under its own file id.
 */

import { request } from './http.js';
import { toTorrent, toVideoFile } from './shapes.js';
import { SOURCE_KINDS, makeScopedLibraryIdentity, ownsLibraryItemId, ownsScopedLibraryIdentity, parseLibraryItemId, toLibraryItem } from './library-item.js';
import { normalizeTorrentFiles } from './paths.js';
import { ProviderAuthError, ProviderItemGoneError } from './errors.js';
import { buildResolveUrl } from './resolve-url.js';
import { isVideo } from '../utils/file-types.js';
import { logger } from '../utils/logger.js';

export const name = 'Premiumize';
export const capabilities = { filesInline: true, bulkFiles: false, directLinks: false };

/** Folder and file ids are base64url */
const NATIVE_ID = /^[A-Za-z0-9_-]+$/;

/** A folder group has no id of its own, so its name is scoped to the account rather than exposed. */
function cloudGroupIdentity(itemId, apiKey) {
    if (!ownsLibraryItemId(itemId, name, SOURCE_KINDS.CLOUD_FILE)) return null;
    const { nativeIdentity } = parseLibraryItemId(itemId);
    return ownsScopedLibraryIdentity(nativeIdentity, apiKey) ? nativeIdentity : null;
}

export const ownsId = (id, apiKey) => NATIVE_ID.test(id) || cloudGroupIdentity(id, apiKey) !== null;

export const ownsLink = link => NATIVE_ID.test(link);

const BASE = 'https://www.premiumize.me/api';

const WALK_CONCURRENCY = 6;
const MAX_DEPTH = 4;

/** The drive rows a listed item was built from, kept off the shape so nothing serialises them. */
const inlineFiles = new WeakMap();

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

const segmentsOf = row => String(row.path ?? row.name ?? '').split('/').filter(Boolean);
const leafOf = row => segmentsOf(row).at(-1) ?? '';

function toGroupItem(folderName, rows, apiKey) {
    const item = toLibraryItem({
        provider: name,
        sourceKind: SOURCE_KINDS.CLOUD_FILE,
        nativeIdentity: makeScopedLibraryIdentity(folderName, apiKey),
        name: folderName,
        size: rows.reduce((total, row) => total + (Number(row.size) || 0), 0),
        created: rows.reduce((newest, row) => Math.max(newest, Number(row.created_at) || 0), 0),
        fileCount: rows.length
    });
    inlineFiles.set(item, rows);
    return item;
}

function toRootItem(row) {
    const item = {
        ...toTorrent({ provider: name, id: row.id, name: row.name, size: row.size, created: row.created_at, fileCount: 1 }),
        sourceKind: SOURCE_KINDS.CLOUD_FILE
    };
    inlineFiles.set(item, [row]);
    return item;
}

/** Every playable item the drive holds, from one listing. */
function toCloudItems(rows, apiKey) {
    const groups = new Map();
    const rootItems = [];

    for (const row of rows) {
        if (!row?.id || !row.name || !isVideo(leafOf(row))) continue;

        const segments = segmentsOf(row);
        if (segments.length < 2) {
            rootItems.push(toRootItem(row));
            continue;
        }
        if (!groups.has(segments[0])) groups.set(segments[0], []);
        groups.get(segments[0]).push(row);
    }

    return [...[...groups].map(([folderName, groupRows]) => toGroupItem(folderName, groupRows, apiKey)), ...rootItems];
}

const driveRows = async (apiKey, operation) => (await api(apiKey, 'item/listall', {}, operation))?.files ?? [];

export async function listLibraryItems(apiKey) {
    return toCloudItems(await driveRows(apiKey, 'listLibraryItems'), apiKey);
}

export const listTorrents = listLibraryItems;

/**
 * Every file below a folder, addressed by id and carrying the path walked to reach it.
 * Only a legacy catalog id reaches this: a listed item already carries its own rows.
 */
async function walk(apiKey, folderId, operation, prefix = null, depth = 0) {
    if (depth > MAX_DEPTH) return [];

    const answer = await api(apiKey, 'folder/list', { id: folderId }, operation, 'files');
    const content = answer?.content ?? [];
    // The folder itself is the container, so it heads every path: without it a first subfolder
    // would look like the container and be stripped as one.
    const here = prefix ?? (answer?.name ? [answer.name] : []);

    const files = content.filter(item => item.type === 'file').map(item => ({ ...item, path: [...here, item.name].join('/') }));
    const folders = content.filter(item => item.type === 'folder');

    const nested = await pooled(
        folders.map(folder => () => walk(apiKey, folder.id, operation, [...here, folder.name], depth + 1)),
        WALK_CONCURRENCY
    );
    return [...files, ...nested.flat()];
}

function toVideos(item, rows, apiKey) {
    const addresses = normalizeTorrentFiles(rows.map(row => row.path ?? row.name), item.name);

    return rows
        .map((row, index) => ({ row, address: addresses[index] }))
        .filter(entry => isVideo(entry.address.fileName))
        .map(entry => toVideoFile({
            provider: name,
            torrentId: item.id,
            fileId: entry.row.id,
            address: entry.address,
            size: entry.row.size,
            created: entry.row.created_at ?? item.created,
            url: buildResolveUrl(name, apiKey, item.id, String(entry.row.id)),
            resolveRef: { fileId: String(entry.row.id) }
        }));
}

async function details(apiKey, fileId, operation) {
    const found = await api(apiKey, 'item/details', { id: fileId }, operation, 'files');
    return found?.name ? [{ id: fileId, name: found.name, size: found.size, created_at: found.created_at, path: found.name }] : [];
}

/** A legacy catalog id names either a folder or a single file, and only trying says which. */
async function legacyRows(apiKey, itemId, operation) {
    const walked = await walk(apiKey, itemId, operation).catch(() => []);
    return walked.length ? walked : details(apiKey, itemId, operation).catch(() => []);
}

export async function fetchFiles(apiKey, items) {
    const files = new Map();
    const pending = [];

    for (const item of items) {
        const id = String(item.id);
        const rows = inlineFiles.get(item);
        if (rows) files.set(id, toVideos(item, rows, apiKey));
        else pending.push(item);
    }

    // A group that arrived without its rows is rebuilt from one listing, however many were asked for.
    const groups = pending.filter(item => cloudGroupIdentity(item.id, apiKey) !== null);
    if (groups.length) {
        try {
            const listed = new Map(toCloudItems(await driveRows(apiKey, 'fetchFiles'), apiKey).map(item => [item.id, item]));
            for (const item of groups) {
                const found = listed.get(String(item.id));
                files.set(String(item.id), found ? toVideos(found, inlineFiles.get(found), apiKey) : []);
            }
        } catch (error) {
            if (error instanceof ProviderAuthError) throw error;
            logger.warn(`[${name}] drive listing unavailable: ${error.name} ${error.code ?? ''}`);
            for (const item of groups) files.set(String(item.id), []);
        }
    }

    await pooled(pending.filter(item => !groups.includes(item)).map(item => async () => {
        const id = String(item.id);
        try {
            files.set(id, toVideos(item, await legacyRows(apiKey, id, 'fetchFiles'), apiKey));
        } catch (error) {
            if (error instanceof ProviderAuthError) throw error;
            logger.debug(`[${name}] dropping library item ${id}: ${error.name} ${error.code ?? error.status ?? ''}`);
            files.set(id, []);
        }
    }), WALK_CONCURRENCY);

    return files;
}

/** One library item with its files, for the meta route. */
export async function fetchTorrent(apiKey, itemId) {
    if (cloudGroupIdentity(itemId, apiKey) !== null) {
        const found = toCloudItems(await driveRows(apiKey, 'fetchTorrent'), apiKey).find(item => item.id === String(itemId));
        return found ? { torrent: found, videos: toVideos(found, inlineFiles.get(found), apiKey) } : null;
    }

    const folder = await api(apiKey, 'folder/list', { id: itemId }, 'fetchTorrent', 'files').catch(() => null);

    if (folder?.content) {
        const rows = await walk(apiKey, itemId, 'fetchTorrent');
        if (rows.length) {
            const item = toTorrent({ provider: name, id: itemId, name: folder.name ?? '', size: rows.reduce((total, row) => total + (Number(row.size) || 0), 0) });
            return { torrent: item, videos: toVideos(item, rows, apiKey) };
        }
    }

    const single = await details(apiKey, itemId, 'fetchTorrent').catch(() => []);
    if (!single.length) return null;

    const item = toTorrent({ provider: name, id: itemId, name: single[0].name, size: single[0].size, created: single[0].created_at });
    return { torrent: item, videos: toVideos(item, single, apiKey) };
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
