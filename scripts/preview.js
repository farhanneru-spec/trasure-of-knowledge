// Serves the scene for live preview in a browser (with VO audio and optional click).
//   npm run preview -- --episode 1 --theme cozy-courtyard
import path from 'node:path';
import { parseJobArgs } from '../src/cli.js';
import { ensureIngested, watchPaths } from '../src/ingest.js';
import { MEDIA_DIR } from '../src/media.js';
import { loadProject, printIssues, CONFIG, ROOT } from '../src/project.js';
import { startServer } from '../src/server.js';
import { THEMES_DIR } from '../src/themes.js';

const { job } = parseJobArgs();
await ensureIngested();
const { issues, dataUrl, timeline } = loadProject(job);
printIssues(issues);
const { url } = await startServer(ROOT, Number(process.env.PORT ?? CONFIG.previewPort));
console.log(`\n${job.name} (theme ${timeline.theme?.name})`);
console.log(`Preview: ${url}/scene/?data=${encodeURIComponent(dataUrl)}   (add &t=8:1 to start at a bar)  Ctrl+C to stop`);

// keep the preview current: media dropped in, timeline or theme edits apply on page reload
watchPaths([MEDIA_DIR, path.dirname(path.resolve(ROOT, job.file)), THEMES_DIR], async () => {
  await ensureIngested();
  const { issues } = loadProject(job);
  console.log(`\nupdated (${new Date().toLocaleTimeString()}); reload the page`);
  printIssues(issues);
});
