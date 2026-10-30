// Scanning assets/media and reading the ingest manifest. Pure filesystem work:
// analysis/conversion is in process.js, decode checks in ingest.js.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ROOT, CONFIG, processingEnabled } from './config.js';

export const MEDIA_DIR = path.resolve(ROOT, CONFIG.mediaDir);
export const MANIFEST_PATH = path.resolve(ROOT, CONFIG.mediaManifest);

// type = what it becomes on the timeline; formats the renderer can't read are converted by process.js
export const MEDIA_TYPES = {
  '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.webp': 'image', '.gif': 'image',
  '.avif': 'image', '.svg': 'image', '.bmp': 'image',
  '.tif': 'image', '.tiff': 'image', '.tga': 'image', '.psd': 'image',
  '.heic': 'image', '.heif': 'image',
  '.mp4': 'video', '.m4v': 'video', '.webm': 'video', '.mov': 'video',
  '.mkv': 'video', '.avi': 'video', '.mxf': 'video',
};
const IGNORE = /^(\.|readme\.md$|thumbs\.db$|desktop\.ini$)/i;
export const OVERLAY_DIR = 'overlay';

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const toPosix = (p) => p.split(path.sep).join('/');

/** Changes whenever processing settings (or ffmpeg availability) change, so every asset is redone. */
export const processingKey = () =>
  crypto
    .createHash('sha1')
    .update(JSON.stringify({ ...CONFIG.processing, active: processingEnabled() }))
    .digest('hex')
    .slice(0, 10);

/**
 * Every media file under assets/media. The id is the path without extension,
 * slugged per folder ("Within/Old Lamp.JPG" -> "within/old-lamp").
 *   <scene>/file          main media, auto-placed across that scene
 *   <scene>/overlay/file  overlay across that scene
 *   overlay/file          overlay across the whole timeline
 */
export function scanMedia() {
  const files = [];
  const skipped = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (IGNORE.test(ent.name)) continue;
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(abs);
        continue;
      }
      const rel = toPosix(path.relative(MEDIA_DIR, abs));
      const ext = path.extname(ent.name).toLowerCase();
      const type = MEDIA_TYPES[ext];
      if (!type) {
        skipped.push(rel);
        continue;
      }
      const parts = rel.replace(/\.[^./]+$/, '').split('/').map(slug);
      const folders = parts.slice(0, -1);
      let group = folders[0] ?? null;
      let role = 'main';
      if (group === OVERLAY_DIR) {
        group = null;
        role = 'overlay';
      } else if (folders[1] === OVERLAY_DIR) role = 'overlay';
      const st = fs.statSync(abs);
      files.push({
        id: parts.join('/'),
        rel,
        file: toPosix(path.relative(ROOT, abs)),
        ext,
        type,
        group,
        role,
        size: st.size,
        mtimeMs: Math.round(st.mtimeMs),
      });
    }
  };
  if (fs.existsSync(MEDIA_DIR)) walk(MEDIA_DIR);

  // same name, different extension (photo.jpg + photo.png): later ones get the extension appended
  files.sort((a, b) => a.rel.localeCompare(b.rel));
  const seen = new Set();
  for (const f of files) {
    if (seen.has(f.id)) f.id = `${f.id}-${f.ext.slice(1)}`;
    seen.add(f.id);
  }
  return { files, skipped };
}

export function readManifest() {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  } catch {
    return null;
  }
}

/** Manifest entries keyed by their original file under assets/media. */
export const bySource = (manifest) =>
  new Map(Object.values(manifest?.assets ?? {}).map((a) => [a.source ?? a.file, a]));

/** True when files were added, removed or changed, or processing settings changed, since the last ingest. */
export function isStale(manifest, scan) {
  if (!manifest || manifest.processingKey !== processingKey()) {
    return scan.files.length > 0 || Object.keys(manifest?.assets ?? {}).length > 0;
  }
  const known = bySource(manifest);
  if (known.size !== scan.files.length) return true;
  return scan.files.some((f) => {
    const a = known.get(f.file);
    return !a || a.size !== f.size || a.mtimeMs !== f.mtimeMs;
  });
}
