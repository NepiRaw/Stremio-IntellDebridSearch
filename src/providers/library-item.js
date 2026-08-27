import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { toTorrent } from './shapes.js';

export const SOURCE_KINDS = Object.freeze({
    TORRENT: 'torrent',
    SAVED_LINK: 'saved-link',
    DOWNLOAD: 'download',
    WEB_DOWNLOAD: 'web-download',
    CLOUD_FILE: 'cloud-file'
});

const VERSION = 'li1';
const VALID_KINDS = new Set(Object.values(SOURCE_KINDS));
const encode = value => Buffer.from(String(value), 'utf8').toString('base64url');

function decode(value) {
    if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
    const decoded = Buffer.from(value, 'base64url').toString('utf8');
    return decoded && encode(decoded) === value ? decoded : null;
}

export function libraryItemDigest(value) {
    return createHash('sha256').update(String(value), 'utf8').digest('base64url');
}

const hmac = (value, secret) => createHmac('sha256', String(secret)).update(String(value), 'utf8').digest('base64url');

export function makeScopedLibraryIdentity(value, secret) {
    if (!secret) throw new TypeError('Scoped library identity requires a secret');
    const digest = hmac(value, secret);
    return `${digest}.${hmac(`${VERSION}:${digest}`, secret)}`;
}

export function ownsScopedLibraryIdentity(identity, secret) {
    if (!secret) return false;
    const [digest, signature, ...rest] = String(identity).split('.');
    if (rest.length || !/^[A-Za-z0-9_-]{43}$/.test(digest) || !/^[A-Za-z0-9_-]{43}$/.test(signature)) return false;
    const expected = hmac(`${VERSION}:${digest}`, secret);
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

export function makeLibraryItemId(provider, sourceKind, nativeIdentity) {
    if (!provider || !VALID_KINDS.has(sourceKind) || nativeIdentity === null || nativeIdentity === undefined || nativeIdentity === '') {
        throw new TypeError('Library item identity requires provider, source kind and native identity');
    }
    return `${VERSION}.${encode(provider)}.${sourceKind}.${encode(nativeIdentity)}`;
}

export function parseLibraryItemId(itemId) {
    const [version, encodedProvider, sourceKind, encodedIdentity, ...rest] = String(itemId).split('.');
    if (version !== VERSION || rest.length || !VALID_KINDS.has(sourceKind)) return null;

    const provider = decode(encodedProvider);
    const nativeIdentity = decode(encodedIdentity);
    return provider && nativeIdentity ? { provider, sourceKind, nativeIdentity } : null;
}

export function ownsLibraryItemId(itemId, provider, sourceKind) {
    const parsed = parseLibraryItemId(itemId);
    return parsed?.provider === provider && parsed.sourceKind === sourceKind;
}

export function toLibraryItem({ provider, sourceKind, nativeIdentity, name, hash, size, created, fileCount }) {
    return {
        ...toTorrent({
            provider,
            id: makeLibraryItemId(provider, sourceKind, nativeIdentity),
            name,
            hash,
            size,
            created,
            fileCount
        }),
        sourceKind
    };
}