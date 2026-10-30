// Exports SRT/VTT for every caption language (RTL-marked where needed), an English reference
// SRT and the VO cue sheet to out/<job>/.
import path from 'node:path';
import { writeCaptionFiles } from '../src/captions.js';
import { parseJobArgs } from '../src/cli.js';
import { loadProject, printIssues, ROOT } from '../src/project.js';

const { job } = parseJobArgs();
const { timeline, issues } = loadProject(job);
if (printIssues(issues)) process.exit(1);
for (const f of writeCaptionFiles(timeline, job.dir).files) console.log(`wrote ${path.relative(ROOT, f)}`);
