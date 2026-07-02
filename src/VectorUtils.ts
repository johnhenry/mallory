import { Vector } from "./Vector.ts";

/**
 * VectorUtils — a large toolbox of static operations over {@link Vector}s and,
 * when they are nested (a vector of equal-length vectors), matrices.
 *
 * Ported from Mallory's ActionScript `VectorUtils`. Method names are camelCased
 * (the AS3 originals were PascalCase). AS3 `Object`-typed callback parameters
 * become proper function types.
 *
 * Bug fixes relative to the AS3 original:
 *  - `merge`: when only the *second* argument is a vector, the AS3 code inserted
 *    `vectorB` into itself; it now correctly prepends `vectorA`.
 *  - `arithmeticBounds`: the AS3 call passed (seed, step, limit) in the wrong
 *    slots; it now produces a proper `size`-step sequence from `lower` to `upper`.
 *  - `combine`: the AS3 code tested element *truthiness*, so a stored `0` was
 *    treated as "missing". It now tests index presence.
 *  - `modes`: guards against an empty input instead of dereferencing `counts[0]`.
 *  - `Diagnoal`/`MinorDiagnoal` typos corrected to `diagonal`/`minorDiagonal`.
 */

/** A matrix is a vector whose elements are equal-length vectors. */
export type Matrix<T> = Vector<Vector<T>>;

type Predicate<T> = (value: T) => boolean;
type Unary<T, R> = (value: T) => R;
type Binary<A, B, R> = (a: A, b: B) => R;

export class VectorUtils {
  // -- Section I.1: truth functions & comparison ---------------------------

  static isVector(e: unknown): e is Vector<unknown> {
    return e instanceof Vector;
  }

  static isNotVector(e: unknown): boolean {
    return !(e instanceof Vector);
  }

  /**
   * True when the vector contains at least one element satisfying
   * `vectorCriterion` (default: is a Vector).
   *
   * Bug fix: the AS3 implementation returned true only when *every* element was
   * a vector, contradicting the library's own glossary ("multi-dimensional … if
   * it contains elements which are also vectors") and breaking {@link flatten}
   * on ragged/mixed vectors. The documented semantics are used here.
   */
  static isMultiDimensional(
    vector: Vector<unknown>,
    vectorCriterion: Predicate<unknown> = VectorUtils.isVector,
  ): boolean {
    for (const e of vector) {
      if (vectorCriterion(e)) return true;
    }
    return false;
  }

  /** True when `element` is present, optionally by a custom equality function. */
  static contains<T>(vector: Vector<T>, element: T, equalityFunction?: Binary<T, T, boolean>): boolean {
    if (!equalityFunction) return vector.lastIndexOf(element) !== -1;
    for (const i of vector) {
      if (equalityFunction(element, i)) return true;
    }
    return false;
  }

  /** The longer of two vectors; ties return the first. */
  static longer<T>(alpha: Vector<T>, beta: Vector<T>): Vector<T> {
    return alpha.length >= beta.length ? alpha : beta;
  }

  /** The shorter of two vectors; ties return the second. */
  static shorter<T>(alpha: Vector<T>, beta: Vector<T>): Vector<T> {
    return alpha.length >= beta.length ? beta : alpha;
  }

  static isNotMultiDimensional(vector: Vector<unknown>, vectorCriterion?: Predicate<unknown>): boolean {
    return !VectorUtils.isMultiDimensional(vector, vectorCriterion ?? VectorUtils.isVector);
  }

  static isFlat(vector: Vector<unknown>, vectorCriterion?: Predicate<unknown>): boolean {
    return VectorUtils.isNotMultiDimensional(vector, vectorCriterion);
  }

  // -- Section I.2: constructors -------------------------------------------

  /** Arithmetic sequence `seed, seed+step, …` bounded by `limit`. */
  static arithmeticSequence(seed = 0, limit = 100, step = 1): Vector<number> {
    const out = new Vector<number>();
    let value = seed;
    if (step > 0) {
      if (limit < value) limit = value;
      while (value <= limit) {
        out.push(value);
        value += step;
      }
    } else if (step < 0) {
      if (limit > value) limit = value;
      while (value >= limit) {
        out.push(value);
        value += step;
      }
    } else {
      out.push(value);
    }
    return out;
  }

  /** `size` equally-spaced steps from `lower` to `upper` (inclusive). */
  static arithmeticBounds(lower: number, upper: number, size: number): Vector<number> {
    return VectorUtils.arithmeticSequence(lower, upper, (upper - lower) / size);
  }

  /** Geometric sequence `seed, seed*step, …` bounded by `|limit|`. */
  static geometricSequence(seed = 1, limit = 1000, step = 2): Vector<number> {
    const out = new Vector<number>();
    let value = seed;
    if (Math.abs(step) > 1) {
      if (Math.abs(limit) < Math.abs(value)) limit = value;
      while (value <= Math.abs(limit)) {
        out.push(value);
        value *= step;
      }
    } else if (Math.abs(step) < 1 && step !== 0) {
      if (Math.abs(limit) < Math.abs(value)) limit = value;
      while (value >= Math.abs(limit)) {
        out.push(value);
        value *= step;
      }
    } else {
      out.push(value);
    }
    return out;
  }

  /** A vector of `length` copies of `e`. */
  static constantVector<T>(length = 1, e: T): Vector<T> {
    const out = new Vector<T>();
    for (let i = 0; i < length; i++) out.push(e);
    return out;
  }

  /** Wrap an array into a Vector. */
  static fromArray<T>(array: Iterable<T>): Vector<T> {
    return Vector.fromArray(array);
  }

  /**
   * Merge two elements into a single vector. Vectors are concatenated; a
   * non-vector is folded into a vector partner; two non-vectors become a pair.
   */
  static merge(vectorA: unknown = null, vectorB: unknown = null): Vector<unknown> {
    if (vectorA instanceof Vector && vectorB instanceof Vector) {
      return Vector.fromArray([...vectorA, ...vectorB]);
    }
    if (vectorA instanceof Vector) {
      const copy = vectorA.clone();
      copy.push(vectorB);
      return copy;
    }
    if (vectorB instanceof Vector) {
      const copy = vectorB.clone();
      copy.addElement(vectorA, 0); // bug fix: prepend vectorA, not vectorB
      return copy;
    }
    return Vector.fromArray([vectorA, vectorB]);
  }

  /**
   * Build a sequence recursively. With `keep`, the growing result feeds itself;
   * otherwise a fixed-length sliding window of `seeds` is used. Neither the
   * caller's `seeds` array is mutated (a bug avoided from the AS3 original).
   */
  static recursiveSequence<T>(
    seeds: readonly T[],
    formula: (seeds: T[]) => T,
    endCondition: (seeds: T[] | Vector<T>) => boolean,
    keep = false,
  ): Vector<T> {
    const out = Vector.fromArray(seeds);
    if (keep) {
      while (!endCondition(out)) out.push(formula([...out]));
    } else {
      const window = [...seeds];
      while (!endCondition(window)) {
        out.push(formula(window));
        window.shift();
        window.push(out[out.length - 1] as T);
      }
    }
    return out;
  }

  /** Wrap `element` inside `depth` nested vectors. Returns `element` if depth 0. */
  static wrap(element: unknown, depth = 1): unknown {
    if (depth === 0) return element;
    const out = new Vector<unknown>();
    out.push(element);
    return VectorUtils.wrap(out, depth - 1);
  }

  /**
   * Placeholder for the AS3 On-Line Encyclopedia of Integer Sequences fetch,
   * which was itself only a hard-coded stub (it "required an internet
   * connection" but never actually made one).
   */
  static fromOEIS(selection = 1): Vector<number> {
    let vectorString: string;
    switch (selection) {
      case 1:
        vectorString = "1,2,3";
        break;
      case 2:
        vectorString = "4,5,6";
        break;
      case 3:
        vectorString = "7,8,9";
        break;
      default:
        vectorString = "0,0,0";
    }
    return VectorUtils.transform(Vector.fromArray(vectorString.split(",")), (s) => parseInt(s, 10));
  }

  // -- Section I.3: transformations ----------------------------------------

  /** Fill a length-`v.length` vector with `unary(i)` for each index. */
  static fillByIndex<R>(v: Vector<unknown>, unaryOperation: Unary<number, R>): Vector<R> {
    const out = new Vector<R>(v.length);
    for (let i = 0; i < out.length; i++) out[i] = unaryOperation(i);
    return out;
  }

  /** Map `unaryOperation` over each element. */
  static transform<T, R>(vector: Vector<T>, unaryOperation: Unary<T, R>): Vector<R> {
    const out = new Vector<R>();
    for (const e of vector) out.push(unaryOperation(e));
    return out;
  }

  /** Replace every element with `element`. */
  static replace<T>(vector: Vector<unknown>, element: T): Vector<T> {
    const out = new Vector<T>();
    for (let i = 0; i < vector.length; i++) out.push(element);
    return out;
  }

  /** Map `unaryOperation` over every end node (non-vector leaf), recursively. */
  static transformEndNodes(
    vector: Vector<unknown>,
    unaryOperation: Unary<unknown, unknown>,
    endNodeCriterion: Predicate<unknown> = VectorUtils.isNotVector,
  ): Vector<unknown> {
    const out = vector.clone();
    for (let i = 0; i < out.length; i++) {
      const el = out[i];
      if (endNodeCriterion(el) || !(el instanceof Vector)) {
        out[i] = unaryOperation(el);
      } else {
        out[i] = VectorUtils.transformEndNodes(el, unaryOperation, endNodeCriterion);
      }
    }
    return out;
  }

  /** Replace every end node with `element`, recursively. */
  static replaceEndNodes(
    vector: Vector<unknown>,
    element: unknown,
    endNodeCriterion: Predicate<unknown> = VectorUtils.isNotVector,
  ): Vector<unknown> {
    const out = vector.clone();
    for (let i = 0; i < out.length; i++) {
      const el = out[i];
      if (endNodeCriterion(el) || !(el instanceof Vector)) {
        out[i] = element;
      } else {
        out[i] = VectorUtils.replaceEndNodes(el, element, endNodeCriterion);
      }
    }
    return out;
  }

  /** Remove `first` elements from the front and `last` from the back. */
  static trim<T>(vector: Vector<T>, first = 0, last = 0): Vector<T> {
    const out = vector.clone();
    out.splice(vector.length - last, last);
    out.splice(0, first);
    return out;
  }

  /** Remove every occurrence of any of `remove` (strict equality). */
  static removeElements<T>(vector: Vector<T>, ...remove: T[]): Vector<T> {
    const out = vector.clone();
    for (let i = 0; i < out.length; i++) {
      if (remove.includes(out[i] as T)) {
        out.removeElement(i);
        i--;
      }
    }
    return out;
  }

  /** Keep the elements matching `matchCriterion`. */
  static filter<T>(vector: Vector<T>, matchCriterion: Predicate<T>): Vector<T> {
    const out = new Vector<T>();
    for (const e of vector) if (matchCriterion(e)) out.push(e);
    return out;
  }

  /** The most frequently occurring element(s). */
  static modes<T>(list: Vector<T>): Vector<T> {
    const modes = new Vector<T>();
    if (list.length === 0) return modes;

    const counted: T[] = [];
    const counts: Array<{ value: T; occurences: number }> = [];
    for (const value of list) {
      if (!counted.includes(value)) {
        counts.push({ value, occurences: VectorUtils.count(list, value) });
        counted.push(value);
      }
    }
    counts.sort((a, b) => b.occurences - a.occurences);

    const highCount = counts[0].occurences;
    for (const c of counts) {
      if (c.occurences < highCount) break;
      modes.push(c.value);
    }
    return modes;
  }

  /** Fully flatten a nested vector of arbitrary, possibly ragged depth. */
  static flatten(vector: Vector<unknown>): Vector<unknown> {
    const out = vector.clone();
    while (!VectorUtils.isFlat(out)) {
      for (let i = 0; i < out.length; i++) {
        const el = out[i];
        if (el instanceof Vector) {
          const temp = el.clone();
          out.removeElement(i);
          for (const e of temp) {
            out.addElement(e, i);
            i++;
          }
          i--;
        }
      }
    }
    return out;
  }

  /** Flatten one level of a vector whose elements share the same depth. */
  static flattenSD(vector: Vector<unknown>): Vector<unknown> {
    const out = vector.clone();
    if (out.length === 0) return new Vector<unknown>();
    if (!(out[0] instanceof Vector)) return out;

    while (out.length > 1) {
      out[0] = VectorUtils.merge(out[0], out[1]).clone();
      out.removeElement(1);
    }
    return out[0] as Vector<unknown>;
  }

  /** Flatten a same-depth vector by `depth` levels (fully if `depth` is 0). */
  static flattenSDLevels(vector: Vector<unknown>, depth = 0): Vector<unknown> {
    let out = vector.clone();
    const level = depth > 0 ? depth : VectorUtils.nestedDepthSD(vector);
    for (let i = 0; i < level; i++) out = VectorUtils.flatten(out);
    return out;
  }

  /** Replace end nodes with copies of the whole vector (one fractal step). */
  static fractal(vector: Vector<unknown>): Vector<unknown> {
    return VectorUtils.replaceEndNodes(vector, vector.clone());
  }

  /** Apply {@link fractal} `level` times. */
  static fractalLevels(vector: Vector<unknown>, level = 0): Vector<unknown> {
    let out = vector.clone();
    for (let i = 0; i < level; i++) out = VectorUtils.fractal(out);
    return out;
  }

  // -- Section I.4: combinations -------------------------------------------

  /** Insert the elements of `newVector` into `target` at `index`. */
  static insert<T>(target: Vector<T>, newVector: Vector<T>, index = -1): Vector<T> {
    if (index < 0) index = target.length;
    const out = target.clone();
    for (let i = 0; i < newVector.length; i++) {
      out.splice(index + i, 0, newVector[i] as T);
    }
    return out;
  }

  /**
   * Combine two vectors element-wise via `binaryOperation`. Where only one
   * vector has an element, `defaultValue` is used if supplied, otherwise the
   * present element. (Bug fix: presence is tested by index, not truthiness.)
   */
  static combine<A, B, R>(
    alpha: Vector<A>,
    beta: Vector<B>,
    binaryOperation: Binary<A, B, R>,
    defaultValue?: R,
  ): Vector<R | A | B> {
    const len = Math.max(alpha.length, beta.length);
    const out = new Vector<R | A | B>(len);
    for (let i = 0; i < len; i++) {
      const hasA = i < alpha.length;
      const hasB = i < beta.length;
      if (hasA && hasB) {
        out[i] = binaryOperation(alpha[i] as A, beta[i] as B);
      } else if (hasA) {
        out[i] = defaultValue !== undefined ? defaultValue : (alpha[i] as A);
      } else {
        out[i] = defaultValue !== undefined ? defaultValue : (beta[i] as B);
      }
    }
    return out;
  }

  // -- Section I.5: reductions & queries -----------------------------------

  static length(list: Vector<unknown>): number {
    return list.length;
  }

  /** Reduce a vector to a single value via a binary operation (left fold). */
  static collapse<T>(vector: Vector<T>, binaryOperation: Binary<T, T, T>, defaultObject: T | null = null): T | null {
    const work = vector.clone();
    if (work.length === 0) return defaultObject;
    let acc = work[0] as T;
    for (let i = 1; i < work.length; i++) acc = binaryOperation(acc, work[i] as T);
    return acc;
  }

  /** Count elements satisfying `matchCriterion`. */
  static matches<T>(vector: Vector<T>, matchCriterion: Predicate<T>): number {
    let n = 0;
    for (const e of vector) if (matchCriterion(e)) n++;
    return n;
  }

  /** Count occurrences of `matchElement` (strict equality). */
  static count<T>(vector: Vector<T>, matchElement: T): number {
    return VectorUtils.matches(vector, (x) => x === matchElement);
  }

  /**
   * Lengths of consecutive runs matching `matchCriterion`. Unlike the AS3
   * original, a spurious trailing `0` (left over when the input ends on a
   * non-matching run) is trimmed.
   */
  static consecutiveMatches<T>(vector: Vector<T>, matchCriterion: Predicate<T>): number[] {
    const appearences: number[] = [0];
    for (const e of vector) {
      if (matchCriterion(e)) {
        appearences[appearences.length - 1]++;
      } else if (appearences[appearences.length - 1] !== 0) {
        appearences.push(0);
      }
    }
    if (appearences.length > 1 && appearences[appearences.length - 1] === 0) appearences.pop();
    return appearences;
  }

  /** Depth of a same-depth nested vector. */
  static nestedDepthSD(vector: Vector<unknown>, initialDepth = 0): number {
    if (!(vector[0] instanceof Vector)) return initialDepth;
    return VectorUtils.nestedDepthSD(vector[0], initialDepth + 1);
  }

  // -- Section III: matrices -----------------------------------------------

  /** Row separator used by {@link matrixString}. */
  static readonly RowSeperator = ",\r";

  /** True when `vector` is a matrix (rows are equal-length vectors). */
  static isMatrix(vector: Vector<unknown>): boolean {
    if (!(vector[0] instanceof Vector)) return false;
    const length = vector[0].length;
    for (const v of vector) {
      if (!(v instanceof Vector) || v.length !== length) return false;
    }
    return true;
  }

  static width(vector: Matrix<unknown>): number {
    return (vector[0] as Vector<unknown>).length;
  }

  static height(vector: Matrix<unknown>): number {
    return vector.length;
  }

  /** An `height`×`width` matrix filled with `e`. */
  static constantMatrix<T>(height = 1, width = 1, e: T): Matrix<T> {
    const out = new Vector<Vector<T>>();
    for (let i = 0; i < height; i++) {
      const row = new Vector<T>();
      for (let j = 0; j < width; j++) row.push(e);
      out.push(row);
    }
    return out;
  }

  /** Identity-like matrix with `one` on the diagonal and `zero` elsewhere. */
  static generateIdentity<T>(height = 1, width = 1, one: T, zero: T): Matrix<T> {
    const identity = VectorUtils.constantMatrix<T>(height, width, zero);
    return VectorUtils.fillMatrixByIndex(identity, (i, j) => (i === j ? one : zero));
  }

  /** Wrap a vector as a single-row matrix. */
  static vectorToMatrixRow<T>(vector: Vector<T>): Matrix<T> {
    const out = new Vector<Vector<T>>();
    out.push(vector);
    return out;
  }

  /** Wrap a vector as a single-column matrix. */
  static vectorToMatrixColumn<T>(vector: Vector<T>): Matrix<T> {
    return VectorUtils.transpose(VectorUtils.vectorToMatrixRow(vector));
  }

  /** Fill each cell of a matrix with `binaryOperation(i, j)`. */
  static fillMatrixByIndex<R>(m: Matrix<unknown>, binaryOperation: Binary<number, number, R>): Matrix<R> {
    const out = m.clone() as unknown as Matrix<R>;
    for (let i = 0; i < VectorUtils.height(out); i++) {
      for (let j = 0; j < VectorUtils.width(out); j++) {
        (out[i] as Vector<R>)[j] = binaryOperation(i, j);
      }
    }
    return out;
  }

  /** Replace every cell of a matrix with `element`. */
  static replaceMatrix<T>(m: Matrix<unknown>, element: T): Matrix<T> {
    const out = m.clone() as unknown as Matrix<T>;
    for (let i = 0; i < VectorUtils.height(out); i++) {
      for (let j = 0; j < VectorUtils.width(out); j++) (out[i] as Vector<T>)[j] = element;
    }
    return out;
  }

  /** Transpose a matrix. */
  static transpose<T>(vector: Matrix<T>): Matrix<T> {
    const out = new Vector<Vector<T>>();
    for (let k = 0; k < VectorUtils.width(vector); k++) out.push(new Vector<T>(VectorUtils.height(vector)));
    for (let i = 0; i < VectorUtils.height(vector); i++) {
      for (let j = 0; j < VectorUtils.width(vector); j++) {
        (out[j] as Vector<T>)[i] = (vector[i] as Vector<T>)[j] as T;
      }
    }
    return out;
  }

  /** Return the `index`-th row as a single-row matrix. */
  static getRow<T>(m: Matrix<T>, index = 0): Matrix<T> {
    return VectorUtils.wrap(m[index]) as Matrix<T>;
  }

  /** Return the `index`-th column as a single-row matrix. */
  static getColumn<T>(m: Matrix<T>, index = 0): Matrix<T> {
    return VectorUtils.transpose(VectorUtils.getRow(VectorUtils.transpose(m), index));
  }

  static rowRemoved<T>(m: Matrix<T>, index = 0): Matrix<T> {
    const out = m.clone();
    out.removeElement(index);
    return out;
  }

  static columnRemoved<T>(m: Matrix<T>, index = 0): Matrix<T> {
    return VectorUtils.transpose(VectorUtils.rowRemoved(VectorUtils.transpose(m), index));
  }

  static rowInserted<T>(target: Matrix<T>, inserted: Vector<T>, index = -1): Matrix<T> {
    return VectorUtils.insert(target, VectorUtils.wrap(inserted) as Matrix<T>, index);
  }

  static columnInserted<T>(target: Matrix<T>, inserted: Vector<T>, index = -1): Matrix<T> {
    return VectorUtils.transpose(VectorUtils.rowInserted(VectorUtils.transpose(target), inserted, index));
  }

  static mergeRows<T>(vectorA: Vector<T>, vectorB: Vector<T>): Matrix<T> {
    return VectorUtils.merge(vectorA, vectorB) as Matrix<T>;
  }

  static mergeColumns<T>(vectorA: Matrix<T>, vectorB: Matrix<T>): Matrix<T> {
    return VectorUtils.transpose(
      VectorUtils.mergeRows(VectorUtils.transpose(vectorA), VectorUtils.transpose(vectorB)) as Matrix<T>,
    );
  }

  static rowSet<T>(target: Matrix<T>, newVector: Vector<T>, index = 0): Matrix<T> {
    const out = target.clone();
    out.setElement(newVector, index);
    return out;
  }

  static columnSet<T>(target: Matrix<T>, newVector: Vector<T>, index = 0): Matrix<T> {
    return VectorUtils.transpose(VectorUtils.rowSet(VectorUtils.transpose(target), newVector, index));
  }

  /** Overlay `block` onto `target` with its top-left corner at (i, j). */
  static placeBlock<T>(target: Matrix<T>, block: Matrix<T>, i: number, j: number): Matrix<T> {
    const out = target.clone();
    for (let iPrime = 0; iPrime < VectorUtils.height(block); iPrime++) {
      for (let jPrime = 0; jPrime < VectorUtils.width(block); jPrime++) {
        const row = out[i + iPrime] as Vector<T> | undefined;
        if (row && row.length > j + jPrime) {
          row[j + jPrime] = (block[iPrime] as Vector<T>)[jPrime] as T;
        }
      }
    }
    return out;
  }

  /** Expand a block matrix (matrix of matrices) into a flat matrix. */
  static breakBlock<T>(M: Matrix<Matrix<T>>): Matrix<T> {
    let newHeight = 0;
    let newWidth = 0;
    const h = VectorUtils.height(M);
    const w = VectorUtils.width(M);

    for (let k = 0; k < h; k++) newHeight += VectorUtils.height((M[k] as Vector<Matrix<T>>)[0] as Matrix<T>);
    for (let k = 0; k < w; k++) newWidth += VectorUtils.width((M[0] as Vector<Matrix<T>>)[k] as Matrix<T>);

    const broken = VectorUtils.constantMatrix<T>(newHeight, newWidth, null as unknown as T);
    let currentHeight = 0;
    let currentWidth = 0;
    let currentMatrix: Matrix<T> = (M[0] as Vector<Matrix<T>>)[0] as Matrix<T>;
    while (currentHeight < newHeight) {
      for (let i = 0; i < h; i++) {
        for (let j = 0; j < w; j++) {
          currentMatrix = (M[i] as Vector<Matrix<T>>)[j] as Matrix<T>;
          for (let iPrime = 0; iPrime < VectorUtils.height(currentMatrix); iPrime++) {
            for (let jPrime = 0; jPrime < VectorUtils.width(currentMatrix); jPrime++) {
              (broken[currentHeight + iPrime] as Vector<T>)[currentWidth + jPrime] = (
                currentMatrix[iPrime] as Vector<T>
              )[jPrime] as T;
            }
          }
          currentWidth += VectorUtils.width(currentMatrix);
        }
        currentWidth = 0;
        currentHeight += VectorUtils.height(currentMatrix);
      }
    }
    return broken;
  }

  /** Pad a matrix with `element`, optionally interleaving and/or bordering. */
  static pad<T>(
    matrix: Matrix<T>,
    element: T | null = null,
    padRows = true,
    padCols = true,
    top = true,
    bottom = true,
    left = true,
    right = true,
  ): Matrix<T> {
    let out = matrix.clone() as Matrix<T>;
    let paddingVector: Vector<T>;

    if (padRows) {
      let insertCount = 1;
      while (insertCount < VectorUtils.height(out)) {
        paddingVector = VectorUtils.constantVector(VectorUtils.width(out), element as T);
        out = VectorUtils.rowInserted(out, paddingVector, insertCount);
        insertCount += 2;
      }
    }
    if (padCols) {
      let insertCount = 1;
      while (insertCount < VectorUtils.width(out)) {
        paddingVector = VectorUtils.constantVector(VectorUtils.height(out), element as T);
        out = VectorUtils.columnInserted(out, paddingVector, insertCount);
        insertCount += 2;
      }
    }
    if (top) out = VectorUtils.rowInserted(out, VectorUtils.constantVector(VectorUtils.width(out), element as T), 0);
    if (bottom)
      out = VectorUtils.rowInserted(out, VectorUtils.constantVector(VectorUtils.width(out), element as T), -1);
    if (left)
      out = VectorUtils.columnInserted(out, VectorUtils.constantVector(VectorUtils.height(out), element as T), 0);
    if (right)
      out = VectorUtils.columnInserted(out, VectorUtils.constantVector(VectorUtils.height(out), element as T), -1);
    return out;
  }

  /** The main (or `off`-set) diagonal of a matrix as a vector. */
  static diagonal<T>(M: Matrix<T>, off = 0): Vector<T> {
    const diag = new Vector<T>();
    if (off >= 0) {
      for (let i = 0; i < VectorUtils.width(M) - off; i++) diag.push((M[i] as Vector<T>)[i + off] as T);
    } else {
      const o = -off;
      for (let i = 0; i < VectorUtils.height(M) - o; i++) diag.push((M[i + o] as Vector<T>)[i] as T);
    }
    return diag;
  }

  /** The anti-diagonal (or `off`-set) of a matrix as a vector. */
  static minorDiagonal<T>(M: Matrix<T>, off = 0): Vector<T> {
    const diag = new Vector<T>();
    if (off >= 0) {
      for (let i = 0; i < VectorUtils.width(M) - off; i++) {
        diag.push((M[i] as Vector<T>)[VectorUtils.width(M) - i - 1 - off] as T);
      }
    } else {
      const o = -off;
      for (let i = 0; i < VectorUtils.height(M) - o; i++) {
        diag.push((M[i + o] as Vector<T>)[VectorUtils.width(M) - i - 1] as T);
      }
    }
    return diag;
  }

  /** Render a matrix as a nicely aligned multi-line string. */
  static matrixString(
    vector: Matrix<unknown>,
    minSpace = 0,
    center = 0,
    seperator = ",",
    leftBracket = "[",
    rightBracket = "]",
    rowSeperator = ",",
    openingBracket = "[",
    closingBracket = "]",
  ): string {
    // Stringify cells (kept in a parallel structure so we don't mutate input).
    const cells: string[][] = [];
    let space = minSpace;
    for (let i = 0; i < VectorUtils.height(vector); i++) {
      const row: string[] = [];
      for (let j = 0; j < VectorUtils.width(vector); j++) {
        const raw = (vector[i] as Vector<unknown>)[j];
        const str = raw == null ? "null" : String(raw);
        row.push(str);
        if (minSpace > 0 && space < str.length) space = str.length;
      }
      cells.push(row);
    }

    if (minSpace > 0) {
      for (const row of cells) {
        for (let j = 0; j < row.length; j++) {
          const cell = row[j] as string;
          if (center !== 0) {
            let addLeft = Math.ceil((space - cell.length) / 2);
            let addRight = Math.floor((space - cell.length) / 2);
            if (center < 0) [addLeft, addRight] = [addRight, addLeft];
            row[j] = " ".repeat(addLeft) + cell + " ".repeat(addRight);
          } else {
            row[j] = " ".repeat(space - cell.length) + cell;
          }
        }
      }
    }

    const rowStrings = cells.map((row) => leftBracket + row.join(seperator) + rightBracket);
    const fullRowSep = `${rowSeperator}\r${" ".repeat(openingBracket.length)}`;
    return openingBracket + rowStrings.join(fullRowSep) + closingBracket;
  }
}
