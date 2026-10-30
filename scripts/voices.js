// Voice-over takes, per language: what each line says, where its file goes, how long its beat
// slot is, and whether the take there fits. Takes come from a narrator or a TTS service; this
// script never generates audio itself.
//
//   node scripts/voices.js --episode 1                       status of every language's takes
//   node scripts/voices.js --episode 1 --langs ur            one language
//   node scripts/voices.js --episode 1 --import <folder>     bring takes in (see below), then report
//
// --import accepts any audio ffmpeg reads (wav, mp3, m4a, ogg, flac…) named <lang>-<cue id>.<ext>
// (e.g. ur-vo04.mp3) or <lang>/<cue id>.<ext>. Each is converted to 48 kHz mono WAV at the
// timeline's VO path with leading and trailing silence trimmed, so speech starts on the beat.
// Also writes out/vo-takes-<timeline>.json: every take's language, text, target file and maximum
// length, the list to record or generate from.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createClock } from '../src/beat.js';
import { parseJobArgs } from '../src/cli.js';
import { LANGUAGES } from '../src/languages.js';
import { loadProject, measureAudio, hasTool, FFMPEG, OUT, ROOT } from '../src/project.js';

const { opt, jobs } = parseJobArgs({ import: { type: 'string' } });
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const AUDIO = /\.(wav|mp3|m4a|aac|ogg|oga|opus|flac|webm|mp4)$/i;

const loaded = jobs.map((job) => ({ job, ...loadProject(job) }));
const cueIds = new Set(loaded[0].timeline.cues.map((c) => c.id));

if (opt.import) importTakes(path.resolve(opt.import));

// re-load after an import so durations reflect the new files
const report = opt.import ? jobs.map((job) => ({ job, ...loadProject(job) })) : loaded;
const takes = [];
let missing = 0;
let tooLong = 0;
for (const { job, timeline: tl } of report) {
  const clock = createClock(tl.clock);
  const L = LANGUAGES[job.lang];
  console.log(`\n${L.name} (${job.lang})  ${job.name}`);
  for (const c of tl.cues) {
    const text = c.text[job.lang] || (job.lang === 'en' ? c.en : '');
    const slot = c.end - c.start;
    const est = text.length / L.speechCps;
    takes.push({ lang: job.lang, id: c.id, text, file: c.file, slotSec: +slot.toFixed(2), estimatedSec: +est.toFixed(1) });
    let status;
    if (!c.file) status = 'no file path';
    else if (!c.fileExists) {
      missing++;
      status = `missing  (est. ${est.toFixed(1)}s${est > slot ? ', PROBABLY TOO LONG' : ''})`;
    } else if (c.audioSec == null) status = 'present, length unknown';
    else if (c.audioSec > slot + 1e-6) {
      tooLong++;
      const need = Math.ceil(clock.toBeat(c.audioSec) - 1e-6);
      status = `TOO LONG ${c.audioSec.toFixed(2)}s (needs ${need} beats, slot is ${c.beats})`;
    } else status = `ok ${c.audioSec.toFixed(2)}s`;
    console.log(`  ${c.id}  ${clock.label(c.startBeat).padEnd(5)} ${slot.toFixed(1).padStart(4)}s slot  ${status.padEnd(44)} ${c.file ?? ''}`);
    console.log(`        ${text}`);
  }
}

const base = path.basename(jobs[0].file, '.json');
const listFile = path.join(OUT, `vo-takes-${base}.json`);
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(listFile, JSON.stringify(takes, null, 2) + '\n');
const ready = takes.length - missing - tooLong;
console.log(`\n${ready}/${takes.length} takes ready, ${missing} missing, ${tooLong} too long. Take list: ${rel(listFile)}`);
if (tooLong) console.log('A take that is too long overlaps the next line: re-record it faster, shorten the text, or give the cue more beats.');

function importTakes(dir) {
  if (!fs.existsSync(dir)) {
    console.error(`--import: ${dir} doesn't exist`);
    process.exit(1);
  }
  if (!hasTool(FFMPEG)) {
    console.error('--import needs ffmpeg (tools/ffmpeg/ffmpeg.exe)');
    process.exit(1);
  }
  const target = new Map(loaded.map(({ job, timeline }) => [job.lang, new Map(timeline.cues.map((c) => [c.id, c.file]))]));
  const files = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (AUDIO.test(e.name)) files.push(p);
    }
  };
  walk(dir);
  console.log(`importing from ${dir}`);
  for (const src of files) {
    const name = path.relative(dir, src).split(path.sep).join('/').replace(AUDIO, '').toLowerCase();
    const m = /^([a-z]{2})[-_/](.+)$/.exec(name);
    const dest = m && target.get(m[1])?.get(m[2]);
    if (!dest) {
      const why = !m ? 'name it <lang>-<cue id>, e.g. ur-vo04.mp3' : !target.has(m[1]) ? `"${m[1]}" isn't a language being imported` : !cueIds.has(m[2]) ? `no cue "${m[2]}"` : 'no VO path';
      console.log(`  skip  ${path.basename(src)}: ${why}`);
      continue;
    }
    const abs = path.resolve(ROOT, dest);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    // trim silence at both ends (the end via reverse-trim-reverse), mono 48 kHz 16-bit PCM
    const trim = 'silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.02';
    const r = spawnSync(FFMPEG, ['-y', '-hide_banner', '-v', 'error', '-i', src, '-af', `${trim},areverse,${trim},areverse`,
      '-ac', '1', '-ar', '48000', '-c:a', 'pcm_s16le', abs], { encoding: 'utf8' });
    if (r.status !== 0) {
      console.log(`  FAIL  ${path.basename(src)}: ${(r.stderr || '').trim().split(/\r?\n/).pop()}`);
      continue;
    }
    const before = measureAudio(src);
    console.log(`  ok    ${path.basename(src)} -> ${dest}  (${before?.toFixed(2) ?? '?'}s -> ${measureAudio(abs).toFixed(2)}s after trimming silence)`);
  }
}
