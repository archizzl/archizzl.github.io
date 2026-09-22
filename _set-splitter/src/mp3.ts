import { Mp3Encoder } from "@breezystack/lamejs";

// Encode a slice of an AudioBuffer to an MP3 Blob at the given bitrate (kbps).
// Uses lamejs (pure-JS LAME port). Stereo if the source has ≥ 2 channels.
export function audioBufferSliceToMp3(
  buffer: AudioBuffer,
  startSec: number,
  endSec: number,
  bitrateKbps = 192,
): Blob {
  const sampleRate = buffer.sampleRate;
  const numChannels = Math.min(2, buffer.numberOfChannels);
  const startFrame = Math.max(0, Math.floor(startSec * sampleRate));
  const endFrame = Math.min(buffer.length, Math.floor(endSec * sampleRate));
  const frameCount = Math.max(0, endFrame - startFrame);

  const enc = new Mp3Encoder(numChannels, sampleRate, bitrateKbps);
  const chunks: Uint8Array[] = [];

  // Convert this slice to int16 PCM up front — lamejs wants Int16Array.
  const left = new Int16Array(frameCount);
  const right = numChannels === 2 ? new Int16Array(frameCount) : undefined;
  const ch0 = buffer.getChannelData(0);
  const ch1 = numChannels === 2 ? buffer.getChannelData(1) : null;
  for (let i = 0; i < frameCount; i++) {
    left[i] = floatToInt16(ch0[startFrame + i]);
    if (right && ch1) right[i] = floatToInt16(ch1[startFrame + i]);
  }

  // Feed lamejs 1152 samples at a time (its native MP3 frame size).
  const blockSize = 1152;
  for (let i = 0; i < frameCount; i += blockSize) {
    const leftBlk = left.subarray(i, Math.min(i + blockSize, frameCount));
    const rightBlk = right
      ? right.subarray(i, Math.min(i + blockSize, frameCount))
      : undefined;
    const mp3Buf = rightBlk
      ? enc.encodeBuffer(leftBlk, rightBlk)
      : enc.encodeBuffer(leftBlk);
    if (mp3Buf.length > 0) chunks.push(mp3Buf);
  }
  const tail = enc.flush();
  if (tail.length > 0) chunks.push(tail);

  return new Blob(chunks as BlobPart[], { type: "audio/mpeg" });
}

function floatToInt16(x: number): number {
  const s = Math.max(-1, Math.min(1, x));
  return s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
}
