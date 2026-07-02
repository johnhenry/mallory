import { ComplexNumber } from "./ComplexNumber.ts";

/**
 * FFT — the discrete Fourier transform and its fast (Cooley-Tukey) radix-2
 * implementation, plus the inverse transform and FFT-based convolution. Builds
 * on {@link ComplexNumber}. Inputs may be complex numbers or plain reals.
 */

type Signal = ReadonlyArray<ComplexNumber | number>;

const toParts = (input: Signal): { re: number[]; im: number[] } => {
  const re: number[] = [];
  const im: number[] = [];
  for (const x of input) {
    if (x instanceof ComplexNumber) {
      re.push(x.value);
      im.push(x.iValue);
    } else {
      re.push(x);
      im.push(0);
    }
  }
  return { re, im };
};

const toComplex = (re: number[], im: number[]): ComplexNumber[] => re.map((r, i) => new ComplexNumber(r, im[i]));

const isPowerOfTwo = (n: number): boolean => n > 0 && (n & (n - 1)) === 0;

/** In-place iterative radix-2 Cooley-Tukey. `invert` runs the inverse transform. */
function transform(re: number[], im: number[], invert: boolean): void {
  const n = re.length;
  // bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((2 * Math.PI) / len) * (invert ? 1 : -1);
    const wlenR = Math.cos(ang);
    const wlenI = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let wr = 1;
      let wi = 0;
      for (let j = 0; j < len / 2; j++) {
        const uR = re[i + j];
        const uI = im[i + j];
        const vR = re[i + j + len / 2] * wr - im[i + j + len / 2] * wi;
        const vI = re[i + j + len / 2] * wi + im[i + j + len / 2] * wr;
        re[i + j] = uR + vR;
        im[i + j] = uI + vI;
        re[i + j + len / 2] = uR - vR;
        im[i + j + len / 2] = uI - vI;
        const nwr = wr * wlenR - wi * wlenI;
        wi = wr * wlenI + wi * wlenR;
        wr = nwr;
      }
    }
  }
  if (invert)
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
}

export class FFT {
  /** Fast Fourier transform (input length must be a power of two). */
  static fft(input: Signal): ComplexNumber[] {
    const { re, im } = toParts(input);
    if (!isPowerOfTwo(re.length)) throw new Error("FFT input length must be a power of two (see fftPadded).");
    transform(re, im, false);
    return toComplex(re, im);
  }

  /** Inverse fast Fourier transform. */
  static ifft(input: Signal): ComplexNumber[] {
    const { re, im } = toParts(input);
    if (!isPowerOfTwo(re.length)) throw new Error("IFFT input length must be a power of two.");
    transform(re, im, true);
    return toComplex(re, im);
  }

  /** FFT with the input zero-padded up to the next power of two. */
  static fftPadded(input: Signal): ComplexNumber[] {
    const { re, im } = toParts(input);
    let n = 1;
    while (n < re.length) n <<= 1;
    while (re.length < n) {
      re.push(0);
      im.push(0);
    }
    transform(re, im, false);
    return toComplex(re, im);
  }

  /** Direct O(n²) discrete Fourier transform for any length (reference implementation). */
  static dft(input: Signal): ComplexNumber[] {
    const { re, im } = toParts(input);
    const n = re.length;
    const out: ComplexNumber[] = [];
    for (let k = 0; k < n; k++) {
      let sumR = 0;
      let sumI = 0;
      for (let t = 0; t < n; t++) {
        const ang = (-2 * Math.PI * k * t) / n;
        sumR += re[t] * Math.cos(ang) - im[t] * Math.sin(ang);
        sumI += re[t] * Math.sin(ang) + im[t] * Math.cos(ang);
      }
      out.push(new ComplexNumber(sumR, sumI));
    }
    return out;
  }

  /** Linear convolution of two real (or complex) signals, via the FFT. */
  static convolve(a: Signal, b: Signal): ComplexNumber[] {
    const resultLen = a.length + b.length - 1;
    let n = 1;
    while (n < resultLen) n <<= 1;
    const pad = (s: Signal) => {
      const { re, im } = toParts(s);
      while (re.length < n) {
        re.push(0);
        im.push(0);
      }
      return { re, im };
    };
    const A = pad(a);
    const B = pad(b);
    transform(A.re, A.im, false);
    transform(B.re, B.im, false);
    const re = new Array(n);
    const im = new Array(n);
    for (let i = 0; i < n; i++) {
      re[i] = A.re[i] * B.re[i] - A.im[i] * B.im[i];
      im[i] = A.re[i] * B.im[i] + A.im[i] * B.re[i];
    }
    transform(re, im, true);
    return toComplex(re.slice(0, resultLen), im.slice(0, resultLen));
  }
}
