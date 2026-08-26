/**
 * RealDebrid on the shared core.
 * The library is one call for any account under 2500 torrents, files come one call per torrent,
 * and a link is only usable when the link count equals the SELECTED file count: any other count
 * means RealDebrid packaged the torrent differently and no per-file link exists.
 */

import { request } from './http.js';
import { toTorrent, toVideoFile } from './shapes.js';
import { normalizeTorrentFiles } from './paths.js';
import { ProviderAuthError, ProviderItemGoneError } from './errors.js';
import { buildResolveUrl } from './resolve-url.js';
import { isVideo } from '../utils/file-types.js';
import { logger } from '../utils/logger.js';

export const name = 'RealDebrid';
export const capabilities = { filesInline: false, bulkFiles: false, directLinks: false };

/** Torrent ids are upper-case alphanumeric, so anything else was minted by someone else. */
export const ownsId = id => /^[A-Z0-9]+$/.test(id);

const BASE = 'https://api.real-debrid.com/rest/1.0';

/** A limit above 5000 silently answers 100 rows, so the page size stays well under it. */
const PAGE_SIZE = 2500;
const MAX_PAGES = 20;

const auth = apiKey => ({ authorization: `Bearer ${apiKey}` });
const posted = { 'content-type': 'application/x-www-form-urlencoded' };

export async function validateKey(apiKey) {
    const { data } = await request({
        provider: name, operation: 'validateKey', apiKey,
        url: `${BASE}/user`, headers: auth(apiKey)
    });
    return { ok: true, username: data?.username, premium: Number(data?.premium) > 0, premiumUntil: data?.expiration };
}

const toTorrentRow = row => toTorrent({
    provider: name,
    id: row.id,
    name: row.filename,
    hash: row.hash,
    size: row.bytes,
    created: row.added,
    fileCount: row.links?.length
});

/**
 * The library. /torrents is capped by concurrency, not by rate, so pages are fetched one after
 * another; a parallel walk is what makes RD reject listing requests.
 */
export async function listTorrents(apiKey) {
    const page = async number => request({
        provider: name, operation: 'listTorrents', endpointClass: 'list', apiKey,
        url: `${BASE}/torrents?limit=${PAGE_SIZE}&page=${number}`, headers: auth(apiKey)
    });

    const first = await page(1);
    const rows = Array.isArray(first.data) ? [...first.data] : [];

    const total = Number(first.headers.get('x-total-count'));
    const pages = Number.isFinite(total) ? Math.min(Math.ceil(total / PAGE_SIZE), MAX_PAGES) : 1;
    for (let number = 2; number <= pages; number++) {
        const next = await page(number);
        if (!Array.isArray(next.data) || next.data.length === 0) break;
        rows.push(...next.data);
    }

    return rows.filter(row => row?.id && row.filename).map(toTorrentRow);
}

/**
 * Pairs links to files
 * RealDebrid returns one link per selected file, in the same order, so the pairing must happen
 * before the video filter. When the counts disagree the torrent was packaged as a single
 * archive and holds no per-file link, returning nothing
 */
function pairLinks(item) {
    const selected = (item.files ?? []).filter(file => file.selected === 1);
    const links = item.links ?? [];

    if (links.length !== selected.length) {
        return { paired: [], reason: links.length < selected.length ? 'archived' : 'more links than selected files' };
    }
    return { paired: selected.map((file, index) => ({ file, link: links[index] })), reason: null };
}

/** One torrent's info payload to canonical video files. */
function toVideos(item, apiKey) {
    const { paired, reason } = pairLinks(item);
    if (reason) {
        logger.debug(`[${name}] dropping torrent ${item.id}: ${reason} (${item.links?.length ?? 0} links, ${(item.files ?? []).filter(file => file.selected === 1).length} selected)`);
        return [];
    }

    const addresses = normalizeTorrentFiles(paired.map(entry => entry.file.path), item.filename);

    return paired
        .map((entry, index) => ({ ...entry, address: addresses[index] }))
        .filter(entry => isVideo(entry.address.fileName))
        .map(entry => toVideoFile({
            provider: name,
            torrentId: item.id,
            fileId: entry.file.id,
            address: entry.address,
            size: entry.file.bytes,
            created: item.added,
            url: buildResolveUrl(name, apiKey, item.id, entry.link),
            resolveRef: { link: entry.link }
        }));
}

async function info(apiKey, torrentId, operation) {
    const { data } = await request({
        provider: name, operation, endpointClass: 'files', apiKey,
        url: `${BASE}/torrents/info/${encodeURIComponent(torrentId)}`, headers: auth(apiKey)
    });
    return data;
}

export async function fetchFiles(apiKey, torrents) {
    const files = new Map();

    await Promise.all(torrents.map(async torrent => {
        const id = String(torrent.id);
        try {
            files.set(id, toVideos(await info(apiKey, id, 'fetchFiles'), apiKey));
        } catch (error) {
            // A rejected key must reach the user; one unreachable torrent must not empty the search.
            if (error instanceof ProviderAuthError) throw error;
            logger.debug(`[${name}] dropping torrent ${id}: ${error.name} ${error.code ?? error.status ?? ''}`);
            files.set(id, []);
        }
    }));

    return files;
}

/** One torrent with its files, for the meta route. */
export async function fetchTorrent(apiKey, torrentId) {
    const item = await info(apiKey, torrentId, 'fetchTorrent');
    if (!item?.id || !item.filename) return null;

    return { torrent: toTorrentRow(item), videos: toVideos(item, apiKey) };
}

export async function resolveStream(apiKey, resolveRef, clientIp) {
    if (!resolveRef?.link) {
        throw new ProviderItemGoneError(`[${name}] resolveStream: the reference carries no link`, { provider: name, operation: 'resolveStream' });
    }

    const body = new URLSearchParams({ link: resolveRef.link });
    if (clientIp) body.set('ip', clientIp);

    const { data } = await request({
        provider: name, operation: 'resolveStream', endpointClass: 'resolve', apiKey,
        url: `${BASE}/unrestrict/link`, method: 'POST',
        headers: { ...auth(apiKey), ...posted },
        body
    });

    return data?.download;
}
