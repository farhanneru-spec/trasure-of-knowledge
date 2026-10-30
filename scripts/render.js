// Renders the scene frame by frame with Puppeteer, then (if ffmpeg is available)
// encodes MP4 with the VO mixed in at its beat positions and the Arabic SRT as a soft track.
//
//   node scripts/render.js                               default timeline, full render
//   node scripts/render.js --episode 1 --theme cozy-courtyard
//   node scripts/render.js --from 5:1 --to 9:1
//   node scripts/render.js --still 6:3                   single PNG
//   options: --episode N, --theme NAME, --timeline FILE,
//            --workers N (parallel browsers, default half the CPU threads),
//            --debug (burn in beat overlay), --no-encode
// Output goes to out/<job>/ (frames, stills, captions) and out/<job>.mp4,
// where <job> is the timeline name plus the theme when --theme is given.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import puppeteer from 'puppeteer';
import { createClock } from '../src/beat.js';
import { writeCaptionFiles } from '../src/captions.js';
import { parseJobArgs } from '../src/cli.js';
import { ensureIngested } from '../src/ingest.js';
import { loadProject, printIssues, hasTool, findLocalBrowser, CONFIG, FFMPEG, OUT, ROOT } from '../src/project.js';
import { startServer } from '../src/server.js';

const { opt, job } = parseJobArgs({
  from: { type: 'string' },
  to: { type: 'string' },
  still: { type: 'string' },
  workers: { type: 'string', default: String(Math.max(1, Math.floor(os.availableParallelism() / 2))) },
  debug: { type: 'boolean', default: false },
  'no-encode': { type: 'boolean', default: false },
});

await ensureIngested();
const { timeline: tl, issues, dataUrl } = loadProject(job);
console.log(`${job.name}: ${job.file}, theme ${tl.theme?.name ?? 'none'}`);
if (printIssues(issues)) process.exit(1);
const clock = createClock(tl.clock);
const parseTime = (v) => (v.includes(':') ? clock.toSec(clock.parse(v)) : Number(v));
const rel = (p) => path.relative(ROOT, p);

const executablePath = findLocalBrowser();
if (!executablePath) {
  console.error(`No browser in ${CONFIG.browserDir}; run \`npm run doctor\` for setup steps.`);
  process.exit(1);
}

const server = await startServer(ROOT);
// one browser per worker: background tabs in a shared browser don't paint, so screenshots stall
const browsers = [];
const blocked = new Set();
try {
  async function openScene() {
    const browser = await puppeteer.launch({ headless: 'shell', executablePath });
    browsers.push(browser);
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.error('scene error:', e.message));
    if (CONFIG.offline) {
      // offline guarantee: anything not served by the local server is refused, so a
      // stray external URL fails loudly here instead of silently needing the network
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        const url = req.url();
        if (url.startsWith(server.url) || url.startsWith('data:') || url.startsWith('blob:')) return req.continue();
        if (!blocked.has(url)) console.warn(`blocked external request: ${url}`);
        blocked.add(url);
        req.abort('blockedbyclient');
      });
    }
    await page.setViewport({ width: tl.width, height: tl.height, deviceScaleFactor: 1 });
    const query = `mode=render&data=${encodeURIComponent(dataUrl)}${opt.debug ? '&debug' : ''}`;
    await page.goto(`${server.url}/scene/index.html?${query}`, { waitUntil: 'networkidle0' });
    await page.waitForFunction('window.sceneReady === true', { timeout: 30000 });
    return page;
  }

  const shoot = async (page, t, file) => {
    await page.evaluate(async (t) => {
      await window.renderFrame(t); // resolves once any videos on this frame have seeked
      await document.fonts.ready;
    }, t);
    await page.screenshot({ path: file, type: 'png', optimizeForSpeed: true, captureBeyondViewport: false });
  };

  if (opt.still) {
    const dir = path.join(job.dir, 'stills');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `still_${opt.still.replace(/[:.]/g, '-')}.png`);
    await shoot(await openScene(), parseTime(opt.still), file);
    console.log(`wrote ${rel(file)}`);
  } else {
    const from = opt.from ? parseTime(opt.from) : 0;
    const to = opt.to ? parseTime(opt.to) : tl.lengthSec;
    const first = Math.round(from * tl.fps);
    const count = Math.round(to * tl.fps) - first;
    const framesDir = path.join(job.dir, 'frames');
    fs.rmSync(framesDir, { recursive: true, force: true });
    fs.mkdirSync(framesDir, { recursive: true });

    // frames are independent (renderFrame is a pure function of t), so pages share a queue
    const workers = Math.max(1, Math.min(Number(opt.workers), count));
    const pages = await Promise.all(Array.from({ length: workers }, openScene));
    const started = Date.now();
    let next = 0;
    let done = 0;
    await Promise.all(
      pages.map(async (page) => {
        for (let i = next++; i < count; i = next++) {
          await shoot(page, (first + i) / tl.fps, path.join(framesDir, `f_${String(i).padStart(5, '0')}.png`));
          if (++done % tl.fps === 0 || done === count) {
            process.stdout.write(`\rframe ${done}/${count}  (${workers} workers)   `);
          }
        }
      }),
    );
    console.log(`\nrendered ${count} frames to ${rel(framesDir)} in ${((Date.now() - started) / 1000).toFixed(1)}s`);

    if (!opt['no-encode']) encode({ from, duration: count / tl.fps, framesDir });
  }
} finally {
  await Promise.all(browsers.map((b) => b.close()));
  server.close();
}

function encode({ from, duration, framesDir }) {
  if (!hasTool(FFMPEG)) {
    console.log('ffmpeg not found (install it or set FFMPEG=path\\to\\ffmpeg.exe); frames are ready to encode.');
    return;
  }
  const audio = [
    ...tl.cues.filter((c) => c.fileExists).map((c) => ({ file: c.file, start: c.start })),
    ...(tl.music?.fileExists ? [{ file: tl.music.file, start: tl.music.start }] : []),
  ].filter((a) => a.start < from + duration);

  const args = [
    '-y', '-hide_banner', '-loglevel', 'error', '-stats',
    '-thread_queue_size', '64', '-framerate', String(tl.fps), '-i', path.join(framesDir, 'f_%05d.png'),
  ];
  for (const a of audio) args.push('-i', path.resolve(ROOT, a.file));

  // soft Arabic subtitle track only for full renders (times are absolute)
  const subs = from === 0 ? writeCaptionFiles(tl, job.dir).find((f) => f.endsWith('captions.ar.srt')) : null;
  if (subs) args.push('-i', subs);

  const map = ['-map', '0:v'];
  if (audio.length) {
    // place each VO file at its beat position (relative to the render start)
    const chains = audio.map((a, i) => {
      const offset = a.start - from;
      const fx = offset >= 0 ? `adelay=${Math.round(offset * 1000)}:all=1` : `atrim=start=${-offset},asetpts=PTS-STARTPTS`;
      return `[${i + 1}:a]${fx}[a${i}]`;
    });
    const mix = `${audio.map((_, i) => `[a${i}]`).join('')}amix=inputs=${audio.length}:normalize=0:duration=longest[aout]`;
    args.push('-filter_complex', [...chains, mix].join(';'));
    map.push('-map', '[aout]');
  }
  if (subs) map.push('-map', `${audio.length + 1}:s`);

  const outFile = path.join(OUT, `${job.name}.mp4`);
  args.push(
    ...map,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18',
    ...(audio.length ? ['-c:a', 'aac', '-b:a', '192k'] : []),
    ...(subs ? ['-c:s', 'mov_text', '-metadata:s:s:0', 'language=ara'] : []),
    '-t', String(duration),
    outFile,
  );
  console.log(`encoding ${rel(outFile)} (${audio.length} audio input(s)${subs ? ', Arabic subtitle track' : ''})`);
  const r = spawnSync(FFMPEG, args, { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`ffmpeg exited with ${r.status}`);
  console.log(`wrote ${rel(outFile)}`);
}
