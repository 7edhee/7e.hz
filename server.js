const express = require('express');
const path = require('path');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const HOST = '0.0.0.0';

function mapSearchResults(results) {
  if (!Array.isArray(results)) return [];
  return results
    .filter((item) => item && item.previewUrl && item.trackName)
    .map((item) => ({
      id: String(item.trackId || ''),
      name: item.trackName || '',
      artist_name: item.artistName || '',
      album_name: item.collectionName || '',
      album_image: typeof item.artworkUrl100 === 'string'
        ? item.artworkUrl100.replace('100x100bb', '300x300bb')
        : '',
      audio: item.previewUrl,
    }));
}

function mapRssResults(entries) {
  if (!Array.isArray(entries)) return [];
  return entries
    .map((entry) => {
      const links = Array.isArray(entry.link) ? entry.link : [entry.link].filter(Boolean);
      const previewLink = links.find(
        (l) => l && l.attributes && l.attributes.rel === 'enclosure' && l.attributes.href
      );
      if (!previewLink) return null;

      const images = Array.isArray(entry['im:image']) ? entry['im:image'] : [];
      const bestImage = images.length ? images[images.length - 1].label : '';

      return {
        id: String(entry.id?.attributes?.['im:id'] || ''),
        name: entry['im:name']?.label || '',
        artist_name: entry['im:artist']?.label || '',
        album_name: entry['im:collection']?.['im:name']?.label || '',
        album_image: bestImage,
        audio: previewLink.attributes.href,
      };
    })
    .filter((t) => t && t.name && t.audio);
}

async function fetchItunesSearch(term) {
  const url = new URL('https://itunes.apple.com/search');
  url.searchParams.set('term', term);
  url.searchParams.set('media', 'music');
  url.searchParams.set('entity', 'song');
  url.searchParams.set('limit', '25');

  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) {
    throw new Error(`iTunes search responded with ${response.status}`);
  }
  const data = await response.json();
  return mapSearchResults(data.results);
}

async function fetchItunesTopSongs() {
  const response = await fetch('https://itunes.apple.com/us/rss/topsongs/limit=25/json', {
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) {
    throw new Error(`iTunes top songs responded with ${response.status}`);
  }
  const data = await response.json();
  const tracks = mapRssResults(data?.feed?.entry);
  if (tracks.length > 0) return tracks;
  return fetchItunesSearch('top hits');
}

function cleanTrackTitle(title) {
  return String(title || '')
    .replace(/\s*[\(\[][^)\]]*(feat\.?|ft\.?|with|radio|edit|remaster|version|mix|live|deluxe|bonus)[^)\]]*[\)\]]/gi, '')
    .trim();
}

function primaryArtistName(artist) {
  return String(artist || '')
    .split(/,|&|\bfeat\.?\b|\bft\.?\b/i)[0]
    .trim();
}

function extractLyricsText(item) {
  if (!item) return '';
  if (typeof item.plainLyrics === 'string' && item.plainLyrics.trim()) {
    return item.plainLyrics.trim();
  }
  if (typeof item.syncedLyrics === 'string' && item.syncedLyrics.trim()) {
    return item.syncedLyrics
      .replace(/^\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]\s*/gm, '')
      .trim();
  }
  return '';
}

async function queryLrclibGet(artist, track) {
  if (!artist || !track) return null;
  const url = new URL('https://lrclib.net/api/get');
  url.searchParams.set('artist_name', artist);
  url.searchParams.set('track_name', track);
  const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
  if (!res.ok) return null;
  const data = await res.json();
  const lyrics = extractLyricsText(data);
  if (data.instrumental) return { lyrics: '', instrumental: true };
  if (lyrics) return { lyrics, instrumental: false };
  return null;
}

async function queryLrclibSearch(params) {
  const url = new URL('https://lrclib.net/api/search');
  for (const [k, v] of Object.entries(params)) {
    if (v) url.searchParams.set(k, v);
  }
  const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
  if (!res.ok) return null;
  const list = await res.json();
  if (!Array.isArray(list) || !list.length) return null;
  const withLyrics = list.find((item) => extractLyricsText(item));
  if (withLyrics) {
    return { lyrics: extractLyricsText(withLyrics), instrumental: Boolean(withLyrics.instrumental) };
  }
  if (list[0]?.instrumental) {
    return { lyrics: '', instrumental: true };
  }
  return null;
}

app.get('/api/tracks', async (req, res) => {
  const term = String(req.query.term || '').trim().slice(0, 100);
  try {
    const results = term
      ? await fetchItunesSearch(term)
      : await fetchItunesTopSongs();
    res.json({ results });
  } catch (err) {
    console.error('iTunes API error:', err);
    res.status(502).json({ error: 'Failed to load tracks from iTunes API' });
  }
});

app.get('/api/lyrics', async (req, res) => {
  const artist = String(req.query.artist || '').trim().slice(0, 150);
  const track = String(req.query.track || '').trim().slice(0, 150);
  if (!track) {
    return res.status(400).json({ error: 'Missing track parameter' });
  }

  const cleanTitle = cleanTrackTitle(track) || track;
  const mainArtist = primaryArtistName(artist) || artist;

  try {
    const result =
      (await queryLrclibGet(artist, track)) ||
      (mainArtist !== artist || cleanTitle !== track
        ? await queryLrclibGet(mainArtist, cleanTitle)
        : null) ||
      (await queryLrclibSearch({ track_name: cleanTitle, artist_name: mainArtist })) ||
      (await queryLrclibSearch({ q: `${cleanTitle} ${mainArtist}`.trim() }));

    if (!result) {
      return res.json({ lyrics: null, instrumental: false });
    }
    res.json(result);
  } catch (err) {
    console.error('Lyrics API error:', err);
    res.status(502).json({ error: 'Failed to load lyrics' });
  }
});

app.use((req, res, next) => {
  if (
    req.path === '/server.js' ||
    req.path === '/package.json' ||
    req.path === '/package-lock.json' ||
    req.path === '/metadata.json'
  ) {
    return res.status(404).end();
  }
  next();
});

app.use(express.static(__dirname, { index: 'index.html' }));

app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`7e.hz server listening on http://${HOST}:${PORT}`);
});
