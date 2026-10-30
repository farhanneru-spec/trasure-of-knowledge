// Every visual is a pure function of time t (seconds) -> renderFrame(t), so the
// Puppeteer renderer and the live preview draw identical frames.
import { createClock } from '/src/beat.js';

const params = new URLSearchParams(location.search);
const RENDER = params.get('mode') === 'render';
// the resolved timeline of one job (episode + theme); preview and render pass its URL
const dataUrl = params.get('data');
if (!dataUrl) {
  document.body.textContent = 'Open this page through `npm run preview` (it adds ?data=… for the episode to show).';
  throw new Error('missing ?data=');
}
const tl = await fetch(dataUrl, { cache: 'no-store' }).then((r) => r.json());
const clock = createClock(tl.clock);

const $ = (id) => document.getElementById(id);
const stage = $('stage');
const bgA = $('bgA');
const bgB = $('bgB');
const motif = $('motif');
const particlesEl = $('particles');
const vignette = $('vignette');
const title = $('title');
const caption = $('caption');
const debug = $('debug');
const mediaBack = $('mediaBack');
const mediaFront = $('mediaFront');

stage.style.width = `${tl.width}px`;
stage.style.height = `${tl.height}px`;
stage.style.setProperty('--u', tl.height / 1080);
debug.hidden = RENDER && !params.has('debug');

const clamp01 = (x) => Math.min(1, Math.max(0, x));

// ---- theme ---------------------------------------------------------------
// Theme sizes are px at 1080p; u scales them to the actual frame.
const T = tl.theme;
const u = tl.height / 1080;
const px = (n) => `${n * u}px`;

const MOTIF_SVG = {
  // rotating eight-point star (two squares) in a ring
  star8: `<rect x="-62" y="-62" width="124" height="124"/>
    <rect x="-62" y="-62" width="124" height="124" transform="rotate(45)"/>
    <circle r="40"/><circle r="88" class="faint"/>`,
  // courtyard doorway: pointed arch with capitals and a threshold, a lantern hanging inside
  arch: `<path d="M -62 96 V -8 C -62 -52 -30 -80 0 -98 C 30 -80 62 -52 62 -8 V 96"/>
    <path class="faint" d="M -50 96 V -4 C -50 -42 -24 -66 0 -82 C 24 -66 50 -42 50 -4 V 96"/>
    <path d="M -70 -8 H -44 M 44 -8 H 70"/>
    <path d="M -84 96 H 84"/><path class="faint" d="M -74 88 H 74"/>
    <circle class="glow" cx="0" cy="-37" r="17"/>
    <path d="M 0 -82 V -52"/>
    <path d="M 0 -52 L 9 -44 V -30 L 0 -22 L -9 -30 V -44 Z"/>
    <path class="faint" d="M -9 -37 H 9"/>`,
  none: '',
};
motif.innerHTML = MOTIF_SVG[T.motif.type] ?? '';
Object.assign(motif.style, {
  color: T.motif.color,
  top: `${T.motif.y}%`,
  width: px(T.motif.size),
  height: px(T.motif.size),
  margin: `${px(-T.motif.size / 2)} 0 0 ${px(-T.motif.size / 2)}`,
});
const motifGlow = motif.querySelector('.glow');

Object.assign(title.style, {
  top: `${T.title.y}%`,
  color: T.title.color,
  font: `${T.title.weight} ${px(T.title.size)} '${T.title.font}', Georgia, serif`,
  letterSpacing: T.title.letterSpacing,
});
Object.assign(caption.style, { color: T.caption.color, fontSize: px(T.caption.size), textShadow: T.caption.shadow });

vignette.hidden = !(T.vignette > 0);
vignette.style.background = `radial-gradient(ellipse at 50% 45%, transparent 45%, rgba(0, 0, 0, ${T.vignette}) 100%)`;

// Ambient particles (lantern embers, dust): fully deterministic, a function of t and a seed.
function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let r = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
const particles = [];
if (T.particles) {
  const P = T.particles;
  const rand = mulberry32(P.seed);
  for (let i = 0; i < P.count; i++) {
    const size = (P.minSize + rand() * (P.maxSize - P.minSize)) * u;
    const el = document.createElement('div');
    el.className = 'p';
    Object.assign(el.style, {
      width: `${size * 3}px`,
      height: `${size * 3}px`,
      margin: `${-size * 1.5}px 0 0 ${-size * 1.5}px`,
      background: `radial-gradient(circle, ${P.color} 0%, ${P.color} 18%, transparent 65%)`,
    });
    particlesEl.append(el);
    particles.push({
      el,
      x0: rand(),
      y0: rand(),
      speed: P.rise * (0.6 + rand() * 0.8) * u,
      sway: P.sway * (0.5 + rand()) * u,
      freq: 0.3 + rand() * 0.5,
      twinkle: 1.5 + rand() * 2.5,
      phase: rand() * Math.PI * 2,
    });
  }
}

function drawParticles(t, pulse) {
  const span = tl.height * 1.1; // rise from just below the frame to just above it
  for (const p of particles) {
    const y = tl.height * 1.05 - ((((p.y0 * span + p.speed * t) % span) + span) % span);
    const x = p.x0 * tl.width + p.sway * Math.sin(t * p.freq + p.phase);
    const tw = 0.65 + 0.35 * Math.sin(t * p.twinkle + p.phase);
    p.el.style.transform = `translate(${x}px, ${y}px)`;
    p.el.style.opacity = T.particles.opacity * tw * (0.85 + 0.3 * pulse);
  }
}
// --------------------------------------------------------------------------
const easeOut = (x) => 1 - (1 - clamp01(x)) ** 3;
const activeAt = (list, beat) => list.findLast((x) => beat >= x.startBeat && beat < x.endBeat) ?? null;
const parseTime = (v) => (String(v).includes(':') ? clock.toSec(clock.parse(v)) : Number(v) || 0);

function setBg(el, bg) {
  if (el.dataset.bg !== (bg ?? '')) {
    el.style.background = bg ?? 'none';
    el.dataset.bg = bg ?? '';
  }
}

// Media layers. During a render videos never play: every frame seeks to its exact
// time, so output is frame-accurate regardless of how slowly frames are captured.
let live = false; // preview playback running
const mediaUrl = (file) => '/' + file.split('/').map(encodeURIComponent).join('/');
const layers = tl.media.map((m) => {
  const wrap = document.createElement('div');
  wrap.className = 'media';
  wrap.hidden = true;
  const [x, y, w, h] = m.box;
  Object.assign(wrap.style, { left: `${x}%`, top: `${y}%`, width: `${w}%`, height: `${h}%`, mixBlendMode: m.blend });
  const el = document.createElement(m.type === 'video' ? 'video' : 'img');
  if (m.type === 'video') Object.assign(el, { muted: true, playsInline: true, preload: 'auto' });
  el.style.objectFit = m.fit;
  el.src = mediaUrl(m.file);
  wrap.append(el);
  (m.layer === 'front' ? mediaFront : mediaBack).append(wrap);
  return { m, wrap, el };
});

function videoTime(m, t) {
  let local = t - m.start;
  const span = m.duration - m.trimSec;
  if (m.loop && span > 0) local %= span;
  return Math.min(Math.max(m.trimSec + local, 0), Math.max(m.duration - 0.001, 0));
}

function seek(el, time) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 5000);
    el.addEventListener('seeked', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
    el.currentTime = time;
  });
}

function setLive(on) {
  live = on;
  if (!on) for (const { el } of layers) if (el.tagName === 'VIDEO') el.pause();
}

let shownCaption = null;
let wordEls = [];
function buildCaption(cap) {
  caption.replaceChildren();
  wordEls = [];
  if (!cap) return;
  // words sit on a plate (a soft panel behind the text) when the theme has one
  const plate = document.createElement('span');
  plate.className = 'plate';
  const P = T.caption.plate;
  if (P) {
    Object.assign(plate.style, { background: P.color, borderRadius: px(P.radius), padding: `${px(P.padY)} ${px(P.padX)}` });
  }
  caption.append(plate);
  cap.words.forEach((w, i) => {
    if (i) plate.append(' ');
    const el = document.createElement('span');
    el.className = 'w';
    el.textContent = w.text;
    plate.append(el);
    wordEls.push(el);
  });
}

function renderFrame(t) {
  const beat = clock.toBeat(t);
  const whole = Math.floor(beat);
  const downbeat = whole % clock.beatsPerBar === 0;

  // beat pulse: sharp attack on every beat, stronger on the downbeat
  const pulse = (1 - (beat - whole)) ** 4 * (downbeat ? 1 : 0.4);
  const M = T.motif;
  motif.style.transform = `rotate(${(beat / (clock.beatsPerBar * 8)) * M.rotateDegPer8Bars}deg) scale(${1 + pulse * M.pulse})`;
  motif.style.opacity = M.opacity + (1 - M.opacity) * pulse;
  if (motifGlow) motifGlow.style.fillOpacity = 0.18 + 0.22 * pulse + 0.04 * Math.sin(t * 9.3) * Math.sin(t * 3.1); // lantern flicker
  drawParticles(t, pulse);

  // scenes, crossfading from the previous one over the first beat
  const i = tl.scenes.findLastIndex((s) => beat >= s.startBeat);
  const scene = tl.scenes[Math.max(i, 0)];
  const prev = i > 0 ? tl.scenes[i - 1] : null;
  setBg(bgA, scene?.bg);
  setBg(bgB, prev?.bg);
  bgB.style.opacity = prev ? 1 - easeOut(beat - scene.startBeat) : 0;

  if (scene?.title) {
    if (title.textContent !== scene.title) title.textContent = scene.title;
    const k = easeOut((beat - scene.startBeat - 1) / 2) * (1 - easeOut(beat - (scene.endBeat - 1)));
    title.style.opacity = k;
    title.style.transform = `translateY(${(1 - k) * 0.25}em)`;
  } else title.style.opacity = 0;

  // media layers: fades, slow zoom/pan, and video time locked to the beat clock
  const seeks = [];
  const activeMedia = [];
  for (const { m, wrap, el } of layers) {
    const active = beat >= m.startBeat && beat < m.endBeat;
    wrap.hidden = !active;
    if (!active) {
      if (m.type === 'video' && !el.paused) el.pause();
      continue;
    }
    activeMedia.push(m.asset);
    const p = clamp01((beat - m.startBeat) / (m.endBeat - m.startBeat));
    const lerp = (a, b) => a + (b - a) * p;
    const fadeIn = m.fadeIn > 0 ? clamp01((beat - m.startBeat) / m.fadeIn) : 1;
    const fadeOut = m.fadeOut > 0 ? clamp01((m.endBeat - beat) / m.fadeOut) : 1;
    wrap.style.opacity = m.opacity * fadeIn * fadeOut;
    el.style.transform = `translate(${lerp(m.pan[0][0], m.pan[1][0])}%, ${lerp(m.pan[0][1], m.pan[1][1])}%) scale(${lerp(m.zoom[0], m.zoom[1])})`;
    if (m.type === 'video') {
      const vt = videoTime(m, t);
      if (live) {
        if (el.paused) el.play().catch(() => {});
        if (Math.abs(el.currentTime - vt) > 0.15) el.currentTime = vt;
      } else if (Math.abs(el.currentTime - vt) > 0.5 / tl.fps || el.readyState < 2) {
        seeks.push(seek(el, vt));
      }
    }
  }

  // Arabic caption, words entering on the beat grid
  const cap = activeAt(tl.captions, beat);
  if (cap !== shownCaption) {
    buildCaption(cap);
    shownCaption = cap;
  }
  if (cap) {
    caption.style.opacity = cap.fadeBeats > 0 ? clamp01((cap.endBeat - beat) / cap.fadeBeats) : 1;
    cap.words.forEach((w, n) => {
      const k = easeOut((beat - w.inBeat) / Math.max(cap.wordInBeats, 1e-3));
      wordEls[n].style.opacity = k;
      wordEls[n].style.transform = `translateY(${(1 - k) * 0.35}em)`;
    });
  }

  if (!debug.hidden) {
    const vo = activeAt(tl.cues, beat);
    debug.classList.toggle('down', downbeat);
    debug.textContent =
      `${tl.job} · ${T.name}   ${clock.label(whole)}  beat ${beat.toFixed(2)}  ${t.toFixed(3)}s  frame ${Math.round(t * tl.fps)}\n` +
      `VO ${vo ? `[${vo.id}] ${vo.en}` : '-'}` +
      (activeMedia.length ? `\nmedia ${activeMedia.join(', ')}` : '') +
      (RENDER ? '' : `\nSpace play · ←/→ beat · Shift+←/→ bar · Home · C click · D debug`);
  }

  // the renderer awaits this so a frame is only captured once its videos have seeked
  return seeks.length ? Promise.all(seeks) : undefined;
}

// With font-display: block a run stays invisible until its font loads, so request
// every string the timeline will show before declaring the scene ready.
await Promise.all([
  document.fonts.load(`700 64px "Noto Naskh Arabic"`, tl.captions.map((c) => c.text).join(' ') || 'الحكمة'),
  document.fonts.load(`${T.title.weight} 84px "${T.title.font}"`, tl.scenes.map((s) => s.title ?? '').join(' ') || 'Hikmat'),
]).catch(() => {});
await document.fonts.ready;
await Promise.all(
  layers.map(({ m, el }) =>
    m.type === 'video'
      ? el.readyState >= 2 ||
        new Promise((r) => {
          el.addEventListener('loadeddata', r, { once: true });
          el.addEventListener('error', r, { once: true });
        })
      : el.decode().catch(() => {}),
  ),
);

window.timeline = tl;
window.renderFrame = renderFrame;
await renderFrame(parseTime(params.get('t') ?? 0));
window.sceneReady = true;

if (!RENDER) startPreview(parseTime(params.get('t') ?? 0));

// Live preview: Web Audio clock drives the visuals so VO stays sample-locked to the beat.
function startPreview(startT) {
  const fit = () => {
    const s = Math.min(innerWidth / tl.width, innerHeight / tl.height);
    stage.style.transform = `translate(${(innerWidth - tl.width * s) / 2}px, ${(innerHeight - tl.height * s) / 2}px) scale(${s})`;
  };
  fit();
  addEventListener('resize', fit);

  const audioItems = [
    ...tl.cues.filter((c) => c.fileExists).map((c) => ({ file: c.file, start: c.start })),
    ...(tl.music?.fileExists ? [{ file: tl.music.file, start: tl.music.start }] : []),
  ];
  const buffers = new Map();
  let ctx = null;
  let playing = false;
  let t0 = startT;
  let ctxT0 = 0;
  let sources = [];
  let click = false;

  const now = () => (playing ? Math.max(t0, t0 + (ctx.currentTime - ctxT0)) : t0);

  async function ensureAudio() {
    ctx ??= new AudioContext();
    await Promise.all(
      audioItems.map(async (a) => {
        if (buffers.has(a.file)) return;
        try {
          const data = await fetch(`/${a.file}`).then((r) => r.arrayBuffer());
          buffers.set(a.file, await ctx.decodeAudioData(data));
        } catch (e) {
          console.warn('could not load', a.file, e);
          buffers.set(a.file, null);
        }
      }),
    );
  }

  function scheduleClicks() {
    for (let b = Math.ceil(clock.toBeat(t0) - 1e-6); b < tl.lengthBeats; b++) {
      const at = ctxT0 + clock.toSec(b) - t0;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = b % clock.beatsPerBar === 0 ? 1760 : 1320;
      gain.gain.setValueAtTime(0.25, at);
      gain.gain.exponentialRampToValueAtTime(0.001, at + 0.04);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 0.05);
      sources.push(osc);
    }
  }

  async function play() {
    await ensureAudio();
    await ctx.resume();
    ctxT0 = ctx.currentTime + 0.05;
    for (const a of audioItems) {
      const buf = buffers.get(a.file);
      const offset = t0 - a.start;
      if (!buf || offset >= buf.duration) continue;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      if (offset >= 0) src.start(ctxT0, offset);
      else src.start(ctxT0 - offset);
      sources.push(src);
    }
    if (click) scheduleClicks();
    playing = true;
    setLive(true);
    requestAnimationFrame(tick);
  }

  function pause() {
    t0 = now();
    playing = false;
    setLive(false);
    for (const s of sources) {
      try {
        s.stop();
      } catch {}
    }
    sources = [];
  }

  function seek(t) {
    const was = playing;
    if (was) pause();
    t0 = Math.min(Math.max(t, 0), tl.lengthSec);
    renderFrame(t0);
    if (was) play();
  }

  function tick() {
    if (!playing) return;
    const t = now();
    if (t >= tl.lengthSec) {
      pause();
      t0 = tl.lengthSec;
      renderFrame(t0);
      return;
    }
    renderFrame(t);
    requestAnimationFrame(tick);
  }

  addEventListener('keydown', (e) => {
    const beatNow = Math.round(clock.toBeat(now()));
    const step = e.shiftKey ? clock.beatsPerBar : 1;
    if (e.code === 'Space') {
      e.preventDefault();
      playing ? pause() : play();
    } else if (e.code === 'ArrowRight') seek(clock.toSec(beatNow + step));
    else if (e.code === 'ArrowLeft') seek(clock.toSec(beatNow - step));
    else if (e.code === 'Home') seek(0);
    else if (e.code === 'KeyD') {
      debug.hidden = !debug.hidden;
      renderFrame(now());
    } else if (e.code === 'KeyC') {
      click = !click;
      if (playing) seek(now());
    }
  });
}
