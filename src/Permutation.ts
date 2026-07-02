import { Cycle } from "./Cycle.ts";
import { NumberTheory } from "./NumberTheory.ts";

/**
 * Permutation — a bijection described by a domain array and the codomain array
 * it maps onto (element-wise). Ported from Mallory's ActionScript `Permutation`.
 *
 * Bug fixes from the AS3 original:
 *  - the constructor silently ignored mismatched-length inputs; it now throws.
 *  - `order` wrapped cycle lengths in `ComplexNumber` then read `.value` off an
 *    `int` (yielding `undefined`); it now takes the LCM of the plain lengths and
 *    returns 1 for the identity.
 *  - `cycles` no longer mutates any shared state (it works on local copies).
 */
export class Permutation<T = unknown> {
  private readonly _domain: T[];
  private readonly _coDomain: T[];

  constructor(input: T[], output: T[]) {
    if (input.length !== output.length) {
      throw new Error("Permutation domain and codomain must have equal length.");
    }
    this._domain = [...input];
    this._coDomain = [...output];
  }

  get domain(): T[] {
    return [...this._domain];
  }

  get coDomain(): T[] {
    return [...this._coDomain];
  }

  /** Map an element through the permutation (identity outside the domain). */
  apply(element: T): T {
    for (let i = 0; i < this._domain.length; i++) {
      if (element === this._domain[i]) return this._coDomain[i] as T;
    }
    return element;
  }

  /** The inverse permutation (swap domain and codomain). */
  inverse(): Permutation<T> {
    return new Permutation(this.coDomain, this.domain);
  }

  /** Raise the permutation to an integer power. */
  power(pow: number): Permutation<T> {
    if (pow === 0) return Permutation.Identity as Permutation<T>;
    if (pow === 1) return this;
    if (pow === -1) return this.inverse();

    let base: Permutation<T> = this;
    let p = pow;
    if (pow < -1) {
      base = this.inverse();
      p = -pow;
    }

    let result = base;
    while (p > 1) {
      result = Permutation.compose(result, base);
      p--;
    }
    return result;
  }

  toString(): string {
    const parts = this._domain.map((d, i) => `${d} -> ${this._coDomain[i]}`);
    return `(${parts.join(",")})`;
  }

  /** Decompose into disjoint cycles. */
  cycles(): Array<Cycle<T>> {
    const domain = [...this._domain];
    const coDomain = [...this._coDomain];
    const result: Array<Cycle<T>> = [];

    while (domain.length > 0) {
      const start = domain[0] as T;
      let current = start;
      const tempArray: T[] = [];
      do {
        tempArray.push(current);
        current = this.apply(current);
        for (let i = 0; i < coDomain.length; i++) {
          if (current === coDomain[i]) {
            domain.splice(i, 1);
            coDomain.splice(i, 1);
            break;
          }
        }
      } while (current !== start);
      result.push(new Cycle(tempArray));
    }
    return result;
  }

  /** The order of the permutation (LCM of its cycle lengths). */
  order(): number {
    const lengths = this.cycles().map((c) => c.length);
    if (lengths.length === 0) return 1;
    return Number(NumberTheory.lcmList(lengths));
  }

  static readonly Identity: Permutation<unknown> = new Permutation<unknown>([], []);

  /** Compose two permutations: `(sigma ∘ tao)(x) = sigma(tao(x))`. */
  static compose<T>(sigma: Permutation<T>, tao: Permutation<T>): Permutation<T> {
    const newDomain = sigma.domain.concat(tao.domain);
    for (let i = 0; i < newDomain.length; i++) {
      if (newDomain.lastIndexOf(newDomain[i] as T) !== i) {
        newDomain.splice(newDomain.lastIndexOf(newDomain[i] as T), 1);
        i--;
      }
    }
    const newCoDomain = newDomain.map((x) => sigma.apply(tao.apply(x)));
    return new Permutation(newDomain, newCoDomain);
  }

  /** Compose a list of permutations left-to-right. */
  static composeList<T>(list: Array<Permutation<T>>): Permutation<T> {
    if (list.length === 0) return Permutation.Identity as Permutation<T>;
    if (list.length === 1) return list[0] as Permutation<T>;
    return list.reduce((acc, p) => Permutation.compose(acc, p));
  }

  /** Structural equality (same action on every domain element of either). */
  static equal<T>(sigma: Permutation<T>, tao: Permutation<T>): boolean {
    for (const d of sigma.domain) if (sigma.apply(d) !== tao.apply(d)) return false;
    for (const d of tao.domain) if (tao.apply(d) !== sigma.apply(d)) return false;
    return true;
  }

  /** Whether two permutations commute. */
  static commute<T>(sigma: Permutation<T>, tao: Permutation<T>): boolean {
    return Permutation.equal(Permutation.compose(sigma, tao), Permutation.compose(tao, sigma));
  }
}
