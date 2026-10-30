// Serves the scene for live preview in a browser (with VO audio and optional click).
import path from 'node:path';
import { ensureIngested, watchPaths } from '../src/ingest.js';
import { MEDIA_DIR } from '../src/media.js';
import { loadProject, printIssues, CONFIG, ROOT } from '../src/project.js';
import { startServer } from '../src/server.js';

await ensureIngested();
const { issues } = loadProject(process.argv[2]);
printIssues(issues);
const { url } = await startServer(ROOT, Number(process.env.PORT ?? CONFIG.previewPort));
console.log(`\nPreview: ${url}/scene/   (add ?t=8:1 to start at a bar)  Ctrl+C to stop`);

// keep the preview's timeline current: media dropped in or timeline edits apply on page reload
watchPaths([MEDIA_DIR, path.dirname(path.resolve(ROOT, CONFIG.timeline))], async () => {
  await ensureIngested();
  const { issues } = loadProject(process.argv[2]);
  console.log(`\ntimeline updated (${new Date().toLocaleTimeString()}); reload the page`);
  printIssues(issues);
});
