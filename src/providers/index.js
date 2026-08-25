/**
 * The provider registry, the only import site consumers need.
 * A provider appears here once its module is implemented and tested; until then the consumers fall
 * back to the legacy classes, so the migration runs one provider at a time.
 */

const registry = new Map();

export function getProvider(name) {
    return registry.get(name);
}

export function migratedProviders() {
    return [...registry.keys()];
}
