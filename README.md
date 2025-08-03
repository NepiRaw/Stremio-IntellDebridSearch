## Debrid Search Stremio Addon
Stremio Addon to search downloads and torrents in your Debrid cloud

Install - https://stremioaddon.canadacentral.cloudapp.azure.com/configure

## Configuration

### Environment Variables (Optional)
You can set fallback API keys using environment variables. These will be used automatically when users don't provide their own API keys:

```bash
# Copy .env.example to .env and configure
cp .env.example .env
```

Supported environment variables:
- `TRAKT_API_KEY` - Trakt API key for improved episode matching
- `TMDB_API_KEY` - TMDb API key for enhanced title matching

**Benefits of using environment fallback keys:**
- **Trakt API**: Enables absolute episode number matching for content with non-standard numbering
- **TMDb API**: Improves search accuracy for international titles and alternate names
- **Seamless experience**: Users get enhanced functionality without needing to configure optional API keys
- **Privacy focused**: Fallback keys are never exposed to users in the web interface

The addon will automatically log when fallback keys are used and when they're unavailable. Users will see status messages about available features without seeing the actual API keys.


## FAQs
Q1. Why DebridSearch is not showing any streaming links on the movie/series page?
> * DebridSearch only shows streaming links for the downloads and torrents present in your Debrid account. It does NOT search Debrid services for content not already present in your Debrid account.
> * The stream links on Stremio are based on Addon installation order. If DebridSearch is at end of the installed addons, any streams shown by DebridSearch would also be at the end of the streams list.

Q2. How to add content to Debrid account for DebridSearch to show them as streaming links?
> * You can find and manually add the torrent/link into your Debrid account and if it matches the movie/series IMDB name, DebridSearch would show it as a stream.
> * You can also use [Debrid Media Manager](https://debridmediamanager.com) on supported Debrid services
>

Q3. Getting the error "The add-on providing this item has been removed" when trying to play content from the discover page?
> * Items in catalog/discover page of DebridSearch need Torrentio catalog option to be enabled to work. Stream links shown in movie/show details page don't need Torrentio



