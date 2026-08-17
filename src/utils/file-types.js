/**
 * File classification by extension, and the two symbols that name a provider's file listings.
 *
 * Both were defined twice before, and the two FILE_TYPES definitions created distinct symbols,
 * so a provider handed configuration's symbol could only recognise it by its string form.
 * One definition removes that.
 */

export const FILE_TYPES = Object.freeze({
    TORRENTS: Symbol('torrents'),
});

export const FILE_EXTENSIONS = Object.freeze({
    video: ['3g2', '3gp', 'avi', 'flv', 'mkv', 'mk3d', 'mov', 'mp2', 'mp4', 'm4v', 'mpe', 'mpeg', 'mpg', 'mpv', 'webm', 'wmv', 'ogm', 'ts', 'm2ts'],
    subtitle: ['aqt', 'gsub', 'jss', 'sub', 'ttxt', 'pjs', 'psb', 'rt', 'smi', 'slt', 'ssf', 'srt', 'ssa', 'ass', 'usf', 'idx', 'vtt'],
    disk: ['iso', 'm2ts', 'ts', 'vob'],
    archive: ['rar', 'zip']
});

/** True when the filename ends in one of `extensions`. */
export function isExtension(filename, extensions) {
    if (!filename || typeof filename !== 'string') return false;
    const extensionMatch = filename.match(/\.(\w{2,4})$/);
    return extensionMatch && extensions.includes(extensionMatch[1].toLowerCase());
}

/**
 * Whether a file is playable. Gated on the extension rather than on the parse, because the
 * parser reports whatever extension it finds and does not judge it.
 */
export function isVideo(filename) {
    return isExtension(filename, FILE_EXTENSIONS.video);
}
