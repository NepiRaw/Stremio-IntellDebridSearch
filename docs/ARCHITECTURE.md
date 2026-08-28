# Stremio IntellDebridSearch Addon - Architecture Documentation


## Overview

Stremio IntellDebridSearch is a modular, content-agnostic streaming addon for Stremio. <br> 
It provides intelligent torrent search, unified parsing, and seamless integration with multiple debrid services. <br>
This document is designed for developers, maintainers, and stakeholders to understand the system's architecture, how its components interact, and how to extend or debug it. No prior knowledge of the codebase is required.

## Table of Contents

1. [System Architecture](#system-architecture)
2. [Core Components](#core-components)
3. [Module Directory](#module-directory)
4. [Data Flow](#data-flow)
5. [Performance Optimizations](#performance-optimizations)
6. [Error Handling](#error-handling)
7. [Caching Strategy](#caching-strategy)
8. [Testing Framework](#testing-framework)
9. [Configuration Management](#configuration-management)
10. [Deployment](#deployment)


## System Architecture

The addon is built on a modular, service-oriented architecture. Each layer is responsible for a distinct concern, making the system easy to maintain and extend.

**Architecture Layers:**


```
┌───────────────────────────────────────────────────────────────┐
│                     Stremio Addon API                         │
├───────────────────────────────────────────────────────────────┤
│                    Express.js Server                          │
├───────────────────────────────────────────────────────────────┤
│  Catalog Provider  │  Stream Provider  │  Search Coordinator  │
├───────────────────────────────────────────────────────────────┤
│     Catalog Enrichment Resolver + L0/L1/L2 Cache Stack       │
├───────────────────────────────────────────────────────────────┤
│              Multi-Phase Search Engine                        │
│  Phase 0 (Prep) │ Phase 1 (Matching) │ Phase 2 (Analysis)   │
├───────────────────────────────────────────────────────────────┤
│              Unified Parsing Engine                           │
├───────────────────────────────────────────────────────────────┤
│   Metadata       │   Performance     │   Quality              │
│   Extractor      │   Optimizer       │   Processor            │
├───────────────────────────────────────────────────────────────┤
│              Debrid Service Integrations                      │
│                   (one module per provider)                   │
├───────────────────────────────────────────────────────────────┤
│  Real-Debrid │ AllDebrid │ Premiumize │ Debrid-Link │ TorBox  │
└───────────────────────────────────────────────────────────────┘
```

**Layer Explanations:**
- **Stremio Addon API**: Entry point for all requests from Stremio clients.
- **Express.js Server**: Handles HTTP requests, routing, and middleware.
- **Providers**: 
     - *Catalog Provider*: Supplies content catalogs.
     - *Stream Provider*: Resolves streams for playback.
     - *Search Coordinator*: Orchestrates multi-phase intelligent search.
- **Multi-Phase Search Engine**: 3-phase search process (preparation, title matching, content analysis).
- **Unified Parsing Engine**: Centralized logic for parsing torrent and video filenames, used by all providers.
- **Metadata/Performance/Quality Modules**: Extracts technical details, optimizes performance, and processes quality.
- **Debrid Service Integrations**: one module per provider on a shared contract and a shared HTTP layer.

## Provider Integration & Extensibility

A provider is a **plain ES module** in `/src/providers/`. It exports a fixed contract and shares six files with every other provider, so a provider module holds only what its API does differently. There is no inheritance and no base class.

The contract, enforced by `tests/unit/providers-registry.test.js`:

| Export | Answers |
|---|---|
| `name` | the provider name as the config blob spells it |
| `capabilities` | `{filesInline, bulkFiles, directLinks}` |
| `ownsId(id, apiKey)` | could this provider have minted this item id. The key is only read where an id is scoped to one account |
| `ownsLink(link, itemId, apiKey)` | could this provider have issued this playback link, for this item |
| `validateKey(apiKey)` | is this key usable, and is the account premium |
| `listLibraryItems(apiKey)` | the whole library, every source kind it holds |
| `listTorrents(apiKey)` | the torrent lane alone. The registry falls back to it, and Premiumize aliases it |
| `fetchFiles(apiKey, items)` | `Map<itemId, VideoFile[]>` for the items given |
| `fetchTorrent(apiKey, id)` | one item with its files, for the meta route |
| `resolveStream(apiKey, ref, clientIp)` | a playable URL, at play time |

### A library is more than torrents

A debrid account holds more than the torrents it downloaded: saved links, web downloads, usenet downloads and durable cloud files are all playable and all live behind their own endpoints. Discovery is the first gate, so a record omitted there can never reach parsing, matching, streams or the catalog, whatever the rest of the pipeline does.

`listLibraryItems()` returns them together. Each item carries a `sourceKind`, and each non-torrent source carries a **typed id**, because these endpoint families run independent id spaces: a TorBox torrent, web download and usenet download can all be numbered `700`, so an untyped id cannot say which endpoint the meta route should ask.

```text
li1.<base64url-provider>.<source-kind>.<base64url-native-identity>
```

Source kinds are `torrent`, `saved-link`, `download`, `web-download`, `usenet-download` and `cloud-file`. **Legacy untyped ids keep meaning `torrent`**, so catalog links and play URLs minted before this scheme still answer.

Where a source has no native id of its own, its identity is derived and **scoped to the account** with an HMAC of the API key, never with the raw value: an AllDebrid saved link and a RealDebrid download are named by their link, and a Premiumize folder group by its folder name. That keeps a link or a folder name out of catalog URLs, and makes an id from one account fail `ownsId` on another.

The shared files it builds on:

- `http.js` - the single HTTP path: rate limiting, timeout, one retry, typed errors. Limits are per token AND per endpoint, so each limiter is keyed `provider:endpointClass:hash(key)`. The retry is skipped when the answer is already definitive, since a second ask cannot change a gone item or a rejected key.
- `errors.js` - turns any response into `ProviderAuthError`, `ProviderRateLimitError`, `ProviderUnavailableError` or `ProviderItemGoneError`. Status alone cannot classify these: AllDebrid and Premiumize report auth failures inside HTTP 200, and TorBox's 403 means both "bad token" and "no User-Agent".
- `shapes.js` - the canonical `Torrent` and `VideoFile` every provider returns. Consumers read `provider` and `fileName`.
- `library-item.js` - typed ids, the source-kind vocabulary, and the account-scoped identity used where a source has no native id. Everything a caller needs to tell one endpoint family from another.
- `paths.js` - one file address out of five path formats. The container strip uses **sibling evidence**, not the torrent name.
- `resolve-url.js` - the addon URL a stream points at. It carries the same encrypted configuration the addon URL carries, so a process that never built the stream row can still serve it, which is what makes the serverless deployment work. A short token rides alongside as an in-process fallback and is removed next release.

Adding a provider:

1. Write `/src/providers/<name>.js` exporting the contract above.
2. Register it in `/src/providers/index.js`, the single import site. A unit test asserts that no provider module is imported anywhere outside that folder.


## Request Lifecycle (End-to-End Flow)

The following steps describe how a Stremio client request is processed from entry to response:

```
1. Stremio Client Request
     ↓
2. Express.js Server (server.js)
     - Receives HTTP request from Stremio client
     - Logs request
     ↓
3. Handler Selection (addon.js)
     - Determines if request is for catalog, stream, or search
     ↓
4. Search Coordinator (Phase-Based Search)
     - Phase 0: Search preparation and term deduplication
     - Phase 1: Fast fuzzy title matching using Fuse.js
     - Phase 2: Deep content analysis and episode matching
     ↓
5. Provider Selection & Integration
     - Looks the provider module up in the registry
     - Executes provider-specific logic through unified interface
     ↓
6. Parsing Seam (parseName, parsium-media)
     - Reads each torrent/video filename once, cached and frozen
     - Providers do not parse; the pipeline decorates with `parsed`
     ↓
7. Episode Addressing & Selection
     - One tiered address set per request (episode-address.js)
     - Selects which file inside a container is the wanted episode
     - Records the outcome on `video.match`, never on the parse
     ↓
8. Catalog Enrichment Resolution (catalog/meta flows)
     - Conservative poster resolution from torrent names
     - Canonical content-key generation
     - Exact filename alias reuse across users/providers
     - Persistent SQLite cache for poster + metadata enrichment
     ↓
9. Quality Processing & Stream Building
     - Quality detection and filtering
     - Technical details extraction
     - Stream object assembly
     ↓
10. Debrid Service Integration
     - Provider-specific API interactions
     - Consistent error handling and retry logic
     ↓
11. UnifiedCacheManager Integration
      - Caches API responses (24h TTL for most data)
      - Performance optimization caching
      - Statistics tracking and monitoring
     ↓
12. Response Assembly & Delivery
      - Final stream objects assembled
      - Response sent back to Stremio client
```

**Key Improvements:**
- **Multi-phase search** provides intelligent ranking and filtering
- **One provider contract** ensures consistent provider behavior
- **UnifiedCacheManager** provides enterprise-grade caching across all components
- **Performance optimization layer** dramatically improves response times

## Getting Started (Onboarding)

**For New Developers:**
1. Clone the repository and install dependencies (`corepack enable && pnpm install`). This project is pnpm only; there is no npm lockfile.
2. Copy `.env.example` to `.env` and fill in your debrid API keys and server config.
3. Start the server (`node server.js`).
4. Run tests from the `/tests/` folder to validate your setup.
5. Explore `/src/` for main logic, `/docs/` for documentation, and `/tests/` for validation scripts.

**Configuration Tips:**
- All sensitive keys and settings are managed via `.env`.
- Provider-specific options are set in `/src/config/configuration.js`.
- For local development, use test API keys and enable verbose logging in `/src/utils/logger.js`.

## Error Handling & Logging (Practical)

All errors are handled through the **ErrorManager** (`/src/utils/error-handler.js`):
- Centralized error processing and classification
- Provider-specific error wrapping and context
- Standardized error logging with context preservation
- Graceful fallback strategies for different error types

The system uses comprehensive logging via `/src/utils/logger.js` with different log levels for development and production environments.

## Extending & Debugging

**To Add a New Provider:**
- Add a module in `/src/providers/` exporting the contract above, and register it in `index.js`, the single import site
- There is no base class and nothing to subclass: a provider module holds only what its API does differently

**To Add a New Content Type:**
- Parsing patterns are **not** changed here: refer to the Parsium repo and re-pin `parsium-media`
- Add the display of any new field to `/src/stream/display.js`
- Add relevant tests and update documentation

**Debugging Tips:**
- Use verbose logging and check the comprehensive error context
- Run integration tests in `/tests/` with real API keys
- Monitor cache performance using UnifiedCacheManager statistics
- Check the multi-phase search coordinator for search flow issues

## Real-World Usage Notes

- The addon is completely content-agnostic and provider-agnostic, supporting all content types through unified patterns
- The provider contract ensures consistent behavior across all debrid services
- Multi-phase search provides intelligent ranking without sacrificing performance
- Enterprise-grade caching dramatically improves response times while reducing API calls
- All components are designed for graceful degradation and robust error handling

## Navigation Guide

- `/src/` — Main source code (providers, parsing, metadata, search, stream logic)
- `/docs/` — Documentation (architecture, caching, performance, refactoring)
- `/tests/` — Test scripts and validation tools
- `/public/` — UI templates and static assets

## FAQ

**Q: How do I add a new debrid provider?**
A: Add a module exporting the provider contract, register it in `src/providers/index.js`, and add tests.

**Q: How do I support a new content type?**
A: Update the unified parser and metadata extractor with new patterns, then add comprehensive tests.

**Q: How do I debug search issues?**
A: Enable verbose logging, examine multi-phase search coordinator output, and check cache statistics.

**Q: How do I deploy to production?**
A: See the Deployment section for supported platforms and step-by-step instructions.

## Core Components

### 1. The Parsing Seam
**Location**: `src/parsing/parser.js`

Every release name in the addon is read here and nowhere else. The engine is `parsium-media`.
No other module parses a filename, and none should.

```javascript
// Parse one name, cached and frozen
parseName(name, context = null)
// The same, never cached, for one-off callers
frozenParse(name)
// Decorate a torrent/details object with `parsed`
attachParse(details)
```

**Rules that hold across the codebase**:
- **Providers do not parse.** They fetch, and the pipeline decorates. `attachParse` is the single decoration point.
- **The result is frozen.** Nothing writes back onto a parse. Match outcomes live on `video.match`.
- **No compensating regex.** A name misread by the parser is fixed in the Parsium repo, then pinned here. A parser sees one name; if the answer is not in that name, it is match policy, not parsing.
- **Context is supplied only where the parser says it is unsure.** The addon passes `{ titles: [cinemetaName], contentType: 'movie' }` only when Parsium raises `ambiguous-episode-number`, which is the only shape where a film and an episode look alike.

### 2. The Display Layer
**Location**: `src/stream/display.js`

Owns the whole multi-line title Stremio shows under the provider name. Pure functions, no I/O.
Built entirely from a parse result; it extracts nothing itself.

```javascript
streamTitle(details, video, type, icon, knownSeasonEpisode, variant)
technicalLine(fileParsed, containerParsed)   // the gear block
episodeTitleLine(parsed)                     // the episode-title line
qualityLine(fileParsed, containerParsed)     // the quality line, and qualityRank() for sorting
detectVariant(details, video, searchContext)
```

**Two rules shape the signatures**:
- **A file inside a pack is described by its container.** Several functions take
  `(fileParsed, containerParsed)` and `inherit()` fills what the file left out, with the file winning
  wherever it states something. A rule reading only the filename goes blank exactly where packs are.
- **A stream is one playable video file.** A field earns a line only if it describes *that file*.
  Pack-level properties (season pack, complete series, episode range) are selection signals and
  belong to matching, not display.

### 3. Stream Construction and Ranking
**Location**: `src/stream/stream-builder.js`, `src/stream/quality-processor.js`

`stream-builder.js` builds stream objects and nothing else. It attaches a **non-enumerable** `rank`
slot carrying `{ isVariant, match, quality, size }`, which `sortStreamsByRank` reads.

Non-enumerable is deliberate: `JSON.stringify` and `Object.keys` skip it, so the response body cannot
change and no stripping step can be forgotten before serialisation.

Ranking order: a detected variant sorts **below every non-variant**, beneath even unknown resolution;
then quality, then size. A release that names its episode outranks one recognised through an absolute
number (`rankEpisodeFiles`).

### 4. UnifiedCacheManager
**Location**: `src/utils/cache-manager.js`

Enterprise-grade caching system used throughout the addon:

```javascript
// Main cache interface with TTL and metadata support
cache.set(key, value, ttlSeconds, metadata)
cache.get(key) 
cache.has(key)
cache.delete(key)
cache.getByPattern(pattern)
cache.getStats()
```

**Features**:
- TTL (Time To Live) management with automatic cleanup
- LRU eviction with configurable size limits (default: 1000 items)
- Pattern-based retrieval for cache analysis
- Comprehensive statistics tracking (hits, misses, evictions)
- Metadata storage for debugging and monitoring
- Automatic background cleanup every 5 minutes

### 5. Catalog Enrichment Cache Layer
**Locations**: `src/catalog/poster-resolver.js`, `src/catalog/meta-enricher.js`, `src/catalog/enrichment-cache.js`

The catalog/meta enrichment path now uses a dedicated cache-aware resolver stack:

```javascript
// Build a canonical content identity from a torrent filename
createPosterLookupContext(torrent)

// Resolve a poster/content match with L1 + L2 cache reuse
resolveContentFromContext(context)

// Compose final clicked-item metadata using cached provider-agnostic enrichment
enrichTorrentMeta(baseMeta, { providerName, torrentDetails })
```

**Capabilities**:
- Conservative poster resolution for strong matches only
- Shared `contentKey` identity for poster + metadata enrichment
- Exact filename aliasing so identical release names can hit cache across users/providers
- L1 in-memory cache for hot requests
- L2 SQLite cache for restart-safe reuse of accepted/rejected enrichment decisions
- Separate TTLs for stable poster matches vs less-stable upstream metadata

### 6. Multi-Phase Search Engine
**Locations**: `src/search/coordinator.js`, `src/search/phase-*.js`

Three phases: search preparation, fuzzy title matching, then deep content analysis.

#### Phase 0: Search Preparation (`phase-0-preparation.js`)
```javascript
// Parallel API calls for episode mapping and alternative titles
prepareSearchTerms(params)
// Episode-specific keyword generation
generateEpisodeKeywords(type, season, episode, absoluteEpisode, uniqueSearchTerms)
```

#### Phase 1: Title Matching (`phase-1-title-matching.js`)
```javascript
// Fast fuzzy title matching using Fuse.js with parallel processing
performTitleMatching(allRawResults, uniqueSearchTerms, threshold)
// Decision logic for proceeding to Phase 2
shouldProceedToPhase2(titleMatches, type, season, episode)
```

#### Phase 2: Content Analysis (`phase-2-content-analysis.js`)
```javascript
// Batch fetch missing torrent details
batchFetchTorrentDetails(titleMatches, provider, apiKey)
// Deep episode matching and container analysis
performContentAnalysis(titleMatches, season, episode, absoluteEpisode)
// Anime episode remapping support
reAnalyzeWithMapping(titleMatches, episodeMapping)
```

### 7. The Provider Layer
**Location**: `src/providers/`, entered only through `index.js`

Five modules on one contract and six shared files. What differs between providers is which lanes hold a library, how many calls it costs and where the files come from, and that is the whole reason each module exists:

| Provider | Library lanes | Files | Play time |
|---|---|---|---|
| **AllDebrid** | magnets + saved links (`user/links`), 1 call each | bulk, 20 ids per call. A saved link is one file | `link/unlock`, through WARP: the endpoint refuses a datacenter address |
| **RealDebrid** | torrents + download history, both paged **sequentially** | 1 call per torrent, none for a download | `unrestrict/link`. A download row is already direct |
| **TorBox** | torrents + web downloads + usenet, 1 call each per 1000 rows | **inline, zero calls** | `requestdl`, on the lane's own resource and id parameter |
| **DebridLink** | seedbox + downloader, pages of 100 | **inline, zero calls** | none, `downloadUrl` is direct |
| **Premiumize** | the durable drive (`item/listall`), 1 call | **inline, zero calls** | `item/details`, preferring `stream_link` |

A lane that fails does not empty the library: discovery of a non-torrent lane logs and returns nothing, while a rejected key still reaches the user as one synthetic stream row.

Five rules in there are important and were each measured:

- **RealDebrid's `/torrents` caps concurrency, not rate.** It rejects at about three concurrent requests, so its paging is sequential. It is the one place parallelism is forbidden rather than tuned.
- **RealDebrid pairs links to SELECTED files, before the video filter.** When the counts disagree the torrent was packaged as one archive and holds no per-file link, so it is dropped rather than indexed around. A count mismatch is a classification signal.
- **Premiumize reads the drive, not the transfer log.** Transfer history is job state that can be cleared while the files remain, so it describes what was downloaded rather than what the account holds. `item/listall` is one unpaged call carrying every file's path, size and date, which is what makes the file phase free.
- **A Premiumize item is a top-level drive folder, and a folder walk now serves legacy ids only.** Grouping one item per file would destroy the container that pack selection and display inheritance depend on; grouping by the deepest folder would name containers after a season, giving the parser and title matching no title to read. A video at the drive root stays its own item under its native file id.
- **TorBox runs three endpoint families with independent id spaces.** A torrent, a web download and a usenet download can share the number `700`, so each typed lane is described once in a lane table that names its resource and its resolve parameter (`torrent_id`, `web_id`, `usenet_id`). Passing the wrong one is refused with HTTP 422.

### 8. Episode Addressing
**Location**: `src/utils/episode-address.js`

All season/episode matching lives here. Pattern recognition itself belongs to the parser; this module decides whether a parsed name answers the request.

```javascript
buildEpisodeAddresses({season, episode, absoluteEpisode, seasonOneLength, remapped})
matchEpisodeAddress(parsed, addresses)   // -> {tier, source, season, episode} | null
couldContain(parsed, addresses)          // is a file list worth fetching?
statesEpisode(parsed) / statesSeasonWithoutEpisode(parsed) / statesAmbiguousEpisode(parsed)
```

**The address set is tiered, not flat.** One set is built per request. Tier 1 is what the request states plus an absolute number that cannot also be read as a real episode of the season; tier 2 reads the request's own number as an absolute and is consulted only when tier 1 matched nothing at all. 
A flat set returns the wrong episode when a release labels absolute numbering as a season episode.

**Ranges are first-class.** `seasons` is an array, so `Seasons 1-3` is `[1,2,3]`; `episodeRange` is read through `inRange`, so `Season 1 E01-24` answers a request for E7.

**`couldContain` fetches every pack**, deliberately: a pack's name describes its main content, not everything inside it. It skips only a torrent whose name states seasons that exclude the wanted one.

**Every match is recorded on `video.match` and nothing writes back onto the parse.**

## Module Directory

### Root Level Files
- `addon.js` - Main addon entry point and Stremio interface
- `server.js` - Express server setup and middleware
- `serverless.js` - Serverless deployment configuration
- `package.json` - Dependencies and scripts
- `README.md` - Project documentation

### Source Code Structure

#### `/src/api/`
- `http.js` - Shared transport for all three upstreams: one retry policy, global `fetch` (undici pools connections). A **status is returned, never retried**, so TheTVDB keeps its 401 re-auth and TMDb its own 404 reading. 429 is deliberately excluded.
- `cinemeta.js` - Cinemeta API integration for metadata (1h TTL)
- `tmdb.js` - Movie/TV metadata and alternative titles via TMDb (6h-24h TTL)
- `tvdb.js` - TheTVDB, resolves absolute episode numbers for non-standard numbering

#### `/src/catalog/`
- `enrichment-cache.js` - Persistent SQLite cache for poster/content resolution and metadata enrichment
- `meta-enricher.js` - Clicked-item metadata enrichment composer
- `poster-resolver.js` - Conservative poster/content resolution logic

#### `/src/config/`
- `configuration.js` - Centralized configuration management with ConfigurationManager class
- `manifest.js` - Addon manifest and metadata

#### `/src/providers/`
- `index.js` - the registry, and the only import site consumers use
- `http.js` - the single HTTP path: per-token, per-endpoint rate limiting, retry, typed errors
- `errors.js` - the error taxonomy and the table that classifies every provider's answer
- `shapes.js` - the canonical `Torrent` and `VideoFile`
- `library-item.js` - typed item ids, source kinds, and account-scoped identity for a source with no native id
- `paths.js` - one file address out of five path formats, using sibling evidence
- `resolve-url.js` - the resolve URL, which carries its own encrypted configuration
- `all-debrid.js`, `real-debrid.js`, `torbox.js`, `debrid-link.js`, `premiumize.js`

#### `/src/search/`
- `coordinator.js` - Multi-phase search orchestration and result aggregation
- `phase-0-preparation.js` - Search term preparation and API calls
- `phase-1-title-matching.js` - Fuzzy title matching with Fuse.js
- `phase-2-content-analysis.js` - Deep content analysis and episode matching
- `provider-search.js` - Main provider search logic and ranking
- `keyword-extractor.js` - Keyword extraction and scoring
- `torrent-analyzer.js` - Selects which file inside a container is the wanted episode

#### `/src/parsing/`
- `parser.js` - The only parsing module. Wraps `parsium-media`, caches, freezes, and decorates.

#### `/src/stream/`
- `display.js` - The whole stream title block, built from a parse result
- `stream-builder.js` - Stream-object construction and the non-enumerable `rank` slot
- `quality-processor.js` - Stream quality analysis and filtering

#### `/src/utils/`
- `episode-address.js` - The tiered address set and every season/episode match decision
- `cache-manager.js` - UnifiedCacheManager for enterprise-grade caching
- `cache-recorder.js` - Hash-keyed torrent/file SQLite DB, consumed by an external addon
- `error-handler.js` - ErrorManager for centralized error processing
- `file-types.js` - Video file-extension helpers
- `logger.js` - Centralized logging system
- `perf-tracker.js` - Per-stage timings behind the `[perf]` debug line
- `variant-detector.js` - Detects a release naming a different work than the one asked for

Release-name vocabulary (quality, source, codec, language, release group, season and episode
forms) is `parsium-media`'s responsibility, not this directory's. Nothing here should hold a
parsing regex.

#### `/public/`
- `landing-template.js` - User interface template

#### `/src/` top level
- `stream-provider.js` - Stream search orchestration: listing, dedup, and the stream response
- `catalog-provider.js` - Torrent-to-meta conversion for the catalog

## Data Flow

### 1. Stream Request Processing

```
User Request → Stremio API → Stream Provider → Search Coordinator
     ↓
Phase 0 (Prep) → Phase 1 (Title Match) → Phase 2 (Content Analysis)
     ↓
Fetch once → parse once (attachParse) → select once (episode-address) → dedup
     ↓
Stream Builder → display.js title block → Response Assembly → User
```

### 2. Parsing Pipeline

```
Raw name → parseName (parsium-media, cached) → frozen ParseResult attached as `parsed`
     ↓
episode-address decides the match, recorded separately on `video.match`
```

Nothing mutates `parsed`. The parse answers "what does this name say"; the address set answers" does that satisfy the request". Keeping them apart is what makes both testable.

### 3. Multi-Phase Search Flow

```
Search Request → Phase 0 (API Prep) → Phase 1 (Fuzzy Match) → Phase 2 (Deep Analysis)
     ↓                                                              ↓
Optional Phase 3 (Anime Fallback) ← Decision Logic ←────────────────┘
     ↓
Result Assembly → Quality Filtering → Stream Generation → Response
```

## Performance Optimizations

### Multi-Level Caching Strategy
The system implements a sophisticated, enterprise-grade caching system with multiple layers:

#### 0. **Catalog Enrichment Cache Stack**
- **L0 request dedupe**: `src/catalog-provider.js` deduplicates repeated poster lookups inside a single response
- **L1 hot cache**: `src/utils/cache-manager.js` stores short-lived accepted/rejected poster and metadata enrichment results
- **L2 persistent cache**: `src/catalog/enrichment-cache.js` stores restart-safe content resolution, metadata enrichment, and filename alias mappings in SQLite

Persistent catalog enrichment behavior:
- accepted poster/content matches are cached longer than metadata payloads
- negative poster/content decisions are cached with shorter TTLs to allow future refreshes
- exact filename aliases point to a canonical `contentKey`, allowing the same release name to reuse cache across providers/users
- metadata records can be marked suspect and refreshed sooner when upstream data looks inconsistent
- periodic maintenance removes expired rows, checkpoints WAL state, and reclaims free pages with incremental auto-vacuum
- an optional soft DB-size limit can prune the oldest/least useful cache entries before the SQLite file grows unbounded

#### 1. **UnifiedCacheManager** (`src/utils/cache-manager.js`)
**Central caching system** for all addon components:
```javascript
class UnifiedCacheManager {
    // Features:
    // - TTL (Time To Live) management with automatic cleanup
    // - LRU eviction with configurable size limits (default: 1000)
    // - Automatic cleanup every 5 minutes
    // - Pattern-based cache retrieval for monitoring
    // - Comprehensive statistics tracking
    // - Metadata storage for debugging and analysis
}
```

#### 2. **API Response Caching**
- **TMDb API**: Alternative titles (24h TTL), search results (6h TTL)
- **TheTVDB API**: Absolute episode numbers for non-standard numbering
- **Cinemeta API**: Metadata responses (1h TTL)

All three share `src/api/http.js`, so a transient network failure costs a retry rather than silently narrowing the search terms.

#### 3. **Performance Optimization Caching**
- **Metadata Cache**: Exact + fuzzy caching (12h-24h TTL)
- **Technical Details**: Video quality, codecs, specifications (24h TTL)
- **Pattern Matching**: Regex evaluation results (12h TTL)
- **Torrent Parser**: In-memory LRU cache (1000 items)

#### 4. **Cache Organization**
- **Prefixed keys**: `tmdb_`, `metadata_`, `tech_details_`
- **TTL variations**: 30min (failures) to 24h (stable data)
- **Pattern retrieval**: `cache.getByPattern()` for debugging and monitoring
- **Statistics**: Real-time cache performance tracking

#### 5. **Catalog Enrichment Persistence**
- **Resolution cache**: accepted/rejected poster/content identity keyed by canonical parsed title/year/type
- **Metadata cache**: provider-agnostic enrichment payloads (`background`, `logo`, synopsis tail, release info, IMDb rating, genres, runtime, links)
- **Alias cache**: exact filename fingerprints that map multiple users/providers to the same canonical content key

### Performance Metrics
Based on comprehensive testing with real-world data:
- **Cold p95**: 1716-2657 ms
- **Pre-filter hoist**: keyword patterns compiled once per request rather than once per (torrent, keyword) pair
- **Phase 0 / listing overlap**: search preparation runs while the provider listing is in flight
- **Parse cost**: ~0.24 ms per name, cached per (name, context)
- **Concurrent processing**: Optimized for multiple simultaneous requests

### Optimization Techniques
1. **Multi-Level Caching**: Exact + fuzzy metadata caching
2. **Batch Processing**: Group similar operations for efficiency
3. **Parallel API Calls**: Phase 0 preparation runs APIs in parallel
4. **Pre-filter hoisting**: per-keyword work computed once per request, not per pair
5. **Memory Management**: Automatic cleanup and LRU eviction
6. **Rate Limiting**: Centralised through bottleneck for provider APIs

## Error Handling

### ErrorManager Architecture
**Location**: `src/utils/error-handler.js`

Centralized error management system:

```javascript
class ErrorManager {
    // Provider-specific error handling
    static handleProviderError(error, providerName, context)
    // API-specific error handling  
    static handleApiError(error, apiName, context)
    // Search-specific error handling
    static handleSearchError(error, searchType, context)
    // Error classification and processing
    static processError(error, context, operationArgs)
}
```

### Error Categories
1. **Provider Errors**: Debrid service failures, authentication issues
2. **API Errors**: External API timeouts, rate limits, connectivity
3. **Parsing Errors**: Malformed filenames, encoding issues  
4. **Search Errors**: Phase-specific failures, coordination issues
5. **Cache Errors**: TTL expiration, memory limitations

### Error Recovery
- **Provider errors**: classified by `providers/errors.js`; only an auth failure reaches the user, as one stream row, carrying the action its cause calls for (reconfigure a key, renew a subscription, upgrade a plan, confirm a sign-in from a new location)
- **Routes with no error channel answer rather than raise**: a catalog returns no items and a meta returns none, because a status there only makes the client retry a call that cannot succeed
- **Play time has only a status**: a file the hoster cannot serve answers 404, not a server error
- **Graceful degradation**: Partial failures don't break entire responses
- **Fallback strategies**: Multi-phase search provides alternative paths
- **Comprehensive logging**: Context preservation for debugging. A failure is logged once, by the route that knows which request caused it

## Caching Strategy

### Cache TTL Strategy by Data Type
| Data Type | TTL | Reason |
|-----------|-----|--------|
| TMDb Alternative Titles | 24h | Title variations are stable |
| TMDb Search Results | 6h | Search results may update |
| Cinemeta Metadata | 1h | Metadata may be updated |
| Technical Details | 24h | Video specs are static |
| Metadata (Exact) | 12h | Parsing results are stable |
| Metadata (Fuzzy) | 24h | Shared across episodes |
| Pattern Matching | 12h | Regex results are stable |
| Failed API Calls | 30min-1h | Retry failed calls sooner |

### Cache Key Patterns
- **API Keys**: `tmdb_alt_titles_${id}_${type}`
- **Performance Keys**: `metadata_${container}|${video}|${type}`, `tech_details_${filename}`
- **Pattern Keys**: `pattern_match_${hash}_${count}`


## Configuration Management

### ConfigurationManager
**Location**: `src/config/configuration.js`

Centralized configuration system:

```javascript
class ConfigurationManager {
    // Provider-specific configurations
    getProviderConfig(providerName)
    // API configuration management
    getApiConfig()
    // Environment variable handling
    // Feature flag management
}
```

### Environment Variables
- **Debrid API Keys**: Provider-specific authentication
- **Server Configuration**: Port, host, environment settings
- **Performance Tuning**: Cache sizes, TTL values, rate limits
- **Feature Flags**: Enable/disable specific optimizations

### Configuration Files
- `src/config/configuration.js` - Main configuration with ConfigurationManager
- `src/config/manifest.js` - Addon manifest and metadata
- `.env` - Environment-specific settings
- `package.json` - Dependencies and scripts

## Deployment

### Supported Platforms
1. **Traditional Server**: Node.js with Express (`server.js`)
2. **Serverless**: AWS Lambda, Vercel, Netlify (`serverless.js`)
3. **Container**: Docker deployment with environment configuration
4. **Cloud**: Heroku, Railway, and other cloud platforms

### Deployment Files
- `server.js` - Traditional server deployment with Express
- `serverless.js` - Serverless function deployment
- `vercel.json` - Vercel platform configuration
- `docker-compose.yml` - Container orchestration

### Performance Considerations
- **Memory Usage**: UnifiedCacheManager provides configurable limits
- **Cache Warming**: Initial requests may be slower, subsequent requests benefit from caching
- **Rate Limiting**: Built-in respect for external API limits
- **Concurrent Handling**: Optimized for multiple simultaneous requests

---