// Playback engine for the loaded AudioBuffer. WebAudio's BufferSource is
// one-shot, so a "seek" is really "stop the old source, start a new one at
// the new offset." We track playhead time ourselves against ctx.currentTime.

export class Player {
  private ctx: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;
  private buffer: AudioBuffer | null = null;
  private startedAt = 0;
  private offsetSec = 0;
  private playing = false;

  onChange?: () => void;

  setBuffer(buffer: AudioBuffer) {
    this.stop();
    this.buffer = buffer;
    this.offsetSec = 0;
    this.notify();
  }

  get isPlaying() { return this.playing; }

  get currentTime(): number {
    if (this.playing && this.ctx) {
      return this.offsetSec + (this.ctx.currentTime - this.startedAt);
    }
    return this.offsetSec;
  }

  get duration(): number {
    return this.buffer?.duration ?? 0;
  }

  play(fromSec?: number) {
    if (!this.buffer) return;
    if (!this.ctx) this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    this.stopSource();
    const startSec = clamp(fromSec ?? this.currentTime, 0, this.duration - 0.02);
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.connect(this.ctx.destination);
    src.onended = () => {
      // Guard against onended firing after a manual stop that already updated state.
      if (this.source === src) {
        this.source = null;
        this.playing = false;
        this.offsetSec = this.duration;
        this.notify();
      }
    };
    src.start(0, startSec);
    this.source = src;
    this.startedAt = this.ctx.currentTime;
    this.offsetSec = startSec;
    this.playing = true;
    this.notify();
  }

  pause() {
    if (!this.playing) return;
    const t = this.currentTime;
    this.stopSource();
    this.offsetSec = t;
    this.playing = false;
    this.notify();
  }

  stop() {
    this.stopSource();
    this.offsetSec = 0;
    this.playing = false;
    this.notify();
  }

  seek(toSec: number) {
    const t = clamp(toSec, 0, this.duration);
    if (this.playing) this.play(t);
    else { this.offsetSec = t; this.notify(); }
  }

  toggle(atSec?: number) {
    if (this.playing) this.pause();
    else this.play(atSec);
  }

  private stopSource() {
    if (this.source) {
      try { this.source.onended = null; this.source.stop(); } catch { /* already stopped */ }
      this.source.disconnect();
      this.source = null;
    }
  }

  private notify() {
    this.onChange?.();
  }
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}
