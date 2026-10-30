import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = JSON.parse(fs.readFileSync(path.join(ROOT, 'pipeline.config.json'), 'utf8'));
export const CONFIG = {
  mediaDir: 'assets/media',
  mediaManifest: 'assets/media.manifest.json',
  episodes: 'timeline/episode-{nn}.json',
  themesDir: 'themes',
  defaultTheme: 'starlit',
  ...file,
  processing: {
    enabled: true,
    cacheDir: 'assets/.processed',
    imageMaxEdge: 3840,
    videoMaxEdge: 1920,
    videoProxy: 'always',
    proxyKeyframeInterval: 1,
    proxyCrf: 18,
    ...file.processing,
  },
};

// Tools resolve project-local first (tools/), then an env override, then PATH.
const local = (rel) => {
  const p = path.resolve(ROOT, rel);
  return fs.existsSync(p) ? p : null;
};
export const FFMPEG = process.env.FFMPEG ?? local(CONFIG.ffmpeg) ?? 'ffmpeg';
export const FFPROBE = process.env.FFPROBE ?? local(CONFIG.ffprobe) ?? 'ffprobe';
export const hasTool = (cmd) => !spawnSync(cmd, ['-version'], { stdio: 'ignore' }).error;

let processingOn;
/** Media processing runs when enabled in the config and ffmpeg is available (checked once). */
export const processingEnabled = () => (processingOn ??= CONFIG.processing.enabled && hasTool(FFMPEG));
