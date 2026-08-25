/**
 * The addon URL a stream points at. Play time comes back to /resolve, which hands the reference
 * to the provider module. The API key never appears in the URL: a short token stands in for it.
 */

import { encode } from 'urlencode';
import { ApiKeySecurityManager } from './BaseProvider.js';

export function buildResolveUrl(provider, apiKey, torrentId, hostUrl) {
    if (!hostUrl) return null;

    const token = ApiKeySecurityManager.generateSecureToken(provider, apiKey);
    return `${process.env.ADDON_URL}/resolve/${provider}/${token}/${torrentId}/${encode(hostUrl)}`;
}
