/**
 * Release Groups Utility - Minimal version for stream processing
 */

/**
 * Extract release group from filename or torrent name
 * @param {string} name - Filename or torrent name
 * @returns {string} - Release group name or empty string
 */
export function extractReleaseGroup(name) {
    if (!name) return '';
    
    // Try patterns: [Group], -Group-, (Group)
    const patterns = [
        /\[([^\]]+)\]/,
        /-([^-]+)-$/,
        /\(([^)]+)\)$/
    ];
    
    for (const pattern of patterns) {
        const match = name.match(pattern);
        if (match && match[1]) {
            const group = match[1].trim();
            if (group.length > 1 && group.length < 30) {
                return group;
            }
        }
    }
    
    return '';
}

/**
 * Check if a release group name is valid
 * @param {string} group - Release group name
 * @returns {boolean} - Whether the group is valid
 */
export function isValidReleaseGroup(group) {
    if (!group || typeof group !== 'string') return false;
    
    // Basic validation - not empty, reasonable length, no obvious technical terms
    const cleaned = group.trim();
    if (cleaned.length < 2 || cleaned.length > 30) return false;
    
    // Skip obvious technical terms
    const technicalTerms = /^(x264|x265|h264|h265|avc|hevc|1080p|720p|480p|bluray|webrip|web-dl|hdtv|dvdrip)$/i;
    if (technicalTerms.test(cleaned)) return false;
    
    return true;
}
