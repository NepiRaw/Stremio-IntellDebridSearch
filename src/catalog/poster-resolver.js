import { parseUnified } from '../utils/unified-torrent-parser.js';
import { hasObviousEpisodeIndicators, hasSeasonOnlyIndicators, isTechnicalTerm } from '../utils/media-patterns.js';
import { extractKeywords } from '../search/keyword-extractor.js';
import { romanToNumber } from '../utils/roman-numeral-utils.js';
import cache from '../utils/cache-manager.js';
import { logger } from '../utils/logger.js';
import {
    buildTMDbPosterUrl,
    fetchTMDbAlternativeTitles,
    fetchTMDbTVDetails,
    searchTMDbMedia
} from '../api/tmdb.js';
import { buildContentKey, buildFilenameAliasKey, getEnrichmentCache } from './enrichment-cache.js';

const ACCEPT_THRESHOLD = 0.82;
const FALLBACK_ACCEPT_THRESHOLD = 0.74;
const AMBIGUITY_DELTA = 0.08;
const DOMINANT_SINGLE_CANDIDATE_THRESHOLD = 0.64;
const DOMINANT_SINGLE_CANDIDATE_DELTA = 0.12;
const SUPPORT_NEUTRAL_SCORE = 0.6;
const POSTER_RESOLUTION_CACHE_PREFIX = 'poster_resolution:';
const POSTER_RESOLUTION_POSITIVE_L1_TTL_SECONDS = 6 * 3600;
const POSTER_RESOLUTION_NEGATIVE_L1_TTL_SECONDS = 1800;
const STOPWORDS = new Set(['a', 'an', 'and', 'de', 'du', 'des', 'en', 'for', 'in', 'la', 'le', 'les', 'my', 'of', 'on', 'or', 'the', 'to', 'with']);
const WEAK_TITLE_TOKENS = new Set(['film', 'movie']);
const FLEXIBLE_SERIES_PART_PATTERN = /\bS(\d{1,2})([A-DF-Z])(\d{2,3})\b/i;

function buildPosterResolutionCacheKey(contentKey) {
    return `${POSTER_RESOLUTION_CACHE_PREFIX}${contentKey}`;
}

function readCachedResolution(contentKey) {
    if (!contentKey) {
        return null;
    }

    return cache.get(buildPosterResolutionCacheKey(contentKey));
}

function writeCachedResolution(resolution) {
    if (!resolution?.contentKey) {
        return;
    }

    cache.set(
        buildPosterResolutionCacheKey(resolution.contentKey),
        resolution,
        resolution.isNegative ? POSTER_RESOLUTION_NEGATIVE_L1_TTL_SECONDS : POSTER_RESOLUTION_POSITIVE_L1_TTL_SECONDS,
        {
            type: 'poster_resolution',
            accepted: !resolution.isNegative,
            reason: resolution.reason || 'unknown'
        }
    );
}

function buildPosterResultFromResolution(resolution) {
    if (!resolution || resolution.isNegative || !resolution.posterUrl) {
        return null;
    }

    return {
        posterUrl: resolution.posterUrl,
        posterShape: resolution.posterShape || 'poster',
        tmdbId: resolution.tmdbId,
        imdbId: resolution.imdbId || null,
        mediaType: resolution.mediaType,
        matchedTitle: resolution.matchedTitle,
        score: resolution.score,
        reason: resolution.reason,
        matchSource: resolution.matchSource
    };
}

function buildAcceptedResolution(context, decision) {
    const selected = decision.selectedCandidate;
    const posterUrl = buildTMDbPosterUrl(selected.posterPath);

    if (!posterUrl) {
        return null;
    }

    return {
        contentKey: context.contentKey,
        normalizedTitle: context.normalizedTitle,
        releaseYear: context.releaseYear,
        mediaHint: context.inferredType,
        tmdbId: selected.id,
        imdbId: null,
        mediaType: selected.mediaType,
        matchedTitle: selected.displayTitle,
        score: selected.score,
        reason: decision.reason,
        matchSource: selected.bestTitleMatch?.source || 'unknown',
        posterUrl,
        posterPath: selected.posterPath,
        posterShape: 'poster',
        isNegative: false
    };
}

function buildNegativeResolution(context, decision) {
    return {
        contentKey: context.contentKey,
        normalizedTitle: context.normalizedTitle,
        releaseYear: context.releaseYear,
        mediaHint: context.inferredType,
        tmdbId: decision?.selectedCandidate?.id ?? null,
        imdbId: null,
        mediaType: decision?.selectedCandidate?.mediaType ?? null,
        matchedTitle: decision?.selectedCandidate?.displayTitle ?? null,
        score: decision?.selectedCandidate?.score ?? null,
        reason: decision?.reason || 'rejected',
        matchSource: decision?.selectedCandidate?.bestTitleMatch?.source || null,
        posterUrl: null,
        posterPath: null,
        posterShape: 'poster',
        isNegative: true
    };
}

function persistResolution(persistentCache, resolution, context) {
    if (!persistentCache || !resolution?.contentKey) {
        return resolution;
    }

    const storedResolution = persistentCache.storeContentResolution(resolution);
    if (context?.filenameAliasKey) {
        persistentCache.storeAlias({
            aliasKey: context.filenameAliasKey,
            aliasType: 'filename',
            contentKey: resolution.contentKey,
            expiresAt: storedResolution?.expiresAt || resolution.expiresAt
        });
    }

    return storedResolution || resolution;
}

function endpointToMediaType(endpoint) {
    return endpoint === 'tv' ? 'series' : 'movie';
}

function mediaTypeToEndpoint(mediaType) {
    return mediaType === 'series' ? 'tv' : 'movie';
}

function normalizeToken(token) {
    const trimmed = (token || '').trim();
    if (!trimmed) {
        return '';
    }

    const romanValue = romanToNumber(trimmed.toUpperCase());
    if (romanValue !== null) {
        return String(romanValue);
    }

    return trimmed.toLowerCase();
}

function normalizeTitle(value) {
    return extractKeywords(value || '')
        .split(/\s+/)
        .map(normalizeToken)
        .filter(Boolean)
        .join(' ')
        .trim();
}

function compactLooseTitle(value) {
    return String(value || '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '');
}

function meaningfulTokens(value) {
    return normalizeTitle(value)
        .split(/\s+/)
        .map(token => token.trim())
        .filter(token => token && !STOPWORDS.has(token));
}

function dedupeNonEmpty(values = []) {
    return [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))];
}

function isLikelyAliasSegment(value) {
    const trimmed = String(value || '').trim();
    if (!trimmed || trimmed.length < 3 || /^\d{4}$/.test(trimmed) || /\d/.test(trimmed)) {
        return false;
    }

    if (isTechnicalTerm(trimmed)) {
        return false;
    }

    return meaningfulTokens(trimmed).length > 0;
}

function buildQueryTitleVariants(queryTitle) {
    const rawTitle = String(queryTitle || '').trim();
    if (!rawTitle) {
        return [];
    }

    const strippedParenthetical = rawTitle
        .replace(/\s*\([^)]*\)/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
    const parentheticalAliases = [...rawTitle.matchAll(/\(([^)]+)\)/g)]
        .map(match => match[1]?.trim())
        .filter(isLikelyAliasSegment);

    return dedupeNonEmpty([
        rawTitle,
        strippedParenthetical,
        ...parentheticalAliases
    ]);
}

function buildSearchQueryVariants(queryTitle) {
    const rawTitle = String(queryTitle || '').trim();
    if (!rawTitle) {
        return [];
    }

    const strippedParenthetical = rawTitle
        .replace(/\s*\([^)]*\)/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();

    return dedupeNonEmpty([
        rawTitle,
        strippedParenthetical
    ]);
}

function extractFlexibleSeriesPartInfo(value) {
    const match = String(value || '').match(FLEXIBLE_SERIES_PART_PATTERN);
    if (!match) {
        return null;
    }

    return {
        season: Number.parseInt(match[1], 10),
        marker: match[0],
        designator: match[2].toUpperCase(),
        index: Number.parseInt(match[3], 10)
    };
}

function stripFlexibleSeriesPartMarker(value) {
    return String(value || '')
        .replace(FLEXIBLE_SERIES_PART_PATTERN, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

function compareTitles(queryTitle, candidateTitle) {
    const normalizedQuery = normalizeTitle(queryTitle);
    const normalizedCandidate = normalizeTitle(candidateTitle);

    if (!normalizedQuery || !normalizedCandidate) {
        return {
            normalizedQuery,
            normalizedCandidate,
            exact: false,
            overlap: 0,
            sequelMismatch: false,
            distinctSemanticDifference: false,
            extraQueryTokens: [],
            extraCandidateTokens: []
        };
    }

    const queryTokens = meaningfulTokens(normalizedQuery);
    const candidateTokens = meaningfulTokens(normalizedCandidate);
    const rawQueryTokens = normalizedQuery.split(/\s+/).filter(Boolean);
    const rawCandidateTokens = normalizedCandidate.split(/\s+/).filter(Boolean);
    const querySet = new Set(queryTokens);
    const candidateSet = new Set(candidateTokens);
    const common = queryTokens.filter(token => candidateSet.has(token));
    const overlap = common.length / Math.max(queryTokens.length || 1, candidateTokens.length || 1);
    const extraQueryTokens = queryTokens.filter(token => !candidateSet.has(token));
    const extraCandidateTokens = candidateTokens.filter(token => !querySet.has(token));
    const rawQuerySet = new Set(rawQueryTokens);
    const rawCandidateSet = new Set(rawCandidateTokens);
    const rawExtraQueryTokens = rawQueryTokens.filter(token => !rawCandidateSet.has(token));
    const rawExtraCandidateTokens = rawCandidateTokens.filter(token => !rawQuerySet.has(token));
    const compactNormalizedQuery = normalizedQuery.replace(/\s+/g, '');
    const compactNormalizedCandidate = normalizedCandidate.replace(/\s+/g, '');
    const looseCompactQuery = compactLooseTitle(queryTitle);
    const looseCompactCandidate = compactLooseTitle(candidateTitle);
    const punctuationEquivalent = compactNormalizedQuery === compactNormalizedCandidate;
    const looseCompactEquivalent = Boolean(looseCompactQuery) && looseCompactQuery === looseCompactCandidate;
    const exact = normalizedQuery === normalizedCandidate || punctuationEquivalent || looseCompactEquivalent;
    const numberTokensQuery = queryTokens.filter(token => /^\d+$/.test(token));
    const numberTokensCandidate = candidateTokens.filter(token => /^\d+$/.test(token));
    const sequelMismatch = numberTokensQuery.join(',') !== numberTokensCandidate.join(',') && (numberTokensQuery.length > 0 || numberTokensCandidate.length > 0);
    const distinctSemanticDifference = !exact && (
        extraQueryTokens.length > 0
        || extraCandidateTokens.length > 0
        || rawExtraQueryTokens.length > 0
        || rawExtraCandidateTokens.length > 0
    );

    return {
        normalizedQuery,
        normalizedCandidate,
        exact,
        overlap: Number(overlap.toFixed(3)),
        sequelMismatch,
        distinctSemanticDifference,
        extraQueryTokens,
        extraCandidateTokens
    };
}

function buildTitleVariants(candidate) {
    const variants = [];

    if (candidate.displayTitle) {
        variants.push({ source: 'display', value: candidate.displayTitle });
    }

    if (candidate.originalTitle && candidate.originalTitle !== candidate.displayTitle) {
        variants.push({ source: 'original', value: candidate.originalTitle });
    }

    for (const altTitle of candidate.alternativeTitles || []) {
        if (altTitle?.title) {
            variants.push({ source: 'alternative', value: altTitle.title });
        }
    }

    return variants;
}

function chooseBestTitleMatch(queryTitle, candidate) {
    const queryVariants = buildQueryTitleVariants(queryTitle);
    const variants = buildTitleVariants(candidate);
    let best = {
        source: 'none',
        querySource: 'query',
        value: null,
        exact: false,
        overlap: 0,
        sequelMismatch: false,
        distinctSemanticDifference: false,
        extraQueryTokens: [],
        extraCandidateTokens: []
    };

    for (const candidateVariant of variants) {
        for (const queryVariant of queryVariants) {
            const comparison = compareTitles(queryVariant, candidateVariant.value);
            const better = comparison.exact && !best.exact
                || (comparison.exact === best.exact && comparison.overlap > best.overlap)
                || (comparison.exact === best.exact && comparison.overlap === best.overlap && best.source === 'none');

            if (better) {
                best = {
                    source: candidateVariant.source,
                    querySource: queryVariant === queryTitle ? 'query' : 'query-variant',
                    value: candidateVariant.value,
                    ...comparison
                };
            }
        }
    }

    return best;
}

function yearDistanceScore(parsedYear, candidateDate) {
    if (!parsedYear) {
        return 0.6;
    }

    const candidateYear = Number.parseInt(String(candidateDate || '').slice(0, 4), 10);
    if (!Number.isFinite(candidateYear)) {
        return 0.15;
    }

    const distance = Math.abs(parsedYear - candidateYear);
    if (distance === 0) return 1;
    if (distance === 1) return 0.75;
    if (distance === 2) return 0.35;
    return 0;
}

function inferProvisionalType(filename, parsed) {
    const hasEpisodeMarkers = hasObviousEpisodeIndicators(filename);
    const hasSeasonMarkers = hasSeasonOnlyIndicators(filename);
    const flexibleSeriesPartInfo = extractFlexibleSeriesPartInfo(filename);

    if (parsed?.episode || parsed?.absoluteEpisode) {
        return 'series';
    }

    if (flexibleSeriesPartInfo) {
        return 'series';
    }

    if (parsed?.season && (hasEpisodeMarkers || hasSeasonMarkers)) {
        return 'series';
    }

    if (hasEpisodeMarkers || hasSeasonMarkers) {
        return 'series';
    }

    return 'movie';
}

function isClearlyEpisodic(filename, parsed) {
    return Boolean(hasObviousEpisodeIndicators(filename) || hasSeasonOnlyIndicators(filename) || parsed?.episode || parsed?.absoluteEpisode);
}

function shouldIgnoreTitleSuffixAbsoluteEpisode(filename, parsed) {
    if (!parsed?.absoluteEpisode || !parsed?.title) {
        return false;
    }

    if (hasObviousEpisodeIndicators(filename) || hasSeasonOnlyIndicators(filename) || parsed?.season) {
        return false;
    }

    const normalizedTitle = normalizeTitle(parsed.title);
    if (!normalizedTitle) {
        return false;
    }

    const titleTokens = normalizedTitle.split(/\s+/).filter(Boolean);
    if (titleTokens.length < 2) {
        return false;
    }

    return titleTokens[titleTokens.length - 1] === String(parsed.absoluteEpisode);
}

function sanitizeParsedForPosterLookup(filename, parsed) {
    if (!parsed) {
        return parsed;
    }

    let sanitized = parsed;

    if (shouldIgnoreTitleSuffixAbsoluteEpisode(filename, parsed)) {
        sanitized = {
            ...sanitized,
            episode: parsed.episode === parsed.absoluteEpisode ? null : parsed.episode,
            absoluteEpisode: null
        };
    }

    const flexibleSeriesPartInfo = extractFlexibleSeriesPartInfo(filename);
    if (!flexibleSeriesPartInfo) {
        return sanitized;
    }

    const cleanedTitle = stripFlexibleSeriesPartMarker(sanitized.title || '');
    return {
        ...sanitized,
        title: cleanedTitle || sanitized.title,
        season: sanitized.season || flexibleSeriesPartInfo.season,
        episode: null,
        absoluteEpisode: null
    };
}

function isJunkParsedTitle(title) {
    const normalized = normalizeTitle(title);
    if (!normalized) {
        return true;
    }

    if (/^(season|saison|episode|episodio)\s+\d+$/i.test(normalized)) {
        return true;
    }

    const tokens = meaningfulTokens(normalized);
    if (tokens.length === 0) {
        return true;
    }

    if (tokens.length === 1 && /^(season|saison|episode|episodio)$/.test(tokens[0])) {
        return true;
    }

    return false;
}

function seasonSupportScore(context, candidate) {
    const parsedSeason = context.parsed?.season;
    if (!parsedSeason) {
        return 0.6;
    }

    if (candidate.mediaType !== 'series') {
        return context.isClearlyEpisodic ? 0.05 : 0.55;
    }

    const numberOfSeasons = candidate.details?.number_of_seasons;
    if (!Number.isFinite(numberOfSeasons)) {
        return 0.7;
    }

    return parsedSeason <= numberOfSeasons ? 1 : 0.05;
}

function episodeSupportScore(context, candidate) {
    const parsedEpisode = context.parsed?.episode || context.parsed?.absoluteEpisode;
    if (!parsedEpisode) {
        return 0.6;
    }

    if (candidate.mediaType !== 'series') {
        return 0.05;
    }

    const numberOfEpisodes = candidate.details?.number_of_episodes;
    if (!Number.isFinite(numberOfEpisodes)) {
        return 0.75;
    }

    return parsedEpisode <= numberOfEpisodes ? 1 : 0.05;
}

function supportSourceScore(source) {
    if (source === 'display') return 1;
    if (source === 'alternative') return 0.98;
    if (source === 'original') return 0.9;
    return 0;
}

function hasOnlyWeakQueryExtras(bestTitleMatch) {
    if (!bestTitleMatch?.extraQueryTokens?.length) {
        return false;
    }

    return bestTitleMatch.extraQueryTokens.every(token => WEAK_TITLE_TOKENS.has(token))
        && (bestTitleMatch.extraCandidateTokens?.length || 0) === 0;
}

function hasWeakMovieInference(context) {
    if (context?.inferredType !== 'movie') {
        return false;
    }

    if (context?.parsed?.year) {
        return false;
    }

    return !/\b(movie|film)\b/i.test(context?.parsedTitle || '');
}

function shouldSkipWeakMovieExactTitleAmbiguity(context, endpointResults) {
    if (!hasWeakMovieInference(context)) {
        return false;
    }

    const topMovie = endpointResults.movie?.[0] || null;
    const topSeries = endpointResults.tv?.[0] || null;
    if (!topMovie || !topSeries) {
        return false;
    }

    if (!topMovie.bestTitleMatch?.exact || !topSeries.bestTitleMatch?.exact) {
        return false;
    }

    const normalizedMovieTitle = normalizeTitle(topMovie.displayTitle || topMovie.bestTitleMatch?.value || '');
    const normalizedSeriesTitle = normalizeTitle(topSeries.displayTitle || topSeries.bestTitleMatch?.value || '');
    if (!normalizedMovieTitle || normalizedMovieTitle !== normalizedSeriesTitle) {
        return false;
    }

    return Math.abs(topMovie.score - topSeries.score) <= AMBIGUITY_DELTA;
}

function canUseDominantSingleCandidateRescue(context, best, second) {
    if (!best || best.score >= ACCEPT_THRESHOLD || !best.posterPath) {
        return false;
    }

    if (best.mediaType !== context.inferredType || best.bestTitleMatch?.sequelMismatch) {
        return false;
    }

    if (best.score < DOMINANT_SINGLE_CANDIDATE_THRESHOLD) {
        return false;
    }

    if (!best.bestTitleMatch?.exact && best.bestTitleMatch?.overlap < 0.85) {
        return false;
    }

    if (second && (best.score - second.score) < DOMINANT_SINGLE_CANDIDATE_DELTA) {
        return false;
    }

    if (!best.bestTitleMatch?.distinctSemanticDifference) {
        return true;
    }

    return hasOnlyWeakQueryExtras(best.bestTitleMatch);
}

function applySeriesAmbiguityTieBreak(context, candidates) {
    if (!Array.isArray(candidates) || candidates.length === 0) {
        return candidates;
    }

    if (!(context.parsed?.season || context.parsed?.episode || context.parsed?.absoluteEpisode)) {
        return candidates;
    }

    const exactSeriesCandidates = candidates.filter(candidate => candidate.mediaType === 'series' && candidate.bestTitleMatch?.exact);
    if (exactSeriesCandidates.length < 2) {
        return candidates;
    }

    const topExactScore = Math.max(...exactSeriesCandidates.map(candidate => candidate.score));
    const contenders = exactSeriesCandidates.filter(candidate => (topExactScore - candidate.score) <= AMBIGUITY_DELTA);
    if (contenders.length < 2) {
        return candidates;
    }

    const contenderKeys = new Set(contenders.map(candidate => `${candidate.endpoint}:${candidate.id}`));

    return candidates
        .map(candidate => {
            const contenderKey = `${candidate.endpoint}:${candidate.id}`;
            if (!contenderKeys.has(contenderKey)) {
                return candidate;
            }

            const adjustedScore = candidate.score
                + (0.12 * (candidate.supportBreakdown.seasonScore - SUPPORT_NEUTRAL_SCORE))
                + (0.08 * (candidate.supportBreakdown.episodeScore - SUPPORT_NEUTRAL_SCORE));

            return {
                ...candidate,
                score: Number(adjustedScore.toFixed(3)),
                supportBreakdown: {
                    ...candidate.supportBreakdown,
                    appliedSeasonScore: candidate.supportBreakdown.seasonScore,
                    appliedEpisodeScore: candidate.supportBreakdown.episodeScore,
                    usedSeriesAmbiguityTieBreak: true
                }
            };
        })
        .sort((a, b) => b.score - a.score);
}

function scoreCandidate(context, candidate) {
    const bestTitleMatch = chooseBestTitleMatch(context.parsedTitle, candidate);
    const titleScore = bestTitleMatch.exact ? 1 : bestTitleMatch.overlap;
    const sourceScore = supportSourceScore(bestTitleMatch.source) || titleScore;
    const typeScore = candidate.mediaType === context.inferredType ? 1 : 0.15;
    const episodicScore = context.isClearlyEpisodic
        ? (candidate.mediaType === 'series' ? 1 : 0.1)
        : 0.6;
    const yearScore = yearDistanceScore(context.parsed?.year, candidate.displayDate);
    const seasonScore = seasonSupportScore(context, candidate);
    const episodeScore = episodeSupportScore(context, candidate);
    const appliedSeasonScore = SUPPORT_NEUTRAL_SCORE;
    const appliedEpisodeScore = SUPPORT_NEUTRAL_SCORE;

    let finalScore = (0.38 * titleScore)
        + (0.12 * sourceScore)
        + (0.15 * yearScore)
        + (0.08 * typeScore)
        + (0.07 * episodicScore)
        + (0.12 * appliedSeasonScore)
        + (0.08 * appliedEpisodeScore);

    if (!candidate.posterPath) {
        finalScore -= 0.35;
    }

    if (bestTitleMatch.distinctSemanticDifference && !bestTitleMatch.exact) {
        finalScore -= bestTitleMatch.sequelMismatch ? 0.35 : 0.18;
    }

    if (candidate.mediaType === 'movie' && context.isClearlyEpisodic) {
        finalScore -= 0.08;
    }

    return {
        ...candidate,
        score: Number(finalScore.toFixed(3)),
        bestTitleMatch,
        supportBreakdown: {
            seasonScore: Number(seasonScore.toFixed(3)),
            episodeScore: Number(episodeScore.toFixed(3)),
            appliedSeasonScore: Number(appliedSeasonScore.toFixed(3)),
            appliedEpisodeScore: Number(appliedEpisodeScore.toFixed(3)),
            usedSeriesAmbiguityTieBreak: false
        }
    };
}

async function enrichCandidate(candidate, endpoint) {
    const alternativeTitles = await fetchTMDbAlternativeTitles(candidate.id, candidate.mediaType);
    const details = candidate.mediaType === 'series'
        ? await fetchTMDbTVDetails(candidate.id)
        : null;

    return {
        ...candidate,
        endpoint,
        alternativeTitles,
        details
    };
}

async function analyzeEndpoint(context, endpoint) {
    const mediaType = endpointToMediaType(endpoint);
    const queryVariants = buildSearchQueryVariants(context.parsedTitle);
    let baseResults = [];

    for (const queryTitle of queryVariants) {
        const results = await searchTMDbMedia({
            title: queryTitle,
            type: mediaType,
            year: context.parsed?.year ?? null,
            limit: endpoint === 'tv' ? 3 : 2
        });

        if (results.length > 0) {
            baseResults = results;
            break;
        }
    }

    const enrichedCandidates = await Promise.all(baseResults.map(candidate => enrichCandidate(candidate, endpoint)));
    return enrichedCandidates
        .map(candidate => scoreCandidate(context, candidate))
        .sort((a, b) => b.score - a.score);
}

function buildDecision(context, endpointResults) {
    const allCandidates = applySeriesAmbiguityTieBreak(context, Object.values(endpointResults)
        .flat()
        .sort((a, b) => b.score - a.score));

    const best = allCandidates[0] || null;
    const second = allCandidates[1] || null;
    const primaryEndpoint = mediaTypeToEndpoint(context.inferredType);
    const primaryBest = endpointResults[primaryEndpoint]?.[0] || null;

    if (!best) {
        return {
            accepted: false,
            reason: 'no-candidates',
            selectedCandidate: null
        };
    }

    if (shouldSkipWeakMovieExactTitleAmbiguity(context, endpointResults)) {
        return {
            accepted: false,
            reason: 'ambiguous-exact-cross-endpoint',
            selectedCandidate: null
        };
    }

    if (
        best.score < ACCEPT_THRESHOLD
        && best.endpoint !== primaryEndpoint
        && best.bestTitleMatch.exact
        && Boolean(best.posterPath)
        && (!primaryBest || !primaryBest.bestTitleMatch?.exact || primaryBest.score < best.score)
        && best.score >= FALLBACK_ACCEPT_THRESHOLD
    ) {
        return {
            accepted: true,
            reason: 'accepted-exact-fallback',
            selectedCandidate: best
        };
    }

    if (canUseDominantSingleCandidateRescue(context, best, second)) {
        return {
            accepted: true,
            reason: 'accepted-dominant-single-candidate',
            selectedCandidate: best
        };
    }

    if (best.score < ACCEPT_THRESHOLD) {
        return {
            accepted: false,
            reason: `below-threshold:${best.score}`,
            selectedCandidate: best
        };
    }

    if (second && (best.score - second.score) < AMBIGUITY_DELTA && !best.bestTitleMatch.exact) {
        return {
            accepted: false,
            reason: `ambiguous:${best.score}-${second.score}`,
            selectedCandidate: best
        };
    }

    return {
        accepted: true,
        reason: 'accepted',
        selectedCandidate: best
    };
}

export function isCatalogPosterEnabled() {
    return String(process.env.ENABLE_CATALOG_POSTERS || 'false').toLowerCase() === 'true';
}

export function createPosterLookupContext(torrent) {
    if (!isCatalogPosterEnabled()) {
        return null;
    }

    const filename = torrent?.name || torrent?.filename || '';
    if (!filename) {
        return null;
    }

    const rawParsed = parseUnified(filename);
    const ignoredTitleSuffixAbsoluteEpisode = shouldIgnoreTitleSuffixAbsoluteEpisode(filename, rawParsed);
    const parsed = sanitizeParsedForPosterLookup(filename, rawParsed);
    const parsedTitle = parsed?.title?.trim() || '';
    if (!parsedTitle || isJunkParsedTitle(parsedTitle)) {
        return null;
    }

    const inferredType = ignoredTitleSuffixAbsoluteEpisode
        ? 'series'
        : inferProvisionalType(filename, parsed);
    const normalizedTitle = normalizeTitle(parsedTitle);
    const releaseYear = String(parsed?.year || 'none');
    const contentKey = buildContentKey({
        normalizedTitle,
        releaseYear,
        mediaHint: inferredType
    });

    return {
        filename,
        parsed,
        parsedTitle,
        normalizedTitle,
        releaseYear,
        inferredType,
        isClearlyEpisodic: isClearlyEpisodic(filename, parsed),
        contentKey,
        cacheKey: contentKey,
        filenameAliasKey: buildFilenameAliasKey(filename)
    };
}

export async function resolveContentFromContext(context) {
    if (!context) {
        return null;
    }

    const cachedResolution = readCachedResolution(context.contentKey);
    if (cachedResolution) {
        return cachedResolution;
    }

    const persistentCache = getEnrichmentCache();
    if (persistentCache && context.filenameAliasKey) {
        const aliasHit = persistentCache.getContentResolutionByAlias(context.filenameAliasKey);
        if (aliasHit) {
            writeCachedResolution(aliasHit);
            return aliasHit;
        }
    }

    if (persistentCache && context.contentKey) {
        const persistentHit = persistentCache.getContentResolution(context.contentKey);
        if (persistentHit) {
            if (context.filenameAliasKey) {
                persistentCache.storeAlias({
                    aliasKey: context.filenameAliasKey,
                    aliasType: 'filename',
                    contentKey: context.contentKey,
                    expiresAt: persistentHit.expiresAt
                });
            }

            writeCachedResolution(persistentHit);
            return persistentHit;
        }
    }

    const [movieCandidates, tvCandidates] = await Promise.all([
        analyzeEndpoint(context, 'movie'),
        analyzeEndpoint(context, 'tv')
    ]);

    const decision = buildDecision(context, {
        movie: movieCandidates,
        tv: tvCandidates
    });

    const resolution = decision.accepted && decision.selectedCandidate?.posterPath
        ? buildAcceptedResolution(context, decision)
        : buildNegativeResolution(context, decision);

    if (!resolution) {
        return null;
    }

    const storedResolution = persistResolution(persistentCache, resolution, context);
    writeCachedResolution(storedResolution);

    if (storedResolution.isNegative) {
        logger.debug(`[poster-resolver] No poster accepted for "${context.filename}" (${storedResolution.reason})`);
    } else {
        logger.debug(`[poster-resolver] Poster resolved for "${context.filename}" -> ${storedResolution.matchedTitle} [${storedResolution.mediaType}] (${storedResolution.reason})`);
    }

    return storedResolution;
}

export async function resolvePosterFromContext(context) {
    const resolution = await resolveContentFromContext(context);
    return buildPosterResultFromResolution(resolution);
}

export async function resolvePosterForTorrent(torrent) {
    const context = createPosterLookupContext(torrent);
    return resolvePosterFromContext(context);
}
