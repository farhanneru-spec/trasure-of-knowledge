// Voice-over takes, per language: what each line says, where its file goes, how long its beat
// slot is, and whether the take there fits.
//
//   node scripts/voices.js --episode 1                       status of every language's takes
//   node scripts/voices.js --episode 1 --langs ur            one language
//   node scripts/voices.js --episode 1 --import <folder>     bring takes in (see below), then report
//   node scripts/voices.js --episode 1 --local [--voice David]
//                                                            placeholder takes from Windows' built-in voices
//
// --import accepts any audio ffmpeg reads (wav, mp3, m4a, ogg, flac…) named <lang>-<cue id>.<ext>
// (e.g. ur-vo04.mp3) or <lang>/<cue id>.<ext>. Each is converted to 48 kHz mono WAV at the
// timeline's VO path with leading and trailing silence trimmed, so speech starts on the beat.
//
// --local synthesises missing takes offline with the Windows speech voices installed for each
// language (no credits, no network), speeding a line up until it fits its slot. It never
// overwrites a real take: only missing files, and its own placeholders whose text has changed.
// Placeholders are listed in assets/vo/placeholders.json and reported as such.
//
// Also writes out/vo-takes-<timeline>.json: every take's language, text, target file and maximum
// length, the list to record or generate from.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createClock } from '../src/beat.js';
import { parseJobArgs } from '../src/cli.js';
import { LANGUAGES } from '../src/languages.js';
import { loadProject, measureAudio, hasTool, FFMPEG, OUT, ROOT } from '../src/project.js';

const { opt, jobs } = parseJobArgs({
  import: { type: 'string' },
  local: { type: 'boolean', default: false },
  voice: { type: 'string' },
});
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const AUDIO = /\.(wav|mp3|m4a|aac|ogg|oga|opus|flac|webm|mp4)$/i;
const PLACEHOLDERS = path.join(ROOT, 'assets', 'vo', 'placeholders.json');

// --local: speaks each { text, out, rate } to a 48 kHz mono WAV with a Windows voice. Input
// travels through a UTF-8 JSON file, never the command line, so any script survives intact.
const SYNTH = `$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$jobs = Get-Content -Raw -Encoding UTF8 $env:VO_JOBS | ConvertFrom-Json
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.SelectVoice($env:VO_VOICE)
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo 48000, ([System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen), ([System.Speech.AudioFormat.AudioChannel]::Mono)
foreach ($j in $jobs) { $s.Rate = [int]$j.rate; $s.SetOutputToWaveFile($j.out, $fmt); $s.Speak([string]$j.text); $s.SetOutputToNull() }
$s.Dispose()`;

const cueText = (c, lang) => c.text[lang] || (lang === 'en' ? c.en : '');
const loaded = jobs.map((job) => ({ job, ...loadProject(job) }));
const cueIds = new Set(loaded[0].timeline.cues.map((c) => c.id));

if ((opt.import || opt.local) && !hasTool(FFMPEG)) {
  console.error('--import and --local need ffmpeg (tools/ffmpeg/ffmpeg.exe)');
  process.exit(1);
}
if (opt.import) importTakes(path.resolve(opt.import));
if (opt.local) generateLocal();

// re-load after changes so durations reflect the new files
const report = opt.import || opt.local ? jobs.map((job) => ({ job, ...loadProject(job) })) : loaded;
const placeholders = readPlaceholders();
const takes = [];
let missing = 0;
let tooLong = 0;
let local = 0;
for (const { job, timeline: tl } of report) {
  const clock = createClock(tl.clock);
  const L = LANGUAGES[job.lang];
  console.log(`\n${L.name} (${job.lang})  ${job.name}`);
  for (const c of tl.cues) {
    const text = cueText(c, job.lang);
    const slot = c.end - c.start;
    const est = text.length / L.speechCps;
    const ph = c.fileExists && isPlaceholder(placeholders, c.file);
    takes.push({ lang: job.lang, id: c.id, text, file: c.file, slotSec: +slot.toFixed(2), estimatedSec: +est.toFixed(1), placeholder: !!ph });
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
    if (ph) {
      local++;
      status += ph.text === text ? ' (local placeholder)' : ' (local placeholder, OUTDATED TEXT)';
    }
    console.log(`  ${c.id}  ${clock.label(c.startBeat).padEnd(5)} ${slot.toFixed(1).padStart(4)}s slot  ${status.padEnd(46)} ${c.file ?? ''}`);
    console.log(`        ${text}`);
  }
}

const base = path.basename(jobs[0].file, '.json');
const listFile = path.join(OUT, `vo-takes-${base}.json`);
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(listFile, JSON.stringify(takes, null, 2) + '\n');
const ready = takes.length - missing - tooLong;
console.log(`\n${ready}/${takes.length} takes ready (${local} of them local placeholders), ${missing} missing, ${tooLong} too long. Take list: ${rel(listFile)}`);
if (tooLong) console.log('A take that is too long overlaps the next line: re-record it faster, shorten the text, or give the cue more beats.');

/** Converts any audio file to 48 kHz mono WAV at dest, trimming silence at both ends. */
function convertTake(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  // the end is trimmed by reversing, trimming the start, and reversing back
  const trim = 'silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.02';
  const r = spawnSync(FFMPEG, ['-y', '-hide_banner', '-v', 'error', '-i', src, '-af', `${trim},areverse,${trim},areverse`,
    '-ac', '1', '-ar', '48000', '-c:a', 'pcm_s16le', dest], { encoding: 'utf8' });
  return r.status === 0 ? null : (r.stderr || '').trim().split(/\r?\n/).pop() || `exit ${r.status}`;
}

function importTakes(dir) {
  if (!fs.existsSync(dir)) {
    console.error(`--import: ${dir} doesn't exist`);
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
  const registry = readPlaceholders();
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
    const err = convertTake(src, abs);
    if (err) {
      console.log(`  FAIL  ${path.basename(src)}: ${err}`);
      continue;
    }
    delete registry[dest]; // a real take replaces any placeholder
    console.log(`  ok    ${path.basename(src)} -> ${dest}  (${measureAudio(src)?.toFixed(2) ?? '?'}s -> ${measureAudio(abs).toFixed(2)}s after trimming silence)`);
  }
  writePlaceholders(registry);
}

// ---- local placeholder voices (Windows speech) ------------------------------------------

function readPlaceholders() {
  try {
    return JSON.parse(fs.readFileSync(PLACEHOLDERS, 'utf8'));
  } catch {
    return {};
  }
}
function writePlaceholders(registry) {
  if (!Object.keys(registry).length) return fs.rmSync(PLACEHOLDERS, { force: true });
  fs.mkdirSync(path.dirname(PLACEHOLDERS), { recursive: true });
  fs.writeFileSync(PLACEHOLDERS, JSON.stringify(registry, null, 2) + '\n');
}
/** The registry entry if the file is still the placeholder written there (same size and time). */
function isPlaceholder(registry, file) {
  const e = registry[file];
  if (!e) return null;
  const st = fs.statSync(path.resolve(ROOT, file), { throwIfNoEntry: false });
  return st && st.size === e.size && Math.round(st.mtimeMs) === e.mtimeMs ? e : null;
}

function powershell(script, env = {}) {
  return spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
  { encoding: 'utf8', env: { ...process.env, ...env }, timeout: 600000, windowsHide: true });
}

function windowsVoices() {
  const r = powershell(`Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
@($s.GetInstalledVoices() | Where-Object Enabled | ForEach-Object {
  [pscustomobject]@{ name = $_.VoiceInfo.Name; culture = $_.VoiceInfo.Culture.Name; gender = [string]$_.VoiceInfo.Gender } }) | ConvertTo-Json -Compress
$s.Dispose()`);
  if (r.status !== 0) return [];
  const v = JSON.parse(r.stdout.trim() || '[]');
  return Array.isArray(v) ? v : [v];
}

function generateLocal() {
  if (process.platform !== 'win32') {
    console.error('--local uses the Windows speech voices; on other systems use --import');
    process.exit(1);
  }
  const voices = windowsVoices();
  const registry = readPlaceholders();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vo-local-'));
  console.log(`local voices installed: ${voices.map((v) => `${v.name} (${v.culture})`).join(', ') || 'none'}`);
  try {
    for (const { job, timeline } of loaded) {
      const L = LANGUAGES[job.lang];
      const own = voices.filter((v) => v.culture.toLowerCase().startsWith(`${job.lang}-`));
      const voice = opt.voice ? own.find((v) => v.name.toLowerCase().includes(opt.voice.toLowerCase())) : own[0];
      if (!voice) {
        const hint = job.lang === 'ur'
          ? 'Windows has no Urdu speech voice'
          : `add one in Windows Settings > Time & Language > Speech${opt.voice ? `, or check --voice "${opt.voice}"` : ''}`;
        console.log(`  ${L.name}: no local ${L.name} voice${opt.voice ? ` matching "${opt.voice}"` : ''}; skipped (${hint})`);
        continue;
      }
      // missing takes, and our own placeholders whose line has been rewritten since
      const todo = timeline.cues.filter((c) => {
        if (!c.file || !cueText(c, job.lang)) return false;
        if (!c.fileExists) return true;
        const ph = isPlaceholder(registry, c.file);
        return ph && ph.text !== cueText(c, job.lang);
      });
      if (!todo.length) {
        console.log(`  ${L.name}: every take already exists; nothing to generate`);
        continue;
      }
      console.log(`  ${L.name}: ${todo.length} take(s) with ${voice.name}`);
      const rate = Object.fromEntries(todo.map((c) => [c.id, 0]));
      let pending = todo;
      // speak, measure, and speed up any line that overruns its slot (Windows rate -10..10;
      // each step is roughly 10% faster)
      for (let pass = 0; pending.length && pass < 5; pass++) {
        const items = pending.map((c) => ({ text: cueText(c, job.lang), out: path.join(tmp, `${job.lang}-${c.id}.wav`), rate: rate[c.id] }));
        const jobsFile = path.join(tmp, 'jobs.json');
        fs.writeFileSync(jobsFile, JSON.stringify(items), 'utf8');
        const r = powershell(SYNTH, { VO_JOBS: jobsFile, VO_VOICE: voice.name });
        if (r.status !== 0) {
          console.log(`  ${L.name}: speech failed: ${(r.stderr || '').trim().split(/\r?\n/)[0]}`);
          break;
        }
        const next = [];
        for (const c of pending) {
          const abs = path.resolve(ROOT, c.file);
          const err = convertTake(path.join(tmp, `${job.lang}-${c.id}.wav`), abs);
          if (err) {
            console.log(`    ${c.id}: FAIL ${err}`);
            continue;
          }
          const sec = measureAudio(abs);
          const slot = c.end - c.start;
          if (sec > slot && rate[c.id] < 10) {
            rate[c.id] = Math.min(10, rate[c.id] + Math.max(1, Math.ceil(Math.log(sec / slot) / Math.log(1.1))));
            next.push(c);
            continue;
          }
          const st = fs.statSync(abs);
          registry[c.file] = { voice: voice.name, rate: rate[c.id], text: cueText(c, job.lang), size: st.size, mtimeMs: Math.round(st.mtimeMs) };
          const speed = rate[c.id] ? `, rate +${rate[c.id]}` : '';
          console.log(`    ${c.id}: ${sec.toFixed(2)}s / ${slot.toFixed(1)}s slot${speed}${sec > slot ? '  STILL TOO LONG at the fastest rate' : ''}`);
        }
        pending = next;
      }
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    writePlaceholders(registry);
  }
}
