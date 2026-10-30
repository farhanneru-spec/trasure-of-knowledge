// Writes a click track for the narrator to record the English VO against.
import path from 'node:path';
import { writeClickTrack } from '../src/wav.js';
import { loadProject, OUT, ROOT } from '../src/project.js';

const { timeline: tl } = loadProject(process.argv[2]);
const file = path.join(OUT, `click-${tl.clock.bpm}bpm.wav`);
writeClickTrack(file, { ...tl.clock, beats: tl.lengthBeats });
console.log(`wrote ${path.relative(ROOT, file)} (${tl.lengthBeats} beats, ${tl.lengthSec}s; downbeats accented)`);
