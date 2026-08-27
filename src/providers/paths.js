/**
 * One canonical file address out of the five path formats the providers use.
 * Normalization is per torrent because the only reliable evidence that a first segment is the
 * torrent's root folder is that every file shares it.
 */

const SEPARATORS = /[\\/]+/;

const fold = value => String(value).trim().toLowerCase().replace(/\s+/g, ' ');

const split = rawPath => String(rawPath ?? '').split(SEPARATORS).filter(segment => segment && segment !== '.');

function address(segments, container) {
    const parts = [...segments];
    const fileName = parts.pop() ?? '';
    const subPath = parts.join('/');
    return { container, subPath, fileName, relPath: subPath ? `${subPath}/${fileName}` : fileName };
}

/**
 * Maps one torrent's raw paths to {container, subPath, fileName, relPath}, in the order given.
 * An unusable path yields empty strings rather than throwing, so the caller's video filter drops it.
 */
export function normalizeTorrentFiles(rawPaths, containerName = '') {
    const container = String(containerName ?? '').trim();
    const files = (rawPaths ?? []).map(split);

    const roots = new Set(files.map(segments => segments[0]));
    const sharedRoot = files.length > 1 && roots.size === 1 && files.every(segments => segments.length > 1);

    // Without siblings to compare, only a folder repeating the torrent name is provably the root.
    const named = segments => segments.length > 1 && container && fold(segments[0]) === fold(container);

    return files.map(segments => address(sharedRoot || named(segments) ? segments.slice(1) : segments, container));
}

/** Flattens an AllDebrid file tree into raw paths. Folder nodes carry `e`, leaves carry `s` and `l`. */
export function flattenTree(nodes, parents = []) {
    const out = [];
    for (const node of nodes ?? []) {
        const path = [...parents, node.n];
        if (Array.isArray(node.e)) out.push(...flattenTree(node.e, path));
        else out.push({ path: path.join('/'), size: node.s, link: node.l });
    }
    return out;
}
