// Pure helpers: no DOM and no chrome.* access, so they can be tested with node:test.

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&nbsp;': ' ', '&quot;': '"', '&#39;': "'" };

const PARAGRAPH_GAP_SECONDS = 2;
const PARAGRAPH_MIN_CHARS = 500;

function parseTimestamp(str) {
  const parts = str.trim().replace(',', '.').split(':').map(Number);
  if (parts.some(Number.isNaN)) return null;
  let seconds = 0;
  for (const part of parts) seconds = seconds * 60 + part;
  return seconds;
}

function cleanCueText(text) {
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/&(?:amp|lt|gt|nbsp|quot|#39);/g, (m) => ENTITIES[m])
    .replace(/\s+/g, ' ')
    .trim();
}

// Returns [{ start, end, text }] with times in seconds.
function parseVtt(raw) {
  const blocks = raw.replace(/\r\n?/g, '\n').split(/\n{2,}/);
  const cues = [];

  for (const block of blocks) {
    const lines = block.split('\n');
    const first = lines[0].trim();
    if (/^(WEBVTT|NOTE|STYLE|REGION)\b/.test(first)) continue;

    const timingIndex = lines.findIndex((line) => line.includes('-->'));
    if (timingIndex === -1) continue;

    const [startStr, endStr = ''] = lines[timingIndex].split('-->');
    const start = parseTimestamp(startStr);
    if (start === null) continue;
    const end = parseTimestamp(endStr.trim().split(/\s+/)[0] || '');

    const text = cleanCueText(lines.slice(timingIndex + 1).join(' '));
    if (!text) continue;
    cues.push({ start, end: end ?? start, text });
  }
  return cues;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

// [mm:ss], or [hh:mm:ss] when useHours is true.
function formatTimestamp(seconds, useHours) {
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return useHours ? `[${pad(h)}:${pad(m)}:${pad(s)}]` : `[${pad(m)}:${pad(s)}]`;
}

function toParagraphs(cues) {
  const paragraphs = [];
  let current = '';
  let prev = null;

  for (const cue of cues) {
    if (prev && cue.text === prev.text) continue; // drop consecutive duplicates

    const longSilence = prev && cue.start - prev.end > PARAGRAPH_GAP_SECONDS;
    const sentenceDone = current.length >= PARAGRAPH_MIN_CHARS && /[.?!]$/.test(current);
    if (current && (longSilence || sentenceDone)) {
      paragraphs.push(current);
      current = '';
    }
    current = current ? `${current} ${cue.text}` : cue.text;
    prev = cue;
  }
  if (current) paragraphs.push(current);
  return paragraphs.join('\n\n');
}

function formatTranscript(cues, { timestamps = false } = {}) {
  if (!timestamps) return toParagraphs(cues);

  const useHours = cues.some((cue) => cue.start >= 3600);
  return cues.map((cue) => `${formatTimestamp(cue.start, useHours)} ${cue.text}`).join('\n');
}

// Removes characters that are not allowed in file names.
function sanitizeFileName(name) {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned || 'transcript';
}

if (typeof module !== 'undefined') {
  module.exports = { parseVtt, formatTranscript, formatTimestamp, sanitizeFileName };
}
