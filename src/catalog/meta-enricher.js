import Cinemeta from '../api/cinemeta.js';
import { fetchTMDbExternalImdbId } from '../api/tmdb.js';
import { getEnrichmentCache } from './enrichment-cache.js';
import { createPosterLookupContext, isCatalogPosterEnabled, resolveContentFromContext } from './poster-resolver.js';
import cache from '../utils/cache-manager.js';
import { logger } from '../utils/logger.js';

const META_ENRICHMENT_CACHE_PREFIX = 'meta_enrichment:';
const META_ENRICHMENT_TTL_SECONDS = Number.parseInt(process.env.META_ENRICHMENT_TTL_SECONDS || '600', 10);
const META_ENRICHMENT_NEGATIVE_TTL_SECONDS = Math.min(META_ENRICHMENT_TTL_SECONDS, 300);
const META_ENRICHMENT_SUSPECT_TTL_SECONDS = Math.min(META_ENRICHMENT_TTL_SECONDS, 900);
const DESCRIPTION_SEPARATOR = ' 📜 Synopsis: ';

function buildCacheKey(contentKey) {
    return `${META_ENRICHMENT_CACHE_PREFIX}${contentKey}`;
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

function writeCachedEnrichment(contentKey, enrichment) {
    if (!contentKey || !enrichment) {
        return;
    }

    const ttlSeconds = enrichment.accepted
        ? (enrichment.isSuspect ? META_ENRICHMENT_SUSPECT_TTL_SECONDS : META_ENRICHMENT_TTL_SECONDS)
        : META_ENRICHMENT_NEGATIVE_TTL_SECONDS;

    cache.set(buildCacheKey(contentKey), enrichment, ttlSeconds, {
        type: 'meta_enrichment',
        accepted: enrichment.accepted,
        reason: enrichment.reason || 'unknown',
        suspect: Boolean(enrichment.isSuspect)
    });
}

function readCachedEnrichment(contentKey) {
    if (!contentKey) {
        return null;
    }

    return cache.get(buildCacheKey(contentKey));
}

function buildEnrichmentFromPersistentMetadata(metadataRow, resolution) {
    if (!metadataRow) {
        return null;
    }

    if (metadataRow.isNegative) {
        return {
            accepted: false,
            reason: metadataRow.reason || 'metadata-miss',
            fields: null,
            isSuspect: false,
            suspectReason: null
        };
    }

    return {
        accepted: true,
        reason: metadataRow.reason || 'persistent-cache-hit',
        fields: sanitizeFields({
            poster: resolution?.posterUrl || null,
            posterShape: resolution?.posterShape || 'poster',
            background: metadataRow.background,
            logo: metadataRow.logo,
            descriptionTail: metadataRow.descriptionTail,
            releaseInfo: metadataRow.releaseInfo,
            imdbRating: metadataRow.imdbRating,
            imdb_id: resolution?.imdbId || null,
            links: buildImdbLinks(resolution?.imdbId || null, metadataRow.imdbRating || null, metadataRow.links),
            genres: metadataRow.genres,
            runtime: metadataRow.runtime
        }),
        isSuspect: metadataRow.isSuspect,
        suspectReason: metadataRow.suspectReason || null
    };
}

function assessMetadataQuality(cinemetaMeta, resolution, context) {
    const reasons = [];

    if (cinemetaMeta?.imdb_id && resolution?.imdbId && cinemetaMeta.imdb_id !== resolution.imdbId) {
        reasons.push('imdb-id-mismatch');
    }

    const parsedYear = Number.parseInt(String(context?.parsed?.year || ''), 10);
    const releaseYearMatch = String(cinemetaMeta?.releaseInfo || '').match(/\b(19|20)\d{2}\b/);
    if (Number.isFinite(parsedYear) && releaseYearMatch) {
        const releaseYear = Number.parseInt(releaseYearMatch[0], 10);
        if (Math.abs(parsedYear - releaseYear) > 2) {
            reasons.push('release-year-mismatch');
        }
    }

    return {
        isSuspect: reasons.length > 0,
        suspectReason: reasons.join(',') || null
    };
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
            fields: null,
            contentKey: null
        };
    }

    const resolution = await resolveContentFromContext(context);
    if (!resolution || resolution.isNegative || !resolution.posterUrl) {
        return {
            accepted: false,
            reason: 'no-confident-poster-match',
            fields: null,
            contentKey: context.contentKey
        };
    }

    const persistentCache = getEnrichmentCache();
    const cachedEnrichment = readCachedEnrichment(resolution.contentKey);
    if (cachedEnrichment) {
        return {
            ...cachedEnrichment,
            contentKey: resolution.contentKey
        };
    }

    const cachedMetadata = persistentCache?.getMetadata(resolution.contentKey)
        || (context.filenameAliasKey ? persistentCache?.getMetadataByAlias(context.filenameAliasKey) : null);
    if (cachedMetadata) {
        const enrichment = buildEnrichmentFromPersistentMetadata(cachedMetadata, resolution);
        writeCachedEnrichment(resolution.contentKey, enrichment);
        return {
            ...enrichment,
            contentKey: resolution.contentKey
        };
    }

    const imdbId = resolution.imdbId || await fetchTMDbExternalImdbId(resolution.tmdbId, resolution.mediaType);
    if (!imdbId) {
        const enrichment = {
            accepted: false,
            reason: 'matched-no-imdb-id',
            fields: null,
            isSuspect: false,
            suspectReason: null,
            contentKey: resolution.contentKey
        };

        writeCachedEnrichment(resolution.contentKey, enrichment);
        persistentCache?.storeMetadata({
            contentKey: resolution.contentKey,
            metaSource: 'tmdb',
            reason: enrichment.reason,
            isNegative: true
        });

        return {
            ...enrichment
        };
    }

    resolution.imdbId = imdbId;
    persistentCache?.storeContentResolution({
        ...resolution,
        imdbId
    });

    const cinemetaType = resolution.mediaType === 'series' ? 'series' : 'movie';
    const cinemetaMeta = await Cinemeta.getMeta(cinemetaType, imdbId);
    if (!cinemetaMeta) {
        const enrichment = {
            accepted: false,
            reason: 'cinemeta-miss',
            fields: null,
            isSuspect: false,
            suspectReason: null,
            contentKey: resolution.contentKey
        };

        writeCachedEnrichment(resolution.contentKey, enrichment);
        persistentCache?.storeMetadata({
            contentKey: resolution.contentKey,
            metaSource: 'cinemeta',
            reason: enrichment.reason,
            isNegative: true
        });

        return {
            ...enrichment
        };
    }

    const qualityAssessment = assessMetadataQuality(cinemetaMeta, resolution, context);
    const enrichment = {
        accepted: true,
        reason: 'enriched-from-cinemeta',
        fields: buildEnrichmentFields(cinemetaMeta, resolution, imdbId),
        isSuspect: qualityAssessment.isSuspect,
        suspectReason: qualityAssessment.suspectReason,
        contentKey: resolution.contentKey,
        diagnostics: {
            providerName,
            torrentId: torrentDetails?.id || null,
            matchedTitle: resolution.matchedTitle || null,
            matchedMediaType: resolution.mediaType || null,
            matchedImdbId: imdbId,
            score: resolution.score || null
        }
    };

    writeCachedEnrichment(resolution.contentKey, enrichment);
    persistentCache?.storeMetadata({
        contentKey: resolution.contentKey,
        background: enrichment.fields.background || null,
        logo: enrichment.fields.logo || null,
        descriptionTail: enrichment.fields.descriptionTail || null,
        releaseInfo: enrichment.fields.releaseInfo || null,
        imdbRating: enrichment.fields.imdbRating || null,
        genres: enrichment.fields.genres || null,
        runtime: enrichment.fields.runtime || null,
        links: enrichment.fields.links || null,
        metaSource: 'cinemeta',
        reason: enrichment.reason,
        isSuspect: enrichment.isSuspect,
        suspectReason: enrichment.suspectReason
    });

    return enrichment;
}

async function getMetaEnrichment(providerName, torrentDetails) {
    if (!isCatalogPosterEnabled()) {
        return null;
    }

    try {
        return await computeMetaEnrichment(providerName, torrentDetails);
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
