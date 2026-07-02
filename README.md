# CCI Sermons Library

A static, searchable sermon library for Celebration Church International teachings by Apostle Emmanuel Iren.

## What it does

- Collects sermon metadata from the CCI sermons API
- Merges RSS audio links where available
- Optionally enriches from YouTube and Spotify
- Groups sermons by topic, series, year, and source
- Generates static JSON and HTML output for browsing

## Main files

- `index.html` - searchable static sermon library
- `cci-sermons-scraper.js` - scraper and static output generator
- `cci-sermons.json` - sermon data
- `cci-sermons-all.json` - expanded sermon data
- `cci-sermons-grouped.json` - grouped sermon data
- `cci-sermons.html` - generated HTML output

## Run the scraper

```bash
node cci-sermons-scraper.js
```

Optional Spotify enrichment:

```bash
node cci-sermons-scraper.js --spotify-id CLIENT_ID --spotify-secret CLIENT_SECRET
```

## View locally

Open `index.html` in a browser.
