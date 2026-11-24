'use strict';

/* ─────────────────────────────────────────────────
   ITUNES API (via /api/tracks)
───────────────────────────────────────────────── */
async function fetchTracks(term = '') {
  const url = new URL('/api/tracks', window.location.origin);
  if (term) url.searchParams.set('term', term);
  const r = await fetch(url);
  if (!r.ok) throw new Error(r.status);
  return (await r.json()).results || [];
}

/* ─────────────────────────────────────────────────
   STATE
───────────────────────────────────────────────── */
let tracks        = [];
let homeTracks    = [];
let queue         = [];
let currentIdx    = -1;
let currentTrack  = null;
let playing       = false;
let activeTab     = 'explore';
let activeHomeTerm = '';
let homeLoaded    = false;
let latestReqId   = 0;
let latestHomeReqId = 0;
let latestLyricsReqId = 0;
let lyricsOpen    = window.innerWidth >= 1024;
const lyricsCache = new Map();

const audio = document.getElementById('audio');

/* ─────────────────────────────────────────────────
   SCREEN TRANSITIONS
───────────────────────────────────────────────── */
function goTo(id) {
  const current = document.querySelector('.screen.active');
  const next    = document.getElementById(id);
  if (!next || next === current) return;

  if (current) {
    current.classList.add('exit');
    setTimeout(() => current.classList.remove('active', 'exit'), 400);
  }
  // small delay so exit starts first
  setTimeout(() => next.classList.add('active'), 30);
}

/* ─────────────────────────────────────────────────
   SPLASH → EXPLORE
───────────────────────────────────────────────── */
document.getElementById('btn-start').addEventListener('click', () => {
  goTo('screen-explore');
  setActiveTab('explore');
  if (!tracks.length) loadTracks('');
});

/* ─────────────────────────────────────────────────
   EXPLORE — RENDER TRACK LIST
───────────────────────────────────────────────── */
async function loadTracks(term = '') {
  const reqId  = ++latestReqId;
  const listEl = document.getElementById('track-list');
  listEl.innerHTML = `<div class="track-list-loading" id="list-loading"><div class="loader-ring"></div></div>`;
  try {
    const results = await fetchTracks(term);
    if (reqId !== latestReqId) return;
    tracks = results;
    renderList();
    if (term && term.length >= 2) {
      addRecentSearch(term);
    }
  } catch {
    if (reqId !== latestReqId) return;
    listEl.innerHTML = `<p style="text-align:center;padding:40px;color:#aaa;font-size:13px">Couldn't load tracks — check your connection.</p>`;
  }
}

function createTrackCard(t, i, listSource) {
  const card = document.createElement('div');
  const key = trackKey(t);
  const isCurrent = Boolean(currentTrack && key && key === trackKey(currentTrack));
  const liked = isTrackLiked(t);
  card.className = 'track-card' + (isCurrent && playing ? ' playing' : '');
  card.dataset.trackId = key;
  card.innerHTML = `
    <div class="tc-cover">
      <img src="${safe(t.album_image)}" alt="" loading="lazy" onerror="this.style.display='none'">
      <div class="play-overlay">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
      </div>
    </div>
    <div class="tc-info">
      <div class="tc-name">${safe(t.name)}</div>
      <div class="tc-artist">${safe(t.artist_name)}</div>
    </div>
    <div class="tc-eq">
      <span></span><span></span><span></span>
    </div>
    <button class="tc-like-btn${liked ? ' liked' : ''}" type="button" aria-label="${liked ? 'Unlike track' : 'Like track'}" aria-pressed="${liked}">
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
    </button>
    <button class="tc-play-btn">Play</button>`;

  card.querySelector('.tc-like-btn').addEventListener('click', e => {
    e.stopPropagation();
    toggleLikeTrack(t);
  });

  card.addEventListener('click', () => openPlayer(i, listSource));
  return card;
}

function renderList() {
  const listEl = document.getElementById('track-list');
  listEl.innerHTML = '';
  if (!tracks.length) {
    listEl.innerHTML = `<p style="text-align:center;padding:40px;color:#aaa;font-size:13px">No tracks found.</p>`;
    return;
  }
  tracks.forEach((t, i) => {
    listEl.appendChild(createTrackCard(t, i, tracks));
  });
}

function safe(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ─────────────────────────────────────────────────
   HOME, LIBRARY, LIKED & NAVIGATION
───────────────────────────────────────────────── */
const RECENTLY_PLAYED_KEY = '7ehz_recently_played';
const LIKED_TRACKS_KEY    = '7ehz_liked_tracks';
const MAX_RECENTLY_PLAYED = 6;

let recentlyPlayed = loadStoredTracks(RECENTLY_PLAYED_KEY, MAX_RECENTLY_PLAYED);
let likedTracks    = loadStoredTracks(LIKED_TRACKS_KEY, 100);

const navHomeBtn         = document.getElementById('nav-home');
const navExploreBtn      = document.getElementById('nav-explore');
const navSavedBtn        = document.getElementById('nav-saved');
const screenTitleEl      = document.getElementById('screen-title');
const searchBarEl        = document.querySelector('.search-bar');
const trackListEl        = document.getElementById('track-list');
const homeViewEl         = document.getElementById('home-view');
const savedViewEl        = document.getElementById('saved-view');
const homeRecentSec      = document.getElementById('home-recent-section');
const homeRecentList     = document.getElementById('home-recent-list');
const homeFeaturedList   = document.getElementById('home-featured-list');
const homeFeaturedTitle  = document.getElementById('home-featured-title');
const homeLikedList      = document.getElementById('home-liked-list');
const btnPlayLiked       = document.getElementById('btn-play-liked');
const libLikedCount      = document.getElementById('lib-liked-count');
const libRecentCount     = document.getElementById('lib-recent-count');
const savedLikedList     = document.getElementById('saved-liked-list');
const btnSavedPlayLiked  = document.getElementById('btn-saved-play-liked');
const savedRecentSec     = document.getElementById('saved-recent-section');
const savedRecentList    = document.getElementById('saved-recent-list');
const btnPlayerLike      = document.getElementById('btn-player-like');
const btnMiniLike        = document.getElementById('mp-like');

function trackKey(t) {
  if (!t) return '';
  if (t.id) return String(t.id);
  return `${t.name || ''}::${t.artist_name || ''}`;
}

function loadStoredTracks(storageKey, limit) {
  try {
    const raw = localStorage.getItem(storageKey);
    const parsed = JSON.parse(raw || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(t => t && t.name && t.audio).slice(0, limit);
  } catch {
    return [];
  }
}

function isTrackLiked(t) {
  const key = trackKey(t);
  if (!key) return false;
  return likedTracks.some(item => trackKey(item) === key);
}

function toggleLikeTrack(t) {
  const key = trackKey(t);
  if (!key) return;
  if (isTrackLiked(t)) {
    likedTracks = likedTracks.filter(item => trackKey(item) !== key);
  } else {
    likedTracks = [t, ...likedTracks.filter(item => trackKey(item) !== key)].slice(0, 100);
  }
  try {
    localStorage.setItem(LIKED_TRACKS_KEY, JSON.stringify(likedTracks));
  } catch {}
  syncLikeUI();
  renderLibraryCounts();
  renderLikedSections();
}

function syncLikeUI() {
  document.querySelectorAll('.track-card').forEach(card => {
    const btn = card.querySelector('.tc-like-btn');
    if (!btn) return;
    const key = card.dataset.trackId;
    const liked = Boolean(key && likedTracks.some(item => trackKey(item) === key));
    btn.classList.toggle('liked', liked);
    btn.setAttribute('aria-pressed', String(liked));
    btn.setAttribute('aria-label', liked ? 'Unlike track' : 'Like track');
  });

  const currentLiked = isTrackLiked(currentTrack);
  [btnPlayerLike, btnMiniLike].forEach(btn => {
    if (!btn) return;
    btn.classList.toggle('liked', currentLiked);
    btn.setAttribute('aria-pressed', String(currentLiked));
    btn.setAttribute('aria-label', currentLiked ? 'Unlike track' : 'Like track');
  });
}

function recordRecentlyPlayed(t) {
  if (!t || !t.name || !t.audio) return;
  const key = trackKey(t);
  recentlyPlayed = [
    t,
    ...recentlyPlayed.filter(item => trackKey(item) !== key),
  ].slice(0, MAX_RECENTLY_PLAYED);
  try {
    localStorage.setItem(RECENTLY_PLAYED_KEY, JSON.stringify(recentlyPlayed));
  } catch {}
  renderLibraryCounts();
  renderRecentlyPlayed();
}

function renderLibraryCounts() {
  const likedCount = likedTracks.length;
  const recentCount = recentlyPlayed.length;
  libLikedCount.textContent  = `${likedCount} ${likedCount === 1 ? 'song' : 'songs'}`;
  libRecentCount.textContent = `${recentCount} ${recentCount === 1 ? 'song' : 'songs'}`;
}

function renderRecentlyPlayed() {
  [
    { sec: homeRecentSec, list: homeRecentList },
    { sec: savedRecentSec, list: savedRecentList },
  ].forEach(({ sec, list }) => {
    list.innerHTML = '';
    if (!recentlyPlayed.length) {
      sec.hidden = true;
      return;
    }
    sec.hidden = false;
    recentlyPlayed.forEach((t, i) => {
      list.appendChild(createTrackCard(t, i, recentlyPlayed));
    });
  });
}

function renderLikedSections() {
  const hasLiked = likedTracks.length > 0;
  btnPlayLiked.hidden = !hasLiked;
  btnSavedPlayLiked.hidden = !hasLiked;

  [homeLikedList, savedLikedList].forEach(container => {
    container.innerHTML = '';
    if (!hasLiked) {
      const empty = document.createElement('p');
      empty.className = 'home-empty';
      empty.textContent = 'No liked songs yet — tap the heart on any track to save it here.';
      container.appendChild(empty);
      return;
    }
    likedTracks.forEach((t, i) => {
      container.appendChild(createTrackCard(t, i, likedTracks));
    });
  });
}

function renderHomeFeatured() {
  homeFeaturedList.innerHTML = '';
  if (!homeTracks.length) {
    homeFeaturedList.innerHTML = `<p style="text-align:center;padding:40px;color:#aaa;font-size:13px">No tracks found.</p>`;
    return;
  }
  homeTracks.forEach((t, i) => {
    homeFeaturedList.appendChild(createTrackCard(t, i, homeTracks));
  });
}

async function loadHomeTracks(term = '', label = 'Top Charts') {
  const reqId = ++latestHomeReqId;
  activeHomeTerm = term;
  homeFeaturedTitle.textContent = label;
  homeFeaturedList.innerHTML = `<div class="track-list-loading"><div class="loader-ring"></div></div>`;
  try {
    const results = await fetchTracks(term);
    if (reqId !== latestHomeReqId) return;
    homeTracks = results;
    homeLoaded = true;
    renderHomeFeatured();
  } catch {
    if (reqId !== latestHomeReqId) return;
    homeFeaturedList.innerHTML = `<p style="text-align:center;padding:40px;color:#aaa;font-size:13px">Couldn't load tracks — check your connection.</p>`;
  }
}

function setActiveTab(tab) {
  activeTab = tab;
  const isHome    = tab === 'home';
  const isExplore = tab === 'explore';
  const isSaved   = tab === 'saved';

  navHomeBtn.classList.toggle('active', isHome);
  navHomeBtn.setAttribute('aria-pressed', String(isHome));
  navExploreBtn.classList.toggle('active', isExplore);
  navExploreBtn.setAttribute('aria-pressed', String(isExplore));
  navSavedBtn.classList.toggle('active', isSaved);
  navSavedBtn.setAttribute('aria-pressed', String(isSaved));

  screenTitleEl.textContent = isHome ? 'Home' : isSaved ? 'Library' : 'Explore';
  homeViewEl.hidden    = !isHome;
  savedViewEl.hidden   = !isSaved;
  searchBarEl.hidden   = !isExplore;
  trackListEl.hidden   = !isExplore;

  if (isHome) {
    recentWrap.hidden = true;
    renderLibraryCounts();
    renderRecentlyPlayed();
    renderLikedSections();
    if (!homeLoaded) {
      loadHomeTracks(activeHomeTerm, homeFeaturedTitle.textContent);
    } else {
      renderHomeFeatured();
    }
  } else if (isSaved) {
    recentWrap.hidden = true;
    renderRecentlyPlayed();
    renderLikedSections();
  } else {
    renderRecentSearches();
    if (!tracks.length) loadTracks('');
    else renderList();
  }
}

navHomeBtn.addEventListener('click', () => {
  setActiveTab('home');
  homeViewEl.scrollTo({ top: 0, behavior: 'smooth' });
});

navExploreBtn.addEventListener('click', () => {
  setActiveTab('explore');
});

navSavedBtn.addEventListener('click', () => {
  setActiveTab('saved');
  savedViewEl.scrollTo({ top: 0, behavior: 'smooth' });
});

document.querySelectorAll('.genre-card').forEach(card => {
  card.addEventListener('click', () => {
    document.querySelectorAll('.genre-card').forEach(c => c.classList.remove('active'));
    card.classList.add('active');
    const titleEl = card.querySelector('.genre-name');
    loadHomeTracks(card.dataset.term || '', titleEl ? titleEl.textContent.trim() : 'Top Charts');
  });
});

document.getElementById('btn-lib-liked').addEventListener('click', () => {
  document.getElementById('home-liked-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

document.getElementById('btn-lib-recent').addEventListener('click', () => {
  if (!homeRecentSec.hidden) {
    homeRecentSec.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else {
    setActiveTab('saved');
  }
});

[btnPlayLiked, btnSavedPlayLiked].forEach(btn => {
  btn.addEventListener('click', () => {
    if (likedTracks.length) openPlayer(0, likedTracks);
  });
});

btnPlayerLike.addEventListener('click', () => {
  if (currentTrack) toggleLikeTrack(currentTrack);
});

btnMiniLike.addEventListener('click', e => {
  e.stopPropagation();
  if (currentTrack) toggleLikeTrack(currentTrack);
});

renderLibraryCounts();
renderLikedSections();
syncLikeUI();

/* ─────────────────────────────────────────────────
   RECENT SEARCHES & SEARCH
───────────────────────────────────────────────── */
const RECENT_STORAGE_KEY = '7ehz_recent_searches';
const MAX_RECENT_SEARCHES = 8;

const searchInput    = document.getElementById('search-input');
const btnClearSearch = document.getElementById('btn-clear-search');
const recentWrap     = document.getElementById('recent-searches');
const recentListEl   = document.getElementById('recent-list');
const btnClearRecent = document.getElementById('btn-clear-recent');

let recentSearches = loadRecentSearches();
let searchTimer    = null;

function loadRecentSearches() {
  try {
    const raw = localStorage.getItem(RECENT_STORAGE_KEY);
    const parsed = JSON.parse(raw || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(item => String(item || '').trim())
      .filter(Boolean)
      .slice(0, MAX_RECENT_SEARCHES);
  } catch {
    return [];
  }
}

function saveRecentSearches() {
  try {
    localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(recentSearches));
  } catch {}
}

function addRecentSearch(query) {
  const clean = String(query || '').trim();
  if (!clean) return;
  const lower = clean.toLowerCase();
  recentSearches = [
    clean,
    ...recentSearches.filter(item => item.toLowerCase() !== lower),
  ].slice(0, MAX_RECENT_SEARCHES);
  saveRecentSearches();
  renderRecentSearches();
}

function removeRecentSearch(query) {
  const lower = query.toLowerCase();
  recentSearches = recentSearches.filter(item => item.toLowerCase() !== lower);
  saveRecentSearches();
  renderRecentSearches();
}

function syncSearchClearBtn() {
  btnClearSearch.hidden = searchInput.value.trim().length === 0;
}

function renderRecentSearches() {
  recentListEl.innerHTML = '';
  if (activeTab !== 'explore' || !recentSearches.length) {
    recentWrap.hidden = true;
    return;
  }

  recentWrap.hidden = false;
  const currentQuery = searchInput.value.trim().toLowerCase();

  recentSearches.forEach(query => {
    const chip = document.createElement('div');
    chip.className = 'recent-chip' + (currentQuery && query.toLowerCase() === currentQuery ? ' active' : '');

    const selectBtn = document.createElement('button');
    selectBtn.type = 'button';
    selectBtn.className = 'recent-chip-btn';
    selectBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;

    const label = document.createElement('span');
    label.className = 'recent-chip-text';
    label.textContent = query;
    selectBtn.appendChild(label);

    selectBtn.addEventListener('click', () => {
      clearTimeout(searchTimer);
      searchInput.value = query;
      syncSearchClearBtn();
      renderRecentSearches();
      loadTracks(query);
    });

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'recent-chip-remove';
    removeBtn.setAttribute('aria-label', `Remove ${query}`);
    removeBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
    removeBtn.addEventListener('click', e => {
      e.stopPropagation();
      removeRecentSearch(query);
    });

    chip.appendChild(selectBtn);
    chip.appendChild(removeBtn);
    recentListEl.appendChild(chip);
  });
}

searchInput.addEventListener('input', e => {
  clearTimeout(searchTimer);
  syncSearchClearBtn();
  renderRecentSearches();
  const q = e.target.value.trim();
  if (!q) {
    loadTracks('');
    return;
  }
  searchTimer = setTimeout(() => {
    loadTracks(q);
  }, 450);
});

searchInput.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  clearTimeout(searchTimer);
  const q = searchInput.value.trim();
  syncSearchClearBtn();
  renderRecentSearches();
  loadTracks(q);
});

btnClearSearch.addEventListener('click', () => {
  clearTimeout(searchTimer);
  searchInput.value = '';
  syncSearchClearBtn();
  renderRecentSearches();
  loadTracks('');
  searchInput.focus();
});

btnClearRecent.addEventListener('click', () => {
  recentSearches = [];
  saveRecentSearches();
  renderRecentSearches();
});

syncSearchClearBtn();
renderRecentSearches();

/* ─────────────────────────────────────────────────
   OPEN PLAYER
───────────────────────────────────────────────── */
function openPlayer(idx, sourceList = tracks) {
  const list = Array.isArray(sourceList) && sourceList.length ? sourceList : tracks;
  queue = list.slice();
  currentIdx = idx;
  currentTrack = queue[idx] || null;
  updatePlayerUI(currentTrack);
  goTo('screen-player');
  playTrack(currentTrack);
}

function updatePlayerUI(t) {
  if (!t) return;
  document.getElementById('pi-title').textContent  = t.name        || '—';
  document.getElementById('pi-artist').textContent = t.artist_name || '—';

  // set vinyl label art from album image if available
  const label = document.getElementById('tv-label');
  if (t.album_image) {
    label.style.backgroundImage    = `url("${t.album_image.replace(/"/g, '\\"')}")`;
    label.style.backgroundSize     = 'cover';
    label.style.backgroundPosition = 'center';
  } else {
    label.style.backgroundImage = '';
    label.style.background = 'linear-gradient(135deg, #e8e8e8, #d0d0d0)';
  }

  updateMiniplayerUI(t);
  syncLikeUI();
  syncLyricsToggleUI();
  loadLyrics(t);
}

function updateMiniplayerUI(t) {
  const mp = document.getElementById('miniplayer');
  if (!t) {
    mp.hidden = true;
    return;
  }
  mp.hidden = false;
  document.getElementById('mp-title').textContent  = t.name        || '—';
  document.getElementById('mp-artist').textContent = t.artist_name || '—';

  const img = document.getElementById('mp-cover-img');
  if (t.album_image) {
    img.src = t.album_image;
    img.style.display = 'block';
  } else {
    img.removeAttribute('src');
    img.style.display = 'none';
  }
}

/* ─────────────────────────────────────────────────
   LYRICS
───────────────────────────────────────────────── */
function syncLyricsToggleUI() {
  const playerScreen = document.getElementById('screen-player');
  const btnLyrics    = document.getElementById('btn-lyrics');
  playerScreen.classList.toggle('lyrics-open', lyricsOpen);
  btnLyrics.classList.toggle('active', lyricsOpen);
  btnLyrics.setAttribute('aria-pressed', String(lyricsOpen));
}

function renderLyricsStatus(message) {
  const body = document.getElementById('lyrics-body');
  body.innerHTML = '';
  const p = document.createElement('p');
  p.className = 'lyrics-status';
  p.textContent = message;
  body.appendChild(p);
  body.scrollTop = 0;
}

function renderLyricsData(data) {
  if (!data) {
    renderLyricsStatus('Lyrics not available for this track.');
    return;
  }
  if (data.instrumental) {
    renderLyricsStatus('Instrumental track.');
    return;
  }
  if (!data.lyrics) {
    renderLyricsStatus('Lyrics not available for this track.');
    return;
  }

  const body = document.getElementById('lyrics-body');
  body.innerHTML = '';
  const list = document.createElement('div');
  list.className = 'lyrics-lines';

  data.lyrics.split(/\r?\n/).forEach(line => {
    const row = document.createElement('div');
    if (line.trim() === '') {
      row.className = 'lyrics-line break';
    } else {
      row.className = 'lyrics-line';
      row.textContent = line;
    }
    list.appendChild(row);
  });

  body.appendChild(list);
  body.scrollTop = 0;
}

async function loadLyrics(t) {
  if (!t || !t.name) {
    renderLyricsStatus('Select a track to load lyrics.');
    return;
  }

  const cacheKey = `${t.id || ''}::${t.artist_name || ''}::${t.name}`;
  if (lyricsCache.has(cacheKey)) {
    renderLyricsData(lyricsCache.get(cacheKey));
    return;
  }

  const reqId = ++latestLyricsReqId;
  renderLyricsStatus('Loading lyrics…');

  try {
    const url = new URL('/api/lyrics', window.location.origin);
    url.searchParams.set('track', t.name);
    if (t.artist_name) url.searchParams.set('artist', t.artist_name);
    const res = await fetch(url);
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    lyricsCache.set(cacheKey, data);
    if (reqId !== latestLyricsReqId) return;
    renderLyricsData(data);
  } catch {
    if (reqId !== latestLyricsReqId) return;
    renderLyricsStatus('Couldn’t load lyrics right now.');
  }
}

document.getElementById('btn-lyrics').addEventListener('click', () => {
  lyricsOpen = !lyricsOpen;
  syncLyricsToggleUI();
});

syncLyricsToggleUI();

/* ─────────────────────────────────────────────────
   AUDIO PLAYBACK
───────────────────────────────────────────────── */
function resetProgress() {
  document.getElementById('prog-fill').style.width    = '0%';
  document.getElementById('prog-thumb').style.left    = '0%';
  document.getElementById('mp-prog-fill').style.width = '0%';
  document.getElementById('prog-cur').textContent     = '0:00';
  document.getElementById('prog-dur').textContent     = '0:00';
}

function playTrack(t) {
  if (!t || !t.audio) return;
  recordRecentlyPlayed(t);
  setPlayingState(false);
  resetProgress();
  audio.src = t.audio;
  audio.play().then(() => {
    setPlayingState(true);
  }).catch(() => {
    setPlayingState(false);
  });
}

function setPlayingState(isPlaying) {
  playing = isPlaying;

  // vinyl spin + tonearm
  const vinyl = document.getElementById('turntable-vinyl');
  const arm   = document.getElementById('turntable-arm');
  vinyl.classList.toggle('spinning', isPlaying);
  arm.classList.toggle('playing',   isPlaying);

  // miniplayer spin + play icon
  document.getElementById('miniplayer').classList.toggle('playing', isPlaying);

  // waveform
  document.querySelector('.wf-bars').classList.toggle('active', isPlaying);

  // play/pause icons (full player + miniplayer)
  const iconSvg = isPlaying
    ? '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>'
    : '<path d="M8 5v14l11-7z"/>';
  document.getElementById('ico-play').innerHTML    = iconSvg;
  document.getElementById('ico-mp-play').innerHTML = iconSvg;

  refreshListHighlight();
}

/* progress */
audio.addEventListener('loadedmetadata', () => {
  document.getElementById('prog-dur').textContent = fmt(audio.duration);
});

audio.addEventListener('timeupdate', () => {
  const pct = audio.duration ? audio.currentTime / audio.duration : 0;
  document.getElementById('prog-fill').style.width    = (pct * 100) + '%';
  document.getElementById('prog-thumb').style.left    = (pct * 100) + '%';
  document.getElementById('mp-prog-fill').style.width = (pct * 100) + '%';
  document.getElementById('prog-cur').textContent     = fmt(audio.currentTime);
  document.getElementById('prog-dur').textContent     = fmt(audio.duration);
});

audio.addEventListener('play',  () => setPlayingState(true));
audio.addEventListener('pause', () => setPlayingState(false));
audio.addEventListener('error', () => setPlayingState(false));
audio.addEventListener('ended', () => advance(1));

/* ─────────────────────────────────────────────────
   CONTROLS
───────────────────────────────────────────────── */
function togglePlayPause() {
  if (!currentTrack) {
    if (tracks.length) openPlayer(0);
    return;
  }
  if (audio.paused) {
    audio.play().catch(() => setPlayingState(false));
  } else {
    audio.pause();
  }
}

document.getElementById('btn-play').addEventListener('click', togglePlayPause);

document.getElementById('btn-prev').addEventListener('click', () => {
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }
  advance(-1);
});
document.getElementById('btn-next').addEventListener('click', () => advance(1));

/* Miniplayer controls */
document.getElementById('mp-open-player').addEventListener('click', () => {
  if (!currentTrack) return;
  goTo('screen-player');
});

document.getElementById('mp-play').addEventListener('click', e => {
  e.stopPropagation();
  togglePlayPause();
});

document.getElementById('mp-prev').addEventListener('click', e => {
  e.stopPropagation();
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }
  advance(-1);
});

document.getElementById('mp-next').addEventListener('click', e => {
  e.stopPropagation();
  advance(1);
});

function advance(dir) {
  const activeQueue = queue.length ? queue : tracks;
  if (!activeQueue.length) return;
  const next = (currentIdx + dir + activeQueue.length) % activeQueue.length;
  currentIdx = next;
  currentTrack = activeQueue[next];
  updatePlayerUI(currentTrack);
  playTrack(currentTrack);
}

/* progress bar seek */
document.getElementById('prog-bar').addEventListener('click', e => {
  if (!audio.duration) return;
  const r = e.currentTarget.getBoundingClientRect();
  audio.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * audio.duration;
});

/* ─────────────────────────────────────────────────
   VOLUME
───────────────────────────────────────────────── */
const volSlider = document.getElementById('volume-slider');
const volValue  = document.getElementById('volume-value');
const btnMute   = document.getElementById('btn-mute');
const icoVol    = document.getElementById('ico-vol');

let lastNonZeroVolume = 0.8;

function updateVolumeUI(vol) {
  const pct = Math.round(vol * 100);
  volSlider.value = String(pct);
  volSlider.style.setProperty('--vol', `${pct}%`);
  volValue.textContent = `${pct}%`;
  btnMute.setAttribute('aria-label', pct === 0 ? 'Unmute' : 'Mute');

  if (pct === 0) {
    icoVol.innerHTML =
      '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>' +
      '<line x1="23" y1="9" x2="17" y2="15"/>' +
      '<line x1="17" y1="9" x2="23" y2="15"/>';
  } else if (pct < 50) {
    icoVol.innerHTML =
      '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>' +
      '<path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>';
  } else {
    icoVol.innerHTML =
      '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>' +
      '<path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>' +
      '<path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>';
  }
}

function applyVolume(vol, persist = true) {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(vol) ? vol : 0.8));
  audio.volume = clamped;
  audio.muted = clamped === 0;
  if (clamped > 0) lastNonZeroVolume = clamped;
  updateVolumeUI(clamped);
  if (persist) {
    try { localStorage.setItem('7ehz_volume', String(clamped)); } catch {}
  }
}

volSlider.addEventListener('input', e => {
  applyVolume(Number(e.target.value) / 100);
});

btnMute.addEventListener('click', () => {
  if (audio.muted || audio.volume === 0) {
    applyVolume(lastNonZeroVolume > 0 ? lastNonZeroVolume : 0.8);
  } else {
    applyVolume(0);
  }
});

(function initVolume() {
  let saved = 0.8;
  try {
    const raw = localStorage.getItem('7ehz_volume');
    if (raw !== null) {
      const parsed = Number(raw);
      if (Number.isFinite(parsed)) saved = parsed;
    }
  } catch {}
  if (saved > 0) lastNonZeroVolume = saved;
  applyVolume(saved, false);
})();

/* ─────────────────────────────────────────────────
   BACK BUTTON
───────────────────────────────────────────────── */
document.getElementById('btn-back').addEventListener('click', () => {
  goTo('screen-explore');
});

/* ─────────────────────────────────────────────────
   REFRESH EXPLORE HIGHLIGHT
───────────────────────────────────────────────── */
function refreshListHighlight() {
  const currentKey = trackKey(currentTrack);
  document.querySelectorAll('.track-card').forEach(el => {
    const id = el.dataset.trackId;
    const isCurrent = Boolean(currentKey && id && id === currentKey);
    el.classList.toggle('playing', isCurrent && playing);
  });
}

/* ─────────────────────────────────────────────────
   HELPERS
───────────────────────────────────────────────── */
function fmt(s) {
  s = Math.round(s || 0);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
