/**
 * The set of addresses that name one wanted episode, and the test a filename is held to.
 *
 * Tier 1 is what the request itself states, plus the absolute number when that number
 * cannot also be read as a real episode of the season. 
 * Tier 2 reads the request's own number as an absolute and is consulted only when 
 * tier 1 matched nothing at all
 */

const inRange = (range, value) => Boolean(range) && value >= range.from && value <= range.to;

const holdsEpisode = (parsed, episode) =>
    Boolean(parsed) && (parsed.episodes?.includes(episode) || inRange(parsed.episodeRange, episode));

const statesSeason = (parsed, season) => Boolean(parsed?.seasons?.includes(season));

const statesNoSeason = parsed => !parsed?.seasons?.length;

export function buildEpisodeAddresses({ season, episode, absoluteEpisode = null, seasonOneLength = 0, remapped = null }) {
    const unambiguous = absoluteEpisode != null && seasonOneLength > 0 && absoluteEpisode > seasonOneLength;

    return Object.freeze({
        season: Number(season),
        episode: Number(episode),
        absoluteEpisode: unambiguous ? Number(absoluteEpisode) : null,
        remapped: remapped && remapped.season !== 0 ? Object.freeze({ ...remapped }) : null
    });
}

export function matchEpisodeAddress(parsed, addresses) {
    if (!parsed || !addresses) {
        return null;
    }

    const { season, episode, absoluteEpisode, remapped } = addresses;

    if (statesSeason(parsed, season) && holdsEpisode(parsed, episode)) {
        return { tier: 1, source: 'stated', season, episode };
    }

    if (season === 1 && statesNoSeason(parsed) && holdsEpisode(parsed, episode)) {
        return { tier: 1, source: 'season-fallback', season, episode };
    }

    if (absoluteEpisode != null) {
        const labelled = statesSeason(parsed, 1) && holdsEpisode(parsed, absoluteEpisode);
        const bare = statesNoSeason(parsed) &&
            (holdsEpisode(parsed, absoluteEpisode) || parsed.absoluteEpisode === absoluteEpisode);

        if (labelled || bare) {
            return { tier: 1, source: 'absolute', season, episode };
        }
    }

    if (remapped && statesSeason(parsed, remapped.season) && holdsEpisode(parsed, remapped.episode)) {
        return { tier: 2, source: 'remap', season: remapped.season, episode: remapped.episode };
    }

    return null;
}

/** Tier 2 exists only for the case where nothing was found at tier 1. */
export function keepBestTier(entries) {
    const matched = entries.filter(entry => entry.match);
    const firstTier = matched.filter(entry => entry.match.tier === 1);

    return firstTier.length ? firstTier : matched;
}
