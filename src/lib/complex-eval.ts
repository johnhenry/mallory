import { ComplexNumber, type Expr } from "mallory-math";

export type ComplexEnv = Record<string, ComplexNumber>;

const CONSTANTS: Record<string, ComplexNumber> = { pi: ComplexNumber.PI, e: ComplexNumber.E };

/**
 * Evaluates a mallory-math `Expr` AST over `ComplexNumber` values. Neither of
 * mallory-math's own evaluators fits: `Symbolic.evaluate` is real-only, and
 * `Symbolic.evaluateOverStructure` throws on any `func`/`call2` node even
 * when given `Structure.complexField()` -- so this is a dedicated AST walker
 * dispatching to `ComplexNumber`'s own elementary-function methods.
 */
export function evaluateComplex(expr: Expr, env: ComplexEnv): ComplexNumber {
  switch (expr.type) {
    case "const":
      return ComplexNumber.fromNumber(expr.value);
    case "var": {
      const constant = CONSTANTS[expr.name];
      if (constant) return constant;
      const bound = env[expr.name];
      if (!bound) throw new Error(`"${expr.name}" is not bound -- only "z" and constants (pi, e) are available here.`);
      return bound;
    }
    case "add":
      return evaluateComplex(expr.left, env).add(evaluateComplex(expr.right, env));
    case "sub":
      return evaluateComplex(expr.left, env).subtract(evaluateComplex(expr.right, env));
    case "mul":
      return evaluateComplex(expr.left, env).multiply(evaluateComplex(expr.right, env));
    case "div":
      return evaluateComplex(expr.left, env).divide(evaluateComplex(expr.right, env));
    case "pow":
      return evaluateComplex(expr.base, env).power(evaluateComplex(expr.exp, env));
    case "neg":
      return evaluateComplex(expr.arg, env).neg();
    case "func":
      return evaluateComplexFunc(expr.name, evaluateComplex(expr.arg, env));
    default:
      throw new Error(`"${expr.type}" has no complex-valued meaning here.`);
  }
}

function evaluateComplexFunc(name: string, z: ComplexNumber): ComplexNumber {
  switch (name) {
    case "sin":
      return z.sine();
    case "cos":
      return z.cosine();
    case "tan":
      return z.tangent();
    case "exp":
      return ComplexNumber.E.power(z);
    case "ln":
      return z.logarithm();
    case "sqrt":
      return z.squareRoot();
    case "asin":
      return z.arcSine();
    case "acos":
      return z.arcCosine();
    case "atan":
      return z.arcTangent();
    case "sinh":
      return z.hyperbolicSine();
    case "cosh":
      return z.hyperbolicCosine();
    case "tanh":
      return z.hyperbolicTangent();
    case "cot":
      return z.tangent().reciprocal();
    case "sec":
      return z.cosine().reciprocal();
    case "csc":
      return z.sine().reciprocal();
    case "asinh":
      return z.arcHyperbolicSine();
    case "acosh":
      return z.arcHyperbolicCosine();
    case "atanh":
      return z.arcHyperbolicTangent();
    case "coth":
      return z.hyperbolicTangent().reciprocal();
    case "sech":
      return z.hyperbolicCosine().reciprocal();
    case "csch":
      return z.hyperbolicSine().reciprocal();
    case "acot":
      return z.reciprocal().arcTangent();
    case "asec":
      return z.reciprocal().arcCosine();
    case "acsc":
      return z.reciprocal().arcSine();
    case "acoth":
      return z.reciprocal().arcHyperbolicTangent();
    case "asech":
      return z.reciprocal().arcHyperbolicCosine();
    case "acsch":
      return z.reciprocal().arcHyperbolicSine();
    case "abs":
      return ComplexNumber.fromNumber(z.magnitude());
    case "log10":
      return z.logarithm(10);
    case "log2":
      return z.logarithm(2);
    case "cbrt":
      return z.power(1 / 3);
    case "expm1":
      return ComplexNumber.E.power(z).subtract(1);
    case "log1p":
      return z.add(1).logarithm();
    default:
      throw new Error(`"${name}" isn't supported for a complex-valued expression (it's a real-only function).`);
  }
}
