// Languages. A timeline lists the ones it has ("languages": ["ar", "ur", "en"]); each cue and
// standalone caption carries its text under the language code. Each language becomes its own
// video: its captions burned in and its voice-over (assets/vo/<lang>/<cue id>.wav) on the
// soundtrack. Every language needs a bundled font (@font-face in scene/scene.css).
// speechCps is a rough speaking rate (characters per second incl. spaces) used only to warn
// when a line probably won't fit its beat slot before anything is recorded.
const ARABIC_SCRIPT = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;

export const LANGUAGES = {
  en: {
    name: 'English',
    dir: 'ltr',
    font: 'Cormorant Garamond',
    weight: 600,
    lineHeight: 1.35,
    sizeScale: 1.1, // Cormorant's small x-height reads smaller than Naskh at the same size
    iso639_2: 'eng',
    speechCps: 14,
    script: /[A-Za-z]/,
  },
  ar: {
    name: 'Arabic',
    dir: 'rtl',
    font: 'Noto Naskh Arabic',
    weight: 700,
    lineHeight: 1.7,
    sizeScale: 1,
    iso639_2: 'ara', // MP4 subtitle track tag
    speechCps: 12,
    script: ARABIC_SCRIPT,
  },
  ur: {
    name: 'Urdu',
    dir: 'rtl',
    font: 'Noto Nastaliq Urdu',
    weight: 700,
    lineHeight: 2.3, // Nastaliq is tall: it slopes down from right to left
    sizeScale: 0.85,
    iso639_2: 'urd',
    speechCps: 13,
    script: ARABIC_SCRIPT,
    // Arabic-keyboard letters that look like, but aren't, the Urdu ones (and render differently in Nastaliq)
    lint: (s) => (/[كيه]/.test(s) ? 'uses Arabic ك/ي/ه where Urdu writes ک/ی/ہ' : null),
  },
};

/** The serialisable part of a language, for the scene and exports. */
export const langInfo = (code) => {
  const { script, lint, ...rest } = LANGUAGES[code];
  return { code, ...rest };
};
