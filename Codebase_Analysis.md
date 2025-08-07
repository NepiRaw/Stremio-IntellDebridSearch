# 🔍 CODEBASE ANALYSIS - Phase 7 Redundant Parsing Investigation

**Analysis Date**: August 6, 2025  
**Purpose**: Identify redundant parsing operations for consolidation  
**Scope**: Complete codebase analysis for Phase 7 optimization

---

## 📊 ANALYSIS OVERVIEW

This document provides a comprehensive analysis of the current codebase to identify redundant parsing operations that can be consolidated into unified, reusable functions.

**Key Focus Areas:**
- Title parsing logic across different modules
- Season/episode extraction operations
- Torrent filename parsing functions
- Metadata extraction from filenames
- Duplicate parsing implementations

---

## 📁 MODULE-BY-MODULE ANALYSIS

### **🔌 API Layer (`src/api/`)**
External API clients for metadata enrichment.

#### **`src/api/cinemeta.js`**
- **Purpose**: Cinemeta API client for content metadata retrieval
- **Main Functions**:
  - `fetchMetadata(imdbId, type)`: Fetches basic content metadata
  - `getContentInfo(id, type)`: Wrapper for content information
- **Parsing Operations**: None - pure API client
- **Dependencies**: HTTP requests, caching
- **Redundancy Assessment**: ✅ No parsing redundancy

#### **`src/api/tmdb.js`**
- **Purpose**: TMDb API client for alternative titles and metadata
- **Main Functions**:
  - `searchTMDbByTitle(searchTitle, tmdbApiKey)`: Search by title
  - `fetchTMDbAlternativeTitles(tmdbId, type, tmdbApiKey, imdbId)`: Get alternative titles
  - `getTmdbApiKey()`: Centralized API key management
  - `isTmdbEnabled()`: Feature availability check
- **Parsing Operations**: 
  - Basic title normalization for search queries
  - Country code processing for alternative titles
- **Dependencies**: Cache manager, logger, keyword extractor
- **Redundancy Assessment**: ⚠️ Minimal title normalization - check if duplicates keyword extraction

#### **`src/api/trakt.js`**
- **Purpose**: Trakt API client for episode mapping and absolute numbers
- **Main Functions**:
  - `getShowInfo(traktApiKey, imdbId)`: Fetch show metadata
  - `getEpisodeMapping(traktApiKey, imdbId, season, episode)`: Get absolute episode numbers
  - `getTraktApiKey()`: Centralized API key management
  - `isTraktEnabled()`: Feature availability check
- **Parsing Operations**: None - uses API responses directly
- **Dependencies**: Cache manager, logger
- **Redundancy Assessment**: ✅ No parsing redundancy

#### **`src/api/jikan.js`**
- **Purpose**: MyAnimeList API client for anime season information
- **Main Functions**:
  - `fetchAnimeSeasonInfo(titleQuery)`: Get anime season data
  - `searchAnime(query)`: Search anime by title
  - Rate limiting and caching functionality
- **Parsing Operations**:
  - Title normalization for anime search
  - Season/part detection from anime titles
  - Air date parsing and sorting
- **Dependencies**: Cache manager, logger
- **Redundancy Assessment**: ⚠️ Title normalization - potential duplication with keyword extraction

---

### **🔍 Search Layer (`src/search/`)**
Search orchestration and content analysis modules.

#### **`src/search/coordinator.js`**
- **Purpose**: Main search orchestration - coordinates all search phases
- **Main Functions**:
  - `coordinateSearch(imdbId, type, season, episode, config)`: Main search entry point
  - Phase 0: Preparation and API enrichment
  - Phase 1: Title matching with Fuse.js
  - Phase 2: Content analysis and episode matching
  - Phase 3: Anime fallback logic
- **Parsing Operations**:
  - ⚠️ **Title keyword extraction** (via keyword-extractor)
  - ⚠️ **Basic torrent title processing** 
  - Episode number validation
- **Dependencies**: All search modules, API modules, providers
- **Redundancy Assessment**: 🔴 **HIGH** - Orchestrates multiple parsing operations

#### **`src/search/keyword-extractor.js`**
- **Purpose**: Text normalization and keyword extraction for search optimization
- **Main Functions**:
  - `extractKeywords(title)`: Primary keyword extraction function
  - Unicode normalization and cleanup
  - Roman numeral handling
  - Stop word filtering
- **Parsing Operations**:
  - 🔴 **Title normalization and cleanup**
  - 🔴 **Punctuation and special character removal**
  - 🔴 **Word filtering by length and relevance**
  - 🔴 **Unicode normalization**
- **Dependencies**: None (standalone utility)
- **Redundancy Assessment**: 🔴 **CRITICAL** - Core parsing logic used everywhere

#### **`src/search/episode-mapper.js`**
- **Purpose**: Episode/season parsing and absolute episode mapping
- **Main Functions**:
  - `getEpisodeMapping(config, imdbId, season, episode)`: Wrapper for Trakt API
  - `extractAbsoluteEpisode(filename)`: Extract absolute episode from filename
  - `parseSeasonEpisode(filename)`: Parse season/episode patterns
  - `isEpisodeMatch(videoInfo, targetSeason, targetEpisode)`: Episode matching logic
- **Parsing Operations**:
  - 🔴 **Season/episode regex parsing** 
  - 🔴 **Absolute episode number extraction**
  - 🔴 **Episode pattern detection**
  - Filename analysis for episode information
- **Dependencies**: Trakt API, parse-torrent-title
- **Redundancy Assessment**: 🔴 **HIGH** - Core episode parsing logic

#### **`src/search/torrent-analyzer.js`**
- **Purpose**: Deep torrent content analysis for episode matching
- **Main Functions**:
  - `analyzeTorrent(torrent, targetSeason, targetEpisode, absoluteEpisode, config)`: Main analysis
  - Container vs direct torrent analysis
  - Video file enumeration and parsing
  - Episode matching within torrent contents
- **Parsing Operations**:
  - 🔴 **Filename parsing for season/episode**
  - 🔴 **Video file extension detection**
  - 🔴 **Episode number extraction from filenames**
  - 🔴 **Title parsing from video filenames**
- **Dependencies**: Providers (for torrent details), parse-torrent-title
- **Redundancy Assessment**: 🔴 **CRITICAL** - Heavy parsing operations

---

### **🎬 Stream Processing Layer (`src/stream/`)**
Stream creation and metadata processing modules.

#### **`src/stream/metadata-extractor.js`**
- **Purpose**: Extract metadata (title, season, quality) from filenames
- **Main Functions**:
  - `extractVideoMetadata(filename)`: Primary metadata extraction
  - `extractSeriesInfo(videoName, containerName)`: Series-specific parsing
  - `extractMovieInfo(movieName)`: Movie-specific parsing
  - `extractCleanFilename(filename)`: Cleanup utility
- **Parsing Operations**:
  - 🔴 **Filename parsing for metadata**
  - 🔴 **Quality information extraction**
  - 🔴 **Release group detection**
  - 🔴 **Video format parsing**
- **Dependencies**: File types, media patterns
- **Redundancy Assessment**: 🔴 **HIGH** - Comprehensive filename parsing

#### **`src/stream/formatter.js`**
- **Purpose**: Format stream titles and details for display in Stremio
- **Main Functions**:
  - `formatStreamTitle(details, video, type, icon, knownSeasonEpisode, variantInfo)`: Main formatting
  - `extractTechnicalDetails(filename)`: Technical details extraction
  - `formatSize(size)`: Size formatting utility
  - `buildStreamDisplayName(details, qualityInfo)`: Display name creation
- **Parsing Operations**:
  - 🔴 **Technical details pattern matching**
  - 🔴 **Quality information parsing**
  - 🔴 **Language and codec detection**
  - 🔴 **Source format identification**
- **Dependencies**: Media patterns, groups utility, variant detector
- **Redundancy Assessment**: 🔴 **CRITICAL** - Heavy pattern matching operations

#### **`src/stream/quality-processor.js`**
- **Purpose**: Extract quality information and sort streams by quality
- **Main Functions**:
  - `extractQualityInfo(name)`: Quality extraction from filename
  - `sortStreamsByQuality(streams, contentType)`: Quality-based sorting
  - `deduplicateStreams(streams)`: Remove duplicate streams
  - `calculateQualityScore(stream)`: Quality scoring algorithm
- **Parsing Operations**:
  - 🔴 **Resolution parsing (1080p, 4K, etc.)**
  - 🔴 **Source detection (BluRay, WEB-DL, etc.)**
  - 🔴 **Codec identification (HEVC, x264, etc.)**
  - Quality scoring and comparison
- **Dependencies**: Media patterns
- **Redundancy Assessment**: 🔴 **HIGH** - Quality parsing operations

#### **`src/stream/stream-builder.js`**
- **Purpose**: Build consistent stream objects from torrent data
- **Main Functions**:
  - `toStream(details, video, type, knownSeasonEpisode, variantInfo, searchContext)`: Main stream creation
  - `filterEpisode(torrentDetails, season, episode, absoluteEpisode)`: Episode filtering
  - `extractTechnicalDetails(filename)`: Technical details extraction
  - `buildStreamObject(streamData)`: Stream object construction
- **Parsing Operations**:
  - 🔴 **Season/episode parsing for filtering**
  - 🔴 **Technical details extraction**
  - 🔴 **Filename analysis for stream metadata**
  - 🔴 **Release group extraction**
- **Dependencies**: Formatter, quality processor, variant detector, media patterns
- **Redundancy Assessment**: 🔴 **CRITICAL** - Multiple parsing operations

---

### **🛠️ Utilities Layer (`src/utils/`)**
Shared utility modules with core parsing functionality.

#### **`src/utils/parse-torrent-title.js`**
- **Purpose**: Core torrent title parsing and season/episode extraction
- **Main Functions**:
  - `parse(title)`: Main torrent title parsing function
  - `parseSeason(title, strict)`: Season extraction with strict mode
  - `parseRomanNumeral(num)`: Roman numeral conversion
  - `romanToNumber(roman)`: Roman to Arabic conversion
- **Parsing Operations**:
  - 🔴 **CORE: Title parsing with comprehensive regex patterns**
  - 🔴 **CORE: Season/episode extraction**
  - 🔴 **CORE: Roman numeral conversion**
  - 🔴 **CORE: Quality and technical details parsing**
- **Dependencies**: None (core utility)
- **Redundancy Assessment**: 🔴 **FOUNDATIONAL** - Core parsing engine used everywhere

#### **`src/utils/media-patterns.js`**
- **Purpose**: Regex patterns for media parsing and quality extraction
- **Main Functions**:
  - Pattern definitions: `QUALITY_PATTERNS`, `SOURCE_PATTERNS`, `CODEC_PATTERNS`
  - `extractQualityInfo(text)`: Quality extraction using patterns
  - Pattern matching utilities
- **Parsing Operations**:
  - 🔴 **Pattern definitions for all media parsing**
  - 🔴 **Quality pattern matching**
  - 🔴 **Language and audio pattern matching**
  - Pattern validation and extraction
- **Dependencies**: None (pattern definitions)
- **Redundancy Assessment**: 🔴 **FOUNDATIONAL** - Pattern source for all parsing

#### **`src/utils/variant-detector.js`**
- **Purpose**: Detect and classify torrent variants for content matching
- **Main Functions**:
  - `detectSimpleVariant(title1, title2)`: Variant detection between titles
  - `cleanupVariantName(variant)`: Variant name cleanup
  - `isValidVariant(variant)`: Variant validation
- **Parsing Operations**:
  - 🔴 **Title comparison and variant extraction**
  - 🔴 **Variant name cleanup and normalization**
  - Similarity scoring for variant detection
- **Dependencies**: String utilities
- **Redundancy Assessment**: ⚠️ Specialized parsing - potential optimization

#### **`src/utils/debrid-processor.js`**
- **Purpose**: Process torrent data from debrid providers
- **Main Functions**:
  - `extractVideoFiles(torrentData)`: Extract video files from torrent
  - `processTorrentDetails(torrent, provider)`: Process torrent metadata
  - `validateVideoFile(filename)`: Video file validation
- **Parsing Operations**:
  - 🔴 **Filename parsing for video detection**
  - 🔴 **File extension analysis**
  - File path processing and cleanup
- **Dependencies**: File types, media patterns
- **Redundancy Assessment**: ⚠️ Provider-specific parsing

---

## 🔴 REDUNDANCY ANALYSIS SUMMARY

### **CRITICAL PARSING REDUNDANCIES IDENTIFIED**

#### **1. Title Normalization & Keyword Extraction**
**Locations:**
- `src/search/keyword-extractor.js`: `extractKeywords(title)` - Primary implementation
- `src/api/tmdb.js`: Basic title normalization for search
- `src/api/jikan.js`: Title normalization for anime search
- Multiple locations: Ad-hoc title cleanup

**Redundancy Level**: 🔴 **HIGH**  
**Impact**: Performance overhead, inconsistent normalization  
**Consolidation Opportunity**: Create unified title normalization utility

#### **2. Season/Episode Parsing**
**Locations:**
- `src/utils/parse-torrent-title.js`: Core season/episode parsing
- `src/search/episode-mapper.js`: Season/episode extraction functions
- `src/search/torrent-analyzer.js`: Episode parsing for content analysis
- `src/stream/stream-builder.js`: Episode parsing for filtering
- `src/stream/metadata-extractor.js`: Episode parsing for metadata

**Redundancy Level**: 🔴 **CRITICAL**  
**Impact**: Multiple regex operations, inconsistent parsing  
**Consolidation Opportunity**: Create single episode parsing engine

#### **3. Technical Details Extraction**
**Locations:**
- `src/stream/formatter.js`: `extractTechnicalDetails(filename)`
- `src/stream/stream-builder.js`: `extractTechnicalDetails(filename)` 
- `src/stream/quality-processor.js`: Quality extraction
- `src/utils/media-patterns.js`: Pattern-based extraction

**Redundancy Level**: 🔴 **CRITICAL**  
**Impact**: Duplicate pattern matching, performance overhead  
**Consolidation Opportunity**: Single technical details parser

#### **4. Filename Parsing & Analysis**
**Locations:**
- `src/stream/metadata-extractor.js`: Comprehensive filename parsing
- `src/search/torrent-analyzer.js`: Filename analysis for episodes
- `src/stream/formatter.js`: Filename processing for display
- `src/utils/debrid-processor.js`: Filename validation and processing

**Redundancy Level**: 🔴 **HIGH**  
**Impact**: Multiple parsing passes, inconsistent results  
**Consolidation Opportunity**: Unified filename parsing engine

#### **5. Quality & Technical Pattern Matching**
**Locations:**
- `src/stream/quality-processor.js`: Quality extraction
- `src/stream/formatter.js`: Technical details matching
- `src/utils/media-patterns.js`: Pattern definitions and utilities
- Multiple files: Ad-hoc quality detection

**Redundancy Level**: 🔴 **HIGH**  
**Impact**: Repeated pattern matching operations  
**Consolidation Opportunity**: Centralized quality parsing service

---

## 📈 PERFORMANCE IMPACT ANALYSIS

### **Current Parsing Operations Per Request**

For a typical series search (e.g., "Breaking Bad S01E01"):

1. **Title Processing**: 
   - Keyword extraction: 1x per title + alternatives (3-5 times)
   - Title normalization: 2-3x across different modules
   
2. **Episode Parsing**: 
   - Season/episode extraction: 5-10x per torrent result
   - Episode matching: 1x per video file in torrent
   
3. **Technical Details**: 
   - Quality extraction: 1x per stream creation
   - Pattern matching: 3-5x per filename processing
   
4. **Filename Analysis**: 
   - Metadata extraction: 1x per video file
   - Validation: 1x per file processing

**Estimated Parsing Operations**: 50-100+ parsing operations per search request

### **Optimization Potential**

🎯 **Target**: Reduce parsing operations by 60-80%  
🎯 **Method**: Parse once, cache results, reuse parsed data  
🎯 **Expected Benefit**: Significant performance improvement and code simplification

---

## 🎯 CONSOLIDATION RECOMMENDATIONS

### **Phase 7.1: Create Unified Parsing Engine**

#### **New Module: `src/utils/unified-parser.js`**
**Purpose**: Single point for all torrent/filename parsing operations

**Core Functions:**
```javascript
// Main parsing function - parse once, return all data
parseMediaFile(filename, containerName = null) {
  return {
    title: string,
    season: number,
    episode: number,
    absoluteEpisode: number,
    year: number,
    quality: object,
    technical: object,
    language: object,
    releaseGroup: string,
    variant: string,
    metadata: object
  }
}

// Specialized parsers
parseTorrentTitle(title)
parseVideoFilename(filename)
parseQualityInfo(text)
extractTechnicalDetails(text)
```

### **Phase 7.2: Implement Caching Layer**

#### **New Module: `src/utils/parsing-cache.js`**
**Purpose**: Cache parsed results to avoid redundant operations

**Features:**
- LRU cache for parsed filenames
- Invalidation strategies
- Memory management
- Performance monitoring

### **Phase 7.3: Refactor Existing Modules**

**Priority Order:**
1. **High Impact**: `stream-builder.js`, `formatter.js`, `torrent-analyzer.js`
2. **Medium Impact**: `metadata-extractor.js`, `quality-processor.js`
3. **Low Impact**: API modules, specialized utilities

---

## 📋 NEXT STEPS FOR PHASE 7

### **Task 7.1**: Detailed Redundancy Mapping
- Map every parsing function call across the codebase
- Identify exact duplication points
- Measure current performance impact

### **Task 7.2**: Design Unified Parser Architecture
- Define comprehensive parsed data structure
- Design caching strategy
- Plan migration approach

### **Task 7.3**: Implementation & Testing
- Create unified parsing engine
- Implement caching layer
- Migrate modules incrementally
- Validate performance improvements

---

**Analysis Complete**: ✅ Ready for Phase 7 implementation
