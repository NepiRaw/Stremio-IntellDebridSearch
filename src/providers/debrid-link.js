/**
 * DebridLink on the shared core.
 * Seedbox entries and downloader rows form the library. Both listings report their own page count
 * and describe every file inline with a directly playable URL, so the file phase costs nothing and
 * play time is an identity function.
 */

import { request, hostOf } from './http.js';
import { toTorrent, toVideoFile } from './shapes.js';
import { SOURCE_KINDS, ownsLibraryItemId, parseLibraryItemId, toLibraryItem } from './library-item.js';
import { normalizeTorrentFiles } from './paths.js';
import { ProviderAuthError, ProviderItemGoneError } from './errors.js';
import { buildResolveUrl } from './resolve-url.js';
import { isVideo } from '../utils/file-types.js';
import { logger } from '../utils/logger.js';

export const name = 'DebridLink';
export const capabilities = { filesInline: true, bulkFiles: false, directLinks: true };

/** Seedbox ids are lower-case alphanumeric, optionally suffixed with the item index. */
const NATIVE_ID = /^[a-z0-9]+(-\d+)?$/;

/** A downloader row's id shares the seedbox shape, so only a typed id names its endpoint. */
function downloaderId(itemId) {
    if (!ownsLibraryItemId(itemId, name, SOURCE_KINDS.DOWNLOAD)) return null;
    const { nativeIdentity } = parseLibraryItemId(itemId);
    return NATIVE_ID.test(nativeIdentity) ? nativeIdentity : null;
}

export const ownsId = id => NATIVE_ID.test(id) || downloaderId(id) !== null;

/** This provider redirects to the link as given, so an unchecked one is an open redirect. */
export const ownsLink = link => {
    const host = hostOf(link);
    return host === 'debrid.link' || host.endsWith('.debrid.link');
};

const BASE = 'https://debrid-link.com/api/v2';

/** DL clamps perPage to 100 and reports its page count against that clamp, on both listings. */
const PAGE_SIZE = 100;
const PAGE_CONCURRENCY = 4;

const auth = apiKey => ({ authorization: `Bearer ${apiKey}` });

/** The listing's own files, kept off the canonical torrent so nothing downstream can serialise them. */
const inlineFiles = new WeakMap();

export async function validateKey(apiKey) {
    const { data } = await request({
        provider: name, operation: 'validateKey', apiKey,
        url: `${BASE}/account/infos`, headers: auth(apiKey)
    });
    const account = data?.value ?? {};
    return { ok: true, username: account.email ?? account.username, premium: Boolean(account.premiumLeft), premiumUntil: account.premiumLeft };
}

async function list(apiKey, resource, query, operation) {
    const { data } = await request({
        provider: name, operation, endpointClass: 'list', apiKey,
        url: `${BASE}/${resource}/list?${query}`, headers: auth(apiKey)
    });
    return { rows: Array.isArray(data?.value) ? data.value : [], pagination: data?.pagination };
}

function toCanonical(row) {
    const torrent = toTorrent({
        provider: name,
        id: row.id,
        name: row.name,
        hash: row.hashString?.toLowerCase() ?? null,
        size: row.totalSize ?? row.size,
        created: row.created,
        fileCount: row.files?.length
    });
    if (Array.isArray(row.files)) inlineFiles.set(torrent, row.files);
    return torrent;
}

/** Runs the tasks with at most `limit` in flight, so a large account cannot open every page at once. */
async function pooled(tasks, limit) {
    const results = [];
    for (let index = 0; index < tasks.length; index += limit) {
        results.push(...await Promise.all(tasks.slice(index, index + limit).map(task => task())));
    }
    return results;
}

/**
 * Every row of one listing. DebridLink reports the total page count upfront, so the remaining pages
 * are fetched concurrently, with no page cap
 */
async function listRows(apiKey, resource, operation) {
    const first = await list(apiKey, resource, `perPage=${PAGE_SIZE}&page=0`, operation);
    const rows = [...first.rows];

    const pages = Number(first.pagination?.pages) || 1;
    if (pages > 1) {
        const rest = await pooled(
            Array.from({ length: pages - 1 }, (_, index) => () => list(apiKey, resource, `perPage=${PAGE_SIZE}&page=${index + 1}`, operation)),
            PAGE_CONCURRENCY
        );
        for (const page of rest) rows.push(...page.rows);
    }

    return rows;
}

export async function listTorrents(apiKey) {
    const rows = await listRows(apiKey, 'seedbox', 'listTorrents');
    const unique = new Map(rows.filter(row => row?.id && row.name).map(row => [String(row.id), row]));
    return [...unique.values()].map(toCanonical);
}

/** A downloader row is one unlocked link, so the row itself describes the file. */
const isPlayableDownload = row => Boolean(row?.id && row.name && row.downloadUrl)
    && !row.expired && !row.isProcessing && isVideo(row.name);

const toDownloadFile = row => ({ id: 0, name: row.name, size: row.size, downloadUrl: row.downloadUrl });

function toDownloadItem(row) {
    const item = toLibraryItem({
        provider: name,
        sourceKind: SOURCE_KINDS.DOWNLOAD,
        nativeIdentity: String(row.id),
        name: row.name,
        size: row.size,
        created: row.created,
        fileCount: 1
    });
    inlineFiles.set(item, [toDownloadFile(row)]);
    return item;
}

export async function listDownloads(apiKey) {
    const rows = await listRows(apiKey, 'downloader', 'listDownloads');
    const unique = new Map(rows.filter(isPlayableDownload).map(row => [String(row.id), row]));
    return [...unique.values()].map(toDownloadItem);
}

export async function listLibraryItems(apiKey) {
    const downloadsTask = listDownloads(apiKey).catch(error => {
        if (error instanceof ProviderAuthError) throw error;
        logger.warn(`[${name}] download discovery unavailable: ${error.name} ${error.code ?? ''}`);
        return [];
    });
    const [torrents, downloads] = await Promise.all([listTorrents(apiKey), downloadsTask]);

    const seedboxItems = torrents.map(torrent => {
        const item = { ...torrent, sourceKind: SOURCE_KINDS.TORRENT };
        const files = inlineFiles.get(torrent);
        if (files) inlineFiles.set(item, files);
        return item;
    });
    return [...seedboxItems, ...downloads];
}

/** DebridLink prefixes each file id with its torrent id, which would repeat inside the canonical id. */
const fileIdOf = (torrentId, fileId) => {
    const raw = String(fileId ?? '');
    return raw.startsWith(`${torrentId}-`) ? raw.slice(String(torrentId).length + 1) : raw;
};

/** A file still downloading has a URL that cannot serve the whole file, so it is not a stream yet */
const isComplete = file => file.downloadPercent === undefined || Number(file.downloadPercent) >= 100;

function toVideos(torrent, files, apiKey) {
    const addresses = normalizeTorrentFiles(files.map(file => file.name), torrent.name);

    return files
        .map((file, index) => ({ file, address: addresses[index] }))
        .filter(entry => isVideo(entry.address.fileName) && isComplete(entry.file))
        .map(entry => toVideoFile({
            provider: name,
            torrentId: torrent.id,
            fileId: fileIdOf(torrent.id, entry.file.id),
            address: entry.address,
            size: entry.file.size,
            created: torrent.created,
            url: buildResolveUrl(name, apiKey, torrent.id, entry.file.downloadUrl),
            resolveRef: { url: entry.file.downloadUrl }
        }));
}

/** `?ids=` returns one torrent with its files; `?id=` is ignored and `?ids[]=` answers HTTP 500. */
async function lookup(apiKey, torrentId) {
    const { rows } = await list(apiKey, 'seedbox', `ids=${encodeURIComponent(torrentId)}`, 'fetchTorrent');
    return rows.find(row => String(row.id) === String(torrentId)) ?? rows[0];
}

/** The two listings share an id shape, so an unmatched downloader row could be another item. */
async function lookupDownload(apiKey, nativeId) {
    const { rows } = await list(apiKey, 'downloader', `ids=${encodeURIComponent(nativeId)}`, 'fetchTorrent');
    return rows.find(row => String(row.id) === String(nativeId)) ?? null;
}

/** One downloader row's files, or none when it has expired or is no longer playable. */
async function downloadVideos(apiKey, nativeId) {
    const row = await lookupDownload(apiKey, nativeId);
    if (!isPlayableDownload(row)) return null;

    const item = toDownloadItem(row);
    return { torrent: item, videos: toVideos(item, [toDownloadFile(row)], apiKey) };
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
            const nativeDownloadId = downloaderId(id);
            if (nativeDownloadId !== null) {
                files.set(id, (await downloadVideos(apiKey, nativeDownloadId))?.videos ?? []);
                return;
            }

            const row = await lookup(apiKey, id);
            files.set(id, row?.files ? toVideos(toCanonical(row), row.files, apiKey) : []);
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
    const nativeDownloadId = downloaderId(itemId);
    if (nativeDownloadId !== null) return downloadVideos(apiKey, nativeDownloadId);

    const row = await lookup(apiKey, itemId);
    if (!row?.id || !row.name) return null;

    const torrent = toCanonical(row);
    return { torrent, videos: toVideos(torrent, row.files ?? [], apiKey) };
}

/** DebridLink hands out a directly playable URL in the listing, so there is nothing to unrestrict. */
export async function resolveStream(apiKey, resolveRef) {
    const url = resolveRef?.url ?? resolveRef?.link;
    if (!url) {
        throw new ProviderItemGoneError(`[${name}] resolveStream: the reference carries no url`, { provider: name, operation: 'resolveStream' });
    }
    return url;
}
