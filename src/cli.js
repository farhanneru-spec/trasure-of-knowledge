// Shared command-line handling: every script accepts the same job options.
//   --episode N    timeline/episode-NN.json
//   --theme NAME   themes/NAME.json, overriding the timeline's own theme
//   --timeline F   any timeline file (also accepted as the first plain argument)
import { parseArgs } from 'node:util';
import { resolveJob } from './project.js';

export function parseJobArgs(options = {}) {
  try {
    const { values, positionals } = parseArgs({
      allowPositionals: true,
      options: {
        episode: { type: 'string' },
        theme: { type: 'string' },
        timeline: { type: 'string' },
        ...options,
      },
    });
    const job = resolveJob({ episode: values.episode, theme: values.theme, timeline: values.timeline ?? positionals[0] });
    return { opt: values, job };
  } catch (e) {
    // unknown flags, bad episode numbers: one clear line instead of a stack trace
    console.error(e.message);
    const known = ['episode', 'theme', 'timeline', ...Object.keys(options)].map((o) => `--${o}`).join(', ');
    if (e.code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION') console.error(`options: ${known}`);
    process.exit(1);
  }
}
