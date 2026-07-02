import { Permutation } from "./Permutation.ts";

/**
 * Cycle — a permutation cycle over an ordered list of distinct elements.
 * Ported from Mallory's ActionScript `Cycle`.
 *
 * Bug fix / modernisation: the AS3 constructor silently left `_elements`
 * undefined when the input contained repeats (every later method then threw);
 * this version rejects repeats up front with a clear error. The misspelled
 * `transpotions` methods are corrected to `transpositions`.
 */
export class Cycle<T = unknown> {
  private readonly _elements: T[];

  constructor(elements: T[]) {
    for (let i = 0; i < elements.length; i++) {
      if (elements.lastIndexOf(elements[i] as T) !== i) {
        throw new Error("Cycle elements must be distinct (no repeats).");
      }
    }
    this._elements = [...elements];
  }

  /** A fresh copy of the ordered elements. */
  get elements(): T[] {
    return [...this._elements];
  }

  /** Cycles with fewer than two elements have length 1. */
  get length(): number {
    return this._elements.length < 2 ? 1 : this._elements.length;
  }

  /** Map an element to the next in the cycle (identity outside the cycle). */
  apply(element: T): T {
    const els = this._elements;
    if (element === els[els.length - 1]) return els[0] as T;
    for (let i = 0; i < els.length; i++) {
      if (element === els[i]) return els[i + 1] as T;
    }
    return element;
  }

  /** The inverse cycle (reverse order). */
  inverse(): Cycle<T> {
    return new Cycle([...this._elements].reverse());
  }

  /** The same cycle with its representation rotated left. */
  shiftedLeft(): Cycle<T> {
    return new Cycle(this._elements.map((e) => this.apply(e)));
  }

  /** The same cycle with its representation rotated right. */
  shiftedRight(): Cycle<T> {
    const inv = this.inverse();
    return new Cycle(this._elements.map((e) => inv.apply(e)));
  }

  /** Convert to the equivalent {@link Permutation}. */
  toPermutation(): Permutation<T> {
    return new Permutation(this.elements, this.shiftedLeft().elements);
  }

  toString(): string {
    return `(${this._elements.join(",")})`;
  }

  contains(element: T): boolean {
    return this._elements.includes(element);
  }

  /** Decompose into a product of adjacent transpositions. */
  transpositions(): Array<Cycle<T>> {
    const out: Array<Cycle<T>> = [];
    if (this.length < 2) {
      out.push(new Cycle([0, 1] as unknown as T[]));
      out.push(new Cycle([1, 0] as unknown as T[]));
      return out;
    }
    for (let i = 0; i < this.length - 1; i++) {
      out.push(new Cycle([this._elements[i] as T, this._elements[i + 1] as T]));
    }
    return out;
  }

  /** An alternate transposition decomposition (all sharing the last element). */
  transpositionsAlt(): Array<Cycle<T>> {
    const out: Array<Cycle<T>> = [];
    if (this.length < 2) {
      out.push(new Cycle([0, 1] as unknown as T[]));
      out.push(new Cycle([1, 0] as unknown as T[]));
      return out;
    }
    for (let i = 0; i < this.length - 1; i++) {
      out.push(new Cycle([this._elements[this.length - 2 - i] as T, this._elements[this.length - 1] as T]));
    }
    return out;
  }

  /** An n-cycle is an even permutation iff n is odd. */
  even(): boolean {
    return this.length % 2 === 1;
  }

  odd(): boolean {
    return !this.even();
  }

  /** True when two cycles are equal up to rotation. */
  static equal<T>(sigma: Cycle<T>, tao: Cycle<T>): boolean {
    if (sigma.length !== tao.length) return false;
    let s = sigma;
    for (let i = 0; i < sigma.length; i++) {
      const se = s.elements;
      const te = tao.elements;
      let equalCount = 0;
      for (let j = 0; j < se.length; j++) if (se[j] === te[j]) equalCount++;
      if (equalCount === sigma.length) return true;
      s = s.shiftedLeft();
    }
    return false;
  }

  /** True when two cycles share no elements. */
  static disjoint<T>(sigma: Cycle<T>, tao: Cycle<T>): boolean {
    for (const a of sigma.elements) {
      for (const b of tao.elements) if (a === b) return false;
    }
    return true;
  }
}
