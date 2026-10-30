import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, CONFIG, FFMPEG, FFPROBE, hasTool, processingEnabled } from './config.js';
import { readManifest, scanMedia, isStale, MANIFEST_PATH } from './media.js';
import { resolveTimeline } from './timeline.js';
import { readWavDuration } from './wav.js';

export { ROOT, CONFIG, FFMPEG, FFPROBE, hasTool, processingEnabled };
export const OUT = path.resolve(ROOT, CONFIG.outDir);
export const DEFAULT_TIMELINE = CONFIG.timeline;

/** The project-local chrome-headless-shell executable, newest version first, or null. */
export function findLocalBrowser() {
  const dir = path.resolve(ROOT, CONFIG.browserDir);
  if (!fs.existsSync(dir)) return null;
  const exe = process.platform === 'win32' ? 'chrome-headless-shell.exe' : 'chrome-headless-shell';
  for (const version of fs.readdirSync(dir).sort().reverse()) {
    const platformDir = path.join(dir, version);
    for (const sub of fs.readdirSync(platformDir)) {
      const candidate = path.join(platformDir, sub, exe);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function measureAudio(abs) {
  if (path.extname(abs).toLowerCase() === '.wav') return readWavDuration(abs);
  if (!hasTool(FFPROBE)) return null;
  const r = spawnSync(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', abs], { encoding: 'utf8' });
  const d = parseFloat(r.stdout);
  return Number.isFinite(d) ? d : null;
}

/** Load + resolve the timeline, measuring VO audio, and write out/timeline.resolved.json for the scene. */
export function loadProject(timelinePath = process.env.TIMELINE ?? DEFAULT_TIMELINE) {
  const raw = JSON.parse(fs.readFileSync(path.resolve(ROOT, timelinePath), 'utf8'));
  const issues = [];
  const audioDurations = {};

  for (const c of raw.cues ?? []) {
    if (!c.file) continue;
    const abs = path.resolve(ROOT, c.file);
    if (!fs.existsSync(abs)) {
      issues.push({ level: 'warn', msg: `cue ${c.id}: audio not found (${c.file}); continuing without it` });
      continue;
    }
    try {
      const d = measureAudio(abs);
      if (d == null) issues.push({ level: 'warn', msg: `cue ${c.id}: can't measure ${c.file} (use .wav or install ffprobe); fit not checked` });
      else audioDurations[c.id] = d;
    } catch (e) {
      issues.push({ level: 'warn', msg: `cue ${c.id}: can't read ${c.file}: ${e.message}` });
    }
  }

  const manifest = readManifest();
  if (isStale(manifest, scanMedia())) {
    issues.push({ level: 'warn', msg: `media folder changed since the last ingest; run \`npm run ingest\` to update ${path.relative(ROOT, MANIFEST_PATH)}` });
  }

  const resolved = resolveTimeline(raw, { audioDurations, media: manifest?.assets ?? {} });
  issues.push(...resolved.issues);
  const { timeline } = resolved;

  const exists = (f) => !!f && fs.existsSync(path.resolve(ROOT, f));
  for (const c of timeline.cues) c.fileExists = exists(c.file);
  if (timeline.music) timeline.music.fileExists = exists(timeline.music.file);

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'timeline.resolved.json'), JSON.stringify(timeline, null, 2));
  return { timeline, issues };
}

/** Prints issues; returns true if any are errors. */
export function printIssues(issues) {
  for (const i of issues) console.log(`  ${i.level === 'error' ? 'ERROR' : 'warn '}  ${i.msg}`);
  return issues.some((i) => i.level === 'error');
}
