# Hikmat Ki Talaash: motion graphics pipeline

English voice-over locked to a **120 BPM** beat grid, with dynamic **Arabic (RTL) captions**
revealed word by word on the beat. Each episode is authored in bars/beats in one file,
`timeline/episode-NN.json`, and its look comes from a theme in `themes/`.

At 120 BPM in 4/4: **1 beat = 0.5s, 1 bar = 2s**. Positions are `"bar:beat"` (1-based, like a DAW,
e.g. `"6:1"`, `"6:2.5"`) or a plain 0-based beat number.

## Commands

| command | what it does |
|---|---|
| `npm run doctor` | checks that everything needed is inside this folder and works offline |
| `npm run ingest` | registers images/videos in `assets/media/` and prints where they land (`-- --watch` to keep running, `-- --force` to re-probe all) |
| `npm run validate` | resolves the timeline, prints every cue in bar:beat and seconds, flags sync problems |
| `npm run click` | writes `out/<job>/click-120bpm.wav`, a metronome (downbeats accented) for recording the VO |
| `npm run captions` | writes `out/<job>/captions.ar.srt`, `captions.ar.vtt`, `captions.en.srt`, `vo-cue-sheet.csv` |
| `npm run preview` | serves the scene at http://127.0.0.1:5173/scene/ with VO playback |
| `npm run still -- 6:3` | renders one frame to `out/<job>/stills/` |
| `npm run render` | renders all frames to `out/<job>/frames/`, then encodes `out/<job>.mp4` |

Every command takes `--episode N` (default: `timeline` in `pipeline.config.json`) and `--theme NAME`:

```
node scripts/render.js --episode 1 --theme cozy-courtyard
npm run preview -- --episode 1 --theme cozy-courtyard
```

Render options: `--from 5:1 --to 9:1`, `--workers N` (parallel browsers, default = half the CPU threads),
`--debug` (burn in the beat/VO overlay), `--no-encode`.

Each run is a *job* named after the episode (plus the theme when `--theme` is given). Its frames, stills,
captions and click track go to `out/<job>/` and the video to `out/<job>.mp4`, e.g.
`out/episode-01-cozy-courtyard.mp4`, so episodes and theme variants never overwrite each other.

## Episodes and themes

**Episodes:** copy `timeline/episode-01.json` to `episode-02.json` and change the VO, captions, scenes and
media. Its `"theme"` picks the default look; `--theme` overrides it for one render.

**Themes** (`themes/<name>.json`) set the look. Everything is optional; sizes are px at 1080p.

| key | what |
|---|---|
| `backgrounds` | CSS backgrounds given to scenes in order (cycling); a scene's own `"bg"` wins |
| `motif` | `type` (`star8`, `arch`, `none`), `color`, `opacity`, `pulse` (beat swell), `rotateDegPer8Bars`, `size`, `y` (% from top) |
| `title` | `font`, `weight`, `color`, `size`, `letterSpacing`, `y` |
| `caption` | `color`, `size`, `shadow`, `plate` (`color`, `radius`, `padX`, `padY`): a soft panel behind the Arabic text |
| `particles` | ambient drifting lights: `count`, `color`, `minSize`, `maxSize`, `rise` (px/s), `sway`, `opacity`, `seed` |
| `vignette` | 0–1 edge darkening |
| `captionDefaults`, `mediaDefaults`, `overlayDefaults` | defaults for the timeline sections of the same name |

Precedence is built-in < theme < timeline, so a timeline only needs to state what makes that episode different.
Included: `starlit` (night blues, rotating star; the original look) and `cozy-courtyard` (draft: warm dusk,
arched doorway with a lantern, embers, caption plate). Particles are seeded, so every render is identical.

## Images and video

Drop files into `assets/media/`. `npm run ingest` processes each new or changed file with the bundled ffmpeg,
then opens the result in the bundled browser (proving the renderer can decode it and recording size and
duration), and writes `assets/media.manifest.json`.

**Processing** (originals are never modified; render-ready copies go to `assets/.processed/`, a cache that
is cleaned automatically and can be deleted any time):

| input | what happens |
|---|---|
| TIFF, PSD, TGA, BMP | converted to PNG |
| images over `imageMaxEdge` (3840px) | downscaled (keeps headroom for zooms) |
| HEVC/H.265, ProRes, DNxHD, MKV/AVI/MXF… | converted to H.264 MP4 |
| video with real transparency (ProRes 4444, QuickTime Animation…) | converted to VP9 WebM with alpha |
| video over `videoMaxEdge` (1920px) | downscaled |
| every video (`videoProxy: "always"`) | all-keyframe proxy, so each frame's seek is fast and exact |
| animated GIF | converted to a seekable video (keeps transparency) |
| HEIC/HEIF | rejected: export as JPEG/PNG |

Transparency is checked on the actual pixels, not the format name (many ProRes 4444 files are fully opaque).
Settings live under `"processing"` in `pipeline.config.json`; changing them re-processes everything on the next
ingest. Without ffmpeg, processing is skipped and files are used as-is (formats the browser can't read are rejected).
`render`, `preview` and `validate` re-ingest automatically when the folder has changed, and
`npm run preview` / `npm run ingest -- --watch` pick up new files as they're dropped in.

**Automatic placement:** put files in `assets/media/<scene id>/` (e.g. `assets/media/within/lamp.jpg`). They fill
that scene, split on whole beats in filename order (prefix `01-`, `02-` to order them), crossfading by
`mediaDefaults.fadeBeats`. Stills get a slow push-in. Set `"autoMedia": false` to turn this off.

**Overlays:** files in `assets/media/<scene id>/overlay/` span that scene; files in `assets/media/overlay/` span the
whole timeline. They loop, sit on the front layer and stack. Footage with real transparency is composited as-is;
anything else (light leaks, dust, film grain on black) uses `overlayDefaults.blend` (`screen` by default), so the
black drops out. `overlayDefaults` also sets their opacity and fades.

**Explicit placement:** the timeline's `"media"` list places any ingested asset by id (path without extension,
lowercased, spaces → dashes; `ingest` prints the ids). An asset used here is not also auto-placed, and explicit
entries always stack above automatic media and overlays.

```jsonc
"mediaDefaults": { "fit": "cover", "layer": "back", "opacity": 0.85, "fadeBeats": 1 },
"media": [
  { "asset": "logo", "at": "13:1", "bars": 4,          // where and how long
    "layer": "front", "fit": "contain", "opacity": 0.9,
    "zoom": [0.32, 0.36], "pan": [[0, -20], [0, -20]] }, // scale and offset (% of frame), from → to
  { "asset": "within/candle", "scene": "within",         // fills that scene
    "loop": true, "trimSec": 1.5,                         // video: start 1.5s in, loop to fill the slot
    "fadeInBeats": 2, "fadeOutBeats": 0.5 }
]
```

| field | values |
|---|---|
| `at` + `beats`/`bars`, or `scene` | position and length; a video without either length defaults to its own duration |
| `layer` | `back` (behind the star motif) or `front` (above it); title and captions always stay on top |
| `fit` | `cover`, `contain`, `fill` |
| `opacity`, `fadeBeats`, `fadeInBeats`, `fadeOutBeats` | 0–1; fades in beats |
| `zoom`, `pan` | `[from, to]` scale (or one number); `[[x, y], [x, y]]` offset in % of the frame |
| `box` | `[x, y, width, height]` in % of the frame to place and size the asset, e.g. a logo at `[84, 4, 12, 18]` |
| `blend` | `normal`, `screen`, `add`, `multiply`, `overlay`, `lighten`, `darken`, `soft-light`, `hard-light`, `color-dodge`, `difference` |
| `loop`, `trimSec` | video only |

Videos are locked to the beat clock: a render never plays them, it seeks each one to the exact time of every
frame. Video audio is ignored. Heavy media costs render time: a timeline with several overlapping 1080p videos
renders at roughly 5 frames/s instead of 25. Validation warns when a clip is shorter than its
slot, when a low-resolution file is enlarged more than 2×, and when a folder name matches no scene.

## Self-contained / offline

Nothing in the pipeline calls an AI model or any web service, and nothing is fetched at render time:

- **Browser:** `chrome-headless-shell` lives in `.cache/puppeteer/` (set by `.puppeteerrc.cjs`), not `~/.cache`.
- **Fonts:** `assets/fonts/` holds Noto Naskh Arabic and Cormorant Garamond (SIL OFL; licences alongside), loaded via `@font-face`.
- **Network guard:** with `"offline": true` in `pipeline.config.json`, the renderer blocks every request that isn't
  to its own local server and prints any it blocked, so an accidental external URL fails visibly.
- **ffmpeg** (optional, for MP4): resolved from `tools/ffmpeg/ffmpeg.exe` first, then the `FFMPEG` env var, then PATH.
  Without it, frames still render to `out/<job>/frames/`.

`pipeline.config.json` holds the paths (timeline, output, browser, ffmpeg) and the preview port.
Copying the whole folder, `node_modules` and `.cache` included, to another Windows PC with Node 20+ is enough to render.

Preview keys: **Space** play/pause · **←/→** ±1 beat · **Shift+←/→** ±1 bar · **Home** · **C** click track · **D** debug overlay.
Add `?t=8:1` to the URL to start at a bar. Audio starts on the first Space (browser autoplay rules).

## VO workflow

1. `npm run click` and record each line against the click, or `npm run captions` and hand the
   narrator `out/vo-cue-sheet.csv` (start bar:beat, timecode, slot length, text).
2. Trim each line so the first syllable sits at the start of the file and save it as
   `assets/vo/<cue id>.wav`. The pipeline places it at the cue's `at` position.
3. `npm run validate` measures each file. If a take is longer than its slot you get
   `audio is 3.60s but its slot is 6 beats (3.00s); it needs 8 beats`. Omit `beats` on a cue to size it
   from the audio automatically (rounded up to the VO grid).

## Timeline reference

```jsonc
"vo": { "grid": 1 },                 // cues must start on whole beats (0.5 = allow eighth notes)
"captionDefaults": {
  "reveal": "word",                  // "word" = word-by-word, "line" = all at once
  "stepBeats": 0.5,                  // a new word every eighth note
  "wordInBeats": 0.5,                // each word's entrance length
  "offsetBeats": 0,                  // shift captions relative to the VO
  "holdBeats": 1,                    // linger after the VO ends
  "fadeBeats": 0.5,
  "maxCharsPerLine": 42              // SRT/VTT line wrapping
},
"cues": [
  { "id": "vo03", "at": "6:1", "beats": 4, "file": "assets/vo/vo03.wav",
    "en": "Listen. Reflect. Seek.", "ar": "استمع. تأمّل. ابحث.",
    "caption": { "stepBeats": 1 } }  // per-cue overrides: one word per beat
],
"captions": [                        // Arabic text with no VO (title cards)
  { "id": "title-ar", "at": "14:1", "bars": 2, "ar": "البحث عن الحكمة", "reveal": "line" }
],
"music": { "file": "assets/music/bed.wav", "at": "1:1" }
```

Validation flags: cues off the VO grid, overlapping VO lines, audio longer than its slot, missing or
non-Arabic caption text, word reveals that don't finish before the fade, captions cut short by the
next one, and content past the end of the timeline.

## RTL handling

- **Burned-in captions**: `#caption` has `dir="rtl" lang="ar"`, so the browser's bidi algorithm lays
  words right to left and puts trailing punctuation (`.` `،`) at the left end. Each word is its own span,
  so the reveal runs in reading order (right → left). Font: Noto Naskh Arabic (bundled).
- **SRT/VTT**: every Arabic line is wrapped in U+202B/U+202C (RTL embedding), so players that default
  to LTR still order punctuation correctly. SRT and the CSV are UTF-8 with BOM for Windows players and Excel.
- **MP4**: a full render also attaches the Arabic SRT as a soft subtitle track (`language=ara`).

## Layout

```
pipeline.config.json   paths, episode pattern, default theme, preview port, offline guard, processing
timeline/              episode timelines, episode-NN.json (edit these)
themes/                looks: starlit, cozy-courtyard
src/                   beat clock, resolver/validator, caption export, WAV tools, static server
scene/                 HTML scene; renderFrame(t) is a pure function of time
scripts/               CLI entry points (doctor, validate, captions, click, preview, render)
assets/fonts/          bundled fonts + OFL licences
assets/media/          your images/videos (subfolder = scene id for auto placement)
assets/media.manifest.json   generated by npm run ingest
assets/.processed/     cache of converted/scaled media (safe to delete)
assets/vo/             VO takes, one file per cue id
tools/ffmpeg/          put ffmpeg.exe here for self-contained MP4 encoding
.cache/puppeteer/      bundled chrome-headless-shell
out/<job>/             generated per episode/theme: resolved timeline, captions, click, frames, stills
out/<job>.mp4          the rendered video
```
