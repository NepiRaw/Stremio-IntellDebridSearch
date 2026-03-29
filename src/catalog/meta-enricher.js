import Cinemeta from '../api/cinemeta.js';
import { fetchTMDbExternalImdbId } from '../api/tmdb.js';
import { createPosterLookupContext, isCatalogPosterEnabled, resolvePosterFromContext } from './poster-resolver.js';
import cache from '../utils/cache-manager.js';
import { logger } from '../utils/logger.js';

const META_ENRICHMENT_CACHE_PREFIX = 'meta_enrichment:';
const META_ENRICHMENT_TTL_SECONDS = Number.parseInt(process.env.META_ENRICHMENT_TTL_SECONDS || '600', 10);
const DESCRIPTION_SEPARATOR = ' 📜 Synopsis: ';

function buildCacheKey(providerName, torrentDetails) {
    return `${META_ENRICHMENT_CACHE_PREFIX}${providerName}:${torrentDetails?.id || torrentDetails?.name || 'unknown'}`;
}

function buildDescription(baseDescription, synopsis) {
    if (baseDescription && synopsis) {
        return `${String(baseDescription).trimEnd()}${DESCRIPTION_SEPARATOR}${String(synopsis).trimStart()}`;
    }

    return synopsis || baseDescription || null;
}

function buildImdbLinks(imdbId, imdbRating, existingLinks = []) {
    if (!imdbId) {
        return existingLinks || [];
    }

    const imdbUrl = `https://www.imdb.com/title/${imdbId}`;
    const links = Array.isArray(existingLinks) ? [...existingLinks] : [];
    const hasImdbLink = links.some(link => link?.category === 'imdb' || link?.url === imdbUrl);

    if (!hasImdbLink) {
        links.unshift({
            name: imdbRating || 'IMDb',
            category: 'imdb',
            url: imdbUrl
        });
    }

    return links;
}

function pickGenres(cinemetaMeta) {
    if (Array.isArray(cinemetaMeta?.genres) && cinemetaMeta.genres.length > 0) {
        return cinemetaMeta.genres;
    }

    if (Array.isArray(cinemetaMeta?.genre) && cinemetaMeta.genre.length > 0) {
        return cinemetaMeta.genre;
    }

    return null;
}

function sanitizeFields(fields) {
    return Object.fromEntries(
        Object.entries(fields).filter(([, value]) => value !== null && value !== undefined)
    );
}

function buildEnrichmentFields(cinemetaMeta, posterResult, imdbId) {
    return sanitizeFields({
        poster: cinemetaMeta?.poster || posterResult?.posterUrl || null,
        posterShape: posterResult?.posterShape || 'poster',
        background: cinemetaMeta?.background || null,
        logo: cinemetaMeta?.logo || null,
        descriptionTail: cinemetaMeta?.description || null,
        releaseInfo: cinemetaMeta?.releaseInfo || null,
        imdbRating: cinemetaMeta?.imdbRating || null,
        imdb_id: imdbId || cinemetaMeta?.imdb_id || null,
        links: buildImdbLinks(imdbId || cinemetaMeta?.imdb_id || null, cinemetaMeta?.imdbRating || null, cinemetaMeta?.links),
        genres: pickGenres(cinemetaMeta),
        runtime: cinemetaMeta?.runtime || null
    });
}

function applyEnrichment(baseMeta, enrichmentFields) {
    if (!enrichmentFields) {
        return baseMeta;
    }

    const { descriptionTail, ...metaFields } = enrichmentFields;

    return {
        ...baseMeta,
        ...metaFields,
        description: buildDescription(baseMeta.description, descriptionTail)
    };
}

async function computeMetaEnrichment(providerName, torrentDetails) {
    const context = createPosterLookupContext(torrentDetails);
    if (!context) {
        return {
            accepted: false,
            reason: 'no-poster-context',
            fields: null
        };
    }

    const posterResult = await resolvePosterFromContext(context);
    if (!posterResult?.posterUrl) {
        return {
            accepted: false,
            reason: 'no-confident-poster-match',
            fields: null
        };
    }

    const imdbId = await fetchTMDbExternalImdbId(posterResult.tmdbId, posterResult.mediaType);
    if (!imdbId) {
        return {
            accepted: false,
            reason: 'matched-no-imdb-id',
            fields: null
        };
    }

    const cinemetaType = posterResult.mediaType === 'series' ? 'series' : 'movie';
    const cinemetaMeta = await Cinemeta.getMeta(cinemetaType, imdbId);
    if (!cinemetaMeta) {
        return {
            accepted: false,
            reason: 'cinemeta-miss',
            fields: null
        };
    }

    return {
        accepted: true,
        reason: 'enriched-from-cinemeta',
        fields: buildEnrichmentFields(cinemetaMeta, posterResult, imdbId),
        diagnostics: {
            providerName,
            torrentId: torrentDetails?.id || null,
            matchedTitle: posterResult.matchedTitle || null,
            matchedMediaType: posterResult.mediaType || null,
            matchedImdbId: imdbId,
            score: posterResult.score || null
        }
    };
}

async function getMetaEnrichment(providerName, torrentDetails) {
    if (!isCatalogPosterEnabled()) {
        return null;
    }

    const cacheKey = buildCacheKey(providerName, torrentDetails);
    const cached = cache.get(cacheKey);
    if (cached) {
        return cached;
    }

    try {
        const enrichment = await computeMetaEnrichment(providerName, torrentDetails);
        cache.set(cacheKey, enrichment, META_ENRICHMENT_TTL_SECONDS, {
            type: 'meta_enrichment',
            providerName,
            accepted: enrichment.accepted,
            reason: enrichment.reason
        });
        return enrichment;
    } catch (error) {
        logger.warn(`[meta-enricher] Failed to enrich meta for "${torrentDetails?.name || torrentDetails?.id || 'unknown'}": ${error.message}`);
        return null;
    }
}

export async function enrichTorrentMeta(baseMeta, { providerName, torrentDetails } = {}) {
    if (!baseMeta || !providerName || !torrentDetails) {
        return baseMeta;
    }

    const enrichment = await getMetaEnrichment(providerName, torrentDetails);
    if (!enrichment?.accepted || !enrichment.fields) {
        return baseMeta;
    }

    logger.debug(`[meta-enricher] Enriched meta for "${torrentDetails.name}" with ${enrichment.reason}`);
    return applyEnrichment(baseMeta, enrichment.fields);
}
