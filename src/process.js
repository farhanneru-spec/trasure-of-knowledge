// Media processing with the bundled ffmpeg. Originals in assets/media are never
// modified; a render-ready copy goes to the cache (assets/.processed) when a file
//  - is in a format the renderer can't decode (TIFF/PSD/TGA, HEVC, ProRes, DNxHD...),
//  - is much larger than the frame needs (slow to decode on every frame),
//  - is a video: an all-keyframe proxy makes per-frame seeks fast and exact,
//  - has transparency in a format the browser can't show (ProRes 4444, QuickTime
//    Animation): it becomes VP9 WebM with alpha,
//  - is an animated GIF, which a browser plays on its own clock: it becomes a seekable video.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { ROOT, CONFIG, FFMPEG } from './config.js';
import { processingKey } from './media.js';

export const CACHE_DIR = path.resolve(ROOT, CONFIG.processing.cacheDir);
const BROWSER_IMAGE = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.svg', '.bmp']);
const BROWSER_VIDEO_CODECS = new Set(['h264', 'vp8', 'vp9', 'av1']);
const ALPHA_PIX = /^(yuva|rgba|bgra|argb|abgr|ya8|ya16|gbrap|rgba64|bgra64)/;

const toPosix = (p) => p.split(path.sep).join('/');
const lastLine = (s = '') => s.trim().split(/\r?\n/).pop() ?? '';

/**
 * Whether the first frame actually has transparent pixels. An alpha-capable pixel
 * format proves nothing: GIFs always decode as RGBA and ProRes 4444 is often fully opaque.
 */
function hasTransparency(abs) {
  const r = spawnSync(
    FFMPEG,
    ['-v', 'error', '-i', abs, '-frames:v', '1', '-vf', 'scale=256:-2,alphaextract', '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1'],
    { maxBuffer: 1 << 24 },
  );
  if (r.status !== 0 || !r.stdout?.length) return true; // can't tell: keep the alpha
  return r.stdout.some((b) => b < 250);
}

/** Codec, size, pixel format, alpha, duration and frame rate, read from `ffmpeg -i`. */
export function analyse(abs) {
  const text = spawnSync(FFMPEG, ['-hide_banner', '-i', abs], { encoding: 'utf8' }).stderr ?? '';
  const v = /Stream #\S+.*?: Video: ([\w-]+)(?: \([^)]*\))*, (\w+)(?:\([^)]*\))?, (\d+)x(\d+)/.exec(text);
  if (!v) return { error: /Invalid data|could not find codec|does not contain any stream/i.test(text) ? 'not a readable image or video' : `no picture found (${lastLine(text)})` };
  let width = Number(v[3]);
  let height = Number(v[4]);
  const rot = /rotation of (-?\d+(?:\.\d+)?) degrees/.exec(text);
  if (rot && Math.abs(Math.abs(Number(rot[1])) - 90) < 1) [width, height] = [height, width]; // phone video
  const d = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(text);
  const fps = /, (\d+(?:\.\d+)?) fps/.exec(text);
  return {
    codec: v[1],
    pixFmt: v[2],
    width,
    height,
    duration: d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : null,
    fps: fps ? Number(fps[1]) : null,
    // VP9 WebM flags its alpha explicitly; anything else is checked pixel by pixel
    alpha: /alpha_mode\s*:\s*1/.test(text) || (ALPHA_PIX.test(v[2]) && hasTransparency(abs)),
  };
}

/** What (if anything) has to be done to make the file render-ready. */
export function planFor(f, info) {
  const P = CONFIG.processing;
  const reasons = [];
  const big = (limit) => Math.max(info.width, info.height) > limit;
  const shrink = (limit) => `${info.width}x${info.height} downscaled to ${limit}px long edge`;

  if (f.type === 'image') {
    if (f.ext === '.svg') return null;
    if (f.ext === '.gif' && info.duration > 0) {
      return info.alpha
        ? { type: 'video', ext: '.webm', alpha: true, reasons: ['animated GIF made seekable (VP9 WebM, transparency kept)'] }
        : { type: 'video', ext: '.mp4', alpha: false, reasons: ['animated GIF made seekable (H.264)'] };
    }
    // BMP is large and uncompressed; a resized GIF would lose quality to its 256-colour palette
    const convert = !BROWSER_IMAGE.has(f.ext) || f.ext === '.bmp' || (f.ext === '.gif' && big(P.imageMaxEdge));
    if (convert) reasons.push(`${f.ext.slice(1).toUpperCase()} converted to PNG`);
    if (big(P.imageMaxEdge)) reasons.push(shrink(P.imageMaxEdge));
    if (!reasons.length) return null;
    return { type: 'image', ext: convert ? '.png' : f.ext === '.jpeg' ? '.jpg' : f.ext, reasons };
  }

  const unsupported = !BROWSER_VIDEO_CODECS.has(info.codec);
  const alphaNeedsWebm = info.alpha && !(f.ext === '.webm' && info.codec === 'vp9');
  if (unsupported) reasons.push(`${info.codec} converted to ${info.alpha ? 'VP9' : 'H.264'}`);
  if (info.alpha) reasons.push('transparency kept (VP9 alpha)');
  if (big(P.videoMaxEdge)) reasons.push(shrink(P.videoMaxEdge));
  const needed = unsupported || alphaNeedsWebm || big(P.videoMaxEdge);
  if (!needed && P.videoProxy !== 'always') return null;
  if (P.videoProxy === 'always') reasons.push('all-keyframe proxy for exact, fast seeking');
  return { type: 'video', ext: info.alpha ? '.webm' : '.mp4', alpha: info.alpha, reasons };
}

function ffmpegArgs(f, info, plan, src, out) {
  const P = CONFIG.processing;
  const limit = plan.type === 'image' ? P.imageMaxEdge : P.videoMaxEdge;
  const scale = `scale=w='min(iw,${limit})':h='min(ih,${limit})':force_original_aspect_ratio=decrease:flags=lanczos`;
  const base = ['-y', '-hide_banner', '-v', 'error'];

  if (plan.type === 'image') {
    const codec = { '.png': ['-c:v', 'png'], '.jpg': ['-c:v', 'mjpeg', '-q:v', '2'], '.webp': ['-c:v', 'libwebp', '-quality', '92'] }[plan.ext];
    if (!codec) return null; // e.g. an oversized AVIF: used as-is
    return [...base, '-i', src, '-vf', scale, '-frames:v', '1', ...codec, '-map_metadata', '-1', out];
  }

  // VP9 WebM with alpha must be decoded by libvpx: ffmpeg's built-in VP9 decoder drops the alpha plane
  const input = info.codec === 'vp9' && info.alpha ? ['-c:v', 'libvpx-vp9'] : [];
  const g = String(P.proxyKeyframeInterval);
  const common = ['-map', '0:v:0', '-an', '-sn', '-dn', '-map_metadata', '-1', '-g', g, '-keyint_min', g];
  if (plan.alpha) {
    return [...base, ...input, '-i', src, ...common,
      '-vf', `${scale}:force_divisible_by=2,format=yuva420p`,
      '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-crf', String(P.proxyCrf + 8), '-b:v', '0',
      '-auto-alt-ref', '0', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '4', out];
  }
  return [...base, ...input, '-i', src, ...common,
    '-vf', `${scale}:force_divisible_by=2,format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', String(P.proxyCrf), '-bf', '0', '-sc_threshold', '0',
    '-movflags', '+faststart', out];
}

/**
 * Makes (or reuses from the cache) the render-ready copy. Returns null when the
 * original is fine as-is, { error } on failure, else { file, type, reasons, cached }.
 */
export function processAsset(f, info, { force = false, onStart = () => {} } = {}) {
  const plan = planFor(f, info);
  if (!plan) return null;
  const hash = crypto
    .createHash('sha1')
    .update([f.file, f.size, f.mtimeMs, processingKey(), plan.ext].join('|'))
    .digest('hex')
    .slice(0, 10);
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const out = path.join(CACHE_DIR, `${f.id.replace(/\//g, '__')}-${hash}${plan.ext}`);
  const result = { file: toPosix(path.relative(ROOT, out)), type: plan.type, reasons: plan.reasons };
  if (!force && fs.existsSync(out) && fs.statSync(out).size > 0) return { ...result, cached: true };

  const tmp = `${out}.tmp${plan.ext}`;
  const args = ffmpegArgs(f, info, plan, path.resolve(ROOT, f.file), tmp);
  if (!args) return null;
  onStart(plan.reasons);
  const r = spawnSync(FFMPEG, args, { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.status !== 0 || !fs.existsSync(tmp)) {
    fs.rmSync(tmp, { force: true });
    return { error: `ffmpeg could not process it: ${lastLine(r.stderr) || `exit ${r.status}`}` };
  }
  fs.renameSync(tmp, out);
  return { ...result, cached: false };
}

/** Deletes cached copies no manifest entry uses any more. Returns how many were removed. */
export function cleanCache(keep) {
  if (!fs.existsSync(CACHE_DIR)) return 0;
  let removed = 0;
  for (const name of fs.readdirSync(CACHE_DIR)) {
    const rel = toPosix(path.relative(ROOT, path.join(CACHE_DIR, name)));
    if (keep.has(rel)) continue;
    fs.rmSync(path.join(CACHE_DIR, name), { force: true, recursive: true });
    removed++;
  }
  return removed;
}
