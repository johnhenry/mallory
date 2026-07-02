/**
 * Rational — an exact rational number `numerator / denominator` backed by
 * `bigint`, always stored in lowest terms with a positive denominator. Gives the
 * library exact (error-free) arithmetic, e.g. for exact linear algebra or
 * polynomial GCDs.
 */

function bgcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y) [x, y] = [y, x % y];
  return x;
}

const toBig = (x: bigint | number): bigint => {
  if (typeof x === "bigint") return x;
  if (!Number.isInteger(x)) throw new Error(`Rational requires integer inputs; got ${x}`);
  return BigInt(x);
};

export class Rational {
  readonly numerator: bigint;
  readonly denominator: bigint;

  static readonly Zero = new Rational(0n, 1n);
  static readonly One = new Rational(1n, 1n);

  constructor(numerator: bigint | number, denominator: bigint | number = 1n) {
    let n = toBig(numerator);
    let d = toBig(denominator);
    if (d === 0n) throw new Error("Rational denominator must be non-zero.");
    if (d < 0n) {
      n = -n;
      d = -d;
    }
    const g = bgcd(n, d) || 1n;
    this.numerator = n / g;
    this.denominator = d / g;
  }

  static from(value: bigint | number | Rational): Rational {
    if (value instanceof Rational) return value;
    if (typeof value === "bigint") return new Rational(value, 1n);
    return Rational.fromNumber(value);
  }

  /** Best rational approximation of a float via continued fractions. */
  static fromNumber(value: number, maxDenominator = 1_000_000): Rational {
    if (Number.isInteger(value)) return new Rational(BigInt(value), 1n);
    if (!Number.isFinite(value)) throw new Error("Cannot make a Rational from a non-finite number.");
    let [h0, h1] = [0n, 1n];
    let [k0, k1] = [1n, 0n];
    let x = value;
    const maxD = BigInt(maxDenominator);
    for (let i = 0; i < 64; i++) {
      const a = Math.floor(x);
      const aB = BigInt(a);
      [h0, h1] = [h1, aB * h1 + h0];
      [k0, k1] = [k1, aB * k1 + k0];
      if (k1 > maxD) return new Rational(h0, k0);
      const frac = x - a;
      if (frac < 1e-15) break;
      x = 1 / frac;
    }
    return new Rational(h1, k1);
  }

  add(other: Rational): Rational {
    return new Rational(
      this.numerator * other.denominator + other.numerator * this.denominator,
      this.denominator * other.denominator,
    );
  }

  subtract(other: Rational): Rational {
    return new Rational(
      this.numerator * other.denominator - other.numerator * this.denominator,
      this.denominator * other.denominator,
    );
  }

  multiply(other: Rational): Rational {
    return new Rational(this.numerator * other.numerator, this.denominator * other.denominator);
  }

  divide(other: Rational): Rational {
    if (other.numerator === 0n) throw new Error("Division by zero Rational.");
    return new Rational(this.numerator * other.denominator, this.denominator * other.numerator);
  }

  negate(): Rational {
    return new Rational(-this.numerator, this.denominator);
  }

  reciprocal(): Rational {
    if (this.numerator === 0n) throw new Error("Zero has no reciprocal.");
    return new Rational(this.denominator, this.numerator);
  }

  abs(): Rational {
    return this.numerator < 0n ? this.negate() : this;
  }

  /** Raise to an integer power (negative powers invert). */
  pow(exponent: number): Rational {
    if (!Number.isInteger(exponent)) throw new Error("Rational.pow requires an integer exponent.");
    if (exponent < 0) return this.reciprocal().pow(-exponent);
    let result = Rational.One;
    let base: Rational = this;
    let e = exponent;
    while (e > 0) {
      if (e & 1) result = result.multiply(base);
      base = base.multiply(base);
      e >>= 1;
    }
    return result;
  }

  equals(other: Rational): boolean {
    return this.numerator === other.numerator && this.denominator === other.denominator;
  }

  /** -1, 0 or 1 depending on ordering against `other`. */
  compare(other: Rational): number {
    const diff = this.numerator * other.denominator - other.numerator * this.denominator;
    return diff < 0n ? -1 : diff > 0n ? 1 : 0;
  }

  lessThan(other: Rational): boolean {
    return this.compare(other) < 0;
  }

  get sign(): number {
    return this.numerator < 0n ? -1 : this.numerator > 0n ? 1 : 0;
  }

  isZero(): boolean {
    return this.numerator === 0n;
  }

  toNumber(): number {
    return Number(this.numerator) / Number(this.denominator);
  }

  toString(): string {
    return this.denominator === 1n ? `${this.numerator}` : `${this.numerator}/${this.denominator}`;
  }
}
