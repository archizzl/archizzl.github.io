// Runs the FFT-heavy feature extraction off the main thread. The main thread
// decodes audio (needs AudioContext) and handles segmentation (cheap).

import { extractFeatures, type WindowFeature } from "./analyze";

interface AnalyzeRequest {
  type: "analyze";
  channels: Float32Array[];
  sampleRate: number;
  length: number;
  numberOfChannels: number;
  duration: number;
}

interface AnalyzeResponse {
  type: "done" | "progress" | "error";
  features?: WindowFeature[];
  windowSec?: number;
  duration?: number;
  progress?: number;
  error?: string;
}

// Reconstruct a minimal AudioBuffer-shaped object that satisfies the
// `AudioBuffer` interface subset used by extractFeatures.
function makeBufferLike(req: AnalyzeRequest): AudioBuffer {
  return {
    sampleRate: req.sampleRate,
    length: req.length,
    duration: req.duration,
    numberOfChannels: req.numberOfChannels,
    getChannelData(c: number) {
      return req.channels[c];
    },
    copyFromChannel() {},
    copyToChannel() {},
  } as unknown as AudioBuffer;
}

self.onmessage = (ev: MessageEvent<AnalyzeRequest>) => {
  const msg = ev.data;
  if (msg.type !== "analyze") return;
  try {
    const buffer = makeBufferLike(msg);
    const { features, windowSec, duration } = extractFeatures(buffer, (frac) => {
      const resp: AnalyzeResponse = { type: "progress", progress: frac };
      (self as unknown as Worker).postMessage(resp);
    });
    const resp: AnalyzeResponse = { type: "done", features, windowSec, duration };
    (self as unknown as Worker).postMessage(resp);
  } catch (e) {
    const resp: AnalyzeResponse = {
      type: "error",
      error: e instanceof Error ? e.message : String(e),
    };
    (self as unknown as Worker).postMessage(resp);
  }
};
