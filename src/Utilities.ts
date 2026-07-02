/**
 * Utilities — small general-purpose helpers.
 *
 * In the ActionScript original the entire body of this class was commented out.
 * The helpers were clearly intended to ship (they are referenced conceptually
 * throughout the library and `RoundTo` is re-implemented ad hoc elsewhere), so
 * they are revived here as ordinary functions. Array helpers that merely duplicate
 * built-ins (`CloneArray`, `MapArray`, `isMember`) are kept for API parity.
 */
export class Utilities {
  static readonly DefaultPrecision = 8;

  /**
   * Round a real number to `precision` decimal places. Extremely large
   * magnitudes collapse to ±Infinity and denormally-small ones to 0, matching
   * the AS3 `RoundTo` behaviour.
   */
  static roundTo(value: number, precision: number = Utilities.DefaultPrecision): number {
    if (value >= Number.MAX_VALUE) return Number.POSITIVE_INFINITY;
    if (value <= -Number.MAX_VALUE) return Number.NEGATIVE_INFINITY;
    if (Math.abs(value) <= Number.MIN_VALUE) return 0;
    const factor = 10 ** precision;
    return Math.round(value * factor) / factor;
  }

  static radiansToDegrees(r: number): number {
    return (180 / Math.PI) * r;
  }

  static degreesToRadians(d: number): number {
    return (Math.PI / 180) * d;
  }

  /** Shallow copy of an array. */
  static cloneArray<T>(array: readonly T[]): T[] {
    return [...array];
  }

  /** Map `mapper` over an array (kept for parity with the AS3 API). */
  static mapArray<T, U>(elements: readonly T[], mapper: (value: T) => U): U[] {
    return elements.map(mapper);
  }

  /** True when `value` is (loosely) equal to a member of `group`. */
  static isMember(value: unknown, group: readonly unknown[]): boolean {
    // biome-ignore lint/suspicious/noDoubleEquals: faithful to AS3 loose `==` coercion semantics
    return group.some((i) => value == i);
  }
}
