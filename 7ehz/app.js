'use strict';

/* ─────────────────────────────────────────────────
   JAMENDO API
───────────────────────────────────────────────── */
const CLIENT_ID = '0bfe3a97';
const API_BASE  = 'https://api.jamendo.com/v3.0';

async function fetchTracks(params = {}) {
  const url = new URL(`${API_BASE}/tracks/`);
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', '25');
  url.searchParams.set('audioformat', 'mp31');
  url.searchParams.set('include', 'licenses');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const r = await fetch(url);
  if (!r.ok) throw new Error(r.status);
  return (await r.json()).results || [];
}

/* ─────────────────────────────────────────────────
   STATE
───────────────────────────────────────────────── */
let tracks     = [];
let currentIdx = -1;
let playing    = false;

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
  loadTracks({ tags: 'pop', orderby: 'popularity_total' }, 'Pop Hits');
});

/* ─────────────────────────────────────────────────
   EXPLORE — RENDER TRACK LIST
───────────────────────────────────────────────── */
async function loadTracks(params, label) {
  const listEl  = document.getElementById('track-list');
  const loading = document.getElementById('list-loading');
  if (loading) loading.style.display = 'flex';
  listEl.innerHTML = `<div class="track-list-loading" id="list-loading"><div class="loader-ring"></div></div>`;
  try {
    tracks = await fetchTracks(params);
    renderList();
  } catch {
    listEl.innerHTML = `<p style="text-align:center;padding:40px;color:#aaa;font-size:13px">Couldn't load tracks — check your connection.</p>`;
  }
}

function renderList() {
  const listEl = document.getElementById('track-list');
  listEl.innerHTML = '';
  if (!tracks.length) {
    listEl.innerHTML = `<p style="text-align:center;padding:40px;color:#aaa;font-size:13px">No tracks found.</p>`;
    return;
  }
  tracks.forEach((t, i) => {
    const card = document.createElement('div');
    card.className = 'track-card' + (i === currentIdx ? ' playing' : '');
    card.dataset.idx = i;
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
      <button class="tc-play-btn">Play</button>`;
    card.addEventListener('click', () => openPlayer(i));
    listEl.appendChild(card);
  });
}

function safe(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ─────────────────────────────────────────────────
   SEARCH
───────────────────────────────────────────────── */
let searchTimer = null;
document.getElementById('search-input').addEventListener('input', e => {
  clearTimeout(searchTimer);
  const q = e.target.value.trim();
  if (!q) {
    loadTracks({ tags: 'pop', orderby: 'popularity_total' });
    return;
  }
  searchTimer = setTimeout(() => {
    loadTracks({ namesearch: q, orderby: 'popularity_total' });
  }, 450);
});

/* ─────────────────────────────────────────────────
   OPEN PLAYER
───────────────────────────────────────────────── */
function openPlayer(idx) {
  currentIdx = idx;
  updatePlayerUI(tracks[idx]);
  goTo('screen-player');
  playTrack(tracks[idx]);
  refreshListHighlight();
}

function updatePlayerUI(t) {
  document.getElementById('pi-title').textContent  = t.name        || '—';
  document.getElementById('pi-artist').textContent = t.artist_name || '—';

  // set vinyl label art from album image if available
  const label = document.getElementById('tv-label');
  if (t.album_image) {
    label.style.backgroundImage  = `url(${t.album_image})`;
    label.style.backgroundSize   = 'cover';
    label.style.backgroundPosition = 'center';
  } else {
    label.style.backgroundImage = '';
    label.style.background = 'linear-gradient(135deg, #e8e8e8, #d0d0d0)';
  }
}

/* ─────────────────────────────────────────────────
   AUDIO PLAYBACK
───────────────────────────────────────────────── */
function playTrack(t) {
  audio.src = t.audio;
  audio.play().then(() => {
    setPlayingState(true);
  }).catch(() => {});
}

function setPlayingState(isPlaying) {
  playing = isPlaying;

  // vinyl spin + tonearm
  const vinyl = document.getElementById('turntable-vinyl');
  const arm   = document.getElementById('turntable-arm');
  vinyl.classList.toggle('spinning', isPlaying);
  arm.classList.toggle('playing',   isPlaying);

  // waveform
  document.querySelector('.wf-bars').classList.toggle('active', isPlaying);

  // play/pause icon
  const ico = document.getElementById('ico-play');
  ico.innerHTML = isPlaying
    ? '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>'
    : '<path d="M8 5v14l11-7z"/>';
}

/* progress */
audio.addEventListener('timeupdate', () => {
  const pct = audio.duration ? audio.currentTime / audio.duration : 0;
  document.getElementById('prog-fill').style.width = (pct * 100) + '%';
  document.getElementById('prog-thumb').style.left  = (pct * 100) + '%';
  document.getElementById('prog-cur').textContent  = fmt(audio.currentTime);
  document.getElementById('prog-dur').textContent  = fmt(audio.duration);
});

audio.addEventListener('play',  () => setPlayingState(true));
audio.addEventListener('pause', () => setPlayingState(false));
audio.addEventListener('ended', () => advance(1));

/* ─────────────────────────────────────────────────
   CONTROLS
───────────────────────────────────────────────── */
document.getElementById('btn-play').addEventListener('click', () => {
  if (!tracks.length) return;
  if (currentIdx < 0) { openPlayer(0); return; }
  audio.paused ? audio.play() : audio.pause();
});

document.getElementById('btn-prev').addEventListener('click', () => {
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }
  advance(-1);
});
document.getElementById('btn-next').addEventListener('click', () => advance(1));

function advance(dir) {
  if (!tracks.length) return;
  const next = (currentIdx + dir + tracks.length) % tracks.length;
  currentIdx = next;
  updatePlayerUI(tracks[next]);
  playTrack(tracks[next]);
  refreshListHighlight();
}

/* progress bar seek */
document.getElementById('prog-bar').addEventListener('click', e => {
  if (!audio.duration) return;
  const r   = e.currentTarget.getBoundingClientRect();
  audio.currentTime = ((e.clientX - r.left) / r.width) * audio.duration;
});

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
  document.querySelectorAll('.track-card').forEach((el, i) => {
    el.classList.toggle('playing', i === currentIdx && playing);
  });
}

/* ─────────────────────────────────────────────────
   HELPERS
───────────────────────────────────────────────── */
function fmt(s) {
  s = Math.round(s || 0);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
