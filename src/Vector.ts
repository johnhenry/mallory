/**
 * Vector — an `Array` subclass that doubles as a mathematical vector / matrix row.
 *
 * Ported from Mallory's ActionScript `Vector` (`dynamic class Vector extends Array`).
 * In the original the class was used both as a plain sequence container and, when
 * nested (a Vector of Vectors), as a matrix. That dual role is preserved here.
 *
 * Modernisations & bug fixes relative to the AS3 original:
 *  - `setElement` no longer infinitely recurses when the target slot holds a
 *    falsy value (the AS3 version looped forever whenever `this[index]` was
 *    `0`/`null`/`undefined`). It now pads with the placeholder and assigns.
 *  - The `x`/`y`/`z`/`t` accessors return a genuinely stored `0` instead of
 *    silently coercing every falsy slot to `0`.
 *  - `toXML` returns a `string` (AS3 `XML` no longer exists in JS land).
 *  - The class is generic and iterable (inherited from `Array`).
 */
export class Vector<T = unknown> extends Array<T> {
  /** A shared, empty vector — mirrors AS3 `Vector.Empty`. */
  static readonly Empty: Vector<never> = new Vector<never>();

  /**
   * Build a Vector from the given elements.
   *
   * NOTE on the single-number case: because `Array` (and therefore this
   * subclass) treats `new Vector(n)` as "create a sparse vector of length n",
   * that behaviour is retained — it is also what `Array.prototype` methods rely
   * on via `Symbol.species` when they allocate result vectors. Use
   * {@link Vector.of} or {@link Vector.from} to wrap a literal single number.
   */
  constructor(length: number);
  constructor(...rest: T[]);
  constructor(...rest: T[]) {
    // Reproduce Array's constructor contract: a lone number means "length".
    if (rest.length === 1 && typeof rest[0] === "number") {
      super(rest[0] as number);
    } else {
      super(...rest);
    }
  }

  /** Ensure `map`/`filter`/`slice`/etc. produce plain `Vector`s, not typed views. */
  static override get [Symbol.species](): ArrayConstructor {
    return Array as unknown as ArrayConstructor;
  }

  /** Convert any array-like into a Vector (shallow). Mirrors AS3 `ArrayToVector`. */
  static fromArray<U>(array: Iterable<U>): Vector<U> {
    const v = new Vector<U>();
    for (const e of array) v.push(e);
    return v;
  }

  /**
   * Parse the `<vector>` form produced by {@link toXML} (best-effort inverse:
   * numeric coordinates become numbers, everything else stays a string).
   */
  static fromXML(xml: string): Vector<number | string> {
    const out = new Vector<number | string>();
    for (const match of xml.matchAll(/<coordinate>(.*?)<\/coordinate>/g)) {
      const raw = match[1] as string;
      const n = Number(raw);
      out.push(raw !== "" && !Number.isNaN(n) ? n : raw);
    }
    return out;
  }

  /**
   * Parse the bracketed form produced by {@link toString} (best-effort inverse:
   * numeric elements become numbers, everything else stays a trimmed string).
   */
  static fromString(str: string, seperator = ",", leftBracket = "[", rightBracket = "]"): Vector<number | string> {
    let s = str.trim();
    if (s.startsWith(leftBracket)) s = s.slice(leftBracket.length);
    if (s.endsWith(rightBracket)) s = s.slice(0, s.length - rightBracket.length);
    const out = new Vector<number | string>();
    if (s === "") return out;
    for (const part of s.split(seperator)) {
      const t = part.trim();
      const n = Number(t);
      out.push(t !== "" && !Number.isNaN(n) ? n : t);
    }
    return out;
  }

  /** String representation, e.g. `[1,2,3]`. */
  override toString(seperator = ",", leftBracket = "[", rightBracket = "]"): string {
    let out = leftBracket;
    for (let i = 0; i < this.length; i++) {
      out += this[i] != null ? String(this[i]) : String(null);
      if (i !== this.length - 1) out += seperator;
    }
    return out + rightBracket;
  }

  /** XML-ish serialisation, kept for compatibility with the AS3 API. */
  toXML(): string {
    const parts: string[] = [];
    for (let i = 0; i < this.length; i++) {
      parts.push(`<coordinate>${this[i]}</coordinate>`);
    }
    return `<vector>${parts.join("")}</vector>`;
  }

  /** Return the element at `index` (defaults to the first). */
  getElement(index = 0): T | undefined {
    return this[index];
  }

  /** Remove and return the element at `index`. */
  removeElement(index = 0): T | undefined {
    return this.splice(index, 1)[0];
  }

  /**
   * Set the element at `index`, padding with `placeHolder` if the vector is too
   * short. Returns the previously stored value (or `undefined`).
   *
   * Bug fix: the AS3 version recursed infinitely whenever the slot was falsy.
   */
  setElement(newElement: T, index = 0, placeHolder: T | null = null): T | undefined {
    while (this.length < index) this.push(placeHolder as T);
    const previous = this[index];
    this[index] = newElement;
    return previous;
  }

  /**
   * Insert `newElement` at `index`. With no index (or a negative one) it is
   * appended. If `index` is beyond the current end, the gap is filled with
   * `placeHolder`. Returns the resulting length.
   */
  addElement(newElement: T | null = null, index = -1, placeHolder: T | null = null): number {
    if (index < 0) return this.push(newElement as T);
    while (index > this.length) this.push(placeHolder as T);
    this.splice(index, 0, newElement as T);
    return this.length;
  }

  // The x/y/z/t accessors let a Vector act as a 1-to-4 dimensional point.
  private coord(i: number): T | 0 {
    return i < this.length && this[i] != null ? (this[i] as T) : 0;
  }

  get x(): T | 0 {
    return this.coord(0);
  }
  get y(): T | 0 {
    return this.coord(1);
  }
  get z(): T | 0 {
    return this.coord(2);
  }
  get t(): T | 0 {
    return this.coord(3);
  }

  set x(value: T) {
    this.setElement(value, 0);
  }
  set y(value: T) {
    this.setElement(value, 1);
  }
  set z(value: T) {
    this.setElement(value, 2);
  }
  set t(value: T) {
    this.setElement(value, 3);
  }

  /**
   * Clone the vector. When `deep` is true (default) nested Vectors are cloned
   * recursively, so a matrix is duplicated rather than sharing its rows.
   */
  clone(deep = true): Vector<T> {
    const out = new Vector<T>();
    for (let i = 0; i < this.length; i++) {
      const el = this[i];
      out[i] = deep && el instanceof Vector ? (el.clone() as unknown as T) : (el as T);
    }
    return out;
  }

  /** Return a new vector with the elements in reverse order. */
  reversed(): Vector<T> {
    const out = new Vector<T>();
    for (let i = 0; i < this.length; i++) out[i] = this[this.length - 1 - i] as T;
    return out;
  }
}
