import { DualNumber } from "./DualNumber.ts";
import { Symbolic } from "./Symbolic.ts";

/**
 * VectorCalculus — multivariable differential calculus: gradients, Jacobians,
 * divergence, curl, and Hessians. Built entirely on existing exact-derivative
 * machinery rather than a new autodiff engine: {@link gradient}/{@link jacobian}
 * reuse {@link DualNumber} forward-mode autodiff (exact, first-order);
 * {@link symbolicGradient} reuses {@link Symbolic} differentiation/evaluation
 * for string-expression functions.
 *
 * {@link hessian} is the one approximate method — it takes central differences
 * of the *exact* gradient (not of `f` itself), which is more accurate than a
 * naive finite-difference Hessian without the scope of implementing
 * second-order (hyperdual) numbers.
 */
export class VectorCalculus {
  /** The gradient of a scalar field `f` at `point` (exact, via {@link DualNumber}). */
  static gradient(f: (xs: DualNumber[]) => DualNumber, point: number[]): number[] {
    return DualNumber.gradient(f, point);
  }

  /** The rate of change of `f` at `point` along `direction` (need not be a unit vector). */
  static directionalDerivative(f: (xs: DualNumber[]) => DualNumber, point: number[], direction: number[]): number {
    const norm = Math.sqrt(direction.reduce((s, d) => s + d * d, 0));
    if (norm === 0) throw new Error("VectorCalculus.directionalDerivative: direction must be non-zero");
    const grad = VectorCalculus.gradient(f, point);
    return grad.reduce((s, g, i) => s + (g * (direction[i] as number)) / norm, 0);
  }

  /**
   * The Jacobian of a vector field `f: R^n -> R^m` at `point`, as an `m × n`
   * matrix (`J[i][j] = ∂f_i/∂x_j`). Computed via `n` forward autodiff passes,
   * one dual-seeded input dimension at a time.
   */
  static jacobian(f: (xs: DualNumber[]) => DualNumber[], point: number[]): number[][] {
    const n = point.length;
    const columns: number[][] = [];
    for (let i = 0; i < n; i++) {
      const seeded = point.map((x, j) => new DualNumber(x, i === j ? 1 : 0));
      columns.push(f(seeded).map((o) => o.deriv));
    }
    const m = columns[0]?.length ?? 0;
    return Array.from({ length: m }, (_, row) => columns.map((column) => column[row] as number));
  }

  /** The divergence of a vector field `f: R^n -> R^n` at `point` (the trace of its Jacobian). */
  static divergence(f: (xs: DualNumber[]) => DualNumber[], point: number[]): number {
    const J = VectorCalculus.jacobian(f, point);
    return point.reduce((sum, _, i) => sum + (J[i]?.[i] as number), 0);
  }

  /** The curl of a 3D vector field `f: R^3 -> R^3` at `point`. */
  static curl3D(f: (xs: DualNumber[]) => DualNumber[], point: [number, number, number]): [number, number, number] {
    const J = VectorCalculus.jacobian(f, point);
    return [
      (J[2]?.[1] as number) - (J[1]?.[2] as number),
      (J[0]?.[2] as number) - (J[2]?.[0] as number),
      (J[1]?.[0] as number) - (J[0]?.[1] as number),
    ];
  }

  /**
   * The Hessian of a scalar field `f` at `point`: central differences (step
   * `h`) of the exact gradient, i.e. `H[i][j] ≈ ∂(∂f/∂x_j)/∂x_i`.
   */
  static hessian(f: (xs: DualNumber[]) => DualNumber, point: number[], h = 1e-4): number[][] {
    return point.map((_, i) => {
      const plus = point.slice();
      const minus = point.slice();
      plus[i] = (plus[i] as number) + h;
      minus[i] = (minus[i] as number) - h;
      const gradPlus = VectorCalculus.gradient(f, plus);
      const gradMinus = VectorCalculus.gradient(f, minus);
      return gradPlus.map((g, j) => (g - (gradMinus[j] as number)) / (2 * h));
    });
  }

  /**
   * The exact gradient of a string expression at `point`, via
   * {@link Symbolic.differentiate}/{@link Symbolic.evaluate} (one partial
   * derivative per named variable — every other variable is held constant).
   */
  static symbolicGradient(expr: string, variables: string[], point: Record<string, number>): number[] {
    return variables.map((variable) => Symbolic.evaluate(Symbolic.differentiate(expr, variable), point));
  }
}
