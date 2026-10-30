import fs from 'node:fs';
import path from 'node:path';
import { createClock } from './beat.js';

// Explicit RTL embedding per line, so players that default to LTR still put
// Arabic punctuation on the correct (left) end of the line.
const RLE = '‫';
const PDF = '‬';
const BOM = '﻿'; // lets Windows players/Excel detect UTF-8 Arabic

const pad = (n) => String(n).padStart(2, '0');

export function timecode(sec, msSep = ',') {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor(ms / 60000) % 60;
  const s = Math.floor(ms / 1000) % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)}${msSep}${String(ms % 1000).padStart(3, '0')}`;
}

/** One line if it fits, else two balanced lines, else greedy wrapping. */
export function wrapLines(text, max) {
  if (text.length <= max) return [text];
  const words = text.split(/\s+/);
  let best = null;
  for (let i = 1; i < words.length; i++) {
    const lines = [words.slice(0, i).join(' '), words.slice(i).join(' ')];
    const worst = Math.max(lines[0].length, lines[1].length);
    if (!best || worst < best.worst) best = { worst, lines };
  }
  if (best && best.worst <= max) return best.lines;

  const lines = [];
  let line = '';
  for (const w of words) {
    if (line && line.length + 1 + w.length > max) {
      lines.push(line);
      line = w;
    } else line = line ? `${line} ${w}` : w;
  }
  lines.push(line);
  return lines;
}

export const toSRT = (entries) =>
  entries
    .map((e, i) => `${i + 1}\n${timecode(e.start)} --> ${timecode(e.end)}\n${e.lines.join('\n')}\n`)
    .join('\n');

export const toVTT = (entries, lang) =>
  `WEBVTT\nKind: captions\nLanguage: ${lang}\n\n` +
  entries
    .map((e) => `${e.id}\n${timecode(e.start, '.')} --> ${timecode(e.end, '.')} align:center\n${e.lines.join('\n')}\n`)
    .join('\n');

const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Writes Arabic SRT/VTT, an English reference SRT and the VO cue sheet. */
export function writeCaptionFiles(timeline, outDir) {
  const clock = createClock(timeline.clock);
  const ar = timeline.captions.map((c) => ({
    id: c.id,
    start: c.start,
    end: c.end,
    lines: wrapLines(c.text, c.maxCharsPerLine).map((l) => RLE + l + PDF),
  }));
  const en = timeline.cues
    .filter((c) => c.en)
    .map((c) => ({ id: c.id, start: c.start, end: c.end, lines: wrapLines(c.en, 42) }));

  const sheet = [
    ['id', 'start_bar_beat', 'end_bar_beat', 'beats', 'start_tc', 'end_tc', 'slot_sec', 'audio_sec', 'fits', 'file', 'en', 'ar'],
    ...timeline.cues.map((c) => [
      c.id,
      clock.label(c.startBeat),
      clock.label(c.endBeat),
      c.beats,
      timecode(c.start),
      timecode(c.end),
      (c.end - c.start).toFixed(2),
      c.audioSec?.toFixed(2) ?? '',
      c.audioSec == null ? '' : c.audioSec <= c.end - c.start + 1e-6 ? 'yes' : 'NO',
      c.file ?? '',
      c.en,
      c.ar,
    ]),
  ];

  const files = {
    'captions.ar.srt': BOM + toSRT(ar),
    'captions.ar.vtt': toVTT(ar, 'ar'),
    'captions.en.srt': BOM + toSRT(en),
    'vo-cue-sheet.csv': BOM + sheet.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n',
  };
  fs.mkdirSync(outDir, { recursive: true });
  return Object.entries(files).map(([name, body]) => {
    const p = path.join(outDir, name);
    fs.writeFileSync(p, body, 'utf8');
    return p;
  });
}
