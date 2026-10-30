// Shared command-line handling: every script accepts the same job options.
//   --episode N     timeline/episode-NN.json
//   --theme NAME    themes/NAME.json, overriding the timeline's own theme
//   --langs ar,ur   caption languages, one video each (default: all the timeline has)
//   --timeline F    any timeline file (also accepted as the first plain argument)
import { parseArgs } from 'node:util';
import { resolveJobs } from './project.js';

export function parseJobArgs(options = {}) {
  try {
    const { values, positionals } = parseArgs({
      allowPositionals: true,
      options: {
        episode: { type: 'string' },
        theme: { type: 'string' },
        langs: { type: 'string' },
        lang: { type: 'string' }, // same as --langs, for a single language
        multilingual: { type: 'string' }, // true = every language (the default), false = the first only
        timeline: { type: 'string' },
        ...options,
      },
    });
    let langs = (values.langs ?? values.lang ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (values.multilingual != null) {
      const on = /^(true|yes|1|on)$/i.test(values.multilingual);
      if (!on && !/^(false|no|0|off)$/i.test(values.multilingual)) {
        throw new Error(`--multilingual takes true or false (got "${values.multilingual}")`);
      }
      if (!on && !langs.length) langs = [resolveJobs({ episode: values.episode, timeline: values.timeline ?? positionals[0] })[0].lang];
    }
    const jobs = resolveJobs({ episode: values.episode, theme: values.theme, timeline: values.timeline ?? positionals[0], langs });
    return { opt: values, jobs, job: jobs[0] };
  } catch (e) {
    // unknown flags, bad episode numbers, unknown languages: one clear line instead of a stack trace
    console.error(e.message);
    const known = ['episode', 'theme', 'langs', 'timeline', ...Object.keys(options)].map((o) => `--${o}`).join(', ');
    if (e.code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION') console.error(`options: ${known}`);
    process.exit(1);
  }
}
