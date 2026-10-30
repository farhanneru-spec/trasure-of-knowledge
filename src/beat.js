// Beat clock shared by Node (resolver, render) and the browser scene.
// Positions are either a beat number (0-based) or "bar:beat" (1-based, like a DAW).

export function createClock({ bpm, beatsPerBar = 4 }) {
  if (!(bpm > 0)) throw new Error(`bpm must be a positive number (got ${bpm})`);
  const beatSec = 60 / bpm;

  function parse(pos) {
    if (typeof pos === 'number' || /^\d+(\.\d+)?$/.test(String(pos).trim())) {
      const b = Number(pos);
      if (!(b >= 0)) throw new Error(`beat position ${pos} must be >= 0`);
      return b;
    }
    const m = /^(\d+):(\d+(?:\.\d+)?)$/.exec(String(pos).trim());
    if (!m) throw new Error(`bad position "${pos}" (use a beat number or "bar:beat", e.g. "3:1")`);
    const bar = Number(m[1]);
    const beat = Number(m[2]);
    if (bar < 1 || beat < 1 || beat >= beatsPerBar + 1) {
      throw new Error(`position "${pos}" out of range (bars start at 1, beats are 1-${beatsPerBar})`);
    }
    return (bar - 1) * beatsPerBar + (beat - 1);
  }

  function label(b) {
    const bar = Math.floor(b / beatsPerBar) + 1;
    const beat = b - (bar - 1) * beatsPerBar + 1;
    return `${bar}:${+beat.toFixed(3)}`;
  }

  return {
    bpm,
    beatsPerBar,
    beatSec,
    parse,
    label,
    toSec: (b) => b * beatSec,
    toBeat: (s) => s / beatSec,
    snap: (b, grid) => Math.round(b / grid) * grid,
    isOnGrid: (b, grid) => Math.abs(b / grid - Math.round(b / grid)) < 1e-6,
  };
}
