import type { Structure } from "./Structure.ts";

/**
 * PolynomialRing — polynomials with coefficients in an arbitrary {@link Structure}
 * (a finite field, the rationals, quaternions, whatever the structure supplies),
 * following {@link GroupTheory}'s idiom of accepting the algebra as a constructor
 * parameter rather than duplicating field logic. This generalizes long division,
 * GCD, differentiation, and evaluation to any field — e.g. polynomials over
 * `Structure.integersModulo(7)`, or plain real polynomials via
 * `new PolynomialRing(Structure.realField())`.
 *
 * Coefficients are plain `T[]` arrays in ascending power (`p[i]` is the
 * coefficient of `x^i`), trimmed of trailing zero coefficients. The zero
 * polynomial is `[]`, with degree `-1`.
 *
 * {@link parsePolynomial}/{@link polynomialToString} below are real-number-only
 * helpers for the common `"3*x^2-2*x+1"` string notation — parsing/formatting
 * needs decimal syntax, which doesn't generalize to an arbitrary `Structure`.
 */
export class PolynomialRing<T> {
  readonly structure: Structure<T>;

  constructor(structure: Structure<T>) {
    this.structure = structure;
  }

  /** Drop trailing coefficients equal to the structure's zero. */
  private trim(p: T[]): T[] {
    let n = p.length;
    while (n > 0 && this.structure.equality(p[n - 1] as T, this.structure.zero)) n--;
    return p.slice(0, n);
  }

  /** `-1` for the zero polynomial, else the index of the highest non-zero coefficient. */
  degree(p: T[]): number {
    return this.trim(p).length - 1;
  }

  zero(): T[] {
    return [];
  }

  one(): T[] {
    return [this.structure.one];
  }

  private pad(p: T[], length: number): T[] {
    const result = p.slice();
    while (result.length < length) result.push(this.structure.zero);
    return result;
  }

  add(a: T[], b: T[]): T[] {
    const length = Math.max(a.length, b.length);
    const pa = this.pad(a, length);
    const pb = this.pad(b, length);
    return this.trim(pa.map((x, i) => this.structure.add(x, pb[i] as T)));
  }

  negate(p: T[]): T[] {
    return p.map((x) => this.structure.negative(x));
  }

  subtract(a: T[], b: T[]): T[] {
    return this.add(a, this.negate(b));
  }

  scale(p: T[], scalar: T): T[] {
    return this.trim(p.map((x) => this.structure.multiply(scalar, x)));
  }

  multiply(a: T[], b: T[]): T[] {
    if (a.length === 0 || b.length === 0) return [];
    const result: T[] = new Array(a.length + b.length - 1).fill(this.structure.zero);
    for (let i = 0; i < a.length; i++) {
      for (let j = 0; j < b.length; j++) {
        result[i + j] = this.structure.add(result[i + j] as T, this.structure.multiply(a[i] as T, b[j] as T));
      }
    }
    return this.trim(result);
  }

  /** Polynomial long division over the structure's field operations. */
  divmod(a: T[], b: T[]): { quotient: T[]; remainder: T[] } {
    const bd = this.degree(b);
    if (bd < 0) throw new Error("PolynomialRing: division by the zero polynomial");
    let remainder = this.trim(a);
    const leadInv = this.structure.reciprocal(b[bd] as T);
    const quotient: T[] = new Array(Math.max(this.degree(remainder) - bd + 1, 0)).fill(this.structure.zero);
    while (this.degree(remainder) >= bd) {
      const rd = this.degree(remainder);
      const shift = rd - bd;
      const coeff = this.structure.multiply(remainder[rd] as T, leadInv);
      quotient[shift] = coeff;
      for (let i = 0; i <= bd; i++) {
        remainder[i + shift] = this.structure.subtract(
          remainder[i + shift] as T,
          this.structure.multiply(coeff, b[i] as T),
        );
      }
      remainder = this.trim(remainder);
    }
    return { quotient: this.trim(quotient), remainder };
  }

  divide(a: T[], b: T[]): T[] {
    return this.divmod(a, b).quotient;
  }

  mod(a: T[], b: T[]): T[] {
    return this.divmod(a, b).remainder;
  }

  /** Rescale so the leading coefficient is the structure's one. No-op on the zero polynomial. */
  private makeMonic(p: T[]): T[] {
    const d = this.degree(p);
    if (d < 0) return p;
    return this.scale(p, this.structure.reciprocal(p[d] as T));
  }

  /** Monic GCD via the Euclidean algorithm (repeated `divmod`). */
  gcd(a: T[], b: T[]): T[] {
    let x = this.trim(a);
    let y = this.trim(b);
    while (this.degree(y) >= 0) {
      const { remainder } = this.divmod(x, y);
      x = y;
      y = remainder;
    }
    return this.makeMonic(x);
  }

  /** `n` copies of the structure's `one`, added together (`n` as an element of the structure). */
  private natural(n: number): T {
    let result = this.structure.zero;
    for (let k = 0; k < n; k++) result = this.structure.add(result, this.structure.one);
    return result;
  }

  /** The derivative polynomial (`i·c_i`, via repeated addition — well-defined over any ring). */
  derivative(p: T[]): T[] {
    const trimmed = this.trim(p);
    const out: T[] = [];
    for (let i = 1; i < trimmed.length; i++) {
      let term = this.structure.zero;
      for (let k = 0; k < i; k++) term = this.structure.add(term, trimmed[i] as T);
      out.push(term);
    }
    return this.trim(out);
  }

  /**
   * An antiderivative with zero constant of integration (`c_i / (i+1)`, via the
   * structure's `reciprocal`).
   */
  antiderivative(p: T[]): T[] {
    const trimmed = this.trim(p);
    const out: T[] = [this.structure.zero];
    for (let i = 0; i < trimmed.length; i++) {
      out.push(this.structure.multiply(trimmed[i] as T, this.structure.reciprocal(this.natural(i + 1))));
    }
    return this.trim(out);
  }

  /** Evaluate at `x` via Horner's method, using the structure's field operations. */
  evaluate(p: T[], x: T): T {
    let result = this.structure.zero;
    for (let i = p.length - 1; i >= 0; i--) {
      result = this.structure.add(this.structure.multiply(result, x), p[i] as T);
    }
    return result;
  }

  equal(a: T[], b: T[]): boolean {
    const ta = this.trim(a);
    const tb = this.trim(b);
    return ta.length === tb.length && ta.every((x, i) => this.structure.equality(x, tb[i] as T));
  }

  toString(p: T[], variable = "x"): string {
    const trimmed = this.trim(p);
    if (trimmed.length === 0) return "0";
    const terms: string[] = [];
    for (let i = trimmed.length - 1; i >= 0; i--) {
      const c = trimmed[i] as T;
      if (this.structure.equality(c, this.structure.zero)) continue;
      if (i === 0) terms.push(`${c}`);
      else if (i === 1) terms.push(`${c}*${variable}`);
      else terms.push(`${c}*${variable}^${i}`);
    }
    return terms.join("+");
  }
}

/**
 * Parse a real-coefficient polynomial string such as `"3*x^2-2*x+1"` into
 * ascending-power coefficients (inverse of {@link polynomialToString}).
 */
export function parsePolynomial(str: string, variable = "x"): number[] {
  const s = str.replace(/\s+/g, "");
  if (s === "") return [0];
  const terms = s
    .replace(/-/g, "+-")
    .split("+")
    .filter((t) => t !== "");
  const p: number[] = [];
  for (const term of terms) {
    let coef: number;
    let exp: number;
    const vi = term.indexOf(variable);
    if (vi === -1) {
      coef = Number(term);
      exp = 0;
    } else {
      const coefPart = term.slice(0, vi).replace(/\*$/, "");
      coef = coefPart === "" || coefPart === "+" ? 1 : coefPart === "-" ? -1 : Number(coefPart);
      const rest = term.slice(vi + variable.length);
      exp = rest.startsWith("^") ? Number(rest.slice(1)) : 1;
    }
    p[exp] = (p[exp] ?? 0) + coef;
  }
  for (let i = 0; i < p.length; i++) if (p[i] === undefined) p[i] = 0;
  return p;
}

/**
 * Render ascending-power real coefficients as a human-readable string such as
 * `3*x^2+2*x+1` (inverse of {@link parsePolynomial}).
 */
export function polynomialToString(coeffs: number[], variable = "x", descending = true): string {
  const term = (coef: number, i: number): string => {
    if (i === 0) return String(coef);
    if (i === 1) return `${coef}*${variable}`;
    return `${coef}*${variable}^${i}`;
  };
  const indices = descending
    ? Array.from({ length: coeffs.length }, (_, i) => coeffs.length - 1 - i)
    : Array.from({ length: coeffs.length }, (_, i) => i);
  return indices.map((i) => term(coeffs[i] as number, i)).join("+");
}
