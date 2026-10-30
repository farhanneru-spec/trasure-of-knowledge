// Checks that everything the pipeline needs lives inside the project folder.
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';
import { MEDIA_DIR, scanMedia, readManifest, isStale } from '../src/media.js';
import { loadProject, listEpisodes, hasTool, findLocalBrowser, processingEnabled, CONFIG, FFMPEG, ROOT } from '../src/project.js';
import { listThemes } from '../src/themes.js';

const rows = [];
const report = (level, what, detail) => rows.push({ level, what, detail });
const rel = (p) => path.relative(ROOT, p);

// Node + packages
const nodeMajor = Number(process.versions.node.split('.')[0]);
report(nodeMajor >= 20 ? 'ok' : 'fail', 'Node.js', `v${process.versions.node}${nodeMajor >= 20 ? '' : ' (need 20+)'}`);
const pkgDir = path.join(ROOT, 'node_modules', 'puppeteer');
report(fs.existsSync(pkgDir) ? 'ok' : 'fail', 'puppeteer package', fs.existsSync(pkgDir) ? rel(pkgDir) : 'missing: run npm install');

// Browser: project-local and actually launchable
const exe = findLocalBrowser();
if (!exe) report('fail', 'browser', `nothing in ${CONFIG.browserDir}: run \`npx puppeteer browsers install chrome-headless-shell\``);
else {
  try {
    const browser = await puppeteer.launch({ headless: 'shell', executablePath: exe });
    report('ok', 'browser', `${await browser.version()} (${rel(exe)})`);
    const page = await browser.newPage();
    const codecs = await page.evaluate(() => {
      const v = document.createElement('video');
      const probe = {
        'MP4/H.264': 'video/mp4; codecs="avc1.42E01E"',
        'WebM/VP9': 'video/webm; codecs="vp9"',
        'WebM/AV1': 'video/webm; codecs="av01.0.05M.08"',
        'MP4/HEVC': 'video/mp4; codecs="hvc1.1.6.L93.B0"',
      };
      return Object.entries(probe).map(([name, type]) => [name, v.canPlayType(type) !== '']);
    });
    const yes = codecs.filter(([, ok]) => ok).map(([n]) => n);
    const no = codecs.filter(([, ok]) => !ok).map(([n]) => n);
    report(yes.includes('MP4/H.264') || yes.includes('WebM/VP9') ? 'ok' : 'warn', 'video codecs', `${yes.join(', ')}${no.length ? ` (not: ${no.join(', ')})` : ''}`);
    await browser.close();
  } catch (e) {
    report('fail', 'browser', `${rel(exe)} failed to launch: ${e.message}`);
  }
}

// Fonts referenced by the scene must exist locally
const css = fs.readFileSync(path.join(ROOT, 'scene', 'scene.css'), 'utf8');
for (const [, url] of css.matchAll(/url\(['"]?([^'")]+)['"]?\)/g)) {
  const file = path.resolve(ROOT, 'scene', decodeURIComponent(url));
  report(fs.existsSync(file) ? 'ok' : 'fail', 'font', fs.existsSync(file) ? rel(file) : `missing ${rel(file)}`);
}

// No external URLs anywhere in the scene
const external = [];
for (const name of fs.readdirSync(path.join(ROOT, 'scene'))) {
  const text = fs.readFileSync(path.join(ROOT, 'scene', name), 'utf8');
  for (const [m] of text.matchAll(/https?:\/\/(?!127\.0\.0\.1|localhost)[^\s'")`]+/g)) external.push(`${name}: ${m}`);
}
report(external.length ? 'fail' : 'ok', 'scene is offline', external.length ? external.join(', ') : 'no external URLs');
report(CONFIG.offline ? 'ok' : 'warn', 'render network guard', CONFIG.offline ? 'on (non-local requests are blocked)' : 'off (pipeline.config.json "offline": false)');

// ffmpeg is optional (frames render without it) but should be project-local
if (!hasTool(FFMPEG)) report('warn', 'ffmpeg', `not found; frames render, MP4 encoding is skipped. Place ffmpeg.exe at ${CONFIG.ffmpeg}`);
else if (path.isAbsolute(FFMPEG) && FFMPEG.startsWith(ROOT)) report('ok', 'ffmpeg', rel(FFMPEG));
else report('warn', 'ffmpeg', `using ${FFMPEG} from outside the project; copy it to ${CONFIG.ffmpeg} to be self-contained`);

// Media manifest
const scan = scanMedia();
const manifest = readManifest();
const broken = Object.entries(manifest?.assets ?? {}).filter(([, a]) => a.error);
if (isStale(manifest, scan)) report('warn', 'media', `${scan.files.length} file(s) in ${rel(MEDIA_DIR)}, manifest out of date: run npm run ingest`);
else report(broken.length ? 'warn' : 'ok', 'media', `${scan.files.length} asset(s) ingested${broken.length ? `; undecodable: ${broken.map(([id]) => id).join(', ')}` : ''}`);

const P = CONFIG.processing;
if (!P.enabled) report('warn', 'media processing', 'off ("processing.enabled": false); files are used as-is');
else if (!processingEnabled()) report('warn', 'media processing', 'off: needs ffmpeg (TIFF/PSD/HEVC/ProRes files will be rejected)');
else {
  const processed = Object.values(manifest?.assets ?? {}).filter((a) => a.processed).length;
  const cacheDir = path.resolve(ROOT, P.cacheDir);
  const bytes = fs.existsSync(cacheDir) ? fs.readdirSync(cacheDir).reduce((n, f) => n + fs.statSync(path.join(cacheDir, f)).size, 0) : 0;
  report('ok', 'media processing', `on (images ≤${P.imageMaxEdge}px, video ≤${P.videoMaxEdge}px, proxies: ${P.videoProxy}); ${processed} processed, cache ${(bytes / 1048576).toFixed(1)} MB`);
}

// Episodes and themes
const episodes = listEpisodes();
report(episodes.length ? 'ok' : 'warn', 'episodes', episodes.length ? episodes.map((n) => `${n}`).join(', ') : `none matching ${CONFIG.episodes}`);
const themes = listThemes();
report(themes.includes(CONFIG.defaultTheme) ? 'ok' : 'fail', 'themes', `${themes.join(', ')} (default: ${CONFIG.defaultTheme})`);

// Timeline
const { issues } = loadProject();
const errors = issues.filter((i) => i.level === 'error');
const warnings = issues.length - errors.length;
report(errors.length ? 'fail' : 'ok', 'timeline', errors.length ? errors.map((e) => e.msg).join('; ') : `valid${warnings ? ` (${warnings} warning(s), see npm run validate)` : ''}`);

const tag = { ok: ' OK ', warn: 'WARN', fail: 'FAIL' };
for (const r of rows) console.log(`  ${tag[r.level]}  ${r.what.padEnd(20)} ${r.detail}`);
const failed = rows.some((r) => r.level === 'fail');
console.log(failed ? '\nSome required checks failed.' : '\nAll required checks passed.');
process.exitCode = failed ? 1 : 0;
