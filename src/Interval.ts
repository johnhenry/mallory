/**
 * Interval — rigorous interval arithmetic `[lo, hi]`. Operations return an
 * interval guaranteed to contain every result of the corresponding operation on
 * any pair of members, so a final interval bounds the true answer despite
 * rounding — useful for reliable numerics and error tracking.
 */
export class Interval {
  readonly lo: number;
  readonly hi: number;

  constructor(lo: number, hi: number = lo) {
    if (lo > hi) throw new Error(`Invalid interval: [${lo}, ${hi}]`);
    this.lo = lo;
    this.hi = hi;
  }

  static of(lo: number, hi: number): Interval {
    return new Interval(lo, hi);
  }

  /** A degenerate interval `[x, x]`. */
  static point(x: number): Interval {
    return new Interval(x, x);
  }

  get width(): number {
    return this.hi - this.lo;
  }
  get midpoint(): number {
    return (this.lo + this.hi) / 2;
  }
  get radius(): number {
    return this.width / 2;
  }

  contains(x: number): boolean {
    return this.lo <= x && x <= this.hi;
  }
  overlaps(o: Interval): boolean {
    return this.lo <= o.hi && o.lo <= this.hi;
  }

  add(o: Interval): Interval {
    return new Interval(this.lo + o.lo, this.hi + o.hi);
  }
  subtract(o: Interval): Interval {
    return new Interval(this.lo - o.hi, this.hi - o.lo);
  }
  negate(): Interval {
    return new Interval(-this.hi, -this.lo);
  }

  multiply(o: Interval): Interval {
    const p = [this.lo * o.lo, this.lo * o.hi, this.hi * o.lo, this.hi * o.hi];
    return new Interval(Math.min(...p), Math.max(...p));
  }

  divide(o: Interval): Interval {
    if (o.contains(0)) throw new Error("Interval division by an interval containing zero.");
    return this.multiply(new Interval(1 / o.hi, 1 / o.lo));
  }

  /** The tightest interval containing both (the convex hull / union). */
  hull(o: Interval): Interval {
    return new Interval(Math.min(this.lo, o.lo), Math.max(this.hi, o.hi));
  }

  /** The overlap of two intervals, or `null` if they are disjoint. */
  intersect(o: Interval): Interval | null {
    const lo = Math.max(this.lo, o.lo);
    const hi = Math.min(this.hi, o.hi);
    return lo <= hi ? new Interval(lo, hi) : null;
  }

  abs(): Interval {
    if (this.lo >= 0) return this;
    if (this.hi <= 0) return this.negate();
    return new Interval(0, Math.max(-this.lo, this.hi));
  }

  sqrt(): Interval {
    if (this.lo < 0) throw new Error("sqrt of an interval with negative values.");
    return new Interval(Math.sqrt(this.lo), Math.sqrt(this.hi));
  }
  exp(): Interval {
    return new Interval(Math.exp(this.lo), Math.exp(this.hi));
  }
  log(): Interval {
    if (this.lo <= 0) throw new Error("log of an interval with non-positive values.");
    return new Interval(Math.log(this.lo), Math.log(this.hi));
  }

  /** Integer power (handles even powers of intervals straddling zero). */
  pow(n: number): Interval {
    if (!Number.isInteger(n) || n < 0) throw new Error("Interval.pow requires a non-negative integer.");
    if (n === 0) return Interval.point(1);
    const a = this.lo ** n;
    const b = this.hi ** n;
    if (n % 2 === 0 && this.contains(0)) return new Interval(0, Math.max(a, b));
    return new Interval(Math.min(a, b), Math.max(a, b));
  }

  private extrema(f: (x: number) => number, criticalPeriodStart: number, period: number): Interval {
    const candidates = [f(this.lo), f(this.hi)];
    // include critical points of the form `criticalPeriodStart + k·period` in range
    const kStart = Math.ceil((this.lo - criticalPeriodStart) / period);
    const kEnd = Math.floor((this.hi - criticalPeriodStart) / period);
    for (let k = kStart; k <= kEnd; k++) candidates.push(f(criticalPeriodStart + k * period));
    return new Interval(Math.min(...candidates), Math.max(...candidates));
  }

  sin(): Interval {
    if (this.width >= 2 * Math.PI) return new Interval(-1, 1);
    return this.extrema(Math.sin, Math.PI / 2, Math.PI);
  }
  cos(): Interval {
    if (this.width >= 2 * Math.PI) return new Interval(-1, 1);
    return this.extrema(Math.cos, 0, Math.PI);
  }

  equals(o: Interval): boolean {
    return this.lo === o.lo && this.hi === o.hi;
  }

  toString(): string {
    return `[${this.lo}, ${this.hi}]`;
  }
}
