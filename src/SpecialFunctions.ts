/**
 * SpecialFunctions — the higher transcendental functions that statistics and
 * analysis rely on: the gamma and log-gamma functions (Lanczos), the beta
 * function, the error function `erf`/`erfc`, and the regularised incomplete
 * gamma and beta functions (which give the distribution CDFs in
 * {@link Distributions} exact closed forms rather than numeric integration).
 */

const LANCZOS_G = 7;
const LANCZOS = [
  0.9999999999998099, 676.5203681218851, -1259.1392167224028, 771.3234287776531, -176.6150291621406, 12.507343278686905,
  -0.13857109526572012, 9.984369578019572e-6, 1.5056327351493116e-7,
];

export class SpecialFunctions {
  /** The gamma function Γ(x) (Lanczos approximation). */
  static gamma(x: number): number {
    if (x < 0.5) return Math.PI / (Math.sin(Math.PI * x) * SpecialFunctions.gamma(1 - x));
    const z = x - 1;
    let a = LANCZOS[0];
    const t = z + LANCZOS_G + 0.5;
    for (let i = 1; i < LANCZOS.length; i++) a += LANCZOS[i] / (z + i);
    return Math.sqrt(2 * Math.PI) * t ** (z + 0.5) * Math.exp(-t) * a;
  }

  /** The natural log of |Γ(x)| — stable for large arguments. */
  static lnGamma(x: number): number {
    if (x < 0.5) return Math.log(Math.abs(Math.PI / Math.sin(Math.PI * x))) - SpecialFunctions.lnGamma(1 - x);
    const z = x - 1;
    let a = LANCZOS[0];
    const t = z + LANCZOS_G + 0.5;
    for (let i = 1; i < LANCZOS.length; i++) a += LANCZOS[i] / (z + i);
    return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
  }

  /** The beta function B(a, b) = Γ(a)Γ(b)/Γ(a+b). */
  static beta(a: number, b: number): number {
    return Math.exp(SpecialFunctions.lnGamma(a) + SpecialFunctions.lnGamma(b) - SpecialFunctions.lnGamma(a + b));
  }

  /** The error function erf(x). */
  static erf(x: number): number {
    const sign = x < 0 ? -1 : 1;
    const ax = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * ax);
    const y =
      1 -
      ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
        t *
        Math.exp(-ax * ax);
    return sign * y;
  }

  /** The complementary error function erfc(x) = 1 − erf(x). */
  static erfc(x: number): number {
    return 1 - SpecialFunctions.erf(x);
  }

  /**
   * The regularised lower incomplete gamma function P(a, x) = γ(a, x)/Γ(a).
   * (This is the CDF of the gamma/chi-square distributions.)
   */
  static regularizedGammaP(a: number, x: number): number {
    if (x < 0 || a <= 0) return Number.NaN;
    if (x === 0) return 0;
    if (x < a + 1) {
      // series expansion
      let ap = a;
      let sum = 1 / a;
      let del = sum;
      for (let n = 0; n < 200; n++) {
        ap++;
        del *= x / ap;
        sum += del;
        if (Math.abs(del) < Math.abs(sum) * 1e-15) break;
      }
      return sum * Math.exp(-x + a * Math.log(x) - SpecialFunctions.lnGamma(a));
    }
    // continued fraction for the upper part Q, then P = 1 - Q
    const tiny = 1e-300;
    let b = x + 1 - a;
    let c = 1 / tiny;
    let d = 1 / b;
    let h = d;
    for (let i = 1; i < 200; i++) {
      const an = -i * (i - a);
      b += 2;
      d = an * d + b;
      if (Math.abs(d) < tiny) d = tiny;
      c = b + an / c;
      if (Math.abs(c) < tiny) c = tiny;
      d = 1 / d;
      const del = d * c;
      h *= del;
      if (Math.abs(del - 1) < 1e-15) break;
    }
    const q = Math.exp(-x + a * Math.log(x) - SpecialFunctions.lnGamma(a)) * h;
    return 1 - q;
  }

  /** The regularised upper incomplete gamma function Q(a, x) = 1 − P(a, x). */
  static regularizedGammaQ(a: number, x: number): number {
    return 1 - SpecialFunctions.regularizedGammaP(a, x);
  }

  /**
   * The regularised incomplete beta function I_x(a, b). (This is the CDF of the
   * beta distribution and underlies the Student-t and F distributions.)
   */
  static regularizedIncompleteBeta(x: number, a: number, b: number): number {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    const lbeta = SpecialFunctions.lnGamma(a + b) - SpecialFunctions.lnGamma(a) - SpecialFunctions.lnGamma(b);
    const front = Math.exp(lbeta + a * Math.log(x) + b * Math.log(1 - x));
    // Use the continued fraction that converges fastest, swapping (a,b,x) as needed.
    if (x < (a + 1) / (a + b + 2)) return (front * betaContinuedFraction(a, b, x)) / a;
    return 1 - (front * betaContinuedFraction(b, a, 1 - x)) / b;
  }
}

/** Lentz's continued fraction for the incomplete beta (Numerical Recipes `betacf`). */
function betaContinuedFraction(a: number, b: number, x: number): number {
  const tiny = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < tiny) d = tiny;
  d = 1 / d;
  let h = d;
  for (let m = 1; m < 200; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return h;
}
