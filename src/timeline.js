import { createClock } from './beat.js';
import { LANGUAGES, langInfo } from './languages.js';

const EPS = 1e-6;

// Where a cue's voice-over lives for a language. A cue's own "file" wins: a string (shared, or a
// pattern with {lang}/{id}) or an object per language; otherwise the timeline's vo.files pattern.
export const VO_PATTERN = 'assets/vo/{lang}/{id}.wav';
export function voFile(raw, cue, lang) {
  const fill = (p) => p.replaceAll('{lang}', lang).replaceAll('{id}', cue.id);
  if (cue.file && typeof cue.file === 'object') return cue.file[lang] ?? null;
  if (typeof cue.file === 'string') return fill(cue.file);
  return fill(raw.vo?.files ?? VO_PATTERN);
}

export const CAPTION_DEFAULTS = {
  reveal: 'word', // 'word' = words appear one by one, 'line' = whole caption at once
  stepBeats: 0.5, // gap between word entrances (0.5 = eighth notes at 120 BPM = 0.25s)
  wordInBeats: 0.5, // duration of each word's entrance animation
  offsetBeats: 0, // shift caption start relative to its VO cue
  holdBeats: 1, // keep caption on screen after the VO cue ends
  fadeBeats: 0.5, // fade-out length at the end
  maxCharsPerLine: 42, // line wrapping for the SRT/VTT exports
};

export const MEDIA_DEFAULTS = {
  fit: 'cover', // cover | contain | fill
  layer: 'back', // back = behind the star motif, front = above it (captions always stay on top)
  opacity: 1,
  fadeBeats: 0.5, // fade in and out; override each with fadeInBeats / fadeOutBeats
  fadeInBeats: null,
  fadeOutBeats: null,
  zoom: null, // [from, to]; default [1, 1.06] for images (slow push-in), [1, 1] for video
  pan: [[0, 0], [0, 0]], // [[x, y] from, [x, y] to], in % of the frame
  loop: false, // video: loop when the slot is longer than the clip
  trimSec: 0, // video: start this many seconds into the clip
  blend: 'normal', // how it mixes with what's beneath: normal | screen | add | multiply | overlay | ...
  box: [0, 0, 100, 100], // [x, y, width, height] in % of the frame; the asset is fitted inside it
};

// overlays (assets/media/overlay/, assets/media/<scene>/overlay/) start from these
export const OVERLAY_DEFAULTS = { blend: 'screen', opacity: 0.8, fadeBeats: 1 };

const BLEND_MODES = {
  normal: 'normal', screen: 'screen', add: 'plus-lighter', multiply: 'multiply', overlay: 'overlay',
  lighten: 'lighten', darken: 'darken', 'soft-light': 'soft-light', 'hard-light': 'hard-light',
  'color-dodge': 'color-dodge', difference: 'difference',
};

const captionOpts = (o = {}) =>
  Object.fromEntries(Object.entries(o).filter(([k]) => k in CAPTION_DEFAULTS));
const mediaOpts = (o = {}) =>
  Object.fromEntries(Object.entries(o).filter(([k, v]) => k in MEDIA_DEFAULTS && v != null));
const byStart = (a, b) => a.startBeat - b.startBeat;

/**
 * Turn the authored timeline (positions in bars/beats) into absolute beats and
 * seconds, and collect sync problems. Pure: audio durations are passed in.
 */
export function resolveTimeline(raw, { audioDurations = {}, media: assets = {}, theme = null, lang = null } = {}) {
  const issues = [];
  const error = (msg) => issues.push({ level: 'error', msg });
  const warn = (msg) => issues.push({ level: 'warn', msg });

  const clock = createClock({ bpm: raw.bpm, beatsPerBar: raw.beatsPerBar });
  const grid = raw.vo?.grid ?? 1;
  // defaults: built-in < theme < timeline
  const capDefaults = { ...CAPTION_DEFAULTS, ...captionOpts(theme?.captionDefaults), ...captionOpts(raw.captionDefaults) };

  const position = (item, label) => {
    try {
      return clock.parse(item.at ?? 0);
    } catch (e) {
      error(`${label}: ${e.message}`);
      return 0;
    }
  };
  const length = (item) => item.beats ?? (item.bars != null ? item.bars * clock.beatsPerBar : undefined);

  // caption languages: the timeline lists them; `lang` picks the one burned into this render
  const languages = (raw.languages ?? ['ar']).filter((code) => {
    if (code in LANGUAGES) return true;
    error(`languages: "${code}" isn't supported (supported: ${Object.keys(LANGUAGES).join(', ')})`);
    return false;
  });
  if (!languages.length) languages.push('ar');
  lang ??= languages[0];
  if (!languages.includes(lang)) {
    error(`language "${lang}" isn't in this timeline's "languages" (${languages.join(', ')})`);
    lang = languages[0];
  }

  // VO cues, locked to the beat grid (the take is this language's; `en` is the source script)
  const cues = (raw.cues ?? [])
    .map((c) => {
      const label = `cue ${c.id}`;
      const startBeat = position(c, label);
      const audioSec = audioDurations[c.id] ?? null;
      let beats = length(c);
      if (beats == null) {
        if (audioSec != null) beats = Math.ceil(audioSec / clock.beatSec / grid - EPS) * grid;
        else {
          error(`${label}: needs "beats"/"bars", or a measurable audio file to size it from`);
          beats = grid;
        }
      }
      if (!clock.isOnGrid(startBeat, grid)) {
        warn(`${label}: starts at ${clock.label(startBeat)}, off the ${grid}-beat VO grid (nearest ${clock.label(clock.snap(startBeat, grid))})`);
      }
      if (audioSec != null && audioSec > clock.toSec(beats) + EPS) {
        const need = Math.ceil(audioSec / clock.beatSec / grid - EPS) * grid;
        warn(`${label}: audio is ${audioSec.toFixed(2)}s but its slot is ${beats} beats (${clock.toSec(beats).toFixed(2)}s); it needs ${need} beats`);
      }
      return {
        id: c.id,
        en: c.en ?? '',
        text: Object.fromEntries(languages.map((code) => [code, (c[code] ?? '').trim()])),
        file: voFile(raw, c, lang), // this language's voice-over take
        startBeat,
        endBeat: startBeat + beats,
        beats,
        audioSec,
        caption: captionOpts(c.caption),
      };
    })
    .sort(byStart);

  for (let i = 1; i < cues.length; i++) {
    const prev = cues[i - 1];
    const cur = cues[i];
    if (cur.startBeat < prev.endBeat - EPS) {
      warn(`cue ${cur.id} starts at ${clock.label(cur.startBeat)} before cue ${prev.id} ends (${clock.label(prev.endBeat)}): VO lines overlap`);
    }
  }

  // Captions: one track per language. Each VO cue gives a caption with its timing, plus
  // standalone ones (title cards). A video burns in one track; all are exported as subtitles.
  function makeCaption(id, text, startBeat, endBeat, o, label, code) {
    const L = LANGUAGES[code];
    if (!L.script.test(text)) warn(`${label}: ${L.name} caption has no ${L.name} script characters`);
    const lint = L.lint?.(text);
    if (lint) warn(`${label}: ${L.name} caption ${lint}`);
    const start = startBeat + o.offsetBeats;
    const end = endBeat + o.holdBeats;
    const step = o.reveal === 'word' ? o.stepBeats : 0;
    const words = text.split(/\s+/).map((w, i) => ({ text: w, inBeat: start + i * step }));
    if (words.at(-1).inBeat + o.wordInBeats > end - o.fadeBeats + EPS) {
      warn(`${label}: word reveal (${words.length} words, one every ${step} beat) isn't finished before the caption fades; lower stepBeats or lengthen it`);
    }
    return {
      id,
      text,
      startBeat: start,
      endBeat: end,
      minEndBeat: endBeat,
      fadeBeats: o.fadeBeats,
      wordInBeats: o.wordInBeats,
      maxCharsPerLine: o.maxCharsPerLine,
      words,
    };
  }

  function buildTrack(code) {
    const L = LANGUAGES[code];
    const track = [];
    for (const c of cues) {
      if (!c.text[code]) {
        warn(`cue ${c.id}: no ${L.name} caption ("${code}")`);
        continue;
      }
      track.push(makeCaption(c.id, c.text[code], c.startBeat, c.endBeat, { ...capDefaults, ...c.caption }, `cue ${c.id}`, code));
    }
    for (const c of raw.captions ?? []) {
      const label = `caption ${c.id}`;
      const start = position(c, label);
      const beats = length(c);
      if (beats == null) {
        if (code === languages[0]) error(`${label}: needs "beats" or "bars"`);
        continue;
      }
      const text = (c[code] ?? '').trim();
      if (!text) {
        warn(`${label}: no ${L.name} text ("${code}")`);
        continue;
      }
      track.push(makeCaption(c.id, text, start, start + beats, { ...capDefaults, holdBeats: 0, ...captionOpts(c) }, label, code));
    }

    // one caption on screen at a time: an earlier caption's hold is cut when the next begins
    track.sort(byStart);
    for (let i = 1; i < track.length; i++) {
      const prev = track[i - 1];
      const cur = track[i];
      if (cur.startBeat < prev.endBeat - EPS) {
        if (cur.startBeat < prev.minEndBeat - EPS) {
          warn(`caption ${cur.id} (${code}) starts before ${prev.id} has finished; ${prev.id} is cut at ${clock.label(cur.startBeat)}`);
        }
        prev.endBeat = cur.startBeat;
      }
    }
    return track;
  }

  const captionTracks = Object.fromEntries(languages.map((code) => [code, buildTrack(code)]));
  const captions = captionTracks[lang] ?? [];

  const contentEnd = Math.max(0, ...cues.map((c) => c.endBeat), ...captions.map((c) => c.endBeat));
  const lengthBeats =
    raw.lengthBeats ??
    (raw.lengthBars != null
      ? raw.lengthBars * clock.beatsPerBar
      : Math.ceil(contentEnd / clock.beatsPerBar) * clock.beatsPerBar);
  if (contentEnd > lengthBeats + EPS) {
    warn(`content runs to ${clock.label(contentEnd)} but the timeline ends at ${clock.label(lengthBeats)}; the rest is cut off`);
  }

  const scenes = (raw.scenes ?? [])
    .map((s) => ({ id: s.id, title: s.title ?? null, bg: s.bg ?? null, startBeat: position(s, `scene ${s.id}`), len: length(s) }))
    .sort(byStart);
  const palette = theme?.backgrounds ?? [];
  scenes.forEach((s, i) => {
    s.endBeat = s.len != null ? s.startBeat + s.len : (scenes[i + 1]?.startBeat ?? lengthBeats);
    s.bg ??= palette.length ? palette[i % palette.length] : null; // a scene's own "bg" wins over the theme
    delete s.len;
  });

  // Media layers: images/videos registered by `npm run ingest`
  const mediaDefaults = { ...MEDIA_DEFAULTS, ...mediaOpts(theme?.mediaDefaults), ...mediaOpts(raw.mediaDefaults) };
  const fps = raw.fps ?? 30;
  const media = [];

  function addLayer(asset, assetId, startBeat, beats, opts, label, auto) {
    const o = { ...mediaDefaults, ...opts };
    if (!['cover', 'contain', 'fill'].includes(o.fit)) error(`${label}: fit must be cover, contain or fill (got "${o.fit}")`);
    if (!['back', 'front'].includes(o.layer)) error(`${label}: layer must be back or front (got "${o.layer}")`);
    if (!(o.blend in BLEND_MODES)) error(`${label}: blend must be one of ${Object.keys(BLEND_MODES).join(', ')} (got "${o.blend}")`);
    if (!(Array.isArray(o.box) && o.box.length === 4 && o.box.every(Number.isFinite) && o.box[2] > 0 && o.box[3] > 0)) {
      error(`${label}: box must be [x, y, width, height] in % of the frame, e.g. [75, 70, 20, 20]`);
      o.box = MEDIA_DEFAULTS.box;
    }
    if (typeof o.zoom === 'number') o.zoom = [o.zoom, o.zoom];
    if (!(beats > 0)) {
      error(`${label}: length must be more than 0 beats`);
      return;
    }
    if (asset.width && asset.height) {
      const fx = ((raw.width ?? 1920) * o.box[2]) / 100 / asset.width;
      const fy = ((raw.height ?? 1080) * o.box[3]) / 100 / asset.height;
      const scale = (o.fit === 'contain' ? Math.min(fx, fy) : Math.max(fx, fy)) * Math.max(...(o.zoom ?? [1]));
      if (scale > 2) warn(`${label}: ${asset.width}x${asset.height} is enlarged ${scale.toFixed(1)}x and will look soft`);
    }
    if (asset.type === 'video') {
      if (o.trimSec >= asset.duration) error(`${label}: trimSec ${o.trimSec}s is past the end of the ${asset.duration.toFixed(2)}s clip`);
      const available = asset.duration - o.trimSec;
      const slot = clock.toSec(beats);
      if (!o.loop && slot > available + 1 / fps) {
        warn(`${label}: clip has ${available.toFixed(2)}s but the slot is ${slot.toFixed(2)}s; it holds its last frame for ${(slot - available).toFixed(2)}s (set "loop": true or shorten it)`);
      }
    }
    media.push({
      id: `${assetId}@${clock.label(startBeat)}`,
      asset: assetId,
      file: asset.file,
      type: asset.type,
      width: asset.width,
      height: asset.height,
      duration: asset.duration,
      auto,
      layer: o.layer,
      fit: o.fit,
      opacity: o.opacity,
      fadeIn: o.fadeInBeats ?? o.fadeBeats,
      fadeOut: o.fadeOutBeats ?? o.fadeBeats,
      zoom: o.zoom ?? (asset.type === 'image' ? [1, 1.06] : [1, 1]),
      pan: o.pan,
      loop: o.loop,
      trimSec: o.trimSec,
      blend: BLEND_MODES[o.blend] ?? 'normal',
      box: o.box,
      alpha: !!asset.alpha,
      startBeat,
      endBeat: startBeat + beats,
    });
  }

  const referenced = new Set();
  for (const m of raw.media ?? []) {
    const label = `media ${m.asset ?? '(no asset)'}`;
    const asset = assets[m.asset];
    referenced.add(m.asset);
    if (!asset) {
      error(`${label}: no ingested asset with that id (drop the file in assets/media and run \`npm run ingest\`)`);
      continue;
    }
    if (asset.error) {
      error(`${label}: ${asset.error}`);
      continue;
    }
    const scene = m.scene != null ? scenes.find((s) => s.id === m.scene) : null;
    if (m.scene != null && !scene) {
      error(`${label}: no scene "${m.scene}" (scenes: ${scenes.map((s) => s.id).join(', ')})`);
      continue;
    }
    const startBeat = m.at != null ? position(m, label) : (scene?.startBeat ?? 0);
    const trim = m.trimSec ?? mediaDefaults.trimSec;
    const beats =
      length(m) ??
      (scene ? scene.endBeat - startBeat : undefined) ??
      (asset.type === 'video' && !(m.loop ?? mediaDefaults.loop) ? Math.ceil(clock.toBeat(asset.duration - trim) - EPS) : undefined);
    if (beats == null) {
      error(`${label}: needs "beats", "bars" or "scene" to know how long to show it`);
      continue;
    }
    addLayer(asset, m.asset, startBeat, beats, mediaOpts(m), label, false);
  }

  // Auto placement: files in assets/media/<scene id>/ that no "media" entry uses fill
  // that scene, split on whole beats and crossfading into each other.
  if (raw.autoMedia !== false) {
    const groups = new Map();
    const overlays = [];
    for (const [id, a] of Object.entries(assets)) {
      if (referenced.has(id) || (!a.group && a.role !== 'overlay')) continue;
      if (a.error) {
        warn(`media ${id}: not placed, ${a.error}`);
        continue;
      }
      if (a.role === 'overlay') {
        overlays.push(id);
        continue;
      }
      if (!groups.has(a.group)) groups.set(a.group, []);
      groups.get(a.group).push(id);
    }

    // overlays span their whole scene (or the whole timeline), stacked on the front layer, looping
    const overlayDefaults = { ...OVERLAY_DEFAULTS, ...mediaOpts(theme?.overlayDefaults), ...mediaOpts(raw.overlayDefaults) };
    for (const id of overlays.sort()) {
      const a = assets[id];
      const scene = a.group ? scenes.find((s) => s.id === a.group) : null;
      if (a.group && !scene) {
        warn(`assets/media/${a.group}/overlay/ matches no scene id (${scenes.map((s) => s.id).join(', ')}); ${id} isn't placed`);
        continue;
      }
      const start = scene ? scene.startBeat : 0;
      const end = scene ? scene.endBeat : lengthBeats;
      // footage with real transparency is composited as-is; footage on black uses overlayDefaults.blend
      // (a "media" entry for the asset overrides either)
      const opts = { layer: 'front', zoom: [1, 1], loop: true, ...overlayDefaults, ...(a.alpha && { blend: 'normal' }) };
      addLayer(a, id, start, end - start, opts, `media overlay ${id}`, true);
    }
    for (const [group, ids] of groups) {
      const scene = scenes.find((s) => s.id === group);
      if (!scene) {
        warn(`assets/media/${group}/ matches no scene id (${scenes.map((s) => s.id).join(', ')}); its ${ids.length} file(s) aren't auto-placed`);
        continue;
      }
      ids.sort();
      const span = scene.endBeat - scene.startBeat;
      const bounds = ids.map((_, i) => scene.startBeat + Math.round((span * i) / ids.length));
      bounds.push(scene.endBeat);
      if (new Set(bounds).size < bounds.length) {
        warn(`scene ${group}: ${ids.length} files don't fit in ${span} beats at one beat minimum each; some are skipped`);
      }
      const fade = mediaDefaults.fadeBeats;
      ids.forEach((id, i) => {
        const last = i === ids.length - 1;
        const beats = bounds[i + 1] - bounds[i];
        if (beats <= 0) return;
        // each clip runs `fade` beats into the next one, which fades in on top of it
        addLayer(assets[id], id, bounds[i], beats + (last ? 0 : fade), { fadeInBeats: fade, fadeOutBeats: last ? fade : 0 }, `auto media ${id}`, true);
      });
    }
  }
  // stacking: automatic media first (in start order, so crossfades layer correctly),
  // then the timeline's own "media" entries above them, so a placed logo stays on top
  media.sort((a, b) => Number(!a.auto) - Number(!b.auto) || byStart(a, b));
  for (const m of media) {
    if (m.endBeat > lengthBeats + EPS) warn(`media ${m.id} runs to ${clock.label(m.endBeat)}, past the end of the timeline`);
  }

  const music = raw.music?.file
    ? { file: raw.music.file, startBeat: position(raw.music, 'music') }
    : null;

  const withSec = (x) =>
    Object.assign(x, {
      start: clock.toSec(x.startBeat),
      ...(x.endBeat != null && { end: clock.toSec(x.endBeat) }),
    });
  [...scenes, ...cues, ...Object.values(captionTracks).flat(), ...media].forEach(withSec);
  if (music) withSec(music);

  return {
    issues,
    timeline: {
      project: raw.project ?? 'untitled',
      clock: { bpm: clock.bpm, beatsPerBar: clock.beatsPerBar },
      fps: raw.fps ?? 30,
      width: raw.width ?? 1920,
      height: raw.height ?? 1080,
      voGrid: grid,
      lengthBeats,
      lengthSec: clock.toSec(lengthBeats),
      scenes,
      cues,
      lang: langInfo(lang), // the burned-in caption language
      languages,
      captions, // the burned-in track (= captionTracks[lang])
      captionTracks, // every language, for subtitle files and MP4 subtitle tracks
      media,
      music,
      // only the visual part goes to the scene; the *Defaults sections were applied above
      theme: theme && {
        name: theme.name,
        motif: theme.motif,
        title: theme.title,
        caption: theme.caption,
        particles: theme.particles,
        vignette: theme.vignette,
      },
    },
  };
}
