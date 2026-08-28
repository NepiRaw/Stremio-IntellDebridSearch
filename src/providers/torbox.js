/**
 * TorBox on the shared core.
 * The listing carries every file inline, so the file phase costs nothing when it is given the
 * torrents the listing returned. A torrent that arrives from anywhere else falls back to a single
 * lookup by id, which keeps correctness independent of how a caller passes objects around.
 */

import { request } from './http.js';
import { toTorrent, toVideoFile } from './shapes.js';
import { SOURCE_KINDS, ownsLibraryItemId, parseLibraryItemId, toLibraryItem } from './library-item.js';
import { normalizeTorrentFiles } from './paths.js';
import { ProviderAuthError, ProviderItemGoneError } from './errors.js';
import { buildResolveUrl } from './resolve-url.js';
import { isVideo } from '../utils/file-types.js';
import { logger } from '../utils/logger.js';

export const name = 'TorBox';
export const capabilities = { filesInline: true, bulkFiles: false, directLinks: false };

const isIntegerId = id => /^\d+$/.test(String(id));

/**
 * The endpoint families, which are near-identical apart from renamed inputs. Their id spaces are
 * independent, so only a typed id says which family an item came from.
 */
const TORRENT_LANE = { sourceKind: SOURCE_KINDS.TORRENT, resource: 'torrents', idParameter: 'torrent_id' };
const TYPED_LANES = [
    { sourceKind: SOURCE_KINDS.WEB_DOWNLOAD, resource: 'webdl', idParameter: 'web_id', operation: 'listWebDownloads' },
    { sourceKind: SOURCE_KINDS.USENET_DOWNLOAD, resource: 'usenet', idParameter: 'usenet_id', operation: 'listUsenetDownloads' }
];

/** The lane an id names, with its native identity, or null when nothing here can serve it. */
function laneOf(itemId) {
    for (const lane of TYPED_LANES) {
        if (!ownsLibraryItemId(itemId, name, lane.sourceKind)) continue;
        const { nativeIdentity } = parseLibraryItemId(itemId);
        return isIntegerId(nativeIdentity) ? { lane, nativeId: nativeIdentity } : null;
    }
    return isIntegerId(itemId) ? { lane: TORRENT_LANE, nativeId: String(itemId) } : null;
}

/** Legacy torrent ids are integers; a typed id also identifies its endpoint family. */
export const ownsId = id => laneOf(id) !== null;

export const ownsLink = (link, itemId) => isIntegerId(link) && (itemId === undefined || ownsId(itemId));

const BASE = 'https://api.torbox.app/v1/api';

/** Without an explicit limit the same call takes 1.5-5.9s instead of 0.7-0.9s. */
const PAGE_SIZE = 1000;
const PAGE_BATCH = 4;
const MAX_PAGES = 40;

const auth = apiKey => ({ authorization: `Bearer ${apiKey}` });

/** The listing's own files, kept off the canonical torrent so nothing downstream can serialise them. */
const inlineFiles = new WeakMap();

const isReady = row => row?.id !== undefined && row.name && row.download_finished && row.download_present;

async function list(apiKey, resource, params, operation) {
    const { data } = await request({
        provider: name, operation, endpointClass: 'list', apiKey,
        url: `${BASE}/${resource}/mylist?bypass_cache=true&${params}`, headers: auth(apiKey)
    });
    return data?.data;
}

const page = async (apiKey, resource, offset, operation) => {
    const rows = await list(apiKey, resource, `limit=${PAGE_SIZE}&offset=${offset}`, operation);
    return Array.isArray(rows) ? rows : [];
};

async function listRows(apiKey, resource, operation) {
    const rows = await page(apiKey, resource, 0, operation);

    if (rows.length === PAGE_SIZE) {
        for (let offset = PAGE_SIZE; offset < PAGE_SIZE * MAX_PAGES;) {
            const batch = await Promise.all(
                Array.from({ length: PAGE_BATCH }, (_, index) => page(apiKey, resource, offset + index * PAGE_SIZE, operation))
            );
            for (const rowsPage of batch) rows.push(...rowsPage);
            offset += PAGE_BATCH * PAGE_SIZE;
            if (batch.some(rowsPage => rowsPage.length < PAGE_SIZE)) break;
        }
    }

    return rows;
}

export async function validateKey(apiKey) {
    const { data } = await request({
        provider: name, operation: 'validateKey', apiKey,
        url: `${BASE}/user/me?settings=false`, headers: auth(apiKey)
    });
    const user = data?.data ?? {};
    return { ok: true, username: user.email, premium: Number(user.plan) > 0, premiumUntil: user.premium_expires_at };
}

function toCanonical(row) {
    const torrent = toTorrent({
        provider: name,
        id: row.id,
        name: row.name,
        hash: row.hash,
        size: row.size,
        created: row.created_at,
        fileCount: row.files?.length
    });
    if (Array.isArray(row.files)) inlineFiles.set(torrent, row.files);
    return torrent;
}

/**
 * The library, always live. One call covers any account up to 1000 torrents; beyond that the next
 * pages are fetched four at a time, since the cost is payload-bound rather than latency-bound.
 */
export async function listTorrents(apiKey) {
    const rows = await listRows(apiKey, 'torrents', 'listTorrents');
    const unique = new Map(rows.filter(isReady).map(row => [String(row.id), row]));
    return [...unique.values()].map(toCanonical);
}

const hasPlayableFile = row => Array.isArray(row.files)
    && row.files.some(file => isVideo(file?.name ?? file?.short_name));

function toTypedItem(row, lane) {
    const item = toLibraryItem({
        provider: name,
        sourceKind: lane.sourceKind,
        nativeIdentity: String(row.id),
        name: row.name,
        hash: row.hash,
        size: row.size,
        created: row.created_at,
        fileCount: row.files?.length
    });
    if (Array.isArray(row.files)) inlineFiles.set(item, row.files);
    return item;
}

/** One typed lane's playable items. A row is only offered once its data is present on the server. */
async function listLane(apiKey, lane) {
    const rows = await listRows(apiKey, lane.resource, lane.operation);
    const unique = new Map(rows.filter(row => isReady(row) && hasPlayableFile(row)).map(row => [String(row.id), row]));
    return [...unique.values()].map(row => toTypedItem(row, lane));
}

export const listWebDownloads = apiKey => listLane(apiKey, TYPED_LANES[0]);
export const listUsenetDownloads = apiKey => listLane(apiKey, TYPED_LANES[1]);

export async function listLibraryItems(apiKey) {
    const laneTasks = TYPED_LANES.map(lane => listLane(apiKey, lane).catch(error => {
        if (error instanceof ProviderAuthError) throw error;
        logger.warn(`[${name}] ${lane.sourceKind} discovery unavailable: ${error.name} ${error.code ?? ''}`);
        return [];
    }));
    const [torrents, ...typed] = await Promise.all([listTorrents(apiKey), ...laneTasks]);

    const torrentItems = torrents.map(torrent => {
        const item = { ...torrent, sourceKind: SOURCE_KINDS.TORRENT };
        const files = inlineFiles.get(torrent);
        if (files) inlineFiles.set(item, files);
        return item;
    });
    return [...torrentItems, ...typed.flat()];
}

/** One library item's inline files to canonical video files. */
function toVideos(item, files, apiKey) {
    const addresses = normalizeTorrentFiles(files.map(file => file.name ?? file.short_name), item.name);

    return files
        .map((file, index) => ({ file, address: addresses[index] }))
        .filter(entry => isVideo(entry.address.fileName))
        .map(entry => toVideoFile({
            provider: name,
            torrentId: item.id,
            fileId: entry.file.id,
            address: entry.address,
            size: entry.file.size,
            created: item.created,
            url: buildResolveUrl(name, apiKey, item.id, String(entry.file.id)),
            resolveRef: { torrentId: String(item.id), fileId: entry.file.id }
        }));
}

async function lookup(apiKey, itemId) {
    const addressed = laneOf(itemId);
    if (!addressed) return null;

    const { lane, nativeId } = addressed;
    const found = await list(apiKey, lane.resource, `id=${encodeURIComponent(nativeId)}`, 'fetchTorrent');
    const row = Array.isArray(found) ? found.find(candidate => String(candidate.id) === String(nativeId)) : found;
    return row ? { row, lane } : null;
}

/** A typed lane only offers a row that still holds a playable file; a torrent is taken as listed. */
function toFoundItem(found) {
    if (!isReady(found.row)) return null;
    if (found.lane === TORRENT_LANE) return toCanonical(found.row);
    return hasPlayableFile(found.row) ? toTypedItem(found.row, found.lane) : null;
}

export async function fetchFiles(apiKey, torrents) {
    const files = new Map();

    await Promise.all(torrents.map(async torrent => {
        const id = String(torrent.id);
        const inline = inlineFiles.get(torrent);
        if (inline) {
            files.set(id, toVideos(torrent, inline, apiKey));
            return;
        }

        try {
            const found = await lookup(apiKey, id);
            const item = found && toFoundItem(found);
            files.set(id, item ? toVideos(item, found.row.files ?? [], apiKey) : []);
        } catch (error) {
            if (error instanceof ProviderAuthError) throw error;
            logger.debug(`[${name}] dropping library item ${id}: ${error.name} ${error.code ?? error.status ?? ''}`);
            files.set(id, []);
        }
    }));

    return files;
}

/** One library item with its files, for the meta route. */
export async function fetchTorrent(apiKey, itemId) {
    const found = await lookup(apiKey, itemId);
    const item = found && toFoundItem(found);
    return item ? { torrent: item, videos: toVideos(item, found.row.files ?? [], apiKey) } : null;
}

export async function resolveStream(apiKey, resolveRef, clientIp) {
    // At play time the reference is rebuilt from the URL, so the file id arrives as `link`.
    const fileId = resolveRef?.fileId ?? resolveRef?.link;
    const addressed = laneOf(resolveRef?.torrentId);
    if (!isIntegerId(fileId) || !addressed) {
        throw new ProviderItemGoneError(`[${name}] resolveStream: the reference names no file`, { provider: name, operation: 'resolveStream' });
    }

    // TorBox takes the token as a query parameter on this endpoint; the header alone is refused.
    const { lane, nativeId } = addressed;
    const query = new URLSearchParams({ token: apiKey, [lane.idParameter]: nativeId, file_id: String(fileId) });
    if (clientIp) query.set('user_ip', clientIp);

    const { data } = await request({
        provider: name, operation: 'resolveStream', endpointClass: 'resolve', apiKey,
        url: `${BASE}/${lane.resource}/requestdl?${query}`, headers: auth(apiKey)
    });

    return data?.data;
}
