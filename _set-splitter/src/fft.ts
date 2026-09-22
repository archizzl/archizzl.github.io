// Minimal iterative radix-2 FFT (in-place). Input length must be a power of 2.
// Real input; complex output as parallel re[] / im[] arrays.

export class FFT {
  readonly size: number;
  private readonly cosTable: Float32Array;
  private readonly sinTable: Float32Array;
  private readonly revTable: Uint32Array;

  constructor(size: number) {
    if ((size & (size - 1)) !== 0 || size < 2) {
      throw new Error("FFT size must be a power of two");
    }
    this.size = size;

    const bits = Math.log2(size);
    this.revTable = new Uint32Array(size);
    for (let i = 0; i < size; i++) {
      let x = i;
      let r = 0;
      for (let b = 0; b < bits; b++) {
        r = (r << 1) | (x & 1);
        x >>= 1;
      }
      this.revTable[i] = r;
    }

    this.cosTable = new Float32Array(size / 2);
    this.sinTable = new Float32Array(size / 2);
    for (let i = 0; i < size / 2; i++) {
      this.cosTable[i] = Math.cos((-2 * Math.PI * i) / size);
      this.sinTable[i] = Math.sin((-2 * Math.PI * i) / size);
    }
  }

  // Fills `re`/`im` (length = size) with the FFT of the real-valued `input`.
  forwardReal(input: Float32Array, re: Float32Array, im: Float32Array) {
    const n = this.size;
    for (let i = 0; i < n; i++) {
      re[i] = input[this.revTable[i]];
      im[i] = 0;
    }

    for (let stage = 2; stage <= n; stage <<= 1) {
      const half = stage >> 1;
      const step = n / stage;
      for (let k = 0; k < n; k += stage) {
        for (let j = 0; j < half; j++) {
          const twIdx = j * step;
          const c = this.cosTable[twIdx];
          const s = this.sinTable[twIdx];
          const i1 = k + j;
          const i2 = i1 + half;
          const tr = re[i2] * c - im[i2] * s;
          const ti = re[i2] * s + im[i2] * c;
          re[i2] = re[i1] - tr;
          im[i2] = im[i1] - ti;
          re[i1] += tr;
          im[i1] += ti;
        }
      }
    }
  }
}
