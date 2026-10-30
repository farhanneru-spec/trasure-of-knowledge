import fs from 'node:fs';

/** Duration in seconds of a PCM/RIFF WAV file. */
export function readWavDuration(file) {
  const buf = fs.readFileSync(file);
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('not a RIFF/WAVE file');
  }
  let off = 12;
  let byteRate = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') byteRate = buf.readUInt32LE(off + 16);
    if (id === 'data') {
      if (!byteRate) throw new Error('data chunk before fmt chunk');
      return Math.min(size, buf.length - off - 8) / byteRate;
    }
    off += 8 + size + (size & 1);
  }
  throw new Error('no data chunk');
}

/** Metronome WAV (16-bit mono) to record the VO against; accent on each downbeat. */
export function writeClickTrack(file, { bpm, beatsPerBar, beats, sampleRate = 48000 }) {
  const beatSec = 60 / bpm;
  const total = Math.round(beats * beatSec * sampleRate);
  const clickLen = Math.round(0.04 * sampleRate);
  const data = Buffer.alloc(total * 2);

  for (let b = 0; b < beats; b++) {
    const accent = b % beatsPerBar === 0;
    const freq = accent ? 1760 : 1320;
    const amp = accent ? 0.8 : 0.5;
    const s0 = Math.round(b * beatSec * sampleRate);
    for (let i = 0; i < clickLen && s0 + i < total; i++) {
      const v = Math.sin((2 * Math.PI * freq * i) / sampleRate) * Math.exp(-i / (clickLen / 5)) * amp;
      data.writeInt16LE(Math.round(v * 32767), (s0 + i) * 2);
    }
  }

  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([header, data]));
}
