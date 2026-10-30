// Registers images/videos dropped into assets/media and shows where they land on the timeline.
//
//   npm run ingest                 ingest new/changed files, print the placement plan
//   npm run ingest -- --watch      keep running; re-ingest whenever media or the timeline changes
//   npm run ingest -- --force      re-probe every file, not just changed ones
import path from 'node:path';
import { createClock } from '../src/beat.js';
import { parseJobArgs } from '../src/cli.js';
import { ingest, watchPaths } from '../src/ingest.js';
import { MEDIA_DIR, MANIFEST_PATH } from '../src/media.js';
import { loadProject, printIssues, processingEnabled, CONFIG, ROOT } from '../src/project.js';

const { opt, job } = parseJobArgs({
  watch: { type: 'boolean', default: false },
  force: { type: 'boolean', default: false },
});
const rel = (p) => path.relative(ROOT, p);

function describe(a) {
  const size = a.width ? `${a.width}x${a.height}` : '?';
  const kind = a.type === 'video' ? `video ${size} ${a.duration?.toFixed(2)}s` : `image ${size}`;
  return `${kind}${a.alpha ? ', alpha' : ''}${a.processed ? ', processed' : ''}`;
}

async function run(force) {
  const r = await ingest({ force, log: console.log });
  const assets = Object.entries(r.manifest?.assets ?? {});

  if (!r.changed) console.log(`media: ${assets.length} asset(s), nothing changed since the last ingest`);
  else {
    console.log(`media: ${assets.length} asset(s) in ${rel(MEDIA_DIR)} -> ${rel(MANIFEST_PATH)}`);
    for (const id of r.added) console.log(`  + ${id}`);
    for (const id of r.updated) console.log(`  ~ ${id}`);
    for (const file of r.removed) console.log(`  - ${file}`);
  }
  for (const p of r.processed ?? []) {
    console.log(`  processed ${p.id}${p.cached ? ' (from cache)' : ''}: ${p.reasons.join('; ')}`);
  }
  if (r.removedCache) console.log(`  removed ${r.removedCache} unused file(s) from ${CONFIG.processing.cacheDir}`);
  if (!processingEnabled()) console.log('  note: processing is off (no ffmpeg or "processing.enabled": false); files are used as-is');
  for (const f of r.scan.skipped) console.log(`  skipped ${f} (not a supported image/video type)`);
  for (const [id, a] of assets) if (a.error) console.log(`  ERROR  ${id}: ${a.error}`);

  const { timeline: tl, issues } = loadProject(job);
  const clock = createClock(tl.clock);
  const placed = new Set(tl.media.map((m) => m.asset));

  if (tl.media.length) {
    console.log('\nPlacement');
    for (const m of tl.media) {
      console.log(`  ${clock.label(m.startBeat).padEnd(6)} -> ${clock.label(m.endBeat).padEnd(6)} ${m.start.toFixed(2).padStart(6)}s  ` +
        `${m.layer.padEnd(5)} ${m.auto ? 'auto ' : 'media'}  ${m.asset}  (${describe(m)}${m.blend !== 'normal' ? `, ${m.blend}` : ''})`);
    }
  }
  const unplaced = assets.filter(([id, a]) => !placed.has(id) && !a.error);
  if (unplaced.length) {
    console.log('\nNot on the timeline (add a "media" entry, or move into assets/media/<scene id>/)');
    for (const [id, a] of unplaced) console.log(`  ${id}  (${describe(a)})`);
  }

  const mediaIssues = issues.filter((i) => /media|assets\/media/.test(i.msg));
  if (mediaIssues.length) {
    console.log('');
    printIssues(mediaIssues);
  }
  return mediaIssues.some((i) => i.level === 'error');
}

const failed = await run(opt.force);
if (!opt.watch) process.exitCode = failed ? 1 : 0;
else {
  const timelineDir = path.dirname(path.resolve(ROOT, job.file));
  console.log(`\nwatching ${rel(MEDIA_DIR)} and ${rel(timelineDir)} (Ctrl+C to stop)`);
  watchPaths([MEDIA_DIR, timelineDir], async () => {
    console.log(`\n--- ${new Date().toLocaleTimeString()} ---`);
    await run(false);
  });
}
