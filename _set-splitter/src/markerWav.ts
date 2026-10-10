// A dedicated writer for the "marker file": a mono 16-bit WAV that's silent
// everywhere except for a short beep at each boundary time.
//
// Writes bytes directly into the output ArrayBuffer — no Float32 intermediate,
// no AudioBuffer, no encoder. The data section starts out as zeros (that's
// how `new ArrayBuffer()` initializes) which already IS the silence; we just
// overwrite the beep windows. One O(markers × beepLen) loop total, so even a
// multi-hour recording finishes in milliseconds.

export interface MarkerWavOpts {
  durationSec: number;
  sampleRate: number;
  markerTimes: number[]; // seconds, assumed already sorted & deduped
  freqHz?: number;       // default 1000
  beepSec?: number;      // default 0.08
  amplitude?: number;    // 0..1, default 0.9
}

export function buildMarkerWav(opts: MarkerWavOpts): Blob {
  const {
    durationSec,
    sampleRate,
    markerTimes,
    freqHz = 1000,
    beepSec = 0.08,
    amplitude = 0.9,
  } = opts;

  const numChannels = 1;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const numFrames = Math.max(0, Math.floor(durationSec * sampleRate));
  const dataSize = numFrames * blockAlign;
  const headerSize = 44;

  const buf = new ArrayBuffer(headerSize + dataSize);
  const view = new DataView(buf);

  writeStr(view, 0, "RIFF");
  view.setUint32(4, headerSize + dataSize - 8, true);
  writeStr(view, 8, "WAVE");
  writeStr(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeStr(view, 36, "data");
  view.setUint32(40, dataSize, true);

  const beepLen = Math.floor(beepSec * sampleRate);
  const fadeIn = Math.floor(0.003 * sampleRate);
  const fadeOut = Math.floor(0.01 * sampleRate);

  for (const t of markerTimes) {
    const startFrame = Math.max(0, Math.floor(t * sampleRate));
    for (let i = 0; i < beepLen; i++) {
      const frame = startFrame + i;
      if (frame >= numFrames) break;
      const env =
        i < fadeIn ? i / fadeIn
        : i > beepLen - fadeOut ? (beepLen - i) / fadeOut
        : 1;
      const s = amplitude * env * Math.sin(2 * Math.PI * freqHz * (i / sampleRate));
      const clamped = s > 1 ? 1 : s < -1 ? -1 : s;
      const int16 = clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);
      view.setInt16(headerSize + frame * blockAlign, int16, true);
    }
  }

  return new Blob([buf], { type: "audio/wav" });
}

function writeStr(view: DataView, offset: number, s: string): void {
  for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
}
