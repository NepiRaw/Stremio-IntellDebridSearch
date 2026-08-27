/**
 * The canonical shapes every provider returns, so no consumer has to learn which provider a
 * torrent or a file came from.
 */

/**
 * @typedef {object} Torrent
 * @property {string} provider
 * @property {string} id
 * @property {string} [sourceKind]
 * @property {string} name
 * @property {string} [hash]
 * @property {number} size
 * @property {Date} created
 * @property {number} [fileCount]
 */

/**
 * @typedef {object} VideoFile
 * @property {string} provider
 * @property {string} torrentId
 * @property {string|number} fileId provider-native id, or the index when the provider has none
 * @property {string} id `torrentId:fileId`
 * @property {string} container torrent display name
 * @property {string} subPath folder inside the torrent, '' when the file sits at its root
 * @property {string} fileName leaf name, what the parser and the display read
 * @property {string} relPath subPath + '/' + fileName
 * @property {number} size
 * @property {Date} created
 * @property {string} [url] addon resolve URL
 * @property {object} resolveRef opaque, everything resolveStream needs
 */

/** Providers date in seconds, in milliseconds, or as an ISO string. */
export function parseDate(value) {
    if (value instanceof Date) return value;
    if (typeof value === 'number') return new Date(value < 1e10 ? value * 1000 : value);
    const parsed = typeof value === 'string' ? new Date(value) : null;
    return parsed && !Number.isNaN(parsed.getTime()) ? parsed : new Date();
}

/** @returns {Torrent} */
export function toTorrent({ provider, id, name, hash, size, created, fileCount }) {
    return {
        provider,
        id: String(id),
        name: String(name ?? ''),
        hash: hash ?? null,
        size: Number(size) || 0,
        created: parseDate(created),
        fileCount
    };
}

/** @returns {VideoFile} */
export function toVideoFile({ provider, torrentId, fileId, address, size, created, url, resolveRef }) {
    return {
        provider,
        torrentId: String(torrentId),
        fileId,
        id: `${torrentId}:${fileId}`,
        ...address,
        size: Number(size) || 0,
        created: parseDate(created),
        url,
        resolveRef
    };
}
