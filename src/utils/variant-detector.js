/**
 * Variant Detection System
 * A release whose title embeds the queried title but names a different work, typically a spin-off.
 * Reported for display only: nothing is filtered on it.
 * Can be disabled from environment variable.
 */

const SIMILARITY_THRESHOLD = 0.85;

function normalizeTitle(value) {
    if (!value || typeof value !== 'string') {
        return '';
    }

    return value
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function wordOverlap(left, right) {
    const leftWords = left.split(' ').filter(Boolean);
    const rightWords = right.split(' ').filter(Boolean);

    if (!leftWords.length || !rightWords.length) {
        return 0;
    }

    const common = leftWords.filter(word => rightWords.includes(word));
    return common.length / Math.max(leftWords.length, rightWords.length);
}

function capitalizeWords(text) {
    return text
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

function normalizeAlternatives(searchContext) {
    return (searchContext?.alternativeTitles ?? [])
        .map(entry => normalizeTitle(entry?.title || entry?.normalizedTitle || entry))
        .filter(Boolean);
}

/**
 * @param {Object} parsed - the file's ParseResult
 * @param {Object} containerParsed - the torrent's ParseResult, consulted only where the file is silent
 * @param {Object} searchContext - { searchTitle, alternativeTitles }
 * @returns {{isVariant: boolean, variantName: string|null}}
 */
export function detectSimpleVariant(parsed, containerParsed, searchContext) {
    const none = { isVariant: false, variantName: null };

    const searchTitle = normalizeTitle(searchContext?.searchTitle);
    if (!searchTitle) {
        return none;
    }

    const alternatives = normalizeAlternatives(searchContext);
    const knownTitles = [searchTitle, ...alternatives];

    const title = normalizeTitle(parsed?.title) || normalizeTitle(containerParsed?.title);
    if (!title) {
        return none;
    }

    const altTitle = normalizeTitle(parsed?.altTitle) || normalizeTitle(containerParsed?.altTitle);
    for (const identity of [title, altTitle].filter(Boolean)) {
        for (const known of knownTitles) {
            if (identity === known || wordOverlap(identity, known) > SIMILARITY_THRESHOLD) {
                return none;
            }
        }
    }

    const episodeTitle = normalizeTitle(parsed?.episodeTitle);

    // Longest first, so "Star Wars The Clone Wars" is subtracted rather than "Star Wars".
    for (const base of [...knownTitles].sort((left, right) => right.length - left.length)) {
        if (!title.includes(base)) {
            continue;
        }

        const residual = title.replace(base, ' ').replace(/\s+/g, ' ').trim();
        if (residual.length <= 2 || /^\d+$/.test(residual)) {
            continue;
        }

        if (alternatives.some(alternative => alternative.includes(residual) || residual.includes(alternative))) {
            return none;
        }

        if (episodeTitle && (residual.includes(episodeTitle) || episodeTitle.includes(residual))) {
            return none;
        }

        return { isVariant: true, variantName: capitalizeWords(residual) };
    }

    return none;
}
