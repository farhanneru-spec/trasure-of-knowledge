// Writes a click track for the narrator to record the English VO against, to out/<job>/.
import path from 'node:path';
import { parseJobArgs } from '../src/cli.js';
import { writeClickTrack } from '../src/wav.js';
import { loadProject, ROOT } from '../src/project.js';

const { job } = parseJobArgs();
const { timeline: tl } = loadProject(job);
const file = path.join(job.dir, `click-${tl.clock.bpm}bpm.wav`);
writeClickTrack(file, { ...tl.clock, beats: tl.lengthBeats });
console.log(`wrote ${path.relative(ROOT, file)} (${tl.lengthBeats} beats, ${tl.lengthSec}s; downbeats accented)`);
