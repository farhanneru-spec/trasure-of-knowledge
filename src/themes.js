// Themes (themes/<name>.json): the look of a render: background palette, centre motif,
// title/caption styling, ambient particles, vignette, plus default caption/media/overlay
// settings. Precedence: built-in defaults < theme < timeline.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, CONFIG } from './config.js';

export const THEMES_DIR = path.resolve(ROOT, CONFIG.themesDir);
export const MOTIFS = ['star8', 'arch', 'none'];

// sizes are px at 1080p; the scene scales them to the actual frame height
const BASE = {
  backgrounds: ['radial-gradient(ellipse at 50% 40%, #1b2440 0%, #0a0d18 70%)'],
  motif: { type: 'star8', color: '#d9b26a', opacity: 0.5, pulse: 0.08, rotateDegPer8Bars: 45, size: 380, y: 40 },
  title: { font: 'Cormorant Garamond', weight: 600, color: '#f3ead8', size: 84, letterSpacing: '0.04em', y: 62 },
  caption: { color: '#ffffff', size: 64, shadow: '0 2px 14px rgba(0, 0, 0, 0.65)', plate: null },
  particles: null,
  vignette: 0,
};
const PARTICLES = { count: 30, color: '#ffffff', minSize: 2, maxSize: 6, rise: 20, sway: 12, opacity: 0.5, seed: 1 };
const PLATE = { color: 'rgba(0, 0, 0, 0.4)', radius: 16, padX: 28, padY: 4 };

export const listThemes = () =>
  fs.existsSync(THEMES_DIR)
    ? fs.readdirSync(THEMES_DIR).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort()
    : [];

/** Loads and fills in a theme. Returns { theme, issues }; an unknown theme falls back to the defaults with an error. */
export function loadTheme(name) {
  const issues = [];
  const file = path.join(THEMES_DIR, `${name}.json`);
  let t = {};
  if (!fs.existsSync(file)) issues.push({ level: 'error', msg: `no theme "${name}" (themes: ${listThemes().join(', ') || 'none'})` });
  else {
    try {
      t = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      issues.push({ level: 'error', msg: `theme ${name}: ${path.relative(ROOT, file)} is not valid JSON (${e.message})` });
    }
  }

  const theme = {
    name,
    description: t.description ?? '',
    backgrounds: Array.isArray(t.backgrounds) && t.backgrounds.length ? t.backgrounds : BASE.backgrounds,
    motif: { ...BASE.motif, ...t.motif },
    title: { ...BASE.title, ...t.title },
    caption: { ...BASE.caption, ...t.caption, plate: t.caption?.plate ? { ...PLATE, ...t.caption.plate } : null },
    particles: t.particles ? { ...PARTICLES, ...t.particles } : null,
    vignette: t.vignette ?? BASE.vignette,
    captionDefaults: t.captionDefaults ?? {},
    mediaDefaults: t.mediaDefaults ?? {},
    overlayDefaults: t.overlayDefaults ?? {},
  };
  if (!MOTIFS.includes(theme.motif.type)) {
    issues.push({ level: 'error', msg: `theme ${name}: motif.type must be ${MOTIFS.join(', ')} (got "${theme.motif.type}")` });
    theme.motif.type = 'none';
  }
  if (!(theme.vignette >= 0 && theme.vignette <= 1)) issues.push({ level: 'warn', msg: `theme ${name}: vignette should be 0–1` });
  return { theme, issues };
}
