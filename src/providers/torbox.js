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

function webDownloadId(itemId) {
    if (!ownsLibraryItemId(itemId, name, SOURCE_KINDS.WEB_DOWNLOAD)) return null;
    const nativeIdentity = parseLibraryItemId(itemId).nativeIdentity;
    return isIntegerId(nativeIdentity) ? nativeIdentity : null;
}

/** Legacy torrent ids are integers; new web-download ids also identify their endpoint family. */
export const ownsId = id => isIntegerId(id) || webDownloadId(id) !== null;

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

function toWebDownload(row) {
    const item = toLibraryItem({
        provider: name,
        sourceKind: SOURCE_KINDS.WEB_DOWNLOAD,
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

export async function listWebDownloads(apiKey) {
    const rows = await listRows(apiKey, 'webdl', 'listWebDownloads');
    const unique = new Map(rows.filter(row => isReady(row) && hasPlayableFile(row)).map(row => [String(row.id), row]));
    return [...unique.values()].map(toWebDownload);
}

export async function listLibraryItems(apiKey) {
    const webDownloadsTask = listWebDownloads(apiKey).catch(error => {
        if (error instanceof ProviderAuthError) throw error;
        logger.warn(`[${name}] web-download discovery unavailable: ${error.name} ${error.code ?? ''}`);
        return [];
    });
    const [torrents, webDownloads] = await Promise.all([listTorrents(apiKey), webDownloadsTask]);
    const torrentItems = torrents.map(torrent => {
        const item = { ...torrent, sourceKind: SOURCE_KINDS.TORRENT };
        const files = inlineFiles.get(torrent);
        if (files) inlineFiles.set(item, files);
        return item;
    });
    return [...torrentItems, ...webDownloads];
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
    const nativeWebId = webDownloadId(itemId);
    const nativeId = nativeWebId ?? itemId;
    if (!isIntegerId(nativeId)) return null;

    const sourceKind = nativeWebId === null ? SOURCE_KINDS.TORRENT : SOURCE_KINDS.WEB_DOWNLOAD;
    const resource = sourceKind === SOURCE_KINDS.WEB_DOWNLOAD ? 'webdl' : 'torrents';
    const found = await list(apiKey, resource, `id=${encodeURIComponent(nativeId)}`, 'fetchTorrent');
    const row = Array.isArray(found) ? found.find(candidate => String(candidate.id) === String(nativeId)) : found;
    return row ? { row, sourceKind } : null;
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
            if (!found || !isReady(found.row)) {
                files.set(id, []);
                return;
            }
            if (found.sourceKind === SOURCE_KINDS.WEB_DOWNLOAD && !hasPlayableFile(found.row)) {
                files.set(id, []);
                return;
            }
            const item = found.sourceKind === SOURCE_KINDS.WEB_DOWNLOAD ? toWebDownload(found.row) : toCanonical(found.row);
            files.set(id, toVideos(item, found.row.files ?? [], apiKey));
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
    if (!ownsId(itemId)) return null;
    const found = await lookup(apiKey, itemId);
    if (!found || !isReady(found.row)) return null;
    if (found.sourceKind === SOURCE_KINDS.WEB_DOWNLOAD && !hasPlayableFile(found.row)) return null;

    const item = found.sourceKind === SOURCE_KINDS.WEB_DOWNLOAD ? toWebDownload(found.row) : toCanonical(found.row);
    return { torrent: item, videos: toVideos(item, found.row.files ?? [], apiKey) };
}

export async function resolveStream(apiKey, resolveRef, clientIp) {
    // At play time the reference is rebuilt from the URL, so the file id arrives as `link`.
    const fileId = resolveRef?.fileId ?? resolveRef?.link;
    const itemId = resolveRef?.torrentId;
    const nativeWebId = webDownloadId(itemId);
    const nativeId = nativeWebId ?? itemId;
    if (!isIntegerId(fileId) || !isIntegerId(nativeId)) {
        throw new ProviderItemGoneError(`[${name}] resolveStream: the reference names no file`, { provider: name, operation: 'resolveStream' });
    }

    // TorBox takes the token as a query parameter on this endpoint; the header alone is refused.
    const idParameter = nativeWebId === null ? 'torrent_id' : 'web_id';
    const resource = nativeWebId === null ? 'torrents' : 'webdl';
    const query = new URLSearchParams({ token: apiKey, [idParameter]: String(nativeId), file_id: String(fileId) });
    if (clientIp) query.set('user_ip', clientIp);

    const { data } = await request({
        provider: name, operation: 'resolveStream', endpointClass: 'resolve', apiKey,
        url: `${BASE}/${resource}/requestdl?${query}`, headers: auth(apiKey)
    });

    return data?.data;
}
