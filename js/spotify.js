/**
 * spotify.js
 * Spotify OAuth (PKCE) + Web API – no backend, no Spotify SDK, no iframe.
 * Audio source: preview_url only → feeds into existing Web Audio engine.
 *
 * SETUP (required before use):
 *   1. Go to https://developer.spotify.com/dashboard
 *   2. Create an app
 *   3. Add your deployed URL as a Redirect URI (e.g. https://your-app.vercel.app/)
 *      – also add http://localhost:PORT if testing locally via a dev server
 *      – file:// URLs do NOT work with Spotify OAuth
 *   4. Paste your Client ID below
 */

const Spotify = (() => {

  // ── Config ─────────────────────────────────────────────────────
  const CLIENT_ID   = 'YOUR_SPOTIFY_CLIENT_ID'; // ← paste your Client ID here
  const REDIRECT_URI = window.location.origin + window.location.pathname;
  const SCOPES = [
    'user-read-private',
    'user-top-read',
    'playlist-read-private',
    'playlist-read-collaborative',
  ].join(' ');

  const AUTH_URL  = 'https://accounts.spotify.com/authorize';
  const TOKEN_URL = 'https://accounts.spotify.com/api/token';
  const API_BASE  = 'https://api.spotify.com/v1';

  // ── Runtime state ───────────────────────────────────────────────
  let accessToken  = null;
  let tokenExpiry  = 0;
  let onTrackSelected = null;   // callback(trackInfo)

  // ── PKCE helpers ────────────────────────────────────────────────
  function _verifier() {
    const arr = new Uint8Array(64);
    crypto.getRandomValues(arr);
    return btoa(String.fromCharCode(...arr))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  async function _challenge(v) {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v));
    return btoa(String.fromCharCode(...new Uint8Array(hash)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  // ── Auth ─────────────────────────────────────────────────────────
  async function login() {
    if (CLIENT_ID === 'YOUR_SPOTIFY_CLIENT_ID') {
      _showSetupMessage();
      return;
    }
    const v = _verifier();
    const c = await _challenge(v);
    sessionStorage.setItem('sp_verifier', v);

    const params = new URLSearchParams({
      client_id:             CLIENT_ID,
      response_type:         'code',
      redirect_uri:          REDIRECT_URI,
      scope:                 SCOPES,
      code_challenge_method: 'S256',
      code_challenge:        c,
    });
    window.location.href = `${AUTH_URL}?${params}`;
  }

  async function _handleCallback() {
    const params = new URLSearchParams(window.location.search);
    const code   = params.get('code');
    const error  = params.get('error');
    if (error || !code) { _cleanUrl(); return false; }

    const verifier = sessionStorage.getItem('sp_verifier');
    if (!verifier) { _cleanUrl(); return false; }

    try {
      const res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id:     CLIENT_ID,
          grant_type:    'authorization_code',
          code,
          redirect_uri:  REDIRECT_URI,
          code_verifier: verifier,
        }),
      });
      const data = await res.json();
      if (data.access_token) {
        accessToken = data.access_token;
        tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
        sessionStorage.removeItem('sp_verifier');
        _cleanUrl();
        return true;
      }
    } catch (e) { console.error('Spotify token exchange failed', e); }
    _cleanUrl();
    return false;
  }

  function _cleanUrl() {
    window.history.replaceState({}, '', window.location.pathname);
  }

  function isConnected() {
    return !!accessToken && Date.now() < tokenExpiry;
  }

  // ── API ───────────────────────────────────────────────────────────
  async function _api(path) {
    if (!accessToken) return null;
    const r = await fetch(`${API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return r.ok ? r.json() : null;
  }

  async function _fetchPlaylists() {
    const d = await _api('/me/playlists?limit=20');
    return d?.items ?? [];
  }

  async function _fetchTopTracks() {
    const d = await _api('/me/top/tracks?limit=20&time_range=medium_term');
    return d?.items ?? [];
  }

  async function _fetchPlaylistTracks(id) {
    const d = await _api(
      `/playlists/${id}/tracks?limit=30` +
      `&fields=items(track(id,name,artists,preview_url,duration_ms,album(name)))`
    );
    return (d?.items ?? []).map(i => i.track).filter(Boolean);
  }

  // ── UI ────────────────────────────────────────────────────────────
  function init(onSelect) {
    onTrackSelected = onSelect;
    _buildPanel();

    // Handle OAuth redirect callback
    if (window.location.search.includes('code=') ||
        window.location.search.includes('error=')) {
      _handleCallback().then(ok => {
        if (ok) _onConnected();
        else    _renderAuth();
      });
    }
  }

  function _buildPanel() {
    // ── Toggle button on plinth ────────────────────────────────────
    const btn = document.createElement('button');
    btn.id = 'spotify-toggle';
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
        <circle cx="12" cy="12" r="10"/>
        <path fill="#1a1208" d="M7.5 16.5c3.5-1 7-1 10.5 0.5M7 13c4-1.2 8-1.2 11 0.5M7.5 9.5c3.5-1 7-1 10 0.5" stroke="#1a1208" stroke-width="1.5" fill="none"/>
      </svg>
      <span>SPOTIFY</span>`;
    btn.addEventListener('click', _togglePanel);
    document.getElementById('turntable').appendChild(btn);

    // ── Side panel ─────────────────────────────────────────────────
    const panel = document.createElement('div');
    panel.id = 'spotify-panel';
    panel.innerHTML = `
      <div id="sp-panel-inner">
        <div id="sp-header">
          <div id="sp-title">
            <div id="sp-title-dot"></div>
            <span>SPOTIFY LIBRARY</span>
          </div>
          <button id="sp-close" aria-label="Close Spotify panel">✕</button>
        </div>
        <div id="sp-body"></div>
      </div>`;
    document.getElementById('app').appendChild(panel);

    document.getElementById('sp-close').addEventListener('click', _closePanel);

    // Render initial state
    if (isConnected()) {
      _onConnected();
    } else {
      _renderAuth();
    }
  }

  function _togglePanel() {
    const panel = document.getElementById('spotify-panel');
    panel.classList.toggle('sp-open');
  }

  function _closePanel() {
    document.getElementById('spotify-panel').classList.remove('sp-open');
  }

  function _renderAuth() {
    const body = document.getElementById('sp-body');
    if (CLIENT_ID === 'YOUR_SPOTIFY_CLIENT_ID') {
      body.innerHTML = `
        <div class="sp-setup-msg">
          <p class="sp-label">SETUP REQUIRED</p>
          <p class="sp-sub">Add your Spotify Client&nbsp;ID to<br><code>js/spotify.js</code></p>
          <p class="sp-sub">Then register your app at<br>developer.spotify.com</p>
        </div>`;
      return;
    }
    body.innerHTML = `
      <div class="sp-auth-wrap">
        <p class="sp-label">CONNECT YOUR LIBRARY</p>
        <p class="sp-sub">Browse playlists and stream<br>30-second previews through the vinyl</p>
        <button class="sp-connect-btn" id="sp-login-btn">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <circle cx="12" cy="12" r="10"/>
            <path fill="#000" stroke="#000" stroke-width="1.5"
              d="M7.5 16.5c3.5-1 7-1 10.5 0.5M7 13c4-1.2 8-1.2 11 0.5M7.5 9.5c3.5-1 7-1 10 0.5"
              fill="none"/>
          </svg>
          CONNECT SPOTIFY
        </button>
        <p class="sp-disclaimer">30-second previews only · audio stays local</p>
      </div>`;
    document.getElementById('sp-login-btn').addEventListener('click', login);
  }

  async function _onConnected() {
    const body = document.getElementById('sp-body');
    body.innerHTML = `<div class="sp-loading"><div class="sp-spinner"></div><span>LOADING LIBRARY…</span></div>`;

    const [playlists, topTracks] = await Promise.all([
      _fetchPlaylists(),
      _fetchTopTracks(),
    ]);

    body.innerHTML = '';

    // Playlists section
    if (playlists.length > 0) {
      body.appendChild(_buildSection('YOUR PLAYLISTS', null));
      const pList = document.createElement('div');
      pList.className = 'sp-playlist-list';
      playlists.forEach(pl => {
        const row = document.createElement('button');
        row.className = 'sp-playlist-row';
        row.innerHTML = `
          <span class="sp-playlist-arrow">▸</span>
          <span class="sp-playlist-name">${_esc(pl.name)}</span>
          <span class="sp-playlist-count">${pl.tracks.total}</span>`;
        row.addEventListener('click', async () => {
          document.querySelectorAll('.sp-playlist-row').forEach(r => r.classList.remove('active'));
          row.classList.add('active');
          const tracks = await _fetchPlaylistTracks(pl.id);
          _renderTracks(pl.name, tracks);
        });
        pList.appendChild(row);
      });
      body.appendChild(pList);
    }

    // Top tracks section
    body.appendChild(_buildSection('TOP TRACKS', null));
    _renderTracks(null, topTracks, body);

    // Auto-open panel after connect
    document.getElementById('spotify-panel').classList.add('sp-open');
  }

  function _buildSection(title) {
    const h = document.createElement('div');
    h.className = 'sp-section-header';
    h.textContent = title;
    return h;
  }

  function _renderTracks(playlistName, tracks, targetEl) {
    const body = targetEl || document.getElementById('sp-body');

    // Remove previous track list if any
    const old = body.querySelector('.sp-track-list');
    if (old) old.remove();
    const oldH = body.querySelector('.sp-tracks-header');
    if (oldH) oldH.remove();

    if (playlistName) {
      const h = document.createElement('div');
      h.className = 'sp-section-header sp-tracks-header';
      h.textContent = playlistName.toUpperCase();
      body.appendChild(h);
    }

    const list = document.createElement('div');
    list.className = 'sp-track-list';

    if (tracks.length === 0) {
      list.innerHTML = `<div class="sp-empty">No tracks found</div>`;
    }

    tracks.forEach((track, i) => {
      if (!track) return;
      const hasPreview = !!track.preview_url;
      const artist = track.artists?.map(a => a.name).join(', ') || '—';

      const row = document.createElement('div');
      row.className = `sp-track-row ${hasPreview ? '' : 'sp-no-preview'}`;
      row.innerHTML = `
        <span class="sp-track-num">${String(i + 1).padStart(2, '0')}</span>
        <div class="sp-track-info">
          <span class="sp-track-name">${_esc(track.name)}</span>
          <span class="sp-track-artist">${_esc(artist)}</span>
        </div>
        <span class="sp-track-action">${hasPreview ? '▶' : '✕'}</span>`;

      if (hasPreview) {
        row.addEventListener('click', () => _selectTrack(track));
        row.setAttribute('role', 'button');
        row.setAttribute('tabindex', '0');
        row.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') _selectTrack(track);
        });
      } else {
        row.title = 'No 30-second preview available for this track';
      }

      list.appendChild(row);
    });

    body.appendChild(list);
  }

  function _selectTrack(track) {
    // Visual feedback
    document.querySelectorAll('.sp-track-row').forEach(r => r.classList.remove('sp-selected'));
    const rows = document.querySelectorAll('.sp-track-row');
    // Find by preview URL match (no id stored on element)

    const artist = track.artists?.map(a => a.name).join(', ') || '';
    _closePanel();

    if (onTrackSelected) {
      onTrackSelected({
        name:       track.name,
        artist,
        previewUrl: track.preview_url,
      });
    }
  }

  function _showSetupMessage() {
    document.getElementById('spotify-panel').classList.add('sp-open');
  }

  function _esc(str) {
    return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  return { init, login, isConnected };
})();
