import { hyperbolicCosine as realHCos, hyperbolicSine as realHSin, roundTo } from "./RealMath.ts";
import { Vector } from "./Vector.ts";

/** Anything that can stand in for a complex operand in a fluent method call. */
export type CNInput = ComplexNumber | number;

function coerce(x: CNInput): ComplexNumber {
  return x instanceof ComplexNumber ? x : new ComplexNumber(x);
}

/** Round tiny floating-point noise out of both components (10 decimal places). */
function roundComplex(z: ComplexNumber, precision = 10): ComplexNumber {
  return new ComplexNumber(roundTo(z.value, precision), roundTo(z.iValue, precision));
}

/**
 * ComplexNumber — an immutable-ish complex value `value + iValue·i`, with a
 * fluent arithmetic/trigonometric API matching the style of `Quaternion`/
 * `Rational`/`DualNumber`/`Decimal`.
 *
 * Ported from Mallory's ActionScript `ComplexNumber`. The AS3 class extended
 * `Array` and stashed its two coordinates in a private `Vector`; that indirection
 * bought nothing, so here the real and imaginary parts are plain number fields.
 * The historical accessor names `value` (real) and `iValue` (imaginary) are kept
 * because the rest of the library reads them hundreds of times; `re`/`im` are
 * provided as modern aliases.
 *
 * The arithmetic/trig/log methods and the `E`/`I`/`PI`/`PHI`/`Zero`/`One`
 * constants and `random()` factory were previously the static-method "namespace
 * class" `ComplexMath` — folded in here so a complex value carries its own
 * operations rather than requiring a second class to operate on it.
 *
 * Bug fixes relative to the AS3 original:
 *  - `parse` (was `fromString`) no longer throws when `String.match` returns
 *    `null`, and it correctly handles negative imaginary parts and the bare
 *    `i` / `-i` forms, so it round-trips with `toString`.
 *  - `toString` renders a negative imaginary part as `a-b*i` rather than the
 *    old `a+-b*i`.
 *  - `divide`'s zero-divisor branches compared `alpha.ivalue` (lowercase v),
 *    which is always `undefined`, so the eight directed infinities were never
 *    returned. Fixed to `iValue`.
 *  - `power`: a zero base produced `NaN` (via `ln 0`); now handled directly, so
 *    `square(0)`, `squareRoot(0)` and e.g. `arcSine(0)` are correct.
 */
export class ComplexNumber {
  value: number;
  iValue: number;

  /** "Not a Complex Number" — both parts NaN. */
  static readonly NaCN = new ComplexNumber(NaN, NaN);

  // The eight directed infinities of the complex plane.
  static readonly PositiveInfinity = new ComplexNumber(Infinity, 0);
  static readonly InfinityQ1 = new ComplexNumber(Infinity, Infinity);
  static readonly PositiveInfinityI = new ComplexNumber(0, Infinity);
  static readonly InfinityQ2 = new ComplexNumber(-Infinity, Infinity);
  static readonly NegativeInfinity = new ComplexNumber(-Infinity, 0);
  static readonly InfinityQ3 = new ComplexNumber(-Infinity, -Infinity);
  static readonly NegativeInfinityI = new ComplexNumber(0, -Infinity);
  static readonly InfinityQ4 = new ComplexNumber(Infinity, -Infinity);

  static readonly Zero = new ComplexNumber(0, 0);
  static readonly One = new ComplexNumber(1, 0);
  static readonly I = new ComplexNumber(0, 1);
  static readonly E = new ComplexNumber(Math.E, 0);
  static readonly PI = new ComplexNumber(Math.PI, 0);
  static readonly PHI = new ComplexNumber((1 + Math.sqrt(5)) / 2, 0);

  /**
   * Construct a complex number. Accepts:
   *  - `()` → 0
   *  - `(re, im)` → re + im·i
   *  - `(ComplexNumber)` → a copy
   *  - `(number)` → a real number
   *  - `(string)` → parsed (see {@link ComplexNumber.parse})
   */
  constructor(value: number | ComplexNumber | string = 0, iValue = 0) {
    if (value instanceof ComplexNumber) {
      this.value = value.value;
      this.iValue = value.iValue;
    } else if (typeof value === "string") {
      const parsed = ComplexNumber.parse(value);
      this.value = parsed.value;
      this.iValue = parsed.iValue;
    } else {
      this.value = value;
      this.iValue = iValue;
    }
  }

  /** Modern alias for {@link value} (the real part). */
  get re(): number {
    return this.value;
  }
  set re(v: number) {
    this.value = v;
  }

  /** Modern alias for {@link iValue} (the imaginary part). */
  get im(): number {
    return this.iValue;
  }
  set im(v: number) {
    this.iValue = v;
  }

  /**
   * Coerce an arbitrary value into a ComplexNumber, returning {@link NaCN} for
   * anything that cannot be interpreted numerically. Safe replacement for the
   * AS3 pattern `new ComplexNumber(element)` used by {@link isComplex}.
   */
  static from(input: unknown): ComplexNumber {
    if (input instanceof ComplexNumber) return new ComplexNumber(input);
    if (typeof input === "number") return new ComplexNumber(input, 0);
    if (typeof input === "string") return ComplexNumber.parse(input);
    return new ComplexNumber(NaN, NaN);
  }

  /** True when `input` is NOT a finite/definite complex number. */
  static isNotComplex(input: unknown): boolean {
    const c = ComplexNumber.from(input);
    return Number.isNaN(c.value) || Number.isNaN(c.iValue);
  }

  /** True when `input` can be interpreted as a complex number. */
  static isComplex(input: unknown): boolean {
    const c = ComplexNumber.from(input);
    return !Number.isNaN(c.value) && !Number.isNaN(c.iValue);
  }

  /**
   * Wrap arguments into a ComplexNumber. Mirrors AS3 `Wrap`: one argument is
   * coerced, two are taken as (re, im). Returns {@link NaCN} for other arities
   * (the AS3 version returned `false`; a ComplexNumber is friendlier and typed).
   */
  static wrap(...args: Array<number | ComplexNumber | string>): ComplexNumber {
    if (args.length === 1) return ComplexNumber.from(args[0]);
    if (args.length === 2) return new ComplexNumber(Number(args[0]), Number(args[1]));
    return new ComplexNumber(NaN, NaN);
  }

  /** Build a real complex number from a plain number. */
  static fromNumber(num: number): ComplexNumber {
    return new ComplexNumber(num, 0);
  }

  /** Build a complex number from polar form `r·e^(iθ)` (inverse of magnitude/angle). */
  static fromPolar(magnitude: number, angle: number): ComplexNumber {
    return new ComplexNumber(magnitude * Math.cos(angle), magnitude * Math.sin(angle));
  }

  /** Build a complex number from a `[re, im]` vector-like (inverse of {@link toVector}). */
  static fromVector(coordinates: ArrayLike<number>): ComplexNumber {
    return new ComplexNumber(coordinates[0] ?? 0, coordinates[1] ?? 0);
  }

  /** Parse the `<complexNumber>` form produced by {@link toXML} (inverse of it). */
  static fromXML(xml: string): ComplexNumber {
    const re = /<value>(.*?)<\/value>/.exec(xml);
    const im = /<iValue>(.*?)<\/iValue>/.exec(xml);
    return new ComplexNumber(re ? Number(re[1]) : NaN, im ? Number(im[1]) : NaN);
  }

  /**
   * Parse a string such as `"3"`, `"-2*i"`, `"i"`, `"3+2*i"`, `"3-2i"`.
   * The `*` between coefficient and `i` is optional. Whitespace is ignored.
   * Returns {@link NaCN} when the string is not a recognisable complex literal.
   */
  static parse(expression: string): ComplexNumber {
    // Collapse only the `*` that multiplies `i` (e.g. `2*i` -> `2i`); a bare `*`
    // is multiplication and must NOT be swallowed, or `"4*2"` would parse as 42.
    const s = expression.replace(/\s+/g, "").replace(/\*i/g, "i");
    if (s.length === 0) return new ComplexNumber(NaN, NaN);

    if (!s.includes("i")) {
      const n = Number(s);
      return Number.isNaN(n) ? new ComplexNumber(NaN, NaN) : new ComplexNumber(n, 0);
    }

    if (!s.endsWith("i")) return new ComplexNumber(NaN, NaN);
    const body = s.slice(0, -1); // strip trailing 'i'

    // Locate the sign that separates the real and imaginary terms. A leading
    // sign (position 0) belongs to the real term; a sign preceded by 'e'/'E'
    // is part of an exponent, not a separator.
    let splitIdx = -1;
    for (let k = 1; k < body.length; k++) {
      const ch = body[k];
      const prev = body[k - 1];
      if ((ch === "+" || ch === "-") && prev !== "e" && prev !== "E") splitIdx = k;
    }

    let realStr: string;
    let imagStr: string;
    if (splitIdx === -1) {
      realStr = "";
      imagStr = body;
    } else {
      realStr = body.slice(0, splitIdx);
      imagStr = body.slice(splitIdx);
    }

    const real = realStr === "" ? 0 : Number(realStr);
    let imag: number;
    if (imagStr === "" || imagStr === "+") imag = 1;
    else if (imagStr === "-") imag = -1;
    else imag = Number(imagStr);

    if (Number.isNaN(real) || Number.isNaN(imag)) return new ComplexNumber(NaN, NaN);
    return new ComplexNumber(real, imag);
  }

  /** Uniform random complex number, real part in `[min(r1,r2), max(r1,r2)]`, imaginary in `[min(i1,i2), max(i1,i2)]`. */
  static random(r1 = 1, r2 = 0, i1 = 1, i2 = 0, _inclusive = true): ComplexNumber {
    const low = Math.min(r1, r2);
    const high = Math.max(r1, r2);
    const iLow = Math.min(i1, i2);
    const iHigh = Math.max(i1, i2);
    return new ComplexNumber(low + Math.random() * (high - low), iLow + Math.random() * (iHigh - iLow));
  }

  /** XML-ish serialisation kept for API compatibility. */
  toXML(): string {
    return `<complexNumber><value>${this.value}</value><iValue>${this.iValue}</iValue></complexNumber>`;
  }

  /** The two coordinates as a fresh {@link Vector}. */
  toVector(): Vector<number> {
    return Vector.fromArray([this.value, this.iValue]);
  }

  /**
   * String representation. In `fullMode` the raw `a+bi` form is emitted (used
   * for debugging); otherwise a canonical, sign-correct form is produced that
   * round-trips through {@link parse}.
   */
  toString(fullMode = false): string {
    if (fullMode) return `${this.value}+${this.iValue}i`;

    if (this.value === 0 && this.iValue === 0) return "0";
    if (this.iValue === 0) return String(this.value);

    const absImag = Math.abs(this.iValue);
    const imagPart = absImag === 1 ? "i" : `${absImag}*i`;

    if (this.value === 0) return this.iValue < 0 ? `-${imagPart}` : imagPart;
    return `${this.value}${this.iValue < 0 ? "-" : "+"}${imagPart}`;
  }

  /** Additive inverse `-z`. */
  neg(): ComplexNumber {
    return new ComplexNumber(-this.value, -this.iValue);
  }

  /** Multiplicative inverse `1/z` (returns {@link NaCN} for zero). */
  reciprocal(): ComplexNumber {
    const { value: a, iValue: b } = this;
    if (a === 0 && b === 0) return new ComplexNumber(NaN, NaN);
    const denom = a * a + b * b;
    return new ComplexNumber(a / denom, -b / denom);
  }

  /** Complex conjugate `a - b·i`. */
  conjugate(): ComplexNumber {
    return new ComplexNumber(this.value, -this.iValue);
  }

  /** Swap the real and imaginary parts (`a + b·i` → `b + a·i`). */
  flip(): ComplexNumber {
    return new ComplexNumber(this.iValue, this.value);
  }

  /** Structural equality (NaN parts compare unequal, matching IEEE semantics). */
  equals(other: ComplexNumber): boolean {
    return this.value === other.value && this.iValue === other.iValue;
  }

  /** Lexicographic comparison: real part first, then imaginary. */
  lexCompare(other: CNInput): number {
    const b = coerce(other);
    if (this.value > b.value) return 1;
    if (this.value < b.value) return -1;
    if (this.iValue > b.iValue) return 1;
    if (this.iValue < b.iValue) return -1;
    return 0;
  }

  /** Comparison by magnitude. */
  magCompare(other: CNInput): number {
    const ma = this.magnitude();
    const mb = coerce(other).magnitude();
    if (ma > mb) return 1;
    if (ma < mb) return -1;
    return 0;
  }

  add(other: CNInput = 0): ComplexNumber {
    const b = coerce(other);
    return new ComplexNumber(this.value + b.value, this.iValue + b.iValue);
  }

  subtract(other: CNInput = 0): ComplexNumber {
    const b = coerce(other);
    return new ComplexNumber(this.value - b.value, this.iValue - b.iValue);
  }

  multiply(other: CNInput = 1): ComplexNumber {
    const b = coerce(other);
    return new ComplexNumber(
      this.value * b.value - this.iValue * b.iValue,
      this.value * b.iValue + this.iValue * b.value,
    );
  }

  /** Division, returning one of the eight directed infinities on a zero divisor. */
  divide(other: CNInput = 1): ComplexNumber {
    const b = coerce(other);
    if (b.value === 0 && b.iValue === 0) {
      if (this.value > 0) {
        if (this.iValue === 0) return ComplexNumber.PositiveInfinity;
        if (this.iValue > 0) return ComplexNumber.InfinityQ1;
        return ComplexNumber.InfinityQ4;
      }
      if (this.value < 0) {
        if (this.iValue === 0) return ComplexNumber.NegativeInfinity;
        if (this.iValue > 0) return ComplexNumber.InfinityQ2;
        return ComplexNumber.InfinityQ3;
      }
      if (this.iValue === 0) return ComplexNumber.NaCN;
      if (this.iValue > 0) return ComplexNumber.PositiveInfinityI;
      return ComplexNumber.NegativeInfinityI;
    }
    return this.multiply(b.reciprocal());
  }

  magnitude(): number {
    return Math.hypot(this.value, this.iValue);
  }

  angle(): number {
    return Math.atan2(this.iValue, this.value);
  }

  private static power2(a: ComplexNumber, b: ComplexNumber): ComplexNumber {
    if (a.value === 0 && a.iValue === 0 && !(b.value === 0 && b.iValue === 0)) {
      return new ComplexNumber(0, 0);
    }
    const mag = a.magnitude();
    const ang = a.angle();
    const c = b.value;
    const d = b.iValue;
    const multiplier = mag ** c / Math.E ** (d * ang);
    const cospart = multiplier * Math.cos(d * Math.log(mag) + c * ang);
    const sinpart = multiplier * Math.sin(d * Math.log(mag) + c * ang);
    return roundComplex(new ComplexNumber(cospart, sinpart));
  }

  private selectedNaturalLogarithm(selector = 0): ComplexNumber {
    const mag = this.magnitude();
    const ang = this.angle();
    return roundComplex(new ComplexNumber(Math.log(mag), ang + 2 * Math.PI * selector));
  }

  /** `this ** exponent`, with branch selection for the multivalued complex logarithm. */
  power(exponent: CNInput = 1, selector = 0): ComplexNumber {
    const b = coerce(exponent);
    // Handle a zero base directly (bug fix: ln 0 otherwise poisons the result).
    if (this.value === 0 && this.iValue === 0) {
      if (b.value === 0 && b.iValue === 0) return new ComplexNumber(1, 0);
      if (b.value > 0) return new ComplexNumber(0, 0);
      return ComplexNumber.NaCN;
    }
    const newPow = b.multiply(this.selectedNaturalLogarithm(selector));
    return ComplexNumber.power2(ComplexNumber.E, newPow);
  }

  square(): ComplexNumber {
    return this.power(2);
  }

  squareRoot(): ComplexNumber {
    return this.power(0.5);
  }

  /** Logarithm in an arbitrary `base` (natural log by default), with branch selection. */
  logarithm(base: CNInput = Math.E, selectA = 0, selectB = 0): ComplexNumber {
    const b = coerce(base);
    return roundComplex(this.selectedNaturalLogarithm(selectA).divide(b.selectedNaturalLogarithm(selectB)));
  }

  sine(): ComplexNumber {
    return new ComplexNumber(
      roundTo(Math.sin(this.value) * realHCos(this.iValue)),
      roundTo(Math.cos(this.value) * realHSin(this.iValue)),
    );
  }

  cosine(): ComplexNumber {
    return new ComplexNumber(
      roundTo(Math.cos(this.value) * realHCos(this.iValue)),
      roundTo(-Math.sin(this.value) * realHSin(this.iValue)),
    );
  }

  tangent(): ComplexNumber {
    return this.sine().divide(this.cosine());
  }

  hyperbolicSine(): ComplexNumber {
    return new ComplexNumber(
      roundTo(realHSin(this.value) * Math.cos(this.iValue)),
      roundTo(realHCos(this.value) * Math.sin(this.iValue)),
    );
  }

  hyperbolicCosine(): ComplexNumber {
    return new ComplexNumber(
      roundTo(realHCos(this.value) * Math.cos(this.iValue)),
      roundTo(realHSin(this.value) * Math.sin(this.iValue)),
    );
  }

  arcSine(): ComplexNumber {
    const inner = ComplexNumber.I.multiply(this).add(new ComplexNumber(1, 0).subtract(this.square()).squareRoot());
    return ComplexNumber.I.neg().multiply(inner.logarithm());
  }

  arcCosine(): ComplexNumber {
    const inner = this.add(this.square().subtract(1).squareRoot());
    return ComplexNumber.I.neg().multiply(inner.logarithm());
  }

  arcTangent(): ComplexNumber {
    const iThis = ComplexNumber.I.multiply(this);
    const left = new ComplexNumber(1, 0).subtract(iThis).logarithm();
    const right = new ComplexNumber(1, 0).add(iThis).logarithm();
    return ComplexNumber.I.divide(2).multiply(left.subtract(right));
  }
}
