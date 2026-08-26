/**
 * TorBox on the shared core.
 * The listing carries every file inline, so the file phase costs nothing when it is given the
 * torrents the listing returned. A torrent that arrives from anywhere else falls back to a single
 * lookup by id, which keeps correctness independent of how a caller passes objects around.
 */

import { request } from './http.js';
import { toTorrent, toVideoFile } from './shapes.js';
import { normalizeTorrentFiles } from './paths.js';
import { ProviderAuthError, ProviderItemGoneError } from './errors.js';
import { buildResolveUrl } from './resolve-url.js';
import { isVideo } from '../utils/file-types.js';
import { logger } from '../utils/logger.js';

export const name = 'TorBox';
export const capabilities = { filesInline: true, bulkFiles: false, directLinks: false };

/** Torrent ids are integers, and the API answers 422 for anything that is not one. */
export const ownsId = id => /^\d+$/.test(id);

export const ownsLink = link => /^\d+$/.test(link);

const BASE = 'https://api.torbox.app/v1/api';

/** Without an explicit limit the same call takes 1.5-5.9s instead of 0.7-0.9s. */
const PAGE_SIZE = 1000;
const PAGE_BATCH = 4;
const MAX_PAGES = 40;

const auth = apiKey => ({ authorization: `Bearer ${apiKey}` });

/** The listing's own files, kept off the canonical torrent so nothing downstream can serialise them. */
const inlineFiles = new WeakMap();

const isReady = row => row?.id !== undefined && row.name && row.download_finished && row.download_present;

async function list(apiKey, params, operation) {
    const { data } = await request({
        provider: name, operation, endpointClass: 'list', apiKey,
        url: `${BASE}/torrents/mylist?bypass_cache=true&${params}`, headers: auth(apiKey)
    });
    return data?.data;
}

const page = async (apiKey, offset) => {
    const rows = await list(apiKey, `limit=${PAGE_SIZE}&offset=${offset}`, 'listTorrents');
    return Array.isArray(rows) ? rows : [];
};

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
    const rows = await page(apiKey, 0);

    if (rows.length === PAGE_SIZE) {
        for (let offset = PAGE_SIZE; offset < PAGE_SIZE * MAX_PAGES;) {
            const batch = await Promise.all(
                Array.from({ length: PAGE_BATCH }, (_, index) => page(apiKey, offset + index * PAGE_SIZE))
            );
            for (const rowsPage of batch) rows.push(...rowsPage);
            offset += PAGE_BATCH * PAGE_SIZE;
            if (batch.some(rowsPage => rowsPage.length < PAGE_SIZE)) break;
        }
    }

    const unique = new Map(rows.filter(isReady).map(row => [String(row.id), row]));
    return [...unique.values()].map(toCanonical);
}

/** One torrent's inline files to canonical video files. */
function toVideos(torrent, files, apiKey) {
    const addresses = normalizeTorrentFiles(files.map(file => file.name ?? file.short_name), torrent.name);

    return files
        .map((file, index) => ({ file, address: addresses[index] }))
        .filter(entry => isVideo(entry.address.fileName))
        .map(entry => toVideoFile({
            provider: name,
            torrentId: torrent.id,
            fileId: entry.file.id,
            address: entry.address,
            size: entry.file.size,
            created: torrent.created,
            url: buildResolveUrl(name, apiKey, torrent.id, String(entry.file.id)),
            resolveRef: { torrentId: String(torrent.id), fileId: entry.file.id }
        }));
}

async function lookup(apiKey, torrentId) {
    const found = await list(apiKey, `id=${encodeURIComponent(torrentId)}`, 'fetchTorrent');
    return Array.isArray(found) ? found.find(row => String(row.id) === String(torrentId)) : found;
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
            const row = await lookup(apiKey, id);
            files.set(id, row?.files ? toVideos(toCanonical(row), row.files, apiKey) : []);
        } catch (error) {
            if (error instanceof ProviderAuthError) throw error;
            logger.debug(`[${name}] dropping torrent ${id}: ${error.name} ${error.code ?? error.status ?? ''}`);
            files.set(id, []);
        }
    }));

    return files;
}

/** One torrent with its files, for the meta route. */
export async function fetchTorrent(apiKey, torrentId) {
    const row = await lookup(apiKey, torrentId);
    if (!isReady(row)) return null;

    const torrent = toCanonical(row);
    return { torrent, videos: toVideos(torrent, row.files ?? [], apiKey) };
}

export async function resolveStream(apiKey, resolveRef, clientIp) {
    // At play time the reference is rebuilt from the URL, so the file id arrives as `link`.
    const fileId = resolveRef?.fileId ?? resolveRef?.link;
    if (fileId === undefined || fileId === null || !resolveRef?.torrentId) {
        throw new ProviderItemGoneError(`[${name}] resolveStream: the reference names no file`, { provider: name, operation: 'resolveStream' });
    }

    // TorBox takes the token as a query parameter on this endpoint; the header alone is refused.
    const query = new URLSearchParams({ token: apiKey, torrent_id: String(resolveRef.torrentId), file_id: String(fileId) });
    if (clientIp) query.set('user_ip', clientIp);

    const { data } = await request({
        provider: name, operation: 'resolveStream', endpointClass: 'resolve', apiKey,
        url: `${BASE}/torrents/requestdl?${query}`, headers: auth(apiKey)
    });

    return data?.data;
}
