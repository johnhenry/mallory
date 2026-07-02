/**
 * DualNumber — a number of the form `value + deriv·ε` where `ε² = 0`. Evaluating
 * a function on a dual number carries its derivative along automatically (the
 * `ε` component), giving exact forward-mode automatic differentiation — more
 * accurate than the finite differences in {@link RealMath.differentiateN}.
 *
 * It is also a commutative ring (a valid {@link Structure}).
 */
export class DualNumber {
  readonly value: number;
  readonly deriv: number;

  constructor(value = 0, deriv = 0) {
    this.value = value;
    this.deriv = deriv;
  }

  /** A constant (zero derivative). */
  static constant(x: number): DualNumber {
    return new DualNumber(x, 0);
  }

  /** An independent variable at `x` (unit derivative). */
  static variable(x: number): DualNumber {
    return new DualNumber(x, 1);
  }

  private static lift(x: DualNumber | number): DualNumber {
    return x instanceof DualNumber ? x : new DualNumber(x, 0);
  }

  add(o: DualNumber | number): DualNumber {
    const d = DualNumber.lift(o);
    return new DualNumber(this.value + d.value, this.deriv + d.deriv);
  }

  subtract(o: DualNumber | number): DualNumber {
    const d = DualNumber.lift(o);
    return new DualNumber(this.value - d.value, this.deriv - d.deriv);
  }

  multiply(o: DualNumber | number): DualNumber {
    const d = DualNumber.lift(o);
    return new DualNumber(this.value * d.value, this.value * d.deriv + this.deriv * d.value);
  }

  divide(o: DualNumber | number): DualNumber {
    const d = DualNumber.lift(o);
    return new DualNumber(this.value / d.value, (this.deriv * d.value - this.value * d.deriv) / (d.value * d.value));
  }

  negate(): DualNumber {
    return new DualNumber(-this.value, -this.deriv);
  }

  /** Raise to a constant power (chain rule). */
  pow(n: number): DualNumber {
    return new DualNumber(this.value ** n, n * this.value ** (n - 1) * this.deriv);
  }

  static sin(x: DualNumber): DualNumber {
    return new DualNumber(Math.sin(x.value), Math.cos(x.value) * x.deriv);
  }
  static cos(x: DualNumber): DualNumber {
    return new DualNumber(Math.cos(x.value), -Math.sin(x.value) * x.deriv);
  }
  static tan(x: DualNumber): DualNumber {
    const c = Math.cos(x.value);
    return new DualNumber(Math.tan(x.value), x.deriv / (c * c));
  }
  static exp(x: DualNumber): DualNumber {
    const e = Math.exp(x.value);
    return new DualNumber(e, e * x.deriv);
  }
  static log(x: DualNumber): DualNumber {
    return new DualNumber(Math.log(x.value), x.deriv / x.value);
  }
  static sqrt(x: DualNumber): DualNumber {
    const s = Math.sqrt(x.value);
    return new DualNumber(s, x.deriv / (2 * s));
  }

  /** The derivative of `f` at `x`, evaluated exactly via dual numbers. */
  static derivative(f: (x: DualNumber) => DualNumber, x: number): number {
    return f(DualNumber.variable(x)).deriv;
  }

  /** The value and derivative of `f` at `x` together. */
  static valueAndDerivative(f: (x: DualNumber) => DualNumber, x: number): { value: number; derivative: number } {
    const r = f(DualNumber.variable(x));
    return { value: r.value, derivative: r.deriv };
  }

  /** The gradient of a multivariate `f` at `point` (one dual seed per coordinate). */
  static gradient(f: (xs: DualNumber[]) => DualNumber, point: number[]): number[] {
    return point.map((_, i) => {
      const seeded = point.map((v, j) => new DualNumber(v, i === j ? 1 : 0));
      return f(seeded).deriv;
    });
  }

  toString(): string {
    return `${this.value} + ${this.deriv}ε`;
  }
}
