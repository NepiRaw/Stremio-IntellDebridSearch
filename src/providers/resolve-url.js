/**
 * The addon URL a stream points at, and the token inside it.
 * Play time comes back to /resolve, which hands the reference to the provider module. The API key
 * never appears in the URL: a short token stands in for it
 */

import crypto from 'crypto';
import { encode } from 'urlencode';
import { encryptConfig } from '../config/configuration.js';
import { logger } from '../utils/logger.js';

const TOKEN_LENGTH = 16;
const secureTokenMapping = new Map();

export class ApiKeySecurityManager {
    static generateSecureToken(providerName, apiKey) {
        const secureToken = crypto.createHash('md5').update(`${providerName}:${apiKey}`).digest('hex').substring(0, TOKEN_LENGTH);
        secureTokenMapping.set(`${providerName}:${secureToken}`, apiKey);
        return secureToken;
    }

    static resolveSecureToken(providerName, token) {
        if (token === 'null') return null;

        const apiKey = secureTokenMapping.get(`${providerName}:${token}`);
        if (!apiKey) {
            logger.warn(`[SECURITY] Token resolution failed for ${providerName}:${token}`);
            return null;
        }
        return apiKey;
    }

    static isSecureToken(value) {
        return Boolean(value) && value.length === TOKEN_LENGTH && /^[a-f0-9]+$/i.test(value);
    }
}

export function buildResolveUrl(provider, apiKey, torrentId, hostUrl) {
    if (!hostUrl) return null;

    const token = ApiKeySecurityManager.generateSecureToken(provider, apiKey);
    const config = encryptConfig({ DebridProvider: provider, DebridApiKey: apiKey });
    const prefix = config ? `/${config}` : '';
    return `${process.env.ADDON_URL}${prefix}/resolve/${provider}/${token}/${torrentId}/${encode(hostUrl)}`;
}
