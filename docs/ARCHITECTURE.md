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
│              Multi-Phase Search Engine                        │
│  Phase 0 (Prep) │ Phase 1 (Matching) │ Phase 2 (Analysis)   │
├───────────────────────────────────────────────────────────────┤
│              Unified Parsing Engine                           │
├───────────────────────────────────────────────────────────────┤
│   Metadata       │   Performance     │   Quality              │
│   Extractor      │   Optimizer       │   Processor            │
├───────────────────────────────────────────────────────────────┤
│              Debrid Service Integrations                      │
│                    (BaseProvider Pattern)                     │
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
- **Multi-Phase Search Engine**: 3-phase search process for optimal results.
- **Unified Parsing Engine**: Centralized logic for parsing torrent and video filenames, used by all providers.
- **Metadata/Performance/Quality Modules**: Extracts technical details, optimizes performance, and processes quality.
- **Debrid Service Integrations**: BaseProvider pattern for consistent provider implementation.

## Provider Integration & Extensibility

Providers are implemented using the **BaseProvider pattern** in `/src/providers/`. <br>
Each provider extends the abstract `BaseProvider` class which provides common functionality including:

- Unified error handling and HTML error detection
- Standard fuzzy search implementation using Fuse.js
- Common torrent object normalization
- Standard video file extraction
- Consistent date parsing and validation
- Centralized configuration management

Adding a new provider requires:

1. Creating a new file in `/src/providers/` extending `BaseProvider`
2. Implementing required abstract methods: `searchTorrents`, `listTorrents`, `getTorrentDetails`
3. Optionally implementing: `unrestrictUrl`, `searchDownloads`, `listTorrentsParallel`
4. Registering the provider in the main configuration
5. Ensuring consistent error handling through the ErrorManager

**BaseProvider Architecture:**
All providers inherit from `BaseProvider` which consolidates common functionality and ensures consistent behavior across all debrid services.


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
     - Phase 3: Anime fallback (if needed)
     ↓
5. Provider Selection & Integration
     - Chooses appropriate BaseProvider implementation
     - Executes provider-specific logic through unified interface
     ↓
6. Unified Parsing Engine (parseUnified)
     - Parses torrent/video filenames for metadata
     - Utilizes performance caching for repeated operations
     ↓
7. Metadata Extraction & Performance Optimization
     - Multi-level caching (exact + fuzzy)
     - Batch processing for technical details
     - Pattern pre-compilation for efficiency
     ↓
8. Quality Processing & Stream Building
     - Quality detection and filtering
     - Technical details extraction
     - Stream object assembly
     ↓
9. Debrid Service Integration
     - Provider-specific API interactions
     - Consistent error handling and retry logic
     ↓
10. UnifiedCacheManager Integration
      - Caches API responses (24h TTL for most data)
      - Performance optimization caching
      - Statistics tracking and monitoring
     ↓
11. Response Assembly & Delivery
      - Final stream objects assembled
      - Response sent back to Stremio client
```

**Key Improvements:**
- **Multi-phase search** provides intelligent ranking and filtering
- **BaseProvider pattern** ensures consistent provider behavior
- **UnifiedCacheManager** provides enterprise-grade caching across all components
- **Performance optimization layer** dramatically improves response times

## Getting Started (Onboarding)

**For New Developers:**
1. Clone the repository and install dependencies (`npm install` or `pnpm install`).
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
- Extend the `BaseProvider` class in `/src/providers/`
- Implement required abstract methods following the established interface
- Register the provider in the shared provider instances
- Add integration tests to validate functionality

**To Add a New Content Type:**
- Update `/src/utils/unified-torrent-parser.js` for parsing patterns
- Enhance `/src/stream/metadata-extractor.js` for metadata extraction
- Add relevant tests and update documentation

**Debugging Tips:**
- Use verbose logging and check the comprehensive error context
- Run integration tests in `/tests/` with real API keys
- Monitor cache performance using UnifiedCacheManager statistics
- Check the multi-phase search coordinator for search flow issues

## Real-World Usage Notes

- The addon is completely content-agnostic and provider-agnostic, supporting all content types through unified patterns
- The BaseProvider architecture ensures consistent behavior across all debrid services
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
A: Extend the BaseProvider class, implement required methods, register in shared provider instances, and add tests.

**Q: How do I support a new content type?**
A: Update the unified parser and metadata extractor with new patterns, then add comprehensive tests.

**Q: How do I debug search issues?**
A: Enable verbose logging, examine multi-phase search coordinator output, and check cache statistics.

**Q: How do I deploy to production?**
A: See the Deployment section for supported platforms and step-by-step instructions.

## Core Components

### 1. Unified Parsing Engine
**Location**: `src/utils/unified-torrent-parser.js`

The heart of the system, providing consistent parsing across all content types:

```javascript
// Main parsing function using parse-torrent-title + regex fallback
parseUnified(filename, options = {})
// Performance tracking
getParserStats()
// Cache management
clearParserCache()
```

**Features**:
- Content-agnostic parsing using parse-torrent-title library
- Advanced caching (1000 item LRU cache)
- Performance monitoring
- Regex fallback for parse-torrent-title limitations
- Technical detail extraction

### 2. Metadata Extraction System
**Location**: `src/stream/metadata-extractor.js`

Sophisticated metadata extraction for different content types:

```javascript
// Series metadata extraction
extractSeriesInfo(videoName, containerName)
// Movie metadata extraction  
extractMovieInfo(movieName)
// Generic video metadata
extractVideoMetadata(filename, type, containerName)
```

**Capabilities**:
- Multi-format support (TV series, movies, anime)
- Quality detection (resolution, source, codec, audio)
- Episode and season parsing
- Release group identification
- Language detection

### 3. Performance Optimization Layer
**Location**: `src/stream/performance-optimizer.js`

Advanced performance optimizations and enterprise caching:

```javascript
// Multi-level caching with exact + fuzzy metadata retrieval
getOrParseMetadata(containerName, videoName, type)
// Batch processing for multiple streams
batchExtractTechnicalDetails(streams)
// Sequential stream formatting with error handling
sequentialStreamFormatting(streamData)
// Pattern matching with unified cache
optimizedPatternMatching(text, patterns)
```

**Optimizations**:
- Multi-level unified caching strategy (exact + fuzzy keys)
- Technical details caching with 24-hour TTL
- Batch processing capabilities for efficiency
- Memory-efficient operations
- Pattern pre-compilation and caching

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

### 5. Multi-Phase Search Engine
**Locations**: `src/search/coordinator.js`, `src/search/phase-*.js`

Intelligent 3-phase search process for optimal results:

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

### 6. BaseProvider Architecture
**Location**: `src/providers/BaseProvider.js`

Abstract base class providing consistent functionality across all debrid providers:

```javascript
// Universal API call wrapper with retry logic and error handling
makeApiCall(apiCall, retries, context)
// HTML error response detection for all providers
detectHtmlErrorResponse(response, context)
// Standard fuzzy search using Fuse.js
performFuzzySearch(items, searchKey, threshold)
// Unified torrent object normalization
normalizeTorrent(item, customFields)
// Standard video file extraction with URL building
extractVideoFiles(item, apiKey, urlBuilder)
```

**Provider Implementations**:
- **Real-Debrid**: `src/providers/real-debrid.js` - Full implementation with bulk operations
- **AllDebrid**: `src/providers/all-debrid.js` - Clean implementation with optimized caching
- **Premiumize**: `src/providers/premiumize.js` - File-based operations
- **Debrid-Link**: `src/providers/debrid-link.js` - Standard implementation
- **TorBox**: `src/providers/torbox.js` - Download-focused implementation

### 7. Episode Pattern Recognition
**Location**: `src/utils/episode-patterns.js`

Comprehensive episode and season detection:

```javascript
// Episode parsing from titles
parseEpisodeFromTitle(filename)
// Absolute episode detection for anime
parseAbsoluteEpisode(filename)
// Season extraction with multiple formats
parseSeasonFromTitle(filename)
```

**Pattern Support**:
- Standard formats (S01E01, 1x01)
- Anime patterns (Episode 001, #12)
- Absolute episode numbering
- Roman numeral seasons
- Multi-episode ranges

## Module Directory

### Root Level Files
- `addon.js` - Main addon entry point and Stremio interface
- `server.js` - Express server setup and middleware
- `serverless.js` - Serverless deployment configuration
- `package.json` - Dependencies and scripts
- `README.md` - Project documentation

### Source Code Structure

#### `/src/api/`
- `cinemeta.js` - Cinemeta API integration for metadata (1h TTL)
- `jikan.js` - Anime metadata via Jikan API with rate limiting (24h TTL, 3 req/sec)
- `tmdb.js` - Movie/TV metadata via TMDB API (6h-24h TTL)
- `trakt.js` - TV/streaming metadata via Trakt API (24h TTL)

#### `/src/config/`
- `configuration.js` - Centralized configuration management with ConfigurationManager class
- `manifest.js` - Addon manifest and metadata

#### `/src/providers/`
- `BaseProvider.js` - Abstract base class with common functionality
- `all-debrid.js` - AllDebrid implementation
- `real-debrid.js` - RealDebrid implementation
- `debrid-link.js` - DebridLink implementation
- `premiumize.js` - Premiumize implementation
- `torbox.js` - TorBox implementation

#### `/src/search/`
- `coordinator.js` - Multi-phase search orchestration and result aggregation
- `phase-0-preparation.js` - Search term preparation and API calls
- `phase-1-title-matching.js` - Fuzzy title matching with Fuse.js
- `phase-2-content-analysis.js` - Deep content analysis and episode matching
- `anime-fallback.js` - Anime-specific search fallbacks (Phase 3)
- `provider-search.js` - Main provider search logic and ranking
- `episode-mapper.js` - Episode number and title mapping
- `keyword-extractor.js` - Keyword extraction and scoring
- `torrent-analyzer.js` - Torrent file analysis for technical details

#### `/src/stream/`
- `metadata-extractor.js` - Core metadata extraction with quality detection
- `performance-optimizer.js` - Multi-level caching and batch processing
- `stream-builder.js` - Stream generation with optimized paths
- `quality-processor.js` - Stream quality analysis and filtering

#### `/src/utils/`
- `unified-torrent-parser.js` - Main parsing engine using parse-torrent-title + regex
- `cache-manager.js` - UnifiedCacheManager for enterprise-grade caching
- `error-handler.js` - ErrorManager for centralized error processing
- `episode-patterns.js` - Comprehensive episode and season pattern recognition
- `absolute-episode-processor.js` - Absolute episode number detection and mapping
- `debrid-processor.js` - Debrid service integration utilities
- `groups-util.js` - Release group identification and normalization
- `logger.js` - Centralized logging system
- `media-patterns.js` - Media type and quality pattern recognition
- `roman-numeral-utils.js` - Roman numeral processing
- `variant-detector.js` - Variant release detection and normalization

#### `/public/`
- `landing-template.js` - User interface template

#### **Root Level Files**
- `catalog-provider.js` - Content catalog management

## Data Flow

### 1. Stream Request Processing

```
User Request → Stremio API → Stream Provider → Search Coordinator
     ↓
Phase 0 (Prep) → Phase 1 (Title Match) → Phase 2 (Content Analysis)
     ↓
BaseProvider → Unified Parser → Performance Optimizer → Quality Processor
     ↓
UnifiedCacheManager → Stream Builder → Response Assembly → User
```

### 2. Parsing Pipeline

```
Raw Filename → parseUnified (PTT + regex) → Metadata Extraction → Quality Detection
     ↓
Performance Optimizer → UnifiedCacheManager → Structured Result
```

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
- **Trakt API**: Episode mappings and show info (24h TTL)
- **Jikan API**: Anime season data (24h TTL) with rate limiting (3 req/sec)
- **Cinemeta API**: Metadata responses (1h TTL)

#### 3. **Performance Optimization Caching**
- **Metadata Cache**: Exact + fuzzy caching (12h-24h TTL)
- **Technical Details**: Video quality, codecs, specifications (24h TTL)
- **Pattern Matching**: Regex evaluation results (12h TTL)
- **Torrent Parser**: In-memory LRU cache (1000 items)

#### 4. **Cache Organization**
- **Prefixed keys**: `jikan:`, `tmdb_`, `trakt_`, `metadata_`, `tech_details_`, `pattern_match_`
- **TTL variations**: 30min (failures) to 24h (stable data)
- **Pattern retrieval**: `cache.getByPattern()` for debugging and monitoring
- **Statistics**: Real-time cache performance tracking

### Performance Metrics
Based on comprehensive testing with real-world data:
- **Overall Performance Improvement**: 71-81% faster than original
- **Jikan API Optimization**: 100% cache hit performance after first fetch
- **Technical Details Caching**: Near-instant retrieval (0.01ms for cache hits)
- **Memory efficiency**: Controlled growth with automatic cleanup
- **Concurrent processing**: Optimized for multiple simultaneous requests

### Optimization Techniques
1. **Multi-Level Caching**: Exact + fuzzy metadata caching
2. **Batch Processing**: Group similar operations for efficiency
3. **Parallel API Calls**: Phase 0 preparation runs APIs in parallel
4. **Pattern Pre-compilation**: Regex optimization with caching
5. **Memory Management**: Automatic cleanup and LRU eviction
6. **Rate Limiting**: Built-in for external APIs (e.g., Jikan 3 req/sec)

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
- **BaseProvider**: Universal HTML error detection and retry logic
- **Graceful degradation**: Partial failures don't break entire responses
- **Fallback strategies**: Multi-phase search provides alternative paths
- **Comprehensive logging**: Context preservation for debugging

## Caching Strategy

### Cache TTL Strategy by Data Type
| Data Type | TTL | Reason |
|-----------|-----|--------|
| Jikan Anime Data | 24h | Anime seasons rarely change |
| TMDb Alternative Titles | 24h | Title variations are stable |
| TMDb Search Results | 6h | Search results may update |
| Trakt Episode Mappings | 24h | Episode data is permanent |
| Cinemeta Metadata | 1h | Metadata may be updated |
| Technical Details | 24h | Video specs are static |
| Metadata (Exact) | 12h | Parsing results are stable |
| Metadata (Fuzzy) | 24h | Shared across episodes |
| Pattern Matching | 12h | Regex results are stable |
| Failed API Calls | 30min-1h | Retry failed calls sooner |

### Cache Key Patterns
- **API Keys**: `jikan:anime_season:${title}`, `tmdb_alt_titles_${id}_${type}`
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