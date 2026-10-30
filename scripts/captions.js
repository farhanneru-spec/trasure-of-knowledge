// Exports Arabic SRT/VTT (RTL-marked), English reference SRT and the VO cue sheet.
import path from 'node:path';
import { writeCaptionFiles } from '../src/captions.js';
import { loadProject, printIssues, OUT, ROOT } from '../src/project.js';

const { timeline, issues } = loadProject(process.argv[2]);
if (printIssues(issues)) process.exit(1);
for (const f of writeCaptionFiles(timeline, OUT)) console.log(`wrote ${path.relative(ROOT, f)}`);
