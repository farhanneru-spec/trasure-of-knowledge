// Caption languages. A timeline lists the ones it has ("languages": ["ar", "ur"]); each cue
// and standalone caption carries its text under the language code. Every language needs a
// bundled font (@font-face in scene/scene.css, file in assets/fonts).
const ARABIC_SCRIPT = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;

export const LANGUAGES = {
  ar: {
    name: 'Arabic',
    dir: 'rtl',
    font: 'Noto Naskh Arabic',
    weight: 700,
    lineHeight: 1.7,
    sizeScale: 1,
    iso639_2: 'ara', // MP4 subtitle track tag
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
