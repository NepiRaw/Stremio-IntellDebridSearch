import { FILE_EXTENSIONS } from './media-patterns.js';

// Use centralized file extension patterns
const VIDEO_EXTENSIONS = FILE_EXTENSIONS.video;
const SUBTITLE_EXTENSIONS = FILE_EXTENSIONS.subtitle;
const DISK_EXTENSIONS = FILE_EXTENSIONS.disk;
const ARCHIVE_EXTENSIONS = FILE_EXTENSIONS.archive;

function isVideo(filename) {
    return isExtension(filename, VIDEO_EXTENSIONS)
}

function isSubtitle(filename) {
    return isExtension(filename, SUBTITLE_EXTENSIONS)
}

function isDisk(filename) {
    return isExtension(filename, DISK_EXTENSIONS)
}

function isArchive(filename) {
    return isExtension(filename, ARCHIVE_EXTENSIONS)
}

function isExtension(filename, extensions) {
    const extensionMatch = filename && filename.match(/\.(\w{2,4})$/)
    return extensionMatch && extensions.includes(extensionMatch[1].toLowerCase())
}

export { isVideo, isSubtitle, isDisk, isArchive, isExtension }