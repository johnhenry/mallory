/**
 * mallory-ts — advanced college-level mathematics for TypeScript.
 *
 * A modern, tested TypeScript port of the Mallory ActionScript 3 library.
 */

// Counting mathematics
export { Combinatorics } from "./Combinatorics.ts";
export * as ComplexMath from "./ComplexMath.ts";
export { ComplexNumber } from "./ComplexNumber.ts";
export { Cycle } from "./Cycle.ts";
export { Decimal } from "./Decimal.ts";
export {
  type ContinuousDistribution,
  type DiscreteDistribution,
  Distributions,
  HypothesisTests,
  type TestResult,
} from "./Distributions.ts";
export { DualNumber } from "./DualNumber.ts";
// Expression evaluation
export { Environment } from "./Environment.ts";
export { Expression } from "./Expression.ts";
export { FFT } from "./FFT.ts";
export { Geometry, type Point, Transform2D } from "./Geometry.ts";
export { type Edge, Graph } from "./Graph.ts";
export {
  type Face,
  Graph3DUtils,
  type Material,
  type Mesh,
  type Placement3D,
  type Vec3,
} from "./Graph3DUtils.ts";
// Graphing (renderer-agnostic geometry)
export {
  type BarPlacement2D,
  type FillStyle,
  GraphUtils,
  type Path2D,
  type PathCommand,
  type Placement2D,
  type StrokeStyle,
} from "./GraphUtils.ts";
export { GroupTheory } from "./GroupTheory.ts";
// Combinatorics & number theory
export { Interval } from "./Interval.ts";
export { IntUtils } from "./IntUtils.ts";
export { Logic } from "./Logic.ts";
export {
  type EigenResult,
  type LUResult,
  MatrixMath,
  type QRResult,
  type SVDResult,
} from "./MatrixMath.ts";
export { NumberTheory } from "./NumberTheory.ts";
export { Numerical, type ODEStep } from "./Numerical.ts";
export { Permutation } from "./Permutation.ts";
export { Polygon } from "./Polygon.ts";
export { PolynomialRing, parsePolynomial, polynomialToString } from "./PolynomialRing.ts";
export { Quaternion } from "./Quaternion.ts";
export { Rational } from "./Rational.ts";
// Numeric cores
export * as RealMath from "./RealMath.ts";
export { SpecialFunctions } from "./SpecialFunctions.ts";
export { SpecialOperator } from "./SpecialOperator.ts";
export * as Statistics from "./Statistics.ts";
export { StringEvaluator } from "./StringEvaluator.ts";
// Algebraic structures & geometry
export { Structure, type StructureOptions } from "./Structure.ts";
export {
  type BinaryFuncName,
  type CmpOp,
  type DifferentiationStep,
  type Expr,
  FUNCTION_NAMES,
  type FuncName,
  NonLinearSystemError,
  NotIntegrableError,
  SeriesDivergesError,
  SingularSystemError,
  Symbolic,
  UndeclaredVariableError,
} from "./Symbolic.ts";
export { Type, TypeTag } from "./Type.ts";
// Utilities & leaves
export { Utilities } from "./Utilities.ts";
// Foundations
export { Vector } from "./Vector.ts";
export { VectorCalculus } from "./VectorCalculus.ts";
// Linear algebra
export { type Matrix, VectorUtils } from "./VectorUtils.ts";
