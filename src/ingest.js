// Registers everything in assets/media into the manifest. Each new or changed file is
//   1. analysed and, where needed, converted/scaled by the bundled ffmpeg (process.js),
//   2. opened in the bundled headless browser, which measures it and proves the renderer can decode it.
// No network and no tools outside the project folder.
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';
import { ROOT, findLocalBrowser, processingEnabled } from './project.js';
import { MANIFEST_PATH, MEDIA_DIR, scanMedia, readManifest, isStale, bySource, processingKey } from './media.js';
import { analyse, processAsset, cleanCache } from './process.js';
import { startServer } from './server.js';

async function probe(items) {
  const executablePath = findLocalBrowser();
  if (!executablePath) throw new Error('no local browser for probing media; run `npm run doctor`');
  const server = await startServer(ROOT);
  const browser = await puppeteer.launch({ headless: 'shell', executablePath });
  try {
    const page = await browser.newPage();
    await page.goto(`${server.url}/pipeline.config.json`); // any same-origin page
    return await page.evaluate(async (items) => {
      const load = (it) =>
        new Promise((resolve) => {
          const url = '/' + it.file.split('/').map(encodeURIComponent).join('/');
          const timer = setTimeout(() => resolve({ error: 'timed out while loading' }), 30000);
          const done = (r) => {
            clearTimeout(timer);
            resolve(r);
          };
          if (it.type === 'image') {
            const img = new Image();
            img.onload = () =>
              img.decode().then(
                () => done({ width: img.naturalWidth, height: img.naturalHeight }),
                () => done({ error: 'image could not be decoded' }),
              );
            img.onerror = () => done({ error: 'not a decodable image' });
            img.src = url;
            return;
          }
          const v = document.createElement('video');
          v.muted = true;
          v.preload = 'auto';
          const report = () => done({ width: v.videoWidth, height: v.videoHeight, duration: v.duration });
          v.onerror = () =>
            done({ error: `the renderer can't decode this video (${v.error?.message || 'unsupported codec'}); convert it to MP4 (H.264) or WebM (VP9)` });
          v.onloadeddata = () => {
            if (Number.isFinite(v.duration)) return report();
            // files without a duration header (e.g. browser-recorded WebM): seek past the end to find it
            v.addEventListener('seeked', report, { once: true });
            v.currentTime = 1e9;
          };
          v.src = url;
        });
      const out = [];
      for (const it of items) out.push(await load(it));
      return out;
    }, items.map(({ file, type }) => ({ file, type })));
  } finally {
    await browser.close();
    server.close();
  }
}

const NEEDS_FFMPEG = new Set(['.tif', '.tiff', '.tga', '.psd', '.mkv', '.avi', '.mxf']);

/**
 * Brings assets/media.manifest.json up to date. Unchanged files keep their previous
 * result; only new or modified ones are processed and probed. `force` redoes all.
 * `log` receives progress lines (conversions can take a while for long videos).
 */
export async function ingest({ force = false, log = () => {} } = {}) {
  const scan = scanMedia();
  const old = readManifest();
  const none = { added: [], updated: [], removed: [], failed: [], processed: [] };
  if (!force && old && !isStale(old, scan)) return { manifest: old, changed: false, scan, ...none };

  const key = processingKey();
  const redoAll = force || old?.processingKey !== key;
  const before = bySource(old);
  const todo = scan.files.filter((f) => {
    const a = before.get(f.file);
    return redoAll || !a || a.size !== f.size || a.mtimeMs !== f.mtimeMs;
  });

  // 1. analyse + convert/scale with ffmpeg
  const processing = processingEnabled();
  const prepared = new Map();
  const processed = [];
  for (const f of todo) {
    const p = { file: f.file, type: f.type, alpha: false, source: null, processed: null, error: null };
    prepared.set(f.file, p);
    if (f.ext === '.heic' || f.ext === '.heif') {
      p.error = 'HEIC/HEIF photos are not supported; export them as JPEG or PNG';
      continue;
    }
    if (!processing) {
      if (NEEDS_FFMPEG.has(f.ext)) p.error = `${f.ext} files need ffmpeg to convert (put ffmpeg.exe in tools/ffmpeg/)`;
      continue;
    }
    const info = analyse(path.resolve(ROOT, f.file));
    if (info.error) {
      p.error = info.error;
      continue;
    }
    p.alpha = info.alpha;
    p.source = { codec: info.codec, width: info.width, height: info.height, fps: info.fps, pixFmt: info.pixFmt };
    const r = processAsset(f, info, { force, onStart: (reasons) => log(`  processing ${f.id}: ${reasons.join('; ')}`) });
    if (r?.error) p.error = r.error;
    else if (r) {
      Object.assign(p, { file: r.file, type: r.type, processed: { reasons: r.reasons } });
      processed.push({ id: f.id, reasons: r.reasons, cached: r.cached });
    }
  }

  // 2. decode check in the renderer's own browser, on the file it will actually load
  const toProbe = todo.filter((f) => !prepared.get(f.file).error);
  const results = toProbe.length ? await probe(toProbe.map((f) => prepared.get(f.file))) : [];
  toProbe.forEach((f, i) => Object.assign(prepared.get(f.file), { probe: results[i], error: results[i].error ?? null }));

  // 3. manifest
  const assets = {};
  const added = [];
  const updated = [];
  const failed = [];
  for (const f of scan.files) {
    const prev = before.get(f.file);
    const p = prepared.get(f.file);
    let entry;
    if (!p) entry = { ...prev, group: f.group, role: f.role };
    else {
      (prev ? updated : added).push(f.id);
      entry = {
        source: f.file,
        file: p.file,
        type: p.type,
        role: f.role,
        group: f.group,
        size: f.size,
        mtimeMs: f.mtimeMs,
        width: p.probe?.width ?? null,
        height: p.probe?.height ?? null,
        duration: p.type === 'video' ? (p.probe?.duration ?? null) : null,
        alpha: p.alpha,
        original: p.source,
        processed: p.processed,
        ...(p.error && { error: p.error }),
      };
    }
    assets[f.id] = entry;
    if (entry.error) failed.push({ id: f.id, error: entry.error });
  }
  const removed = [...before.keys()].filter((file) => !scan.files.some((f) => f.file === file));
  const removedCache = cleanCache(new Set(Object.values(assets).filter((a) => a.processed).map((a) => a.file)));

  const manifest = {
    version: 2,
    processingKey: key,
    mediaDir: path.relative(ROOT, MEDIA_DIR).split(path.sep).join('/'),
    assets,
  };
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
  return { manifest, changed: true, scan, added, updated, removed, failed, processed, removedCache };
}

/** Quietly re-ingests if the media folder changed; used by render/preview/validate. */
export async function ensureIngested() {
  const r = await ingest({ log: console.log });
  if (r.changed) {
    const parts = [
      r.added.length && `${r.added.length} added`,
      r.updated.length && `${r.updated.length} updated`,
      r.removed.length && `${r.removed.length} removed`,
    ].filter(Boolean);
    console.log(`media: re-ingested (${parts.join(', ') || 'no changes'})`);
    for (const f of r.failed) console.log(`  ERROR  ${f.id}: ${f.error}`);
  }
  return r;
}

/** Calls onChange (debounced, never overlapping) whenever any of the paths change. */
export function watchPaths(paths, onChange) {
  let timer = null;
  let running = false;
  let again = false;
  const run = async () => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      await onChange();
    } catch (e) {
      console.error(e.message);
    } finally {
      running = false;
      if (again) {
        again = false;
        run();
      }
    }
  };
  for (const p of paths) {
    fs.mkdirSync(p, { recursive: true });
    fs.watch(p, { recursive: true }, () => {
      clearTimeout(timer);
      timer = setTimeout(run, 700); // let copies of large files settle
    });
  }
}
