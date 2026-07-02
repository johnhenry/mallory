/**
 * Decimal — an arbitrary-precision decimal number `digits × 10^exponent`,
 * backed by `bigint`. Addition/subtraction/multiplication are exact (unlike
 * `number`, which drifts on values like `0.1 + 0.2`); division is inherently
 * approximate and rounds to a configurable number of significant digits — an
 * honest limitation analogous to floats, just with configurable precision
 * instead of a fixed 53 bits.
 *
 * Unlike {@link Rational}, no canonical/normalized form is maintained —
 * equality and comparison work by aligning exponents rather than requiring
 * reduced digits, which keeps arithmetic simple at the cost of `toString()`
 * not collapsing trailing zeros introduced by intermediate computations.
 */

const digitCount = (n: bigint): number => (n < 0n ? -n : n).toString().length;

/** Round `num / den` to the nearest integer (half away from zero), for any sign combination. */
function divRound(num: bigint, den: bigint): bigint {
  const q = num / den;
  const r = num % den;
  if (r === 0n) return q;
  const doubledR = (r < 0n ? -r : r) * 2n;
  const absDen = den < 0n ? -den : den;
  if (doubledR >= absDen) {
    const sameSign = num < 0n === den < 0n;
    return sameSign ? q + 1n : q - 1n;
  }
  return q;
}

export class Decimal {
  static readonly DEFAULT_PRECISION = 20;

  readonly digits: bigint;
  readonly exponent: number;

  static readonly Zero = new Decimal(0n, 0);
  static readonly One = new Decimal(1n, 0);

  constructor(digits: bigint = 0n, exponent = 0) {
    this.digits = digits;
    this.exponent = exponent;
  }

  static fromString(value: string): Decimal {
    const match = /^\s*([+-]?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?\s*$/.exec(value);
    if (!match) throw new Error(`Invalid Decimal string: ${value}`);
    const [, sign, intPart, fracPart = "", expPart] = match;
    const digits = BigInt((sign === "-" ? "-" : "") + intPart + fracPart);
    const exponent = -fracPart.length + (expPart ? Number(expPart) : 0);
    return new Decimal(digits, exponent);
  }

  static from(value: Decimal | bigint | number | string): Decimal {
    if (value instanceof Decimal) return value;
    if (typeof value === "bigint") return new Decimal(value, 0);
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw new Error("Cannot make a Decimal from a non-finite number.");
      return Decimal.fromString(value.toString());
    }
    return Decimal.fromString(value);
  }

  /** Rescale `a` and `b` to a shared exponent (the smaller of the two). */
  private static align(a: Decimal, b: Decimal): { ad: bigint; bd: bigint; exponent: number } {
    const exponent = Math.min(a.exponent, b.exponent);
    const ad = a.digits * 10n ** BigInt(a.exponent - exponent);
    const bd = b.digits * 10n ** BigInt(b.exponent - exponent);
    return { ad, bd, exponent };
  }

  add(other: Decimal): Decimal {
    const { ad, bd, exponent } = Decimal.align(this, other);
    return new Decimal(ad + bd, exponent);
  }

  subtract(other: Decimal): Decimal {
    const { ad, bd, exponent } = Decimal.align(this, other);
    return new Decimal(ad - bd, exponent);
  }

  multiply(other: Decimal): Decimal {
    return new Decimal(this.digits * other.digits, this.exponent + other.exponent);
  }

  /** Division is approximate: the result is rounded to `precision` significant digits. */
  divide(other: Decimal, precision = Decimal.DEFAULT_PRECISION): Decimal {
    if (other.digits === 0n) throw new Error("Division by zero Decimal.");
    if (this.digits === 0n) return Decimal.Zero;
    const shift = Math.max(0, precision - digitCount(this.digits) + digitCount(other.digits));
    const scaledNumerator = this.digits * 10n ** BigInt(shift);
    const quotient = divRound(scaledNumerator, other.digits);
    return new Decimal(quotient, this.exponent - other.exponent - shift);
  }

  negate(): Decimal {
    return new Decimal(-this.digits, this.exponent);
  }

  abs(): Decimal {
    return this.digits < 0n ? this.negate() : this;
  }

  equals(other: Decimal): boolean {
    const { ad, bd } = Decimal.align(this, other);
    return ad === bd;
  }

  /** -1, 0 or 1 depending on ordering against `other`. */
  compare(other: Decimal): number {
    const { ad, bd } = Decimal.align(this, other);
    return ad < bd ? -1 : ad > bd ? 1 : 0;
  }

  lessThan(other: Decimal): boolean {
    return this.compare(other) < 0;
  }

  isZero(): boolean {
    return this.digits === 0n;
  }

  toNumber(): number {
    return Number(this.digits) * 10 ** this.exponent;
  }

  /**
   * Renders in plain decimal notation. Trailing fractional zeros are trimmed
   * for readability — this is purely presentational; no canonical form is
   * maintained internally, so `digits`/`exponent` are untouched.
   */
  toString(): string {
    if (this.digits === 0n) return "0";
    const negative = this.digits < 0n;
    let s = (negative ? -this.digits : this.digits).toString();
    if (this.exponent >= 0) {
      s = s + "0".repeat(this.exponent);
    } else {
      const pointPos = s.length + this.exponent;
      s = pointPos <= 0 ? `0.${"0".repeat(-pointPos)}${s}` : `${s.slice(0, pointPos)}.${s.slice(pointPos)}`;
      if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
    }
    return negative ? `-${s}` : s;
  }
}
