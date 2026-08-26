/**
 * DebridLink on the shared core.
 * The seedbox listing reports its own page count and carries every file inline with a directly
 * playable URL, so the library is one call for a normal account, the file phase costs nothing,
 * and play time is an identity function.
 */

import { request } from './http.js';
import { toTorrent, toVideoFile } from './shapes.js';
import { normalizeTorrentFiles } from './paths.js';
import { ProviderAuthError, ProviderItemGoneError } from './errors.js';
import { buildResolveUrl } from './resolve-url.js';
import { isVideo } from '../utils/file-types.js';
import { logger } from '../utils/logger.js';

export const name = 'DebridLink';
export const capabilities = { filesInline: true, bulkFiles: false, directLinks: true };

/** Seedbox ids are lower-case alphanumeric, optionally suffixed with the item index. */
export const ownsId = id => /^[a-z0-9]+(-\d+)?$/.test(id);

const BASE = 'https://debrid-link.com/api/v2';

/** DL caps the page size and reports its own page count */
const PAGE_SIZE = 1000;
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

async function seedbox(apiKey, query, operation) {
    const { data } = await request({
        provider: name, operation, endpointClass: 'list', apiKey,
        url: `${BASE}/seedbox/list?${query}`, headers: auth(apiKey)
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
 * The library. DebridLink reports the total page count upfront, so the remaining pages are fetched
 * concurrently, with no page cap
 */
export async function listTorrents(apiKey) {
    const first = await seedbox(apiKey, `perPage=${PAGE_SIZE}&page=0`, 'listTorrents');
    const rows = [...first.rows];

    const pages = Number(first.pagination?.pages) || 1;
    if (pages > 1) {
        const rest = await pooled(
            Array.from({ length: pages - 1 }, (_, index) => () => seedbox(apiKey, `perPage=${PAGE_SIZE}&page=${index + 1}`, 'listTorrents')),
            PAGE_CONCURRENCY
        );
        for (const page of rest) rows.push(...page.rows);
    }

    const unique = new Map(rows.filter(row => row?.id && row.name).map(row => [String(row.id), row]));
    return [...unique.values()].map(toCanonical);
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
    const { rows } = await seedbox(apiKey, `ids=${encodeURIComponent(torrentId)}`, 'fetchTorrent');
    return rows.find(row => String(row.id) === String(torrentId)) ?? rows[0];
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
