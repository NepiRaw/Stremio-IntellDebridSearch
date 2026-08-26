/**
 * The stream title block, built from a parse result. Pure functions, no I/O and no caching.
 */

import { detectSimpleVariant } from '../utils/variant-detector.js';
import { configManager } from '../config/configuration.js';

const LANGUAGE_FLAG = {
    fre: '🇫🇷', que: '🇫🇷', eng: '🇬🇧', jpn: '🇯🇵', spa: '🇪🇸', ger: '🇩🇪', deu: '🇩🇪',
    ita: '🇮🇹', kor: '🇰🇷', chi: '🇨🇳', zho: '🇨🇳', rus: '🇷🇺', por: '🇵🇹', dan: '🇩🇰',
    dut: '🇳🇱', nld: '🇳🇱', swe: '🇸🇪', nor: '🇳🇴', fin: '🇫🇮', pol: '🇵🇱', tur: '🇹🇷',
    ara: '🇸🇦', hin: '🇮🇳', tha: '🇹🇭', vie: '🇻🇳', ind: '🇮🇩', heb: '🇮🇱', ces: '🇨🇿',
    hun: '🇭🇺', ell: '🇬🇷', ukr: '🇺🇦', ron: '🇷🇴'
};

/** Releases are labelled in scene vocabulary rather than by the language name. */
const SPOKEN_LABEL = { que: 'VFQ' };
const SUBTITLE_LABEL = { fre: 'VOSTFR', que: 'VOSTFR' };

const SOURCE_ICON = {
    BluRay: '📀', 'UHD BluRay': '📀', REMUX: '📀', 'BR-DISK': '📀', 'HD-DVD': '📀',
    BDRip: '💿', BRRip: '💿', HDRip: '💿', DVD: '📀', DVDR: '📀',
    'WEB-DL': '🌐', WEBRip: '🌐', WEBMux: '🌐', WEB: '🌐', IPTV: '🌐', VODRip: '🌐',
    HDTV: '📺', PDTV: '📺', SDTV: '📺', TVRip: '📺', SATRip: '📺'
};

const LOSSLESS_AUDIO = new Set(['TrueHD', 'DTS-HD MA', 'DTS-HD', 'DTS-X', 'DTS-ES', 'DTS', 'LPCM', 'PCM', 'Atmos']);

const HDR_LABEL = { DV: 'Dolby Vision' };

/** What the torrent contains, which says nothing about the single file being played. */
const PACK_EDITIONS = new Set(['OVA', 'OAV', 'OAD', 'ODA', 'ONA']);

const SEPARATOR = ' • ';

function flagFor(language) {
    return LANGUAGE_FLAG[language.code] ?? '🌐';
}

function appendLanguages(segments, parsed) {
    if (parsed.isMultiLanguage) segments.push('🌍 MULTI');
    if (parsed.isDualAudio) segments.push('🌍 Dual Audio');

    // A subtitle language is listed in both arrays, so the spoken ones are those without a type.
    for (const language of parsed.languages ?? []) {
        if (language.type === 'subtitle') continue;
        segments.push(`${flagFor(language)} ${SPOKEN_LABEL[language.code] ?? language.label}`);
    }

    for (const language of parsed.subtitleLanguages ?? []) {
        const label = SUBTITLE_LABEL[language.code] ?? `${language.label} subs`;
        segments.push(`${flagFor(language)} ${label}`);
    }

    // Several subtitle tracks with none of them named.
    if (parsed.isMultiSubtitle && !parsed.subtitleLanguages?.length) segments.push('🌍 Multi Subs');
}

function appendAudio(segments, parsed) {
    const formats = parsed.audio ?? [];
    const channels = parsed.channels?.[0];

    if (!formats.length) {
        if (channels) segments.push(`🔊 ${channels}`);
        return;
    }

    formats.forEach((format, index) => {
        const icon = LOSSLESS_AUDIO.has(format) ? '🔊' : '🎵';
        segments.push(index === 0 && channels ? `${icon} ${format} ${channels}` : `${icon} ${format}`);
    });
}

function appendTechnical(segments, parsed) {
    for (const hdr of parsed.hdr ?? []) {
        if (hdr === 'SDR') continue;
        segments.push(`🌈 ${HDR_LABEL[hdr] ?? hdr}`);
    }
    if (parsed.bitDepth) segments.push(`🎨 ${parsed.bitDepth.replace('-bit', 'bit')}`);
    if (parsed.isRemux) segments.push('🎯 REMUX');
    if (parsed.isRepack) segments.push('📦 REPACK');
    if (parsed.isProper) segments.push('✅ PROPER');
    if (parsed.frameRate) segments.push(`🎬 ${parsed.frameRate}`);

    for (const edition of parsed.editions ?? []) {
        if (!PACK_EDITIONS.has(edition)) segments.push(`🎞️ ${edition}`);
    }
}

const RESOLUTION_DISPLAY = {
    '2160p': '💎 4K UHD', '1440p': '💍 1440p', '1080p': '⭐ 1080p',
    '720p': '✨ 720p', '576p': '🔘 576p', '480p': '⚫ 480p'
};

/** Best first. Ranking reads this rather than re-parsing the line it just built. */
const QUALITY_ORDER = ['💎 4K UHD', '💍 1440p', '⭐ 1080p', '✨ 720p', '🔘 576p', '⚫ 480p', '📀 DVD'];

export function qualityRank(line) {
    const index = QUALITY_ORDER.indexOf(line);
    return index === -1 ? -1 : QUALITY_ORDER.length - index;
}

function resolutionDisplay(parsed) {
    if (parsed?.resolution) return RESOLUTION_DISPLAY[parsed.resolution] ?? `📺 ${parsed.resolution}`;
    if (parsed?.source === 'DVD' || parsed?.source === 'DVDR') return '📀 DVD';
    return null;
}

/** The quality line beside the provider name. A bare filename often states no resolution, so the
 *  container answers for it. */
export function qualityLine(parsed, containerParsed = null) {
    return resolutionDisplay(parsed) ?? resolutionDisplay(containerParsed) ?? '❓ Unknown';
}

/** Full-width comma, which looks the same but does not break Stremio's own field splitting. */
function safeText(text) {
    return text.replace(/,/g, '，');
}

/** The 📺 line, empty when the release states no episode title. */
export function episodeTitleLine(parsed) {
    const title = parsed?.episodeTitle;
    return title ? `📺 "${safeText(title)}"` : '';
}

const SINGLE_VALUE = ['source', 'codec', 'bitDepth', 'frameRate'];
const LIST_VALUE = ['languages', 'subtitleLanguages', 'audio', 'channels', 'hdr', 'editions'];
const FLAG_VALUE = ['isMultiLanguage', 'isDualAudio', 'isMultiSubtitle', 'isRemux', 'isRepack', 'isProper'];

/** A file inside a pack often states almost nothing, so the container fills what it left out. */
function inherit(file, container) {
    if (!container) return file;
    if (!file) return container;

    const merged = { ...file };
    for (const field of SINGLE_VALUE) merged[field] = file[field] ?? container[field];
    for (const field of LIST_VALUE) merged[field] = file[field]?.length ? file[field] : container[field];
    for (const field of FLAG_VALUE) merged[field] = file[field] || container[field];
    return merged;
}

/** The ⚙️ segment: languages, source, codec, audio, then the technical flags. */
export function technicalLine(fileParsed, containerParsed = null) {
    const parsed = inherit(fileParsed, containerParsed);
    if (!parsed) return '';

    const segments = [];
    appendLanguages(segments, parsed);
    if (parsed.source) segments.push(`${SOURCE_ICON[parsed.source] ?? '📼'} ${parsed.source}`);
    if (parsed.codec) segments.push(`🎥 ${parsed.codec}`);
    appendAudio(segments, parsed);
    appendTechnical(segments, parsed);

    return [...new Set(segments)].join(SEPARATOR);
}

// ================================================================================================
// THE TITLE BLOCK
// ================================================================================================

function formatSize(size) {
    if (!size) return undefined;
    const unit = size === 0 ? 0 : Math.floor(Math.log(size) / Math.log(1024));
    return Number((size / Math.pow(1024, unit)).toFixed(2)) + ' ' + ['B', 'kB', 'MB', 'GB', 'TB'][unit];
}

/** A file inside a pack states less than its container, so the container answers for what it omits. */
function extractBasicInfo(details, video) {
    return {
        containerName: details.containerName || details.name || 'Unknown',
        videoName: video.fileName || '',
        size: formatSize(video?.size || 0),
        matchedTerm: details.matchedTerm || null,
        parsed: (video.fileName ? video.parsed : null) ?? details.parsed ?? null,
        containerParsed: details.parsed ?? null
    };
}

function titleOf(parsed, containerParsed) {
    return parsed?.title || containerParsed?.title || 'Unknown';
}

/** The container answers only when the file has no name of its own, never when the group is absent. */
function releaseGroupOf(basicInfo) {
    if (!configManager.getIsReleaseGroupEnabled()) return null;
    return (basicInfo.videoName ? basicInfo.parsed : basicInfo.containerParsed)?.releaseGroup ?? null;
}

/**
 * A release whose title names a different work than the one asked for. Ranking reads this too, so
 * it is exported rather than computed only for the line.
 */
export function detectVariant(details, video, searchContext) {
    if (process.env.VARIANT_SYSTEM_ENABLED === 'false') return null;
    if (!searchContext?.searchTitle || !searchContext?.alternativeTitles) return null;

    const { parsed, containerParsed } = extractBasicInfo(details, video);
    return detectSimpleVariant(parsed, containerParsed, searchContext);
}

function variantLine(variant) {
    return variant?.isVariant && variant.variantName ? `🔄 Variant: ${variant.variantName}` : '';
}

function seasonEpisodeOf(knownSeasonEpisode, parsed) {
    const season = knownSeasonEpisode?.season ?? parsed?.seasons?.[0];
    const episode = knownSeasonEpisode?.episode ?? parsed?.episodes?.[0];
    if (season == null || episode == null) return null;

    return `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`;
}

function sizeLine(icon, size, releaseGroup, seasonEpisode = null) {
    let line = seasonEpisode
        ? `${seasonEpisode.substring(0, 3)} - ${seasonEpisode.substring(3)} • ${icon} ${size}`
        : `${icon} ${size}`;

    if (releaseGroup?.trim()) {
        line += ` • 👥 [${releaseGroup}]`;
    }

    return line;
}

function seriesTitle(basicInfo, icon, knownSeasonEpisode, variant) {
    const { containerName, videoName, size, matchedTerm, parsed, containerParsed } = basicInfo;

    const lines = [`📁 ${safeText(videoName || containerName)}`];
    lines.push(safeText(matchedTerm?.trim() ? matchedTerm : titleOf(parsed, containerParsed)));

    for (const line of [variantLine(variant), episodeTitleLine(parsed)]) {
        if (line) lines.push(line);
    }

    const technical = technicalLine(parsed, containerParsed);
    if (technical) lines.push(`⚙️ ${technical}`);

    lines.push(sizeLine(icon, size, releaseGroupOf(basicInfo), seasonEpisodeOf(knownSeasonEpisode, parsed)));
    return lines.join('\n');
}

function movieTitle(basicInfo, icon) {
    const { containerName, videoName, size, parsed, containerParsed } = basicInfo;

    const title = titleOf(parsed, containerParsed);
    const year = parsed?.year ?? containerParsed?.year ?? null;

    const lines = [`📁 ${safeText(videoName || containerName)}`];
    lines.push(year ? `${title} (${year})` : title);

    const technical = technicalLine(parsed, containerParsed);
    if (technical) lines.push(`⚙️ ${technical}`);

    lines.push(sizeLine(icon, size, releaseGroupOf(basicInfo)));
    return lines.join('\n');
}

/** The multi-line title Stremio shows under the provider name. */
export function streamTitle(details, video, type, icon, knownSeasonEpisode = null, variant = null) {
    const basicInfo = extractBasicInfo(details, video);

    return type === 'series'
        ? seriesTitle(basicInfo, icon, knownSeasonEpisode, variant)
        : movieTitle(basicInfo, icon);
}
