/**
 * The stream title block, built from a parse result. Pure functions, no I/O and no caching.
 */

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
