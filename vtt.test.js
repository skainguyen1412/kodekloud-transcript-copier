const test = require('node:test');
const assert = require('node:assert');
const { parseVtt, formatTranscript, formatTimestamp, sanitizeFileName } = require('./vtt.js');

const SAMPLE = [
  'WEBVTT',
  '',
  'NOTE this is a comment',
  '',
  '1',
  '00:00:01.000 --> 00:00:03.000 align:start',
  'Hello <i>world</i> &amp; friends',
  '',
  '00:00:03.500 --> 00:00:05.000',
  '<c.yellow>Second</c> line',
  'continues here',
  '',
  '00:01:05.000 --> 00:01:07.000',
  'Hello <00:01:05.500>again',
].join('\r\n');

test('parseVtt skips header/notes, strips tags, decodes entities', () => {
  const cues = parseVtt(SAMPLE);
  assert.deepStrictEqual(
    cues.map((c) => [c.start, c.text]),
    [
      [1, 'Hello world & friends'],
      [3.5, 'Second line continues here'],
      [65, 'Hello again'],
    ]
  );
});

test('parseVtt handles mm:ss.mmm timestamps', () => {
  const cues = parseVtt('WEBVTT\n\n01:02.500 --> 01:04.000\nHi');
  assert.strictEqual(cues[0].start, 62.5);
  assert.strictEqual(cues[0].end, 64);
});

test('formatTimestamp switches to hours when asked', () => {
  assert.strictEqual(formatTimestamp(65, false), '[01:05]');
  assert.strictEqual(formatTimestamp(3725, true), '[01:02:05]');
});

test('timestamp mode: one line per cue', () => {
  const out = formatTranscript(parseVtt(SAMPLE), { timestamps: true });
  assert.strictEqual(
    out,
    ['[00:01] Hello world & friends', '[00:03] Second line continues here', '[01:05] Hello again'].join('\n')
  );
});

test('timestamp mode: uses hh:mm:ss when a cue starts at 1h or later', () => {
  const out = formatTranscript([{ start: 3600, end: 3601, text: 'x' }], { timestamps: true });
  assert.strictEqual(out, '[01:00:00] x');
});

test('paragraph mode: joins cues, drops consecutive duplicates', () => {
  const cues = [
    { start: 0, end: 1, text: 'Hello' },
    { start: 1, end: 2, text: 'Hello' },
    { start: 2, end: 3, text: 'world.' },
  ];
  assert.strictEqual(formatTranscript(cues), 'Hello world.');
});

test('paragraph mode: breaks on silence longer than 2 seconds', () => {
  const cues = [
    { start: 0, end: 1, text: 'One' },
    { start: 5, end: 6, text: 'Two' },
  ];
  assert.strictEqual(formatTranscript(cues), 'One\n\nTwo');
});

test('paragraph mode: breaks at sentence end once long enough', () => {
  const long = 'a'.repeat(500) + '.';
  const cues = [
    { start: 0, end: 1, text: long },
    { start: 1, end: 2, text: 'Next' },
  ];
  assert.strictEqual(formatTranscript(cues), `${long}\n\nNext`);
});

test('sanitizeFileName strips forbidden characters', () => {
  assert.strictEqual(sanitizeFileName('A/B: "C"?*'), 'A B C');
  assert.strictEqual(sanitizeFileName('???'), 'transcript');
});
