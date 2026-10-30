// Checks VO/caption sync against the beat grid and prints the resolved cue list.
import { createClock } from '../src/beat.js';
import { parseJobArgs } from '../src/cli.js';
import { ensureIngested } from '../src/ingest.js';
import { loadProject, printIssues } from '../src/project.js';

const { job } = parseJobArgs();
await ensureIngested();
const { timeline: tl, issues } = loadProject(job);
const clock = createClock(tl.clock);

console.log(`${tl.project} [${job.name}, theme ${tl.theme?.name}]: ${tl.clock.bpm} BPM, ${tl.clock.beatsPerBar}/4, beat = ${clock.beatSec}s, ` +
  `${tl.lengthBeats / tl.clock.beatsPerBar} bars = ${tl.lengthSec}s @ ${tl.fps}fps\n`);

console.log('VO cues');
for (const c of tl.cues) {
  const audio = c.audioSec == null ? 'no audio' : `audio ${c.audioSec.toFixed(2)}s`;
  console.log(`  ${c.id}  ${clock.label(c.startBeat).padEnd(6)} -> ${clock.label(c.endBeat).padEnd(6)} ` +
    `${String(c.beats).padStart(3)} beats  ${c.start.toFixed(2)}-${c.end.toFixed(2)}s  ${audio.padEnd(13)} ${c.en}`);
}
for (const code of tl.languages) {
  const name = code === tl.lang.code ? `${tl.lang.name} captions (burned in)` : `${code} captions`;
  console.log(`\n${name}`);
  for (const c of tl.captionTracks[code]) {
    console.log(`  ${c.id.padEnd(10)} ${clock.label(c.startBeat).padEnd(6)} -> ${clock.label(c.endBeat).padEnd(6)} ` +
      `${String(c.words.length).padStart(2)} words  ${c.text}`);
  }
}

if (tl.media.length) {
  console.log('\nMedia layers');
  for (const m of tl.media) {
    console.log(`  ${clock.label(m.startBeat).padEnd(6)} -> ${clock.label(m.endBeat).padEnd(6)} ${m.layer.padEnd(5)} ` +
      `${m.auto ? 'auto' : '    '}  ${m.asset}`);
  }
}

console.log(issues.length ? `\n${issues.length} issue(s):` : '\nNo issues.');
process.exitCode = printIssues(issues) ? 1 : 0;
