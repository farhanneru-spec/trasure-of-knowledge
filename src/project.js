import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, CONFIG, FFMPEG, FFPROBE, hasTool, processingEnabled } from './config.js';
import { readManifest, scanMedia, isStale, MANIFEST_PATH } from './media.js';
import { loadTheme } from './themes.js';
import { resolveTimeline } from './timeline.js';
import { readWavDuration } from './wav.js';

export { ROOT, CONFIG, FFMPEG, FFPROBE, hasTool, processingEnabled };
export const OUT = path.resolve(ROOT, CONFIG.outDir);
export const DEFAULT_TIMELINE = CONFIG.timeline;

const toPosix = (p) => p.split(path.sep).join('/');

/** Episode numbers that have a timeline file, from the "episodes" pattern in pipeline.config.json. */
export function listEpisodes() {
  const pattern = path.resolve(ROOT, CONFIG.episodes);
  const dir = path.dirname(pattern);
  const re = new RegExp(`^${path.basename(pattern).replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\\?\{nn?\\?\}/, '(\\d+)')}$`);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).map((f) => re.exec(f)?.[1]).filter(Boolean).map(Number).sort((a, b) => a - b);
}

/**
 * What to work on: a timeline (by --episode N, --timeline FILE, or the default) and an
 * optional theme override. Each job writes to its own out/<name>/ folder, so episodes and
 * theme variants never overwrite each other.
 */
export function resolveJob({ episode, theme, timeline } = {}) {
  let file = timeline ?? process.env.TIMELINE;
  if (episode != null) {
    const n = Number(episode);
    if (!Number.isInteger(n) || n < 1) throw new Error(`--episode must be a whole number from 1 (got "${episode}")`);
    file = CONFIG.episodes.replace('{nn}', String(n).padStart(2, '0')).replace('{n}', String(n));
    if (!fs.existsSync(path.resolve(ROOT, file))) {
      const have = listEpisodes();
      throw new Error(`episode ${n}: ${file} doesn't exist (episodes: ${have.join(', ') || 'none'})`);
    }
  }
  file ??= DEFAULT_TIMELINE;
  if (!fs.existsSync(path.resolve(ROOT, file))) throw new Error(`timeline ${file} doesn't exist`);
  const base = path.basename(file, '.json');
  const name = theme ? `${base}-${theme}` : base;
  return { file, theme: theme ?? null, name, dir: path.join(OUT, name) };
}

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

/**
 * Load + resolve a job's timeline with its theme, measuring VO audio, and write
 * out/<job>/timeline.resolved.json for the scene (its URL is returned as dataUrl).
 */
export function loadProject(job = resolveJob()) {
  if (typeof job === 'string') job = resolveJob({ timeline: job });
  const raw = JSON.parse(fs.readFileSync(path.resolve(ROOT, job.file), 'utf8'));
  const issues = [];
  const audioDurations = {};
  const themeName = job.theme ?? raw.theme ?? CONFIG.defaultTheme;
  const { theme, issues: themeIssues } = loadTheme(themeName);
  issues.push(...themeIssues);

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

  const resolved = resolveTimeline(raw, { audioDurations, media: manifest?.assets ?? {}, theme });
  issues.push(...resolved.issues);
  const { timeline } = resolved;
  timeline.job = job.name;

  const exists = (f) => !!f && fs.existsSync(path.resolve(ROOT, f));
  for (const c of timeline.cues) c.fileExists = exists(c.file);
  if (timeline.music) timeline.music.fileExists = exists(timeline.music.file);

  fs.mkdirSync(job.dir, { recursive: true });
  const dataFile = path.join(job.dir, 'timeline.resolved.json');
  fs.writeFileSync(dataFile, JSON.stringify(timeline, null, 2));
  return { timeline, issues, job, dataUrl: `/${toPosix(path.relative(ROOT, dataFile))}` };
}

/** Prints issues; returns true if any are errors. */
export function printIssues(issues) {
  for (const i of issues) console.log(`  ${i.level === 'error' ? 'ERROR' : 'warn '}  ${i.msg}`);
  return issues.some((i) => i.level === 'error');
}
