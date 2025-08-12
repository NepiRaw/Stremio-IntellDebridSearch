
# Stremio IntellDebridSearch Addon - Architecture Documentation


## Overview

Stremio IntellDebridSearch is a modular, content-agnostic streaming addon for Stremio. <br> 
It provides intelligent torrent search, unified parsing, and seamless integration with multiple debrid services. <br>
This document is designed for developers, maintainers, and stakeholders to understand the system’s architecture, how its components interact, and how to extend or debug it. No prior knowledge of the codebase is required.

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
│  Catalog Provider  │  Stream Provider  │  Search Provider     │
├───────────────────────────────────────────────────────────────┤
│              Unified Parsing Engine                           │
├───────────────────────────────────────────────────────────────┤
│   Metadata       │   Performance     │   Quality              │
│   Extractor      │   Optimizer       │   Detector             │
├───────────────────────────────────────────────────────────────┤
│              Debrid Service Integrations                      │
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
     - *Search Provider*: Handles search queries and result ranking.
- **Unified Parsing Engine**: Centralized logic for parsing torrent and video filenames, used by all providers.
- **Metadata/Performance/Quality Modules**: Extracts technical details, optimizes performance, and detects quality.
- **Debrid Service Integrations**: Pluggable modules for each supported debrid service.
## Provider Integration & Extensibility

Providers are implemented as modular files in `/src/providers/`. <br>
Each provider exports a standard interface (e.g., `listTorrents`, `searchTorrents`, `getTorrentDetails`, etc.) and plugs into the main system via the provider registry. <p>

Adding a new provider requires:

1. Creating a new file in `/src/providers/` following the standard interface.
2. Implementing authentication, API calls, and error handling.
3. Registering the provider in the main configuration.
4. Ensuring it uses the unified parsing engine for filename parsing and metadata extraction.

**Unified Parsing Usage:**
All providers call the unified parser (`parseUnified`) to ensure consistent metadata extraction and content-agnostic handling. This guarantees that new providers or content types are automatically supported by the parsing logic.


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
4. Provider Selection
     - Chooses the appropriate provider (e.g., RealDebrid, AllDebrid) based on config and request type
     ↓
5. Provider Logic (src/providers/)
     - Provider module executes requested action (listTorrents, searchTorrents, getTorrentDetails, etc.)
     - Calls Unified Parsing Engine for filename parsing
     ↓
6. Unified Parsing Engine (parseUnified)
     - Parses torrent/video filenames for metadata
     ↓
7. Metadata Extraction (extractSeriesInfo, extractMovieInfo, ...)
     - Extracts technical details and content info
     ↓
8. Performance Optimization
     - Applies caching, batch processing, and parallel formatting
     ↓
9. Quality Filtering
     - Filters streams for quality (resolution, codec, etc.)
     ↓
10. Debrid Service API
      - Provider interacts with debrid service API (fetch, resolve, unrestrict)
     ↓
11. Stream Generation
      - Stream provider assembles final stream objects
     ↓
12. Response Caching
      - Results may be cached for performance
     ↓
13. Stremio Client Response
      - Final response sent back to Stremio client
```

**Notes:**
- Unified parsing and metadata extraction are always performed before any stream is returned.
- Provider selection is dynamic and based on configuration and request type.
- Caching and error handling are applied throughout the flow for robustness and performance.

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

All errors are logged via the centralized logger (`/src/utils/logger.js`).
- API errors, parsing failures, and network issues are caught and logged with context.
- The system uses fallback strategies and retries for transient errors.
## Extending & Debugging

**To Add a New Provider:**
- Copy an existing provider file in `/src/providers/` and update API endpoints and logic.
- Register the provider in `/src/config/configuration.js`.
- Ensure all exported functions match the standard interface.
- Add tests in `/tests/` to validate provider integration.

**To Add a New Content Type:**
- Update `/src/utils/unified-torrent-parser.js` and `/src/stream/metadata-extractor.js` to recognize new patterns.
- Add relevant tests and update documentation.

**Debugging Tips:**
- Use verbose logging and run integration tests.
- Check `output.log` for error traces.
- Use the test scripts in `/tests/` to simulate real-world scenarios.
## Real-World Usage Notes

- The addon is designed to be content-agnostic and provider-agnostic. It works for movies, series, anime, and any future content types.
- All parsing and metadata extraction is centralized, so improvements benefit all providers and content types.
- The system is robust against malformed input, API failures, and edge cases, with graceful degradation and fallback logic.
## Navigation Guide

- `/src/` — Main source code (providers, parsing, metadata, search, stream logic)
- `/docs/` — Documentation (architecture, caching, performance, refactoring)
- `/tests/` — Test scripts and validation tools
- `/public/` — UI templates and static assets
## FAQ

**Q: How do I add a new debrid provider?**
A: Copy an existing provider file, implement the required interface, register it in config, and add tests.

**Q: How do I support a new content type?**
A: Update the unified parser and metadata extractor, then add tests and documentation.

**Q: How do I debug errors?**
A: Use verbose logging, and run integration tests in `/tests/`.

**Q: How do I deploy to production?**
A: See the Deployment section for supported platforms and step-by-step instructions.

## Core Components

### 1. Unified Parsing Engine
**Location**: `src/utils/unified-torrent-parser.js`

The heart of the system, providing consistent parsing across all content types:

```javascript
// Main parsing function
parseUnified(filename, options = {})
// Performance tracking
getParserStats()
// Cache management
clearParserCache()
```

**Features**:
- Content-agnostic parsing
- Advanced caching (1000 item LRU cache)
- Performance monitoring
- Fallback parsing strategies
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

Advanced performance optimizations and caching:

```javascript
// Optimized metadata retrieval with caching
getOrParseMetadata(containerName, videoName, type)
// Batch processing for multiple streams
batchExtractTechnicalDetails(streams)
// Parallel stream formatting
parallelStreamFormatting(streamData, maxWorkers)
```

**Optimizations**:
- Multi-level caching strategy
- Batch processing capabilities
- Parallel worker support
- Memory-efficient operations
- Pattern pre-compilation

### 4. Episode Pattern Recognition
**Location**: `src/utils/episode-patterns.js`

Comprehensive episode and season detection:

```javascript
// Episode parsing from titles
parseEpisodeFromTitle(filename)
// Absolute episode detection
parseAbsoluteEpisode(filename)
// Season extraction
parseSeasonFromTitle(filename)
```

**Pattern Support**:
- Standard formats (S01E01, 1x01)
- Anime patterns (Episode 001, #12)
- Absolute episode numbering
- Roman numeral seasons
- Multi-episode ranges

### 5. Stream Provider Services
**Locations**: `src/stream/`, `src/providers`

Multiple debrid service integrations:

- **Real-Debrid**: `src/real-debrid.js`
- **AllDebrid**: `src/all-debrid.js`
- **Premiumize**: `src/premiumize.js`
- **Debrid-Link**: `src/debrid-link.js`
- **TorBox**: `src/torbox.js`

Each service provides:
- Authentication handling
- Error recovery
- Stream resolution
- Quality filtering

## Module Directory

### Root Level Files
- `addon.js` - Main addon entry point and Stremio interface
- `server.js` - Express server setup and middleware
- `serverless.js` - Serverless deployment configuration
- `package.json` - Dependencies and scripts
- `README.md` - Project documentation

### Source Code Structure

#### `/src/api/`
- `cinemeta.js` - Cinemeta API integration for metadata
- `jikan.js` - Anime metadata via Jikan API
- `tmdb.js` - Movie/TV metadata via TMDB API
- `trakt.js` - TV/streaming metadata via Trakt API

#### `/src/catalog/`
- `catalog-provider.js` - Content catalog management

#### `/src/config/`
- `configuration.js` - System configuration management
- `manifest.js` - Addon manifest and metadata

#### `/src/providers/`
- Individual debrid provider implementations

#### `/src/search/`
- `provider-search.js` - Main provider search logic, ranking, and fuzzy matching
- `phase-0-preparation.js` - Initial preparation and normalization of search input
- `phase-1-title-matching.js` - Title-based matching and scoring of torrents
- `phase-2-content-analysis.js` - Enriches torrent results with metadata and technical details
- `anime-fallback.js` - Handles anime-specific search fallbacks and edge cases (phase 3)
- `coordinator.js` - Orchestrates multi-phase search and result aggregation
- `episode-mapper.js` - Maps episode numbers and titles for accurate matching
- `keyword-extractor.js` - Extracts and scores keywords from torrent names
- `torrent-analyzer.js` - Analyzes torrent files for technical and content details

#### `/src/stream/`
- `metadata-extractor.js` - Core metadata extraction
- `performance-optimizer.js` - Performance optimizations
- `stream-provider.js` - Stream generation logic
- `quality-processor.js` - Stream quality analysis and filtering

#### `/src/utils/`
- `unified-torrent-parser.js` - Main parsing engine for torrent/video filenames
- `absolute-episode-processor.js` - Handles absolute episode number detection and mapping
- `cache-manager.js` - Caching utilities and LRU cache management
- `debrid-processor.js` - Utility functions for debrid service integration and normalization
- `episode-patterns.js` - Pattern recognition for episodes and seasons
- `error-handler.js` - Centralized error management and reporting
- `groups-util.js` - Release group identification and normalization
- `logger.js` - Logging system for errors, warnings, and info
- `media-patterns.js` - Media type and quality pattern recognition
- `parse-torrent-title.js` - Advanced parsing for torrent titles and metadata
- `roman-numeral-utils.js` - Roman numeral processing and conversion
- `variant-detector.js` - Detects and normalizes variant releases and editions

#### `/public/`
- `landing-template.js` - User interface template


## Data Flow

### 1. Stream Request Processing

```
User Request → Stremio API → Stream Provider → Search Engine
     ↓
Torrent Results → Unified Parser → Metadata Extractor → Quality Filter
     ↓
Debrid Services → Stream Generation → Response Cache → User
```

### 2. Parsing Pipeline

```
Raw Filename → Cleaning → Pattern Recognition → Metadata Extraction
     ↓
Quality Detection → Technical Details → Caching → Structured Result
```

### 3. Performance Optimization Flow

```
Request → Cache Check → Parse if Needed → Store Result → Return
     ↓
Background: Stats Collection → Performance Monitoring → Cache Optimization
```

## Performance Optimizations

### Caching Strategy
1. **Parsing Cache**: 1000-item LRU cache for parsed results
2. **Metadata Cache**: Performance-optimized metadata storage
3. **Pattern Cache**: Pre-compiled regex patterns
4. **API Cache**: Debrid service response caching

### Performance Metrics
Based on comprehensive testing:
- **Average parsing time**: 2.37ms
- **Cache hit ratio**: 20.6x speedup (up to 54.1x)
- **Memory efficiency**: 0.007MB per file
- **Concurrent processing**: 50+ streams simultaneously

### Optimization Techniques
1. **Lazy Loading**: Parse only when needed
2. **Batch Processing**: Group similar operations
3. **Parallel Workers**: Multi-threaded stream processing
4. **Pattern Pre-compilation**: Regex optimization
5. **Memory Management**: Efficient garbage collection

## Error Handling

### Error Categories
1. **Input Validation**: Null/undefined/malformed input handling
2. **Network Errors**: API timeouts, rate limits, connectivity issues
3. **Parsing Errors**: Malformed filenames, encoding issues
4. **Service Errors**: Debrid service failures, authentication issues

### Error Recovery
- Graceful degradation for partial failures
- Fallback parsing strategies
- Retry mechanisms with exponential backoff
- Comprehensive error logging

## Configuration Management

### Environment Variables
- Debrid service API keys
- Server configuration (port, host)
- Performance tuning parameters
- Feature flags

### Configuration Files
- `src/config/configuration.js` - Main configuration
- `.env` - Environment-specific settings
- `package.json` - Dependencies and scripts

## Deployment

### Supported Platforms
1. **Traditional Server**: Node.js with Express
2. **Serverless**: AWS Lambda, Vercel, Netlify, ...
3. **Container**: Docker deployment
4. **Cloud**: Heroku, Railway, etc.

### Deployment Files
- `server.js` - Traditional server deployment
- `serverless.js` - Serverless function deployment
- `vercel.json` - Vercel configuration
- `beamup.json` - BeamUp deployment config


---

*This architecture documentation represents the current state of the Stremio IntellDebridSearch Addon after comprehensive refactoring and optimization. The system demonstrates excellent performance, reliability, and maintainability through its unified parsing engine and modular design.*

---

**Last Updated**: August 2025  
**Version**: 2.1.0 (Unified, Extensible, Post-Refactoring)  
**Author**: NepiRaw