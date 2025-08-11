<div align="center">

# Stremio Intelligent Debrid Search Addon

<p>
  <img src="https://img.shields.io/badge/Stremio-Addon-purple" alt="Stremio" />
  <img src="https://img.shields.io/badge/Node.js-18+-brightgreen" alt="Node.js" />
</p>

</div>

---

<p align="center"><i><b>Stremio addon to search downloads and torrents in your Debrid cloud.<br></b>
<small><i>Forked and improved from original <a href="https://github.com/MrMonkey42/stremio-addon-debrid-search">DebridSearch</a> addon</i></small></p>


---
## ⚡ Public install

Addon currently available at: [WIP]



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

- [Configuration](#%EF%B8%8F-configuration)
- [Self-Hosting Installation](#-Self-Hosting-Installation)
  - [Docker Compose (Recommended)](#-Docker-Compose-(Recommended))
  - [Manual Installation](#manual-installation)
  - [Vercel Deployment](#vercel-deployment)
- [Environment Variables](#-environment-variables)
- [FAQs](#-faqs)
- [Future Enhancements](#-future-enhancements)
- [Documentation](#-documentation)

## ⚙️ Configuration

### Access Configuration
1. Navigate to your addon URL (e.g., http://localhost:3000 or your domain)
2. Configure your Debrid provider and API keys
3. Click "Install Addon" to add it to Stremio

### Configuration Options
- **Provider Selection**: Choose your Debrid provider (not all debrid provider have been tested - provide feedback) <p>
    - [x] AllDebrid, 
    - [x] RealDebrid, 
    - [ ] Premiumize (not yet tested), 
    - [ ] Torbox (not yet tested),
    - [ ] Debrid-Link (not yet tested)

- **API Keys**: Enter your debrid provider API key.

## 🚀 Self-Hosting Installation

### 🐳 Docker Compose (Recommended)
1. **Create a `Dockerfile` in your project root:**

```Dockerfile
FROM node:18
WORKDIR /app
COPY . .
RUN npm install && npm run build
EXPOSE 3000
CMD ["npm", "start"]
```

2. **Create a `docker-compose.yml` file:**

```yaml
version: '3.8'
services:
  stremio-intelldebridsearch:
    build: .
    container_name: stremio-intelldebridsearch
    restart: unless-stopped
    ports:
      - "3000:3000"
    env_file:
      - .env
    healthcheck:
      test: ["CMD", "node", "-e", "require('http').get('http://localhost:3000/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
```

> **Note:**
> - This setup builds your addon from source using the included Dockerfile.
> - The container will use your `.env` file for configuration.
> - Healthcheck ensures the addon is running and healthy (optional).

3. **Set up environment and build:**

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

4. **Access your addon at `http://localhost:3000` (or your configured domain)**



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
5. **Access your addon at `http://localhost:3000` (or your configured domain)**

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
| `BASE_URL`              | ❌       | http://localhost  | Base URL for the addon (optional, used for deployment)                                        |
| `PORT`                  | ❌       | 3000              | Server port (optional)                                                                        |
| `LOG_LEVEL`             | ❌       | info              | Logging level: error, warn, info, debug (optional)                                            |

**API Key Scenarios:**
- **TMDb API**: Improves search accuracy for international titles and alternate names
- **Trakt API**: Enables absolute episode number matching for content with non-standard numbering
- If you provide a TMDb API key, the addon will use international and alternate titles for better search accuracy.
- If you provide ALSO a Trakt API key, the addon will use absolute episode numbers for improved matching, especially for anime and non-standard series.
- If ONLY Trakt API key or neither key is provided, the addon will still work, but without advanced matching, hence may be less accurate for some content (especially anime, international titles, or series with unusual episode numbering).


---

## ❓ FAQs

**Q1. Why IntellDebridSearch is not showing any streaming links on the movie/series page?**
- The addon only shows streaming links for the downloads and torrents present in your Debrid account. It does NOT search Debrid services for content not already present in your Debrid account.
- The stream links on Stremio are based on Addon installation order. If DebridSearch is at end of the installed addons, any streams shown by DebridSearch would also be at the end of the streams list.

**Q2. How to add content to Debrid account for DebridSearch to show them as streaming links?**
- You can find and manually add the torrent/link into your Debrid account and if it matches the movie/series IMDB name, DebridSearch would show it as a stream.
- You can also use [Debrid Media Manager](https://debridmediamanager.com) on supported Debrid services

**Q3. Getting the error "The add-on providing this item has been removed" when trying to play content from the discover page?**
- Items in catalog/discover page of DebridSearch need Torrentio catalog option to be enabled to work. Stream links shown in movie/show details page don't need Torrentio

---

## 🌟 Future Enhancements

- [ ] Improved performance
- [ ] Improved caching

---

## 📚 Documentation

- [Architecture document](docs/ARCHITECTURE.md) - Current architecture

---

<div align="center">
<b>Enjoy 😊</b>
</div>