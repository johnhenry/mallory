import { ComplexNumber } from "./ComplexNumber.ts";
import { Vector } from "./Vector.ts";
import { VectorUtils } from "./VectorUtils.ts";

/**
 * Type — runtime classification used for the polymorphic `*Generic` dispatchers
 * in {@link RealMath}/{@link ComplexMath}. Ported from Mallory's ActionScript
 * `Type`. The string tags are preserved.
 *
 * Note: the AS3 version had an explicit `obj is Expression -> FUNCTION` branch,
 * but its fall-through default was already `FUNCTION`, so the check is redundant
 * and omitted here (an Expression still classifies as `FUNCTION`).
 */
export const TypeTag = {
  NUMBER: "number",
  VECTOR: "vector",
  MATRIX: "matrix",
  FUNCTION: "function",
  ERROR: "error",
  BOOLEAN: "boolean",
  PERMUTATION: "permutation",
} as const;

export type TypeTag = (typeof TypeTag)[keyof typeof TypeTag];

export class Type {
  static readonly NUMBER = TypeTag.NUMBER;
  static readonly VECTOR = TypeTag.VECTOR;
  static readonly MATRIX = TypeTag.MATRIX;
  static readonly FUNCTION = TypeTag.FUNCTION;
  static readonly ERROR = TypeTag.ERROR;
  static readonly BOOLEAN = TypeTag.BOOLEAN;
  static readonly PERMUTATION = TypeTag.PERMUTATION;

  /** Classify a runtime value into one of the {@link TypeTag} strings. */
  static getType(obj: unknown): TypeTag {
    if (typeof obj === "number" || obj instanceof ComplexNumber || ComplexNumber.isComplex(obj)) {
      return TypeTag.NUMBER;
    }
    if (obj instanceof Vector) {
      return VectorUtils.isMatrix(obj) ? TypeTag.MATRIX : TypeTag.VECTOR;
    }
    if (obj instanceof Error) return TypeTag.ERROR;
    if (typeof obj === "boolean") return TypeTag.BOOLEAN;
    if (typeof obj === "string") return TypeTag.ERROR;
    return TypeTag.FUNCTION;
  }
}
