import { FFT } from "./fft";

export type Label = "silence" | "music" | "applause" | "talk";

export interface WindowFeature {
  t: number;          // start time in seconds
  rms: number;        // linear
  rmsDb: number;      // dB, -inf..0
  flatness: number;   // 0..1 (1 = white noise, 0 = pure tone)
  centroid: number;   // Hz
  zcr: number;        // 0..1
  musicScore: number; // 0..1
  label: Label;
  chroma: Float32Array; // 12-bin pitch-class profile (L1-normalized within window)
}

export interface Segment {
  start: number;
  end: number;
}

export interface AnalyzeOptions {
  minSongSec: number;
  minGapSec: number;
  sensitivity: number; // 0..100 — higher = more permissive about calling something "music"
}

export interface AnalyzeResult {
  features: WindowFeature[];
  windowSec: number;
  segments: Segment[];
  duration: number;
}

const FRAME_SIZE = 2048;
const HOP_SIZE = 1024;
const WINDOW_SEC = 0.5; // aggregate features into ~0.5s windows

// --- Hann window, precomputed on first use ---
let hann: Float32Array | null = null;
function hannWindow(n: number): Float32Array {
  if (hann && hann.length === n) return hann;
  hann = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
  }
  return hann;
}

function downmixToMono(buffer: AudioBuffer): Float32Array {
  const n = buffer.length;
  const ch = buffer.numberOfChannels;
  if (ch === 1) return buffer.getChannelData(0).slice();
  const out = new Float32Array(n);
  for (let c = 0; c < ch; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < n; i++) out[i] += data[i];
  }
  for (let i = 0; i < n; i++) out[i] /= ch;
  return out;
}

// Extract per-frame features and then aggregate into WINDOW_SEC windows.
export function extractFeatures(
  buffer: AudioBuffer,
  onProgress?: (frac: number) => void,
): { features: WindowFeature[]; windowSec: number; duration: number } {
  const mono = downmixToMono(buffer);
  const sampleRate = buffer.sampleRate;
  const duration = buffer.duration;

  const fft = new FFT(FRAME_SIZE);
  const window = hannWindow(FRAME_SIZE);
  const re = new Float32Array(FRAME_SIZE);
  const im = new Float32Array(FRAME_SIZE);
  const framed = new Float32Array(FRAME_SIZE);
  const spectrum = new Float32Array(FRAME_SIZE / 2);

  const framesPerWindow = Math.max(1, Math.round((WINDOW_SEC * sampleRate) / HOP_SIZE));
  const windowStep = framesPerWindow * HOP_SIZE;
  const numWindows = Math.max(1, Math.floor((mono.length - FRAME_SIZE) / windowStep));

  const features: WindowFeature[] = [];
  const nyquist = sampleRate / 2;
  const binHz = nyquist / (FRAME_SIZE / 2);

  // Precompute pitch-class assignment for each FFT bin. Bins under ~55 Hz
  // (low A) and above ~2 kHz are excluded — the fundamental and first few
  // harmonics of most musical notes fall in that range, and going wider
  // dilutes the profile with cymbals/hiss.
  const half = FRAME_SIZE / 2;
  const binPc = new Int8Array(half);
  for (let k = 0; k < half; k++) {
    const freq = k * binHz;
    if (freq < 55 || freq > 2000) { binPc[k] = -1; continue; }
    const midi = 69 + 12 * Math.log2(freq / 440);
    binPc[k] = (((Math.round(midi) % 12) + 12) % 12) as number;
  }

  let lastProgress = 0;

  for (let w = 0; w < numWindows; w++) {
    const winStartSample = w * windowStep;

    let sumRms = 0;
    let sumFlat = 0;
    let sumCentroid = 0;
    let sumZcr = 0;
    let framesUsed = 0;
    const chromaAcc = new Float32Array(12);

    for (let f = 0; f < framesPerWindow; f++) {
      const frameStart = winStartSample + f * HOP_SIZE;
      if (frameStart + FRAME_SIZE > mono.length) break;

      // Copy + apply Hann window; also compute RMS + ZCR on raw samples.
      let sqSum = 0;
      let zc = 0;
      let prevSign = mono[frameStart] >= 0 ? 1 : -1;
      for (let i = 0; i < FRAME_SIZE; i++) {
        const s = mono[frameStart + i];
        sqSum += s * s;
        const sign = s >= 0 ? 1 : -1;
        if (sign !== prevSign) zc++;
        prevSign = sign;
        framed[i] = s * window[i];
      }
      const rms = Math.sqrt(sqSum / FRAME_SIZE);

      fft.forwardReal(framed, re, im);

      // Magnitude spectrum (positive frequencies).
      let specSum = 0;
      let logSum = 0;
      let centNum = 0;
      for (let k = 1; k < half; k++) {
        const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
        spectrum[k] = mag;
        specSum += mag;
        logSum += Math.log(mag + 1e-12);
        centNum += mag * (k * binHz);
        const pc = binPc[k];
        if (pc >= 0) chromaAcc[pc] += mag;
      }
      const arith = specSum / (half - 1);
      const geo = Math.exp(logSum / (half - 1));
      const flatness = arith > 0 ? Math.min(1, geo / arith) : 0;
      const centroid = specSum > 0 ? centNum / specSum : 0;

      sumRms += rms;
      sumFlat += flatness;
      sumCentroid += centroid;
      sumZcr += zc / FRAME_SIZE;
      framesUsed++;
    }

    if (framesUsed === 0) continue;
    const rms = sumRms / framesUsed;
    const flatness = sumFlat / framesUsed;
    const centroid = sumCentroid / framesUsed;
    const zcr = sumZcr / framesUsed;
    const rmsDb = 20 * Math.log10(rms + 1e-9);

    // L1-normalize the chroma so loudness doesn't dominate; keeps it a
    // pitch-class *profile* (fraction of energy per pitch class).
    let chromaSum = 0;
    for (let i = 0; i < 12; i++) chromaSum += chromaAcc[i];
    const chroma = new Float32Array(12);
    if (chromaSum > 0) {
      for (let i = 0; i < 12; i++) chroma[i] = chromaAcc[i] / chromaSum;
    }

    features.push({
      t: winStartSample / sampleRate,
      rms,
      rmsDb,
      flatness,
      centroid,
      zcr,
      musicScore: 0,
      label: "silence",
      chroma,
    });

    if (onProgress) {
      const p = w / numWindows;
      if (p - lastProgress > 0.02) {
        onProgress(p);
        lastProgress = p;
      }
    }
  }

  if (onProgress) onProgress(1);
  return { features, windowSec: WINDOW_SEC, duration };
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = arr.slice().sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor(p * sorted.length)));
  return sorted[idx];
}

// Classify each window in-place given the current sensitivity setting and
// self-calibrate against the file's own noise floor.
//
// Core idea: music is *tonal* — its energy concentrates in a few frequency
// bands. Applause, talk, wind, and silence-with-hiss are all comparatively
// broadband. Spectral flatness captures this directly, so it does most of the
// work; RMS just decides silence vs. real signal.
function classify(features: WindowFeature[], sensitivity: number) {
  if (features.length === 0) return;

  const rmsDbs = features.map((f) => f.rmsDb);
  const noiseFloor = percentile(rmsDbs, 0.05);
  const loudDb = percentile(rmsDbs, 0.9);

  // Silence: within ~8 dB of the file's noise floor, but never above -35 dB —
  // a floor higher than that isn't really silence, it's a loud room.
  const silenceDb = Math.min(noiseFloor + 8, -35);

  // Sensitivity: -1..+1. Positive = more permissive about calling something
  // music (tolerate higher flatness).
  const sensBias = (sensitivity - 50) / 50;
  const flatnessThreshold = 0.25 - sensBias * 0.1; // 0.15..0.35

  for (const f of features) {
    // 0 at silenceDb → 1 at loudDb-ish.
    const energyScore = clamp01(
      (f.rmsDb - silenceDb) / Math.max(6, loudDb - silenceDb),
    );

    // Tonality: 1 for pure tones, 0 for broadband noise. The threshold
    // separates real music from noise-like content in this file.
    const tonalScore = clamp01(1 - f.flatness / flatnessThreshold);

    // Low ZCR reinforces tonal content — pure tones cross zero at their
    // fundamental frequency, so ZCR is small; noise and hiss push it up.
    const zcrScore = clamp01(1 - f.zcr / 0.15);

    // Combined: needs to actually be sounding, and be tonal.
    f.musicScore = clamp01(
      Math.min(energyScore, 0.2 + 0.8 * tonalScore) * (0.7 + 0.3 * zcrScore),
    );

    if (f.rmsDb < silenceDb) {
      f.label = "silence";
    } else if (f.flatness > 0.4 && f.zcr > 0.2) {
      f.label = "applause";
    } else if (f.musicScore > 0.5) {
      f.label = "music";
    } else {
      f.label = "talk";
    }
  }

  // Smooth the music score with a moving average to bridge tiny dips (a
  // single quiet bar, a breath in the vocal).
  const smoothed = new Float32Array(features.length);
  const half = 2; // ± windows → ~2.5s
  for (let i = 0; i < features.length; i++) {
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(features.length - 1, i + half); j++) {
      sum += features[j].musicScore;
      count++;
    }
    smoothed[i] = sum / count;
  }
  for (let i = 0; i < features.length; i++) features[i].musicScore = smoothed[i];
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

// Turn a boolean is-music timeline into song segments respecting min-song /
// min-gap. Gap-filling merges short non-music runs sandwiched between music.
export function segmentSongs(
  features: WindowFeature[],
  windowSec: number,
  duration: number,
  opts: AnalyzeOptions,
): Segment[] {
  classify(features, opts.sensitivity);
  if (features.length === 0) return [];

  const threshold = 0.5;
  const isMusic = features.map((f) => f.musicScore > threshold);

  // Fill short gaps (< minGap) between music runs so a brief cheer inside a
  // song doesn't split it.
  const gapFrames = Math.ceil(opts.minGapSec / windowSec);
  for (let i = 0; i < isMusic.length; i++) {
    if (isMusic[i]) continue;
    let j = i;
    while (j < isMusic.length && !isMusic[j]) j++;
    const runLen = j - i;
    const leftMusic = i > 0 && isMusic[i - 1];
    const rightMusic = j < isMusic.length && isMusic[j];
    if (leftMusic && rightMusic && runLen < gapFrames) {
      for (let k = i; k < j; k++) isMusic[k] = true;
    }
    i = j - 1;
  }

  // Collect runs.
  const runs: Segment[] = [];
  let i = 0;
  while (i < isMusic.length) {
    if (!isMusic[i]) { i++; continue; }
    let j = i;
    while (j < isMusic.length && isMusic[j]) j++;
    const start = features[i].t;
    const end = j < features.length ? features[j].t : duration;
    runs.push({ start, end });
    i = j;
  }

  // Filter by min song length.
  const kept = runs.filter((r) => r.end - r.start >= opts.minSongSec);

  // Snap boundaries: pull the start back to the nearest preceding silence/talk
  // edge within 1s so we don't cut into the intro; push the end forward
  // similarly to catch decaying reverb.
  const pad = 0.75;
  return kept.map((r) => ({
    start: Math.max(0, r.start - pad),
    end: Math.min(duration, r.end + pad),
  }));
}

export function analyze(
  buffer: AudioBuffer,
  opts: AnalyzeOptions,
  onProgress?: (frac: number) => void,
): AnalyzeResult {
  const { features, windowSec, duration } = extractFeatures(buffer, onProgress);
  const segments = segmentSongs(features, windowSec, duration, opts);
  return { features, windowSec, segments, duration };
}
