<div align="center">

# Stremio Intelligent Debrid Search Addon

<p>
  <img alt="GitHub Release" src="https://img.shields.io/github/v/release/nepiraw/Stremio-IntellDebridSearch">
  <img src="https://img.shields.io/badge/Stremio-Addon-purple" alt="Stremio" />
  <img src="https://img.shields.io/badge/Node.js-20+-brightgreen" alt="Node.js" />
</p>

</div>

---

<p align="center"><i><b>Stremio addon to search downloads and torrents in your Debrid cloud.<br></b>
<small><i>Forked and improved from original <a href="https://github.com/MrMonkey42/stremio-addon-debrid-search">DebridSearch</a> addon</i></small></p>


---
## ⚡ Public install

Addon currently available at: 
- **https://intell-debridsearch.nepiraw.com** (preferred)
- **https://intell-debridsearch.vercel.app** (backup)



## 🎯 Features

- 🔎 **Search your Debrid cloud**: Find and stream torrents already present in your Debrid account
- 🏷️ **Advanced parsing**: 
  - Handles alternate titles, 
  - Absolute episode numbers (for anime)
  - Better season parsing (catalogs may display anime as S01, instead of accurate season number)
  - Quality detection
- 🧠 **Intelligent episode/title matching**: Uses Trakt and TMDb APIs for improved accuracy
- 🌍 **Multi-provider support**: AllDebrid, RealDebrid, Premiumize, Torbox, Debrid-Link
- 🗂️ **Content-agnostic**: Works for movies, series, anime, and more

**Examples**
- Classic serie : <p>
  [![2025-08-10-22h17-10.png](https://i.postimg.cc/9fn7Fd5B/2025-08-10-22h17-10.png)](https://postimg.cc/2qn60B5q)
- Anime with catalog showing as S01<p>
[![2025-08-10-22h19-33.png](https://i.postimg.cc/6p62rjB0/2025-08-10-22h19-33.png)](https://postimg.cc/fJFRZvtt)

## 📋 Table of Contents
  - [⚙️ Configuration](#️-configuration)
    - [Access Configuration](#access-configuration)
    - [Configuration Options](#configuration-options)
    - [Recommendations](#recommendations)
  - [🚀 Self-Hosting Installation](#-self-hosting-installation)
    - [🐳 Docker Compose (Recommended)](#-docker-compose-recommended)
    - [🐍 Manual Installation](#-manual-installation)
    - [🔺 Vercel Deployment](#-vercel-deployment)
  - [🔧 Environment Variables](#-environment-variables)
  - [❓ FAQs](#-faqs)
  - [📚 Documentation](#-documentation)

## ⚙️ Configuration

### Access Configuration
1. Navigate to your addon URL (e.g., http://localhost:3001 or your domain)
2. Configure your Debrid provider and API keys
3. Click "Install Addon" to add it to Stremio

### Configuration Options
- **Provider Selection**: Choose your Debrid provider (not all debrid providers have been tested - provide feedback) <p>
    - [x] AllDebrid, 
    - [x] RealDebrid,
    - [x] Torbox,
    - [x] Debrid-Link,
    - [ ] Premiumize (not yet tested - provide feedback), 

- **API Keys**: Enter your debrid provider API key.

### Recommendations
- Order your addons so that the Intelligent Debrid Search addon is all the way at the top. This way:
  - If you have matching torrents in your debrid cloud, they will be found instantly.
  - If no torrents are found, nothing will appear and you can use your favorites addons as usual, but next time, the newly downloaded torrent will appear first.
- Provide feedback on unrecognized titles or false positives to help improve the addon.

## 🚀 Self-Hosting Installation

### 🐳 Docker Compose (Recommended)
1. **Create a `Dockerfile` in your project root:**

```Dockerfile
FROM node:20
WORKDIR /app
COPY . .
RUN npm install
EXPOSE 3001
CMD ["npm", "start"]
```

2. **Create a `docker-compose.yml` file:**

```yaml
services:
  stremio-intelldebridsearch:
    build: .
    container_name: stremio-intelldebridsearch
    restart: unless-stopped
    ports:
      - "3001:3001"
    env_file:
      - .env
```

> **Note:**
> - This setup builds your addon from source using the included Dockerfile.
> - The container will use your `.env` file for configuration.

1. **Set up environment and build:**

```powershell
# Clone the repository
 git clone https://github.com/NepiRaw/Stremio-IntellDebridSearch.git
 cd Stremio-IntellDebridSearch

# Copy and configure environment
 cp .env.example .env
 # Edit .env with your API keys and settings

# Start with Docker Compose (builds and runs the container)
 docker-compose up -d --build
```
> **Note:**
> - Make sure to adapt your `.env` file with the correct API keys and settings.

4. **Access your addon at `http://localhost:3001` (or your configured domain)**



### 🐍 Manual Installation

1. **Clone the repository:**
```bash
git clone https://github.com/NepiRaw/Stremio-IntellDebridSearch.git
cd Stremio-IntellDebridSearch
```
2. **Install dependencies:**
```bash
npm install
```
3. **Configure environment:**
```bash
cp .env.example .env
# Edit .env with your API keys
```
4. **Start the addon:**
```bash
npm start
```
5. **Access your addon at `http://localhost:3001` (or your configured domain)**


### 🔺 Vercel Deployment

1. **Copy this repository to your GitHub account**
2. **Deploy to Vercel:**
   - Connect your GitHub repository to Vercel
   - Configure environment variables in the Vercel dashboard (see below)
   - Vercel will auto-detect install and build commands

---

## 🔧 Environment Variables

| Variable                | Required | Default           | Description                                                                                   |
|-------------------------|----------|-------------------|-----------------------------------------------------------------------------------------------|
| `TRAKT_API_KEY`         | ❌ Recommended       | (empty)           | Trakt API key for improved episode matching (optional, get from trakt.tv)                     |
| `TMDB_API_KEY`          | ❌ Recommended      | (empty)           | TMDb API key for enhanced title matching (optional, get from themoviedb.org)                  |
| `VARIANT_SYSTEM_ENABLED`| ❌       | true             | True/False - Enables detection of content variants (Directors Cut, Extended Edition, OVA, title variants, etc.)                 |
| `ENABLE_MULTI_STREAM_PER_TORRENT`| ❌       | false            | True/False - Controls stream processing mode. When false (default): single stream per torrent (ultra-fast). When true: multiple streams per torrent (comprehensive but slower) |
| `ENABLE_RELEASE_GROUP`  | ❌       | false            | True/False - Controls release group extraction and display. When true: shows release group info (e.g. "👥 [RARBG]"). When false (default): skips release group processing for better performance |
| `ADDON_URL`             | ❌       | http://127.0.0.1:3001 | Complete addon URL including port. Examples: `http://127.0.0.1:3002`, `https://my-addon.vercel.app` |
| `LOG_LEVEL`             | ❌       | info              | Logging level: error, warn, info, debug (optional)                                            |

**API Key Scenarios:**
- **TMDb API**: Improves search accuracy for international titles and alternate names
- **Trakt API**: Enables absolute episode number matching for content with non-standard numbering
- If you provide a TMDb API key, the addon will use international and alternate titles for better search accuracy.
- If you provide ALSO a Trakt API key, the addon will use absolute episode numbers for improved matching, especially for anime and non-standard series.
- If ONLY Trakt API key or neither key is provided, the addon will still work, but without advanced matching, hence will be way less accurate for some content (especially anime, international titles, or series with unusual episode numbering).


---

## ❓ FAQs

**Q1. Why IntellDebridSearch is not showing any streaming links on the movie/series page?**
- The addon only shows streaming links for the downloads and torrents present in your Debrid account. It does NOT search Debrid services for content not already present in your Debrid account.
- The stream links on Stremio are based on Addon installation order. If IntellDebridSearch is at end of the installed addons, any streams shown by IntellDebridSearch would also be at the end of the streams list.
**Note:** I would recommend you to put IntellDebridSearch on top in the list to first get torrents from your debrid provider.

**Q2. How to add content to my debrid account for IntellDebridSearch to show them as streaming links?**
- You can find and manually add the torrent/link into your debrid account and if it matches the movie/series name, IntellDebridSearch will instantly try to find it and show it as a stream.

**Q3. Why am I not seeing the correct episode or movie?**
- The addon has many ways to find the correct movie or episode from your debrid provider, however, it may not always succeed due to variations in torrent naming, metadata, or content availability. Ensure that your Debrid account has the correct content added and a clear naming (title name, clear episode or season, ...).

---

## 📚 Documentation

- [Architecture document](docs/ARCHITECTURE.md) - Current architecture

---

<div align="center">
<b>Enjoy 😊</b>
</div>
