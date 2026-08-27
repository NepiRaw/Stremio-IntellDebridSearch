/**
 * The one error a user can act on, rendered as a stream row.
 * Stremio gives an addon no error channel, so a rejected API key looks exactly like an empty
 * library. Auth failures alone get a row: an outage or a rate limit stays logged and silent.
 */

import { ProviderAuthError } from '../providers/errors.js';

const STREAM_NAME = '⚠️ Intell DebridSearch';

/** @returns {Array} one stream for an auth failure, nothing for anything else. */
export function authErrorStreams(error) {
    if (!(error instanceof ProviderAuthError)) return [];

    const configureUrl = process.env.ADDON_URL ? `${process.env.ADDON_URL}/configure` : null;
    const stream = {
        name: STREAM_NAME,
        title: error.userMessage ?? `Your ${error.provider} API key was rejected.\nOpen the addon configuration page to update it.`
    };
    if (configureUrl) stream.externalUrl = configureUrl;

    return [stream];
}
