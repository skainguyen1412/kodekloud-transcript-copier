// Runs inside each frame (MAIN world). Must be self-contained: it is serialized by chrome.scripting.
function readPlayerConfig() {
  const config = window.playerConfig;
  const tracks = config && config.request && config.request.text_tracks;
  const debug = {
    href: location.href,
    hasConfig: !!config,
    hasRequest: !!(config && config.request),
    trackCount: Array.isArray(tracks) ? tracks.length : null,
  };
  if (!tracks) return { debug, data: null };
  return {
    debug,
    data: {
      title: (config.video && config.video.title) || 'transcript',
      tracks: tracks.map((t) => ({
        id: t.id,
        lang: t.lang,
        label: t.label,
        url: t.url,
        default: !!t.default,
      })),
    },
  };
}

const CAPTIONS_ORIGIN = 'https://captions.vimeo.com/';

const MESSAGES = {
  noVideo: 'No Vimeo video found on this page.',
  noTracks: 'This video has no captions.',
  expired: 'Caption link expired. Reload the page and try again.',
  fetchFailed: 'Could not load the captions.',
};

const $ = (id) => document.getElementById(id);
const els = {
  message: $('message'),
  retry: $('retry'),
  content: $('content'),
  title: $('title'),
  videoRow: $('videoRow'),
  videoSelect: $('videoSelect'),
  langSelect: $('langSelect'),
  timestamps: $('timestamps'),
  preview: $('preview'),
  stats: $('stats'),
  copy: $('copy'),
  download: $('download'),
};

const state = {
  videos: [], // [{ title, tracks }]
  video: null,
  track: null,
  cues: [],
  text: '',
};

const THEME_KEY = 'theme';

function savedTheme() {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

// Without a saved choice the CSS follows the system theme; the buttons just reflect it.
function currentTheme() {
  return savedTheme() || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}

function applyTheme(theme) {
  if (theme) document.documentElement.dataset.theme = theme;
  const active = currentTheme();
  $('themeLight').setAttribute('aria-pressed', String(active === 'light'));
  $('themeDark').setAttribute('aria-pressed', String(active === 'dark'));
}

function setTheme(theme) {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Storage unavailable: the choice just applies to this popup session.
  }
  document.documentElement.dataset.theme = theme;
  applyTheme();
}

let lastDiagnostics = ''; // raw per-frame result, shown when no video is found
let loadToken = 0; // ignores stale responses when the user switches quickly
let copyResetTimer = null;

function showMessage(text, { retry = false } = {}) {
  els.content.hidden = true;
  els.message.textContent = text;
  els.message.hidden = false;
  els.retry.hidden = !retry;
}

function showContent() {
  els.message.hidden = true;
  els.retry.hidden = true;
  els.content.hidden = false;
}

function setBusy(busy) {
  els.langSelect.disabled = busy;
  els.videoSelect.disabled = busy;
  els.timestamps.disabled = busy;
  els.copy.disabled = busy || !state.text;
  els.download.disabled = busy || !state.text;
}

async function findVideos() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id === undefined) return [];

  let results;
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      world: 'MAIN',
      func: readPlayerConfig,
    });
  } catch (err) {
    lastDiagnostics = `executeScript failed: ${err.message}`;
    return []; // restricted page (chrome://, web store, ...) or no access
  }
  lastDiagnostics = results.map((r) => JSON.stringify(r.result && r.result.debug)).join('\n');
  return results.map((r) => r.result && r.result.data).filter(Boolean);
}

function pickDefaultTrack(tracks) {
  return tracks.find((t) => t.default) || tracks.find((t) => t.lang === 'en-US') || tracks[0];
}

function fillSelect(select, items, getLabel, selectedIndex) {
  select.replaceChildren(
    ...items.map((item, i) => {
      const option = document.createElement('option');
      option.value = String(i);
      option.textContent = getLabel(item, i);
      return option;
    })
  );
  select.value = String(selectedIndex);
}

function selectVideo(index) {
  state.video = state.videos[index];
  els.title.textContent = state.video.title;
  els.title.title = state.video.title;

  const tracks = state.video.tracks;
  if (tracks.length === 0) {
    showMessage(MESSAGES.noTracks);
    return Promise.resolve();
  }
  const defaultTrack = pickDefaultTrack(tracks);
  fillSelect(els.langSelect, tracks, (t) => t.label || t.lang, tracks.indexOf(defaultTrack));
  showContent();
  return loadTrack(defaultTrack);
}

async function loadTrack(track) {
  const token = ++loadToken;
  state.track = track;
  state.text = '';
  els.preview.value = 'Loading captions…';
  els.stats.textContent = '';
  setBusy(true);

  try {
    if (!track.url.startsWith(CAPTIONS_ORIGIN)) throw new Error('unexpected track url');
    const response = await fetch(track.url);
    if (response.status === 401 || response.status === 403) {
      if (token === loadToken) showMessage(MESSAGES.expired, { retry: true });
      return;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const raw = await response.text();
    if (token !== loadToken) return;
    state.cues = parseVtt(raw);
    render();
  } catch {
    if (token === loadToken) showMessage(MESSAGES.fetchFailed, { retry: true });
  }
}

// Re-formats the already parsed cues; does not hit the network.
function render() {
  state.text = formatTranscript(state.cues, { timestamps: els.timestamps.checked });
  els.preview.value = state.text;
  const words = state.text.split(/\s+/).filter(Boolean).length;
  const lines = state.text ? state.text.split('\n').length : 0;
  els.stats.textContent = `${words.toLocaleString('en-US')} words · ${lines.toLocaleString('en-US')} lines`;
  setBusy(false);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    els.preview.focus();
    els.preview.select();
    document.execCommand('copy');
    els.preview.setSelectionRange(0, 0);
  }
}

async function onCopy() {
  await copyText(state.text);
  els.copy.textContent = 'Copied ✓';
  clearTimeout(copyResetTimer);
  copyResetTimer = setTimeout(() => {
    els.copy.textContent = '📋 Copy';
  }, 2000);
}

function onDownload() {
  const name = `${sanitizeFileName(state.video.title)}.${state.track.lang}.txt`;
  const url = URL.createObjectURL(new Blob([state.text], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function init() {
  showMessage('Loading…');
  const videos = await findVideos();
  if (videos.length === 0) {
    showMessage(`${MESSAGES.noVideo}\n\n${lastDiagnostics}`);
    return;
  }
  state.videos = videos;

  els.videoRow.hidden = videos.length < 2;
  if (videos.length > 1) {
    fillSelect(els.videoSelect, videos, (v, i) => `${i + 1}. ${v.title}`, 0);
  }
  await selectVideo(0);
}

$('themeLight').addEventListener('click', () => setTheme('light'));
$('themeDark').addEventListener('click', () => setTheme('dark'));
applyTheme(savedTheme());

els.langSelect.addEventListener('change', () => loadTrack(state.video.tracks[Number(els.langSelect.value)]));
els.videoSelect.addEventListener('change', () => selectVideo(Number(els.videoSelect.value)));
els.timestamps.addEventListener('change', render);
els.copy.addEventListener('click', onCopy);
els.download.addEventListener('click', onDownload);
els.retry.addEventListener('click', init);

init();
