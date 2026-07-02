/**
 * Logic — boolean helper predicates.
 *
 * Ported from Mallory's ActionScript `Logic`. The AS3 source did not actually
 * compile (`And(a*;b:*)` and friends are syntactically invalid); the intent is
 * clear from the comments and reproduced here as ordinary boolean functions.
 */
export class Logic {
  /** Always true, whatever the arguments. */
  static truth(..._anything: unknown[]): boolean {
    return true;
  }

  /** Always false, whatever the arguments. */
  static falsehood(..._anything: unknown[]): boolean {
    return false;
  }

  /** Logical AND. */
  static and(a: unknown, b: unknown): boolean {
    return Boolean(a) && Boolean(b);
  }

  /** Logical (inclusive) OR. */
  static or(a: unknown, b: unknown): boolean {
    return Boolean(a) || Boolean(b);
  }

  /** Logical exclusive OR. */
  static xor(a: unknown, b: unknown): boolean {
    return Boolean(a) !== Boolean(b);
  }

  /** Logical NOT. */
  static not(a: unknown): boolean {
    return !a;
  }
}
