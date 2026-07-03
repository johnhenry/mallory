/**
 * Symbolic — a small computer-algebra engine: an expression AST with parsing,
 * symbolic differentiation, algebraic simplification, basic symbolic
 * integration, Taylor expansion, polynomial equation solving/factoring,
 * limits, LaTeX rendering, and numeric evaluation.
 */
import { Rational } from "./Rational.ts";
import { SpecialFunctions } from "./SpecialFunctions.ts";

export type FuncName =
  | "sin"
  | "cos"
  | "tan"
  | "exp"
  | "ln"
  | "sqrt"
  | "asin"
  | "acos"
  | "atan"
  | "sinh"
  | "cosh"
  | "tanh"
  | "cot"
  | "sec"
  | "csc"
  | "asinh"
  | "acosh"
  | "atanh"
  | "coth"
  | "sech"
  | "csch"
  | "acot"
  | "asec"
  | "acsc"
  | "acoth"
  | "asech"
  | "acsch"
  | "abs"
  | "log10"
  | "log2"
  | "cbrt"
  | "floor"
  | "ceil"
  | "round"
  | "sign"
  | "trunc"
  | "expm1"
  | "log1p"
  | "sigmoid"
  | "erf"
  | "relu";

/** Elementary functions that take exactly two `Expr` operands (see the `call2` `Expr` variant). */
export type BinaryFuncName = "atan2" | "hypot" | "min" | "max" | "gcd" | "lcm";

export type Expr =
  | { type: "const"; value: number }
  | { type: "var"; name: string }
  | { type: "add"; left: Expr; right: Expr }
  | { type: "sub"; left: Expr; right: Expr }
  | { type: "mul"; left: Expr; right: Expr }
  | { type: "div"; left: Expr; right: Expr }
  | { type: "pow"; base: Expr; exp: Expr }
  | { type: "neg"; arg: Expr }
  | { type: "func"; name: FuncName; arg: Expr }
  | { type: "call2"; name: BinaryFuncName; left: Expr; right: Expr };

const FUNCS: FuncName[] = [
  "sin",
  "cos",
  "tan",
  "exp",
  "ln",
  "sqrt",
  "asin",
  "acos",
  "atan",
  "sinh",
  "cosh",
  "tanh",
  "cot",
  "sec",
  "csc",
  "asinh",
  "acosh",
  "atanh",
  "coth",
  "sech",
  "csch",
  "acot",
  "asec",
  "acsc",
  "acoth",
  "asech",
  "acsch",
  "abs",
  "log10",
  "log2",
  "cbrt",
  "floor",
  "ceil",
  "round",
  "sign",
  "trunc",
  "expm1",
  "log1p",
  "sigmoid",
  "erf",
  "relu",
];

/**
 * `BinaryFuncName`s recognized by {@link Symbolic.parse}. `hypot`/`min`/`max`/
 * `gcd`/`lcm` accept N ≥ 2 user-facing arguments, pairwise-folded into nested
 * `call2` nodes at parse time; `atan2` takes exactly 2. `log(base, x)` and
 * `clamp(x, lo, hi)` are also multi-arg but desugar entirely into existing
 * constructs at parse time rather than becoming `call2` nodes.
 */
const BINARY_FUNCS: BinaryFuncName[] = ["atan2", "hypot", "min", "max", "gcd", "lcm"];

/**
 * Alternate plain-text spellings accepted by {@link Symbolic.parse}, mapped to
 * their canonical `FuncName` — e.g. `arcsin(x)` parses identically to
 * `asin(x)`.
 */
const FUNC_ALIASES: Record<string, FuncName> = {
  arcsin: "asin",
  arccos: "acos",
  arctan: "atan",
  arcsinh: "asinh",
  arccosh: "acosh",
  arctanh: "atanh",
  arccot: "acot",
  arcsec: "asec",
  arccsc: "acsc",
  arccoth: "acoth",
  arcsech: "asech",
  arccsch: "acsch",
  sgn: "sign",
  logistic: "sigmoid",
};

/**
 * Every function name {@link Symbolic.parse} recognizes — canonical spellings
 * plus alternate ones like `arcsin` — for consumers (e.g. a UI's implicit-
 * multiplication preprocessor) that need to know what counts as a known
 * identifier without hand-duplicating this list.
 */
export const FUNCTION_NAMES: readonly string[] = [
  ...FUNCS,
  ...Object.keys(FUNC_ALIASES),
  ...BINARY_FUNCS,
  "log",
  "clamp",
];

// -- constructors -----------------------------------------------------------
const num = (value: number): Expr => ({ type: "const", value });
const v = (name: string): Expr => ({ type: "var", name });
const add = (left: Expr, right: Expr): Expr => ({ type: "add", left, right });
const sub = (left: Expr, right: Expr): Expr => ({ type: "sub", left, right });
const mul = (left: Expr, right: Expr): Expr => ({ type: "mul", left, right });
const div = (left: Expr, right: Expr): Expr => ({ type: "div", left, right });
const pow = (base: Expr, exp: Expr): Expr => ({ type: "pow", base, exp });
const neg = (arg: Expr): Expr => ({ type: "neg", arg });
const fn = (name: FuncName, arg: Expr): Expr => ({ type: "func", name, arg });
const call2 = (name: BinaryFuncName, left: Expr, right: Expr): Expr => ({ type: "call2", name, left, right });

const isConst = (e: Expr, value?: number): boolean => e.type === "const" && (value === undefined || e.value === value);
const containsVar = (e: Expr, name: string): boolean => {
  switch (e.type) {
    case "const":
      return false;
    case "var":
      return e.name === name;
    case "neg":
      return containsVar(e.arg, name);
    case "func":
      return containsVar(e.arg, name);
    case "pow":
      return containsVar(e.base, name) || containsVar(e.exp, name);
    default:
      return containsVar(e.left, name) || containsVar(e.right, name);
  }
};

export class NotIntegrableError extends Error {
  constructor(message = "This expression cannot be integrated by the elementary rules implemented.") {
    super(message);
    this.name = "NotIntegrableError";
  }
}

export class Symbolic {
  /** Parse an expression string such as `"sin(x^2) + 3*x"` into an AST. */
  static parse(input: string): Expr {
    return new Parser(input).parse();
  }

  static differentiate(expr: Expr | string, variable = "x"): Expr {
    const e = typeof expr === "string" ? Symbolic.parse(expr) : expr;
    return Symbolic.simplify(diff(e, variable));
  }

  /**
   * Like {@link differentiate}, but also returns a bottom-up trace of every
   * differentiation rule applied — one step per subexpression, innermost
   * first — for a "show your work" UI. Each step's `input`/`output` are
   * unsimplified, matching the mechanical rule application; `result` is the
   * final simplified derivative (same as `differentiate` would return).
   */
  static differentiateSteps(expr: Expr | string, variable = "x"): { steps: DifferentiationStep[]; result: Expr } {
    const e = typeof expr === "string" ? Symbolic.parse(expr) : expr;
    const steps: DifferentiationStep[] = [];
    const raw = diffTraced(e, variable, steps);
    return { steps, result: Symbolic.simplify(raw) };
  }

  static simplify(expr: Expr | string): Expr {
    let e = typeof expr === "string" ? Symbolic.parse(expr) : expr;
    for (let i = 0; i < 30; i++) {
      const next = collectLikeTerms(simplifyOnce(e));
      if (equal(next, e)) return next;
      e = next;
    }
    return e;
  }

  /** Symbolic anti-derivative (elementary rules; throws {@link NotIntegrableError} otherwise). */
  static integrate(expr: Expr | string, variable = "x"): Expr {
    const e = typeof expr === "string" ? Symbolic.parse(expr) : expr;
    return Symbolic.simplify(integ(e, variable));
  }

  /** Taylor expansion of `expr` about `center` up to `order`, as an expression. */
  static taylor(expr: Expr | string, variable = "x", center = 0, order = 4): Expr {
    let term: Expr = typeof expr === "string" ? Symbolic.parse(expr) : expr;
    let result: Expr = num(0);
    let factorial = 1;
    for (let n = 0; n <= order; n++) {
      if (n > 0) factorial *= n;
      const coeff = Symbolic.evaluate(term, { [variable]: center });
      if (coeff !== 0) {
        const power = pow(sub(v(variable), num(center)), num(n));
        result = add(result, mul(num(coeff / factorial), power));
      }
      term = diff(term, variable);
    }
    return Symbolic.simplify(result);
  }

  /** Replace every occurrence of a variable with a sub-expression (e.g. for changing variables or plugging in a solved value). */
  static substitute(expr: Expr | string, variable: string, replacement: Expr | string): Expr {
    const e = typeof expr === "string" ? Symbolic.parse(expr) : expr;
    const r = typeof replacement === "string" ? Symbolic.parse(replacement) : replacement;
    return Symbolic.simplify(subst(e, variable, r));
  }

  /** Distribute multiplication over addition/subtraction and expand small integer powers of sums, e.g. `(x+1)^2 -> x^2+2*x+1`. */
  static expand(expr: Expr | string): Expr {
    const e = typeof expr === "string" ? Symbolic.parse(expr) : expr;
    let cur = e;
    for (let i = 0; i < 30; i++) {
      const next = Symbolic.simplify(expandOnce(cur));
      if (equal(next, cur)) return next;
      cur = next;
    }
    return cur;
  }

  static evaluate(expr: Expr | string, env: Record<string, number> = {}): number {
    const e = typeof expr === "string" ? Symbolic.parse(expr) : expr;
    return evalExpr(e, env);
  }

  /**
   * Compile `expr` into a closure tree, walking the AST once instead of on
   * every call. Prefer this over {@link evaluate} when the same expression is
   * evaluated many times (e.g. sampling a curve across hundreds of x values).
   */
  static compile(expr: Expr | string): (env: Record<string, number>) => number {
    const e = typeof expr === "string" ? Symbolic.parse(expr) : expr;
    return compileExpr(e);
  }

  static toString(expr: Expr | string): string {
    return render(typeof expr === "string" ? Symbolic.parse(expr) : expr, 0);
  }

  /** Render `expr` as a LaTeX string, e.g. `"x/2"` -> `"\\frac{x}{2}"`. */
  static toLatex(expr: Expr | string): string {
    return toLatexRec(typeof expr === "string" ? Symbolic.parse(expr) : expr, 0);
  }

  /**
   * Parse a LaTeX math string into an `Expr` — the reverse of {@link toLatex}.
   * Round-trips everything `toLatex` produces: `\frac{a}{b}`, `\sqrt{a}` /
   * `\sqrt[3]{a}` (as `cbrt`) / `\sqrt[n]{a}`, `\left(...\right)`,
   * `\left|...\right|` (absolute value), `\left\lfloor...\right\rfloor` /
   * `\left\lceil...\right\rceil`, `\log_{10}`/`\log_{2}`, `\cdot`/`\times`,
   * `\pi`, `^{...}` exponents, `_{...}` subscripts, the named unary function
   * commands (`\sin`, `\arcsin`, `\sinh`, `\operatorname{sech}`, ...), and the
   * two-argument `BinaryFuncName` commands (`\min`, `\max`, `\gcd`,
   * `\operatorname{atan2}`, `\operatorname{hypot}`, `\operatorname{lcm}`).
   * Spacing commands (`\,`, `\;`, `\!`, `\quad`) are ignored.
   *
   * @throws on LaTeX constructs with no `Expr` equivalent, e.g. `\int` or `\sum`.
   */
  static fromLatex(latex: string): Expr {
    return Symbolic.parse(latexToInfix(latex));
  }

  /**
   * Solve `expr = 0` for `variable`, returning every *real* root mallory-math
   * can find as an exact `Expr` (rationals and `sqrt`-radicals where
   * possible) — complex roots are not returned (e.g. `x^2 + 1` yields `[]`).
   * Supports polynomials up to degree 6: linear and quadratic are solved in
   * closed form; degree ≥ 3 is solved by repeatedly finding a rational root
   * (rational root theorem) and deflating via synthetic division, so a cubic
   * or quartic with only irrational/complex roots left over after rational
   * deflation cannot be fully solved this way.
   *
   * @throws if `expr` isn't a polynomial in `variable` of degree ≤ 6, or if a
   *   degree ≥ 3 factor has no rational root to deflate on.
   */
  static solve(expr: Expr | string, variable = "x"): Expr[] {
    const e = typeof expr === "string" ? Symbolic.parse(expr) : expr;
    const coeffs = polynomialCoeffs(Symbolic.simplify(e), variable, 6);
    if (!coeffs) {
      throw new Error(`solve: expression is not a polynomial in "${variable}" of degree ≤ 6.`);
    }
    return solvePolynomial(coeffs).map((r) => Symbolic.simplify(r));
  }

  /**
   * Factor a polynomial in `variable`: extracts a common numeric GCD and
   * common power of `variable`, then repeatedly pulls out rational linear
   * factors `(variable - r)` via the rational root theorem, falling back to
   * the quadratic formula for a final degree-2 remainder. Any remaining
   * factor mallory-math can't reduce further (e.g. an irreducible cubic) is
   * left as-is. Returns `expr` unchanged (simplified) if it isn't a
   * polynomial in `variable`.
   */
  static factor(expr: Expr | string, variable = "x"): Expr {
    const e = typeof expr === "string" ? Symbolic.parse(expr) : expr;
    const simplified = Symbolic.simplify(e);
    const coeffs = polynomialCoeffs(simplified, variable, 6);
    if (!coeffs) return simplified;
    return factorPolynomial(coeffs, variable);
  }

  /**
   * Numeric limit of `expr` as `variable` approaches `point`. Falls back to
   * L'Hopital's rule (repeated symbolic differentiation of numerator and
   * denominator) whenever direct evaluation of a `div` node hits a `0/0` or
   * `∞/∞` indeterminate form.
   */
  static limit(expr: Expr | string, variable = "x", point = 0, direction: "left" | "right" | "both" = "both"): number {
    const e = typeof expr === "string" ? Symbolic.parse(expr) : expr;
    return limitAt(e, variable, point, direction, 0);
  }
}

// -- differentiation --------------------------------------------------------

/** One rule application recorded by {@link Symbolic.differentiateSteps}. */
export interface DifferentiationStep {
  /** Human-readable name of the differentiation rule applied, e.g. "Product Rule". */
  rule: string;
  /** The subexpression this rule was applied to. */
  input: Expr;
  /** The (unsimplified) derivative of `input` produced by this rule. */
  output: Expr;
}

function diffTraced(e: Expr, x: string, steps: DifferentiationStep[]): Expr {
  let rule: string;
  let result: Expr;
  switch (e.type) {
    case "const":
      rule = "Constant Rule";
      result = num(0);
      break;
    case "var":
      rule = e.name === x ? "Variable Rule" : "Constant Rule";
      result = num(e.name === x ? 1 : 0);
      break;
    case "add":
      rule = "Sum Rule";
      result = add(diffTraced(e.left, x, steps), diffTraced(e.right, x, steps));
      break;
    case "sub":
      rule = "Difference Rule";
      result = sub(diffTraced(e.left, x, steps), diffTraced(e.right, x, steps));
      break;
    case "mul":
      rule = "Product Rule";
      result = add(mul(diffTraced(e.left, x, steps), e.right), mul(e.left, diffTraced(e.right, x, steps)));
      break;
    case "div":
      rule = "Quotient Rule";
      result = div(
        sub(mul(diffTraced(e.left, x, steps), e.right), mul(e.left, diffTraced(e.right, x, steps))),
        pow(e.right, num(2)),
      );
      break;
    case "neg":
      rule = "Negation Rule";
      result = neg(diffTraced(e.arg, x, steps));
      break;
    case "pow":
      if (e.exp.type === "const") {
        rule = "Power Rule";
        result = mul(mul(e.exp, pow(e.base, num(e.exp.value - 1))), diffTraced(e.base, x, steps));
      } else {
        rule = "Generalized Power Rule";
        result = mul(
          e,
          add(
            mul(diffTraced(e.exp, x, steps), fn("ln", e.base)),
            mul(e.exp, div(diffTraced(e.base, x, steps), e.base)),
          ),
        );
      }
      break;
    case "func": {
      rule = `Chain Rule (${e.name})`;
      const u = e.arg;
      const du = diffTraced(u, x, steps);
      switch (e.name) {
        case "sin":
          result = mul(fn("cos", u), du);
          break;
        case "cos":
          result = neg(mul(fn("sin", u), du));
          break;
        case "tan":
          result = div(du, pow(fn("cos", u), num(2)));
          break;
        case "exp":
          result = mul(fn("exp", u), du);
          break;
        case "ln":
          result = div(du, u);
          break;
        case "sqrt":
          result = div(du, mul(num(2), fn("sqrt", u)));
          break;
        case "asin":
          result = div(du, fn("sqrt", sub(num(1), pow(u, num(2)))));
          break;
        case "acos":
          result = neg(div(du, fn("sqrt", sub(num(1), pow(u, num(2))))));
          break;
        case "atan":
          result = div(du, add(num(1), pow(u, num(2))));
          break;
        case "sinh":
          result = mul(fn("cosh", u), du);
          break;
        case "cosh":
          result = mul(fn("sinh", u), du);
          break;
        case "tanh":
          result = div(du, pow(fn("cosh", u), num(2)));
          break;
        case "cot":
          result = neg(mul(pow(fn("csc", u), num(2)), du));
          break;
        case "sec":
          result = mul(mul(fn("sec", u), fn("tan", u)), du);
          break;
        case "csc":
          result = neg(mul(mul(fn("csc", u), fn("cot", u)), du));
          break;
        case "asinh":
          result = div(du, fn("sqrt", add(pow(u, num(2)), num(1))));
          break;
        case "acosh":
          result = div(du, fn("sqrt", sub(pow(u, num(2)), num(1))));
          break;
        case "atanh":
          result = div(du, sub(num(1), pow(u, num(2))));
          break;
        case "coth":
          result = neg(mul(pow(fn("csch", u), num(2)), du));
          break;
        case "sech":
          result = neg(mul(mul(fn("sech", u), fn("tanh", u)), du));
          break;
        case "csch":
          result = neg(mul(mul(fn("csch", u), fn("coth", u)), du));
          break;
        case "acot":
          result = neg(div(du, add(num(1), pow(u, num(2)))));
          break;
        case "asec":
          result = div(du, mul(fn("abs", u), fn("sqrt", sub(pow(u, num(2)), num(1)))));
          break;
        case "acsc":
          result = neg(div(du, mul(fn("abs", u), fn("sqrt", sub(pow(u, num(2)), num(1))))));
          break;
        case "acoth":
          result = div(du, sub(num(1), pow(u, num(2))));
          break;
        case "asech":
          result = neg(div(du, mul(u, fn("sqrt", sub(num(1), pow(u, num(2)))))));
          break;
        case "acsch":
          result = neg(div(du, mul(fn("abs", u), fn("sqrt", add(num(1), pow(u, num(2)))))));
          break;
        case "abs":
          result = mul(fn("sign", u), du);
          break;
        case "log10":
          result = div(du, mul(u, fn("ln", num(10))));
          break;
        case "log2":
          result = div(du, mul(u, fn("ln", num(2))));
          break;
        case "cbrt":
          result = div(du, mul(num(3), pow(fn("cbrt", u), num(2))));
          break;
        case "floor":
        case "ceil":
        case "round":
        case "sign":
        case "trunc":
          result = num(0);
          break;
        case "expm1":
          result = mul(fn("exp", u), du);
          break;
        case "log1p":
          result = div(du, add(num(1), u));
          break;
        case "sigmoid":
          result = mul(mul(fn("sigmoid", u), sub(num(1), fn("sigmoid", u))), du);
          break;
        case "erf":
          result = mul(mul(div(num(2), fn("sqrt", num(Math.PI))), fn("exp", neg(pow(u, num(2))))), du);
          break;
        case "relu":
          result = mul(div(add(num(1), fn("sign", u)), num(2)), du);
          break;
      }
      break;
    }
    case "call2": {
      rule = `Multivariable Chain Rule (${e.name})`;
      const l = e.left;
      const r = e.right;
      const dl = diffTraced(l, x, steps);
      const dr = diffTraced(r, x, steps);
      switch (e.name) {
        case "atan2":
          result = div(sub(mul(r, dl), mul(l, dr)), add(pow(l, num(2)), pow(r, num(2))));
          break;
        case "hypot":
          result = div(add(mul(l, dl), mul(r, dr)), call2("hypot", l, r));
          break;
        case "min":
          result = sub(div(add(dl, dr), num(2)), mul(fn("sign", sub(l, r)), div(sub(dl, dr), num(2))));
          break;
        case "max":
          result = add(div(add(dl, dr), num(2)), mul(fn("sign", sub(l, r)), div(sub(dl, dr), num(2))));
          break;
        case "gcd":
        case "lcm":
          result = num(0);
          break;
      }
      break;
    }
  }
  steps.push({ rule, input: e, output: result });
  return result;
}

function diff(e: Expr, x: string): Expr {
  switch (e.type) {
    case "const":
      return num(0);
    case "var":
      return num(e.name === x ? 1 : 0);
    case "add":
      return add(diff(e.left, x), diff(e.right, x));
    case "sub":
      return sub(diff(e.left, x), diff(e.right, x));
    case "mul":
      return add(mul(diff(e.left, x), e.right), mul(e.left, diff(e.right, x)));
    case "div":
      return div(sub(mul(diff(e.left, x), e.right), mul(e.left, diff(e.right, x))), pow(e.right, num(2)));
    case "neg":
      return neg(diff(e.arg, x));
    case "pow": {
      // constant exponent: c·u^(c-1)·u'
      if (e.exp.type === "const") {
        return mul(mul(e.exp, pow(e.base, num(e.exp.value - 1))), diff(e.base, x));
      }
      // general: u^v·(v'·ln u + v·u'/u)
      return mul(e, add(mul(diff(e.exp, x), fn("ln", e.base)), mul(e.exp, div(diff(e.base, x), e.base))));
    }
    case "func": {
      const u = e.arg;
      const du = diff(u, x);
      const name = e.name;
      switch (name) {
        case "sin":
          return mul(fn("cos", u), du);
        case "cos":
          return neg(mul(fn("sin", u), du));
        case "tan":
          return div(du, pow(fn("cos", u), num(2)));
        case "exp":
          return mul(fn("exp", u), du);
        case "ln":
          return div(du, u);
        case "sqrt":
          return div(du, mul(num(2), fn("sqrt", u)));
        case "asin":
          return div(du, fn("sqrt", sub(num(1), pow(u, num(2)))));
        case "acos":
          return neg(div(du, fn("sqrt", sub(num(1), pow(u, num(2))))));
        case "atan":
          return div(du, add(num(1), pow(u, num(2))));
        case "sinh":
          return mul(fn("cosh", u), du);
        case "cosh":
          return mul(fn("sinh", u), du);
        case "tanh":
          return div(du, pow(fn("cosh", u), num(2)));
        case "cot":
          return neg(mul(pow(fn("csc", u), num(2)), du));
        case "sec":
          return mul(mul(fn("sec", u), fn("tan", u)), du);
        case "csc":
          return neg(mul(mul(fn("csc", u), fn("cot", u)), du));
        case "asinh":
          return div(du, fn("sqrt", add(pow(u, num(2)), num(1))));
        case "acosh":
          return div(du, fn("sqrt", sub(pow(u, num(2)), num(1))));
        case "atanh":
          return div(du, sub(num(1), pow(u, num(2))));
        case "coth":
          return neg(mul(pow(fn("csch", u), num(2)), du));
        case "sech":
          return neg(mul(mul(fn("sech", u), fn("tanh", u)), du));
        case "csch":
          return neg(mul(mul(fn("csch", u), fn("coth", u)), du));
        case "acot":
          return neg(div(du, add(num(1), pow(u, num(2)))));
        case "asec":
          return div(du, mul(fn("abs", u), fn("sqrt", sub(pow(u, num(2)), num(1)))));
        case "acsc":
          return neg(div(du, mul(fn("abs", u), fn("sqrt", sub(pow(u, num(2)), num(1))))));
        case "acoth":
          return div(du, sub(num(1), pow(u, num(2))));
        case "asech":
          return neg(div(du, mul(u, fn("sqrt", sub(num(1), pow(u, num(2)))))));
        case "acsch":
          return neg(div(du, mul(fn("abs", u), fn("sqrt", add(num(1), pow(u, num(2)))))));
        case "abs":
          return mul(fn("sign", u), du);
        case "log10":
          return div(du, mul(u, fn("ln", num(10))));
        case "log2":
          return div(du, mul(u, fn("ln", num(2))));
        case "cbrt":
          return div(du, mul(num(3), pow(fn("cbrt", u), num(2))));
        case "floor":
        case "ceil":
        case "round":
        case "sign":
        case "trunc":
          return num(0);
        case "expm1":
          return mul(fn("exp", u), du);
        case "log1p":
          return div(du, add(num(1), u));
        case "sigmoid":
          return mul(mul(fn("sigmoid", u), sub(num(1), fn("sigmoid", u))), du);
        case "erf":
          return mul(mul(div(num(2), fn("sqrt", num(Math.PI))), fn("exp", neg(pow(u, num(2))))), du);
        case "relu":
          return mul(div(add(num(1), fn("sign", u)), num(2)), du);
      }
      throw new Error(`Unhandled function: ${name}`);
    }
    case "call2": {
      const l = e.left;
      const r = e.right;
      const dl = diff(l, x);
      const dr = diff(r, x);
      switch (e.name) {
        case "atan2":
          return div(sub(mul(r, dl), mul(l, dr)), add(pow(l, num(2)), pow(r, num(2))));
        case "hypot":
          return div(add(mul(l, dl), mul(r, dr)), call2("hypot", l, r));
        case "min":
          return sub(div(add(dl, dr), num(2)), mul(fn("sign", sub(l, r)), div(sub(dl, dr), num(2))));
        case "max":
          return add(div(add(dl, dr), num(2)), mul(fn("sign", sub(l, r)), div(sub(dl, dr), num(2))));
        case "gcd":
        case "lcm":
          return num(0);
      }
    }
  }
}

// -- simplification ---------------------------------------------------------
function simplifyOnce(e: Expr): Expr {
  if (e.type === "const" || e.type === "var") return e;
  if (e.type === "neg") {
    const a = simplifyOnce(e.arg);
    if (a.type === "const") return num(-a.value);
    if (a.type === "neg") return a.arg;
    return neg(a);
  }
  if (e.type === "func") return fn(e.name, simplifyOnce(e.arg));
  if (e.type === "call2") {
    const l = simplifyOnce(e.left);
    const r = simplifyOnce(e.right);
    if (l.type === "const" && r.type === "const") return num(BINARY_FUNC_IMPLS[e.name](l.value, r.value));
    return call2(e.name, l, r);
  }
  if (e.type === "pow") {
    const b = simplifyOnce(e.base);
    const p = simplifyOnce(e.exp);
    if (isConst(p, 0)) return num(1);
    if (isConst(p, 1)) return b;
    if (isConst(b, 0)) return num(0);
    if (isConst(b, 1)) return num(1);
    if (b.type === "const" && p.type === "const") return num(b.value ** p.value);
    return pow(b, p);
  }
  const l = simplifyOnce((e as { left: Expr }).left);
  const r = simplifyOnce((e as { right: Expr }).right);
  if (l.type === "const" && r.type === "const") {
    if (e.type === "add") return num(l.value + r.value);
    if (e.type === "sub") return num(l.value - r.value);
    if (e.type === "mul") return num(l.value * r.value);
    if (e.type === "div" && r.value !== 0) return num(l.value / r.value);
  }
  switch (e.type) {
    case "add":
      if (isConst(l, 0)) return r;
      if (isConst(r, 0)) return l;
      return add(l, r);
    case "sub":
      if (isConst(r, 0)) return l;
      if (isConst(l, 0)) return neg(r);
      if (equal(l, r)) return num(0);
      return sub(l, r);
    case "mul":
      if (isConst(l, 0) || isConst(r, 0)) return num(0);
      if (isConst(l, 1)) return r;
      if (isConst(r, 1)) return l;
      return mul(l, r);
    case "div":
      if (isConst(l, 0)) return num(0);
      if (isConst(r, 1)) return l;
      return div(l, r);
  }
  return e;
}

function equal(a: Expr, b: Expr): boolean {
  if (a.type !== b.type) return false;
  switch (a.type) {
    case "const":
      return a.value === (b as typeof a).value;
    case "var":
      return a.name === (b as typeof a).name;
    case "neg":
      return equal(a.arg, (b as typeof a).arg);
    case "func":
      return a.name === (b as typeof a).name && equal(a.arg, (b as typeof a).arg);
    case "call2":
      return (
        a.name === (b as typeof a).name && equal(a.left, (b as typeof a).left) && equal(a.right, (b as typeof a).right)
      );
    case "pow":
      return equal(a.base, (b as typeof a).base) && equal(a.exp, (b as typeof a).exp);
    default:
      return equal(a.left, (b as typeof a).left) && equal(a.right, (b as typeof a).right);
  }
}

// -- substitution -------------------------------------------------------------
function subst(e: Expr, name: string, r: Expr): Expr {
  switch (e.type) {
    case "const":
      return e;
    case "var":
      return e.name === name ? r : e;
    case "neg":
      return neg(subst(e.arg, name, r));
    case "func":
      return fn(e.name, subst(e.arg, name, r));
    case "call2":
      return call2(e.name, subst(e.left, name, r), subst(e.right, name, r));
    case "pow":
      return pow(subst(e.base, name, r), subst(e.exp, name, r));
    case "add":
      return add(subst(e.left, name, r), subst(e.right, name, r));
    case "sub":
      return sub(subst(e.left, name, r), subst(e.right, name, r));
    case "mul":
      return mul(subst(e.left, name, r), subst(e.right, name, r));
    case "div":
      return div(subst(e.left, name, r), subst(e.right, name, r));
  }
}

// -- expansion ----------------------------------------------------------------
const MAX_EXPAND_POWER = 8;

function expandOnce(e: Expr): Expr {
  switch (e.type) {
    case "const":
    case "var":
      return e;
    case "neg":
      return neg(expandOnce(e.arg));
    case "func":
      return fn(e.name, expandOnce(e.arg));
    case "call2":
      return call2(e.name, expandOnce(e.left), expandOnce(e.right));
    case "add":
      return add(expandOnce(e.left), expandOnce(e.right));
    case "sub":
      return sub(expandOnce(e.left), expandOnce(e.right));
    case "div":
      return div(expandOnce(e.left), expandOnce(e.right));
    case "pow": {
      const base = expandOnce(e.base);
      if (
        e.exp.type === "const" &&
        Number.isInteger(e.exp.value) &&
        e.exp.value >= 2 &&
        e.exp.value <= MAX_EXPAND_POWER &&
        (base.type === "add" || base.type === "sub")
      ) {
        let result: Expr = base;
        for (let i = 1; i < e.exp.value; i++) result = distribute(result, base);
        return result;
      }
      return pow(base, expandOnce(e.exp));
    }
    case "mul":
      return distribute(expandOnce(e.left), expandOnce(e.right));
  }
}

/** Distribute a product over any top-level +/- structure on either side. */
function distribute(l: Expr, r: Expr): Expr {
  if (l.type === "add") return add(distribute(l.left, r), distribute(l.right, r));
  if (l.type === "sub") return sub(distribute(l.left, r), distribute(l.right, r));
  if (r.type === "add") return add(distribute(l, r.left), distribute(l, r.right));
  if (r.type === "sub") return sub(distribute(l, r.left), distribute(l, r.right));
  return mul(l, r);
}

// -- like-term collection -----------------------------------------------------
// Recognizes commutative/associative equivalence that raw tree-structural
// `equal()` misses — e.g. `x + x` -> `2*x`, `a*b + b*a` -> `2*a*b`,
// `x*x*x` -> `x^3` — by flattening a subtree into a canonical sum-of-monomials
// form, grouping monomials with matching (sorted) factor signatures, and
// rebuilding. Recurses into every sub-position, so nested sums (inside a
// `func` arg, a `mul` factor, etc.) get collected too.

interface Factor {
  base: Expr;
  exp: number;
}
interface Term {
  coeff: number;
  factors: Factor[];
}

function collectLikeTerms(e: Expr): Expr {
  switch (e.type) {
    case "const":
    case "var":
      return e;
    case "func":
      return fn(e.name, collectLikeTerms(e.arg));
    case "call2":
      return call2(e.name, collectLikeTerms(e.left), collectLikeTerms(e.right));
    case "div":
      return div(collectLikeTerms(e.left), collectLikeTerms(e.right));
    case "pow":
      return pow(collectLikeTerms(e.base), collectLikeTerms(e.exp));
    case "neg":
    case "add":
    case "sub":
    case "mul": {
      const terms: Term[] = [];
      flattenAdditive(e, 1, terms);
      return rebuildAdditive(groupTerms(terms));
    }
  }
}

function flattenAdditive(e: Expr, sign: number, out: Term[]): void {
  if (e.type === "add") {
    flattenAdditive(e.left, sign, out);
    flattenAdditive(e.right, sign, out);
    return;
  }
  if (e.type === "sub") {
    flattenAdditive(e.left, sign, out);
    flattenAdditive(e.right, -sign, out);
    return;
  }
  if (e.type === "neg") {
    flattenAdditive(e.arg, -sign, out);
    return;
  }
  const term = flattenMonomial(e);
  out.push({ coeff: term.coeff * sign, factors: term.factors });
}

function flattenMonomial(e: Expr): Term {
  if (e.type === "const") return { coeff: e.value, factors: [] };
  if (e.type === "neg") {
    const inner = flattenMonomial(e.arg);
    return { coeff: -inner.coeff, factors: inner.factors };
  }
  if (e.type === "mul") {
    const l = flattenMonomial(e.left);
    const r = flattenMonomial(e.right);
    return mergeFactors(l.coeff * r.coeff, [...l.factors, ...r.factors]);
  }
  // a power with a constant exponent contributes a single (base, exp) factor;
  // the base itself is collected so nested sums inside it are also handled.
  if (e.type === "pow" && e.exp.type === "const") {
    return mergeFactors(1, [{ base: collectLikeTerms(e.base), exp: e.exp.value }]);
  }
  // opaque atom (var, func, div, or pow with a non-constant exponent)
  return mergeFactors(1, [{ base: collectLikeTerms(e), exp: 1 }]);
}

function mergeFactors(coeff: number, factors: Factor[]): Term {
  const merged: Factor[] = [];
  for (const f of factors) {
    const existing = merged.find((m) => equal(m.base, f.base));
    if (existing) existing.exp += f.exp;
    else merged.push({ ...f });
  }
  return { coeff, factors: merged.filter((f) => f.exp !== 0) };
}

function groupTerms(terms: Term[]): Term[] {
  const groups = new Map<string, Term>();
  const order: string[] = [];
  for (const t of terms) {
    const sorted = [...t.factors].sort((a, b) => render(a.base, 0).localeCompare(render(b.base, 0)));
    const key = sorted.map((f) => `${render(f.base, 0)}^${f.exp}`).join("*");
    const existing = groups.get(key);
    if (existing) existing.coeff += t.coeff;
    else {
      groups.set(key, { coeff: t.coeff, factors: sorted });
      order.push(key);
    }
  }
  return order.map((k) => groups.get(k) as Term).filter((t) => t.coeff !== 0);
}

function buildMonomial(factors: Factor[]): Expr | null {
  let result: Expr | null = null;
  for (const f of factors) {
    const factorExpr = f.exp === 1 ? f.base : pow(f.base, num(f.exp));
    result = result === null ? factorExpr : mul(result, factorExpr);
  }
  return result;
}

function rebuildAdditive(terms: Term[]): Expr {
  let result: Expr | null = null;
  for (const t of terms) {
    const monomial = buildMonomial(t.factors);
    const magnitude = Math.abs(t.coeff);
    const positivePart: Expr =
      monomial === null ? num(magnitude) : magnitude === 1 ? monomial : mul(num(magnitude), monomial);
    if (result === null) {
      result = t.coeff < 0 ? neg(positivePart) : positivePart;
    } else {
      result = t.coeff < 0 ? sub(result, positivePart) : add(result, positivePart);
    }
  }
  return result ?? num(0);
}

// -- integration (elementary) ----------------------------------------------
function integ(e: Expr, x: string): Expr {
  if (!containsVar(e, x)) return mul(e, v(x)); // ∫c dx = c·x
  switch (e.type) {
    case "var":
      return div(pow(v(x), num(2)), num(2));
    case "add":
      return add(integ(e.left, x), integ(e.right, x));
    case "sub":
      return sub(integ(e.left, x), integ(e.right, x));
    case "neg":
      return neg(integ(e.arg, x));
    case "mul": {
      // pull out a constant factor
      if (!containsVar(e.left, x)) return mul(e.left, integ(e.right, x));
      if (!containsVar(e.right, x)) return mul(e.right, integ(e.left, x));
      // integration by parts: ∫ x^n · f(a·x + b) dx, f ∈ {sin, cos, exp}
      for (const [poly, other] of [
        [e.left, e.right],
        [e.right, e.left],
      ] as const) {
        const n = xPowerDegree(poly, x);
        if (n !== null && other.type === "func" && isByPartsFunc(other.name) && linearCoeffs(other.arg, x)) {
          return ibpPolyTimesFunc(n, other, x);
        }
      }
      throw new NotIntegrableError();
    }
    case "div": {
      if (!containsVar(e.right, x)) return div(integ(e.left, x), e.right); // ∫ u/c
      // 1/x -> ln x
      if (isConst(e.left, 1) && e.right.type === "var" && e.right.name === x) return fn("ln", v(x));
      // numerator constant wrt x — check rational/radical forms with an x^2 denominator
      if (!containsVar(e.left, x)) {
        const c = evalExpr(e.left, {});
        // ∫ c / (x^2 + k) dx = (c/√k)·atan(x/√k)   (k > 0, no linear term)
        const quad = quadraticCoeffs(e.right, x);
        if (quad && Math.abs(quad.a - 1) < 1e-9 && Math.abs(quad.b) < 1e-9 && quad.c > 0) {
          const s = Math.sqrt(quad.c);
          return mul(num(c / s), fn("atan", div(v(x), num(s))));
        }
        // ∫ c / √(k - x^2) dx = c·asin(x/√k)   (k > 0)
        if (e.right.type === "func" && e.right.name === "sqrt") {
          const under = quadraticCoeffs(e.right.arg, x);
          if (under && Math.abs(under.a + 1) < 1e-9 && Math.abs(under.b) < 1e-9 && under.c > 0) {
            const s = Math.sqrt(under.c);
            return mul(num(c), fn("asin", div(v(x), num(s))));
          }
        }
      }
      throw new NotIntegrableError();
    }
    case "pow": {
      // x^n (constant n)
      if (e.base.type === "var" && e.base.name === x && e.exp.type === "const") {
        if (e.exp.value === -1) return fn("ln", v(x));
        return div(pow(v(x), num(e.exp.value + 1)), num(e.exp.value + 1));
      }
      throw new NotIntegrableError();
    }
    case "func": {
      // only elementary functions of a linear argument a·x + b
      const lin = linearCoeffs(e.arg, x);
      if (!lin) throw new NotIntegrableError();
      const inner = e.arg;
      const scale = (F: Expr) => div(F, num(lin.a));
      switch (e.name) {
        case "sin":
          return scale(neg(fn("cos", inner)));
        case "cos":
          return scale(fn("sin", inner));
        case "exp":
          return scale(fn("exp", inner));
        default:
          throw new NotIntegrableError();
      }
    }
    default:
      throw new NotIntegrableError();
  }
}

/** If `e` is `a·x + b` (a, b constant), return `{ a, b }`, else `null`. */
function linearCoeffs(e: Expr, x: string): { a: number; b: number } | null {
  try {
    const at0 = evalExpr(e, { [x]: 0 });
    const at1 = evalExpr(e, { [x]: 1 });
    const a = at1 - at0;
    const b = at0;
    // verify linearity at a third point
    const at2 = evalExpr(e, { [x]: 2 });
    if (Math.abs(at2 - (2 * a + b)) > 1e-9) return null;
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return { a, b };
  } catch {
    return null;
  }
}

/** If `e` is `a·x^2 + b·x + c` (a, b, c constant), return `{ a, b, c }`, else `null`. */
function quadraticCoeffs(e: Expr, x: string): { a: number; b: number; c: number } | null {
  try {
    const at0 = evalExpr(e, { [x]: 0 });
    const at1 = evalExpr(e, { [x]: 1 });
    const atm1 = evalExpr(e, { [x]: -1 });
    const c = at0;
    const a = (at1 + atm1) / 2 - c;
    const b = (at1 - atm1) / 2;
    // verify quadratic-ness at a fourth point
    const at2 = evalExpr(e, { [x]: 2 });
    if (Math.abs(at2 - (4 * a + 2 * b + c)) > 1e-9) return null;
    if (![a, b, c].every(Number.isFinite)) return null;
    return { a, b, c };
  } catch {
    return null;
  }
}

/** If `e` is `x` or `x^n` (positive integer n), return `n`, else `null`. */
function xPowerDegree(e: Expr, x: string): number | null {
  if (e.type === "var" && e.name === x) return 1;
  if (
    e.type === "pow" &&
    e.base.type === "var" &&
    e.base.name === x &&
    e.exp.type === "const" &&
    Number.isInteger(e.exp.value) &&
    e.exp.value >= 1
  ) {
    return e.exp.value;
  }
  return null;
}

const BY_PARTS_FUNCS = new Set<FuncName>(["sin", "cos", "exp"]);
function isByPartsFunc(name: FuncName): boolean {
  return BY_PARTS_FUNCS.has(name);
}

/** ∫ x^n · f dx via repeated integration by parts, reducing the polynomial degree by 1 each step. */
function ibpPolyTimesFunc(n: number, f: Expr, x: string): Expr {
  if (n === 0) return integ(f, x);
  const antideriv = integ(f, x);
  const xn = n === 1 ? v(x) : pow(v(x), num(n));
  const term = mul(xn, antideriv);
  const rest = ibpPolyTimesFunc(n - 1, antideriv, x);
  return sub(term, mul(num(n), rest));
}

// -- evaluation -------------------------------------------------------------
function evalExpr(e: Expr, env: Record<string, number>): number {
  switch (e.type) {
    case "const":
      return e.value;
    case "var":
      return env[e.name] ?? Number.NaN;
    case "add":
      return evalExpr(e.left, env) + evalExpr(e.right, env);
    case "sub":
      return evalExpr(e.left, env) - evalExpr(e.right, env);
    case "mul":
      return evalExpr(e.left, env) * evalExpr(e.right, env);
    case "div":
      return evalExpr(e.left, env) / evalExpr(e.right, env);
    case "pow":
      return evalExpr(e.base, env) ** evalExpr(e.exp, env);
    case "neg":
      return -evalExpr(e.arg, env);
    case "func": {
      const a = evalExpr(e.arg, env);
      const name = e.name;
      switch (name) {
        case "sin":
          return Math.sin(a);
        case "cos":
          return Math.cos(a);
        case "tan":
          return Math.tan(a);
        case "exp":
          return Math.exp(a);
        case "ln":
          return Math.log(a);
        case "sqrt":
          return Math.sqrt(a);
        case "asin":
          return Math.asin(a);
        case "acos":
          return Math.acos(a);
        case "atan":
          return Math.atan(a);
        case "sinh":
          return Math.sinh(a);
        case "cosh":
          return Math.cosh(a);
        case "tanh":
          return Math.tanh(a);
        case "cot":
          return cotImpl(a);
        case "sec":
          return secImpl(a);
        case "csc":
          return cscImpl(a);
        case "asinh":
          return Math.asinh(a);
        case "acosh":
          return Math.acosh(a);
        case "atanh":
          return Math.atanh(a);
        case "coth":
          return cothImpl(a);
        case "sech":
          return sechImpl(a);
        case "csch":
          return cschImpl(a);
        case "acot":
          return acotImpl(a);
        case "asec":
          return asecImpl(a);
        case "acsc":
          return acscImpl(a);
        case "acoth":
          return acothImpl(a);
        case "asech":
          return asechImpl(a);
        case "acsch":
          return acschImpl(a);
        case "abs":
          return Math.abs(a);
        case "log10":
          return Math.log10(a);
        case "log2":
          return Math.log2(a);
        case "cbrt":
          return Math.cbrt(a);
        case "floor":
          return Math.floor(a);
        case "ceil":
          return Math.ceil(a);
        case "round":
          return Math.round(a);
        case "sign":
          return Math.sign(a);
        case "trunc":
          return Math.trunc(a);
        case "expm1":
          return Math.expm1(a);
        case "log1p":
          return Math.log1p(a);
        case "sigmoid":
          return sigmoidImpl(a);
        case "erf":
          return SpecialFunctions.erf(a);
        case "relu":
          return Math.max(a, 0);
      }
      throw new Error(`Unhandled function: ${name}`);
    }
    case "call2":
      return BINARY_FUNC_IMPLS[e.name](evalExpr(e.left, env), evalExpr(e.right, env));
  }
}

// -- compilation --------------------------------------------------------------
const cotImpl = (x: number): number => 1 / Math.tan(x);
const secImpl = (x: number): number => 1 / Math.cos(x);
const cscImpl = (x: number): number => 1 / Math.sin(x);
const cothImpl = (x: number): number => 1 / Math.tanh(x);
const sechImpl = (x: number): number => 1 / Math.cosh(x);
const cschImpl = (x: number): number => 1 / Math.sinh(x);
// Inverse reciprocal-trig/hyperbolic functions expressed via their reciprocal-argument
// counterparts (e.g. arcsec(x) = arccos(1/x)) — JS's Math object has no direct equivalents.
const acotImpl = (x: number): number => Math.PI / 2 - Math.atan(x);
const asecImpl = (x: number): number => Math.acos(1 / x);
const acscImpl = (x: number): number => Math.asin(1 / x);
const acothImpl = (x: number): number => Math.atanh(1 / x);
const asechImpl = (x: number): number => Math.acosh(1 / x);
const acschImpl = (x: number): number => Math.asinh(1 / x);
const sigmoidImpl = (x: number): number => 1 / (1 + Math.exp(-x));

const FUNC_IMPLS: Record<FuncName, (x: number) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  exp: Math.exp,
  ln: Math.log,
  sqrt: Math.sqrt,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  cot: cotImpl,
  sec: secImpl,
  csc: cscImpl,
  asinh: Math.asinh,
  acosh: Math.acosh,
  atanh: Math.atanh,
  coth: cothImpl,
  sech: sechImpl,
  csch: cschImpl,
  acot: acotImpl,
  asec: asecImpl,
  acsc: acscImpl,
  acoth: acothImpl,
  asech: asechImpl,
  acsch: acschImpl,
  abs: Math.abs,
  log10: Math.log10,
  log2: Math.log2,
  cbrt: Math.cbrt,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  sign: Math.sign,
  trunc: Math.trunc,
  expm1: Math.expm1,
  log1p: Math.log1p,
  sigmoid: sigmoidImpl,
  erf: SpecialFunctions.erf,
  relu: (x: number) => Math.max(x, 0),
};

const BINARY_FUNC_IMPLS: Record<BinaryFuncName, (a: number, b: number) => number> = {
  atan2: Math.atan2,
  hypot: Math.hypot,
  min: Math.min,
  max: Math.max,
  gcd: intGcd,
  lcm: (a, b) => Math.abs(a * b) / intGcd(a, b),
};

function compileExpr(e: Expr): (env: Record<string, number>) => number {
  switch (e.type) {
    case "const": {
      const value = e.value;
      return () => value;
    }
    case "var": {
      const name = e.name;
      return (env) => env[name] ?? Number.NaN;
    }
    case "add": {
      const l = compileExpr(e.left);
      const r = compileExpr(e.right);
      return (env) => l(env) + r(env);
    }
    case "sub": {
      const l = compileExpr(e.left);
      const r = compileExpr(e.right);
      return (env) => l(env) - r(env);
    }
    case "mul": {
      const l = compileExpr(e.left);
      const r = compileExpr(e.right);
      return (env) => l(env) * r(env);
    }
    case "div": {
      const l = compileExpr(e.left);
      const r = compileExpr(e.right);
      return (env) => l(env) / r(env);
    }
    case "pow": {
      const b = compileExpr(e.base);
      const p = compileExpr(e.exp);
      return (env) => b(env) ** p(env);
    }
    case "neg": {
      const a = compileExpr(e.arg);
      return (env) => -a(env);
    }
    case "func": {
      const a = compileExpr(e.arg);
      const impl = FUNC_IMPLS[e.name];
      return (env) => impl(a(env));
    }
    case "call2": {
      const l = compileExpr(e.left);
      const r = compileExpr(e.right);
      const impl = BINARY_FUNC_IMPLS[e.name];
      return (env) => impl(l(env), r(env));
    }
  }
}

// -- rendering --------------------------------------------------------------
const PREC: Record<string, number> = { add: 1, sub: 1, mul: 2, div: 2, neg: 3, pow: 4 };
function render(e: Expr, parentPrec: number): string {
  switch (e.type) {
    case "const":
      return `${e.value}`;
    case "var":
      return e.name;
    case "func":
      return `${e.name}(${render(e.arg, 0)})`;
    case "call2":
      return `${e.name}(${render(e.left, 0)}, ${render(e.right, 0)})`;
    case "neg":
      return wrap(`-${render(e.arg, PREC.neg)}`, PREC.neg, parentPrec);
    case "pow":
      return wrap(`${render(e.base, PREC.pow + 1)}^${render(e.exp, PREC.pow)}`, PREC.pow, parentPrec);
    case "add":
      return wrap(`${render(e.left, PREC.add)} + ${render(e.right, PREC.add)}`, PREC.add, parentPrec);
    case "sub":
      return wrap(`${render(e.left, PREC.sub)} - ${render(e.right, PREC.sub + 1)}`, PREC.sub, parentPrec);
    case "mul":
      return wrap(`${render(e.left, PREC.mul)}*${render(e.right, PREC.mul + 1)}`, PREC.mul, parentPrec);
    case "div":
      return wrap(`${render(e.left, PREC.div)}/${render(e.right, PREC.div + 1)}`, PREC.div, parentPrec);
  }
}
const wrap = (s: string, prec: number, parentPrec: number): string => (prec < parentPrec ? `(${s})` : s);

// -- LaTeX rendering ----------------------------------------------------------
const LATEX_FUNCS: Partial<Record<FuncName, string>> = {
  sin: "\\sin",
  cos: "\\cos",
  tan: "\\tan",
  exp: "\\exp",
  ln: "\\ln",
  asin: "\\arcsin",
  acos: "\\arccos",
  atan: "\\arctan",
  sinh: "\\sinh",
  cosh: "\\cosh",
  tanh: "\\tanh",
  cot: "\\cot",
  sec: "\\sec",
  csc: "\\csc",
  coth: "\\coth",
  // \sech/\csch and arc-hyperbolic names aren't standard LaTeX commands —
  // render via \operatorname, same convention KaTeX/MathJax use for them.
  sech: "\\operatorname{sech}",
  csch: "\\operatorname{csch}",
  asinh: "\\operatorname{arcsinh}",
  acosh: "\\operatorname{arccosh}",
  atanh: "\\operatorname{arctanh}",
  acot: "\\operatorname{arccot}",
  asec: "\\operatorname{arcsec}",
  acsc: "\\operatorname{arccsc}",
  acoth: "\\operatorname{arccoth}",
  asech: "\\operatorname{arcsech}",
  acsch: "\\operatorname{arccsch}",
  round: "\\operatorname{round}",
  sign: "\\operatorname{sgn}",
  trunc: "\\operatorname{trunc}",
  expm1: "\\operatorname{expm1}",
  log1p: "\\operatorname{log1p}",
  sigmoid: "\\operatorname{sigmoid}",
  erf: "\\operatorname{erf}",
  relu: "\\operatorname{relu}",
};

/** LaTeX commands for `BinaryFuncName`s — `\min`/`\max`/`\gcd` are standard LaTeX; the rest use `\operatorname`. */
const LATEX_BINARY_FUNCS: Record<BinaryFuncName, string> = {
  atan2: "\\operatorname{atan2}",
  hypot: "\\operatorname{hypot}",
  min: "\\min",
  max: "\\max",
  gcd: "\\gcd",
  lcm: "\\operatorname{lcm}",
};

function toLatexRec(e: Expr, parentPrec: number): string {
  switch (e.type) {
    case "const":
      if (Math.abs(e.value - Math.PI) < 1e-12) return "\\pi";
      if (Math.abs(e.value - Math.E) < 1e-12) return "e";
      return `${e.value}`;
    case "var":
      return e.name;
    case "func":
      if (e.name === "sqrt") return `\\sqrt{${toLatexRec(e.arg, 0)}}`;
      if (e.name === "cbrt") return `\\sqrt[3]{${toLatexRec(e.arg, 0)}}`;
      if (e.name === "abs") return `\\left|${toLatexRec(e.arg, 0)}\\right|`;
      if (e.name === "floor") return `\\left\\lfloor ${toLatexRec(e.arg, 0)}\\right\\rfloor`;
      if (e.name === "ceil") return `\\left\\lceil ${toLatexRec(e.arg, 0)}\\right\\rceil`;
      if (e.name === "log10") return `\\log_{10}\\left(${toLatexRec(e.arg, 0)}\\right)`;
      if (e.name === "log2") return `\\log_{2}\\left(${toLatexRec(e.arg, 0)}\\right)`;
      return `${LATEX_FUNCS[e.name]}\\left(${toLatexRec(e.arg, 0)}\\right)`;
    case "call2":
      return `${LATEX_BINARY_FUNCS[e.name]}\\left(${toLatexRec(e.left, 0)}, ${toLatexRec(e.right, 0)}\\right)`;
    case "neg":
      return wrap(`-${toLatexRec(e.arg, PREC.neg)}`, PREC.neg, parentPrec);
    case "pow":
      return wrap(`${toLatexRec(e.base, PREC.pow + 1)}^{${toLatexRec(e.exp, 0)}}`, PREC.pow, parentPrec);
    case "add":
      return wrap(`${toLatexRec(e.left, PREC.add)} + ${toLatexRec(e.right, PREC.add)}`, PREC.add, parentPrec);
    case "sub":
      return wrap(`${toLatexRec(e.left, PREC.sub)} - ${toLatexRec(e.right, PREC.sub + 1)}`, PREC.sub, parentPrec);
    case "mul":
      return wrap(`${toLatexRec(e.left, PREC.mul)} \\cdot ${toLatexRec(e.right, PREC.mul + 1)}`, PREC.mul, parentPrec);
    case "div":
      // \frac is self-delimiting — never needs outer parens.
      return `\\frac{${toLatexRec(e.left, 0)}}{${toLatexRec(e.right, 0)}}`;
  }
}

// -- LaTeX parsing (fromLatex) ------------------------------------------------
const LATEX_FUNC_NAMES: Partial<Record<string, FuncName>> = Object.fromEntries(
  Object.entries(LATEX_FUNCS)
    .filter(([, latex]) => !latex.startsWith("\\operatorname"))
    .map(([name, latex]) => [latex, name as FuncName]),
);

/** Reverse lookup for the `\operatorname{name}` functions in {@link LATEX_FUNCS} (e.g. `sech` -> `"sech"`). */
const OPERATORNAME_FUNC_NAMES: Partial<Record<string, FuncName>> = Object.fromEntries(
  Object.entries(LATEX_FUNCS)
    .filter((entry): entry is [string, string] => entry[1].startsWith("\\operatorname"))
    .map(([name, latex]) => [/\\operatorname\{(\w+)\}/.exec(latex)?.[1], name as FuncName]),
);

/** Reverse lookup for the standard-LaTeX-command `BinaryFuncName`s (`\min`, `\max`, `\gcd`). */
const LATEX_BINARY_FUNC_NAMES: Partial<Record<string, BinaryFuncName>> = Object.fromEntries(
  Object.entries(LATEX_BINARY_FUNCS)
    .filter((entry): entry is [BinaryFuncName, string] => !entry[1].startsWith("\\operatorname"))
    .map(([name, latex]) => [latex, name as BinaryFuncName]),
);

/** Reverse lookup for the `\operatorname{name}` `BinaryFuncName`s (`atan2`, `hypot`, `lcm`). */
const OPERATORNAME_BINARY_FUNC_NAMES: Partial<Record<string, BinaryFuncName>> = Object.fromEntries(
  Object.entries(LATEX_BINARY_FUNCS)
    .filter((entry): entry is [BinaryFuncName, string] => entry[1].startsWith("\\operatorname"))
    .map(([name, latex]) => [/\\operatorname\{(\w+)\}/.exec(latex)?.[1], name as BinaryFuncName]),
);

/** Find the index of the delimiter matching `open` at `s[start]`, honoring nesting. */
function findGroupEnd(s: string, start: number, open: string, close: string): number {
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    if (s[i] === open) depth++;
    else if (s[i] === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  throw new Error(`Unmatched '${open}' in LaTeX source`);
}

/** Extract the `{...}`/`(...)`/`[...]` group starting at `s[pos]` (the opening delimiter itself). */
function extractGroup(s: string, pos: number): { content: string; next: number } {
  const open = s[pos];
  const close = open === "{" ? "}" : open === "(" ? ")" : open === "[" ? "]" : undefined;
  if (!close) throw new Error(`Expected a group starting with '{', '(' or '[' at position ${pos}`);
  const end = findGroupEnd(s, pos, open, close);
  return { content: s.slice(pos + 1, end), next: end + 1 };
}

/** Split `s` on top-level commas, ignoring commas nested inside `{}`/`()`/`[]`. */
function splitTopLevelCommas(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "{" || ch === "(" || ch === "[") depth++;
    else if (ch === "}" || ch === ")" || ch === "]") depth--;
    else if (ch === "," && depth === 0) {
      parts.push(s.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(s.slice(start));
  return parts;
}

/** Convert a LaTeX math string into the plain-infix syntax `Symbolic.parse`'s `Parser` understands. */
function latexToInfix(latex: string): string {
  const cleaned = latex.replace(/\\left|\\right/g, "").replace(/\\(?:,|;|!|quad|qquad| )/g, "");
  return transformLatex(cleaned);
}

function transformLatex(s: string): string {
  let out = "";
  let i = 0;

  const readGroup = (): string => {
    if (s[i] !== "{") throw new Error(`Expected '{' at position ${i} in LaTeX source: ${s}`);
    const { content, next } = extractGroup(s, i);
    i = next;
    return content;
  };

  const readGroupOrParenOrToken = (): string => {
    if (s[i] === "{" || s[i] === "(") {
      const { content, next } = extractGroup(s, i);
      i = next;
      return content;
    }
    const m = /^[a-zA-Z_]\w*|^\d+\.?\d*(?:[eE][+-]?\d+)?/.exec(s.slice(i));
    if (m) {
      i += m[0].length;
      return m[0];
    }
    throw new Error(`Expected an argument at position ${i} in LaTeX source: ${s}`);
  };

  /** Read a `(...)`/`{...}` group holding exactly 2 comma-separated arguments, for `call2` functions. */
  const readArgPair = (): [string, string] => {
    if (s[i] !== "(" && s[i] !== "{") throw new Error(`Expected '(' at position ${i} in LaTeX source: ${s}`);
    const { content, next } = extractGroup(s, i);
    i = next;
    const parts = splitTopLevelCommas(content);
    if (parts.length !== 2)
      throw new Error(`Expected 2 comma-separated arguments at position ${i} in LaTeX source: ${s}`);
    return [parts[0], parts[1]];
  };

  while (i < s.length) {
    const ch = s[i];
    if (ch === "\\") {
      const cmdMatch = /^\\[a-zA-Z]+/.exec(s.slice(i));
      if (!cmdMatch) throw new Error(`Unsupported LaTeX construct at position ${i}: ${s.slice(i, i + 10)}`);
      const cmd = cmdMatch[0];
      i += cmd.length;
      if (cmd === "\\cdot" || cmd === "\\times") {
        out += "*";
        continue;
      }
      if (cmd === "\\pi") {
        out += "pi";
        continue;
      }
      if (cmd === "\\frac") {
        const numerator = readGroup();
        const denominator = readGroup();
        out += `((${transformLatex(numerator)})/(${transformLatex(denominator)}))`;
        continue;
      }
      if (cmd === "\\sqrt") {
        if (s[i] === "[") {
          const { content: root, next } = extractGroup(s, i);
          i = next;
          const arg = readGroup();
          const transformedRoot = transformLatex(root).trim();
          // \sqrt[3]{...} maps to cbrt(...) rather than a fractional power so
          // negative arguments evaluate correctly (Math.cbrt(-8) = -2, but
          // (-8)^(1/3) is NaN under JS's `**`).
          out +=
            transformedRoot === "3"
              ? `cbrt(${transformLatex(arg)})`
              : `((${transformLatex(arg)})^(1/(${transformedRoot})))`;
        } else {
          const arg = readGroup();
          out += `sqrt(${transformLatex(arg)})`;
        }
        continue;
      }
      if (cmd === "\\log") {
        let base = "10";
        if (s[i] === "_" && s[i + 1] === "{") {
          const { content, next } = extractGroup(s, i + 1);
          i = next;
          base = content.trim();
        }
        if (base !== "10" && base !== "2") {
          throw new Error(`Unsupported LaTeX construct: \\log base ${base} (only base 10 and base 2 are supported)`);
        }
        const arg = readGroupOrParenOrToken();
        out += `${base === "2" ? "log2" : "log10"}(${transformLatex(arg)})`;
        continue;
      }
      if (cmd === "\\lfloor" || cmd === "\\lceil") {
        const closeCmd = cmd === "\\lfloor" ? "\\rfloor" : "\\rceil";
        const closeIdx = s.indexOf(closeCmd, i);
        if (closeIdx === -1) throw new Error(`Unmatched '${cmd}' in LaTeX source`);
        const inner = s.slice(i, closeIdx);
        i = closeIdx + closeCmd.length;
        out += `${cmd === "\\lfloor" ? "floor" : "ceil"}(${transformLatex(inner)})`;
        continue;
      }
      if (cmd === "\\operatorname") {
        const opName = readGroup();
        const binaryName = OPERATORNAME_BINARY_FUNC_NAMES[opName];
        if (binaryName) {
          const [left, right] = readArgPair();
          out += `${binaryName}(${transformLatex(left)}, ${transformLatex(right)})`;
          continue;
        }
        const funcName = OPERATORNAME_FUNC_NAMES[opName];
        if (!funcName) throw new Error(`Unsupported LaTeX construct: \\operatorname{${opName}}`);
        const arg = readGroupOrParenOrToken();
        out += `${funcName}(${transformLatex(arg)})`;
        continue;
      }
      const binaryFuncName = LATEX_BINARY_FUNC_NAMES[cmd];
      if (binaryFuncName) {
        const [left, right] = readArgPair();
        out += `${binaryFuncName}(${transformLatex(left)}, ${transformLatex(right)})`;
        continue;
      }
      const funcName = LATEX_FUNC_NAMES[cmd];
      if (funcName) {
        const arg = readGroupOrParenOrToken();
        out += `${funcName}(${transformLatex(arg)})`;
        continue;
      }
      throw new Error(`Unsupported LaTeX construct: ${cmd}`);
    }
    if (ch === "|") {
      const closeIdx = s.indexOf("|", i + 1);
      if (closeIdx === -1) throw new Error("Unmatched '|' in LaTeX source");
      const inner = s.slice(i + 1, closeIdx);
      i = closeIdx + 1;
      out += `abs(${transformLatex(inner)})`;
      continue;
    }
    if (ch === "^" && s[i + 1] === "{") {
      const { content, next } = extractGroup(s, i + 1);
      i = next;
      out += `^(${transformLatex(content)})`;
      continue;
    }
    if (ch === "_" && s[i + 1] === "{") {
      const { content, next } = extractGroup(s, i + 1);
      i = next;
      out += `_${content.replace(/\W/g, "")}`;
      continue;
    }
    if (ch === "{") {
      const { content, next } = extractGroup(s, i);
      i = next;
      out += `(${transformLatex(content)})`;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

// -- equation solving & factoring ----------------------------------------------
/** Best-effort exact `Expr` for a numeric value: an integer, a reduced fraction, or (as a last resort) the raw float. */
function toExactExpr(value: number): Expr {
  if (Number.isInteger(value)) return num(value);
  const r = Rational.fromNumber(value, 10_000);
  if (r.denominator === 1n) return num(Number(r.numerator));
  return div(num(Number(r.numerator)), num(Number(r.denominator)));
}

function evalPoly(coeffsLowToHigh: number[], p: number): number {
  let result = 0;
  for (let i = coeffsLowToHigh.length - 1; i >= 0; i--) result = result * p + coeffsLowToHigh[i];
  return result;
}

/**
 * Extract `[c0, c1, ..., cn]` such that `expr = c0 + c1·x + ... + cn·x^n`, via
 * Taylor coefficients at 0 (`f^(n)(0)/n!`), verified against `expr` at a few
 * probe points so non-polynomial expressions (e.g. `sin(x)`) are rejected
 * rather than silently truncated. Returns `null` if `expr` isn't a polynomial
 * of degree ≤ `maxDegree` in `variable`.
 */
function polynomialCoeffs(expr: Expr, variable: string, maxDegree: number): number[] | null {
  const coeffs: number[] = [];
  let term = expr;
  let factorial = 1;
  for (let n = 0; n <= maxDegree; n++) {
    if (n > 0) factorial *= n;
    const c0 = evalExpr(term, { [variable]: 0 });
    if (!Number.isFinite(c0)) return null;
    coeffs.push(c0 / factorial);
    // Simplify between differentiation steps: an unsimplified term like the
    // derivative of x^0 (`0·x^-1`) evaluates to `0·Infinity = NaN` at x=0
    // even though it is symbolically zero — simplifying collapses `0·anything`
    // to `0` before that indeterminate form can arise.
    term = Symbolic.simplify(diff(term, variable));
  }
  while (coeffs.length > 1 && Math.abs(coeffs[coeffs.length - 1]) < 1e-9) coeffs.pop();
  for (const p of [1.3, -2.1, 3.7]) {
    const actual = evalExpr(expr, { [variable]: p });
    if (!Number.isFinite(actual)) return null;
    if (Math.abs(evalPoly(coeffs, p) - actual) > 1e-6 * Math.max(1, Math.abs(actual))) return null;
  }
  return coeffs;
}

function intGcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) [x, y] = [y, x % y];
  return x || 1;
}

function divisorsOf(n: number): number[] {
  const a = Math.round(Math.abs(n));
  if (a === 0) return [1];
  const result: number[] = [];
  for (let i = 1; i <= a; i++) if (a % i === 0) result.push(i);
  return result;
}

/** Rational-root-theorem search for one root of an integer-coefficient polynomial (low-to-high `coeffs`). */
function findRationalRoot(coeffs: number[]): number | null {
  const n = coeffs.length - 1;
  const rounded = coeffs.map((c) => Math.round(c));
  const isIntegerPoly = coeffs.every((c, i) => Math.abs(c - rounded[i]) < 1e-6);
  if (!isIntegerPoly) return null;
  const pCands = divisorsOf(rounded[0]);
  const qCands = divisorsOf(rounded[n]);
  const tried = new Set<number>();
  for (const p of pCands) {
    for (const q of qCands) {
      for (const sign of [1, -1]) {
        const candidate = (sign * p) / q;
        if (tried.has(candidate)) continue;
        tried.add(candidate);
        if (Math.abs(evalPoly(rounded, candidate)) < 1e-6) return candidate;
      }
    }
  }
  return null;
}

/** Synthetic division of a polynomial (low-to-high `coeffs`) by `(x - root)`; assumes `root` is an exact root. */
function syntheticDivide(coeffsLowToHigh: number[], root: number): number[] {
  const desc = [...coeffsLowToHigh].reverse();
  const quotientDesc: number[] = [desc[0]];
  for (let i = 1; i < desc.length - 1; i++) {
    quotientDesc.push(desc[i] + root * quotientDesc[i - 1]);
  }
  return quotientDesc.reverse();
}

function solvePolynomial(coeffsIn: number[]): Expr[] {
  const coeffs = [...coeffsIn];
  while (coeffs.length > 1 && Math.abs(coeffs[coeffs.length - 1]) < 1e-9) coeffs.pop();
  const n = coeffs.length - 1;
  if (n <= 0) return [];
  if (n === 1) {
    const [c0, c1] = coeffs;
    return [toExactExpr(-c0 / c1)];
  }
  if (n === 2) {
    const [c0, c1, c2] = coeffs;
    const disc = c1 * c1 - 4 * c2 * c0;
    if (disc < -1e-9) return [];
    const negB = -c1;
    const twoA = 2 * c2;
    if (Math.abs(disc) < 1e-9) return [toExactExpr(negB / twoA)];
    const sqrtDisc = Math.sqrt(disc);
    if (Math.abs(sqrtDisc - Math.round(sqrtDisc)) < 1e-9) {
      return [toExactExpr((negB + sqrtDisc) / twoA), toExactExpr((negB - sqrtDisc) / twoA)];
    }
    const sqrtExpr = fn("sqrt", toExactExpr(disc));
    return [
      div(add(toExactExpr(negB), sqrtExpr), toExactExpr(twoA)),
      div(sub(toExactExpr(negB), sqrtExpr), toExactExpr(twoA)),
    ];
  }
  const root = findRationalRoot(coeffs);
  if (root === null) {
    throw new Error(
      `solve: no closed-form root found for a degree-${n} polynomial (only rational roots are searched for degree ≥ 3).`,
    );
  }
  const deflated = syntheticDivide(coeffs, root);
  return [toExactExpr(root), ...solvePolynomial(deflated)];
}

/** Build `c0 + c1·x + c2·x^2 + ...` from low-to-high coefficients. */
function polyToExpr(coeffs: number[], variable: string): Expr {
  let result: Expr | null = null;
  for (let i = 0; i < coeffs.length; i++) {
    if (coeffs[i] === 0) continue;
    const monomial =
      i === 0 ? toExactExpr(coeffs[i]) : mul(toExactExpr(coeffs[i]), i === 1 ? v(variable) : pow(v(variable), num(i)));
    result = result === null ? monomial : add(result, monomial);
  }
  return result ?? num(0);
}

function factorPolynomial(coeffsIn: number[], variable: string): Expr {
  let coeffs = [...coeffsIn];
  while (coeffs.length > 1 && Math.abs(coeffs[coeffs.length - 1]) < 1e-9) coeffs.pop();
  if (coeffs.every((c) => Math.abs(c) < 1e-9)) return num(0);

  let xPower = 0;
  while (coeffs.length > 1 && Math.abs(coeffs[0]) < 1e-9) {
    coeffs.shift();
    xPower++;
  }

  const rounded = coeffs.map((c) => Math.round(c));
  const isIntegerPoly = coeffs.every((c, i) => Math.abs(c - rounded[i]) < 1e-6);
  let gcd = 1;
  if (isIntegerPoly) {
    gcd = rounded.reduce((g, c) => (c === 0 ? g : intGcd(g, Math.abs(c))), 0) || 1;
    coeffs = rounded.map((c) => c / gcd);
  }

  const linearRoots: number[] = [];
  let remaining = coeffs;
  while (remaining.length - 1 >= 3) {
    const root = findRationalRoot(remaining);
    if (root === null) break;
    linearRoots.push(root);
    remaining = syntheticDivide(remaining, root);
  }
  if (remaining.length - 1 === 2) {
    const [c0, c1, c2] = remaining;
    const disc = c1 * c1 - 4 * c2 * c0;
    if (disc >= 0) {
      const sqrtDisc = Math.sqrt(disc);
      if (Math.abs(sqrtDisc - Math.round(sqrtDisc)) < 1e-9) {
        linearRoots.push((-c1 + sqrtDisc) / (2 * c2), (-c1 - sqrtDisc) / (2 * c2));
        remaining = [c2];
      }
    }
  } else if (remaining.length - 1 === 1) {
    const [c0, c1] = remaining;
    linearRoots.push(-c0 / c1);
    remaining = [c1];
  }

  let result: Expr = toExactExpr(gcd);
  if (xPower === 1) result = mul(result, v(variable));
  else if (xPower > 1) result = mul(result, pow(v(variable), num(xPower)));
  for (const r of linearRoots) {
    result = mul(result, Math.abs(r) < 1e-9 ? v(variable) : sub(v(variable), toExactExpr(r)));
  }
  if (remaining.length > 1) {
    result = mul(result, polyToExpr(remaining, variable));
  } else if (Math.abs(remaining[0] - 1) > 1e-9) {
    result = mul(result, toExactExpr(remaining[0]));
  }
  return Symbolic.simplify(result);
}

// -- limits ---------------------------------------------------------------------
function evalNear(e: Expr, x: string, point: number, direction: "left" | "right" | "both"): number {
  if (direction === "both") return evalExpr(e, { [x]: point });
  const eps = direction === "right" ? 1e-6 : -1e-6;
  return evalExpr(e, { [x]: point + eps });
}

function limitAt(e: Expr, x: string, point: number, direction: "left" | "right" | "both", depth: number): number {
  const direct = evalNear(e, x, point, direction);
  if (Number.isFinite(direct)) return direct;
  if (e.type === "div" && depth < 12) {
    const fAt = evalNear(e.left, x, point, direction);
    const gAt = evalNear(e.right, x, point, direction);
    const indeterminate =
      (Math.abs(fAt) < 1e-6 && Math.abs(gAt) < 1e-6) || (!Number.isFinite(fAt) && !Number.isFinite(gAt));
    if (indeterminate) {
      const df = diff(e.left, x);
      const dg = diff(e.right, x);
      return limitAt(div(df, dg), x, point, direction, depth + 1);
    }
  }
  return direct;
}

// -- recursive-descent parser ----------------------------------------------
class Parser {
  private readonly s: string;
  private pos = 0;

  constructor(input: string) {
    this.s = input.replace(/\s+/g, "");
  }

  parse(): Expr {
    const e = this.expr();
    if (this.pos < this.s.length) throw new Error(`Unexpected token at ${this.pos}: ${this.s.slice(this.pos)}`);
    return e;
  }

  private peek(): string {
    return this.s[this.pos] ?? "";
  }

  /** Parse a comma-separated list of expressions, for multi-arg function calls. */
  private argList(): Expr[] {
    const args = [this.expr()];
    while (this.peek() === ",") {
      this.pos++;
      args.push(this.expr());
    }
    return args;
  }

  private expr(): Expr {
    let left = this.term();
    while (this.peek() === "+" || this.peek() === "-") {
      const op = this.s[this.pos++];
      const right = this.term();
      left = op === "+" ? add(left, right) : sub(left, right);
    }
    return left;
  }

  private term(): Expr {
    let left = this.factor();
    while (this.peek() === "*" || this.peek() === "/") {
      const op = this.s[this.pos++];
      const right = this.factor();
      left = op === "*" ? mul(left, right) : div(left, right);
    }
    return left;
  }

  private factor(): Expr {
    if (this.peek() === "-") {
      this.pos++;
      return neg(this.factor());
    }
    const base = this.base();
    if (this.peek() === "^") {
      this.pos++;
      return pow(base, this.factor()); // right-associative
    }
    return base;
  }

  private base(): Expr {
    if (this.peek() === "(") {
      this.pos++;
      const e = this.expr();
      if (this.peek() !== ")") throw new Error("Expected ')'");
      this.pos++;
      return e;
    }
    if (this.peek() === "|") {
      this.pos++;
      const e = this.expr();
      if (this.peek() !== "|") throw new Error("Expected '|'");
      this.pos++;
      return fn("abs", e);
    }
    // number
    const numMatch = /^\d+\.?\d*(?:[eE][+-]?\d+)?/.exec(this.s.slice(this.pos));
    if (numMatch) {
      this.pos += numMatch[0].length;
      return num(Number(numMatch[0]));
    }
    // identifier (function or variable or constant)
    const idMatch = /^[a-zA-Z_]\w*/.exec(this.s.slice(this.pos));
    if (idMatch) {
      const name = idMatch[0];
      this.pos += name.length;
      if ((name === "log" || name === "clamp") && this.peek() === "(") {
        this.pos++;
        const args = this.argList();
        if (this.peek() !== ")") throw new Error("Expected ')'");
        this.pos++;
        if (name === "log") {
          if (args.length !== 2) throw new Error(`log() expects 2 arguments (base, x), got ${args.length}`);
          return div(fn("ln", args[1]), fn("ln", args[0]));
        }
        if (args.length !== 3) throw new Error(`clamp() expects 3 arguments (x, lo, hi), got ${args.length}`);
        return call2("min", call2("max", args[0], args[1]), args[2]);
      }
      if ((BINARY_FUNCS as string[]).includes(name) && this.peek() === "(") {
        const binaryName = name as BinaryFuncName;
        this.pos++;
        const args = this.argList();
        if (this.peek() !== ")") throw new Error("Expected ')'");
        this.pos++;
        if (binaryName === "atan2") {
          if (args.length !== 2) throw new Error(`atan2() expects exactly 2 arguments, got ${args.length}`);
          return call2("atan2", args[0], args[1]);
        }
        if (args.length < 2) throw new Error(`${binaryName}() expects at least 2 arguments, got ${args.length}`);
        return args.reduce((l, r) => call2(binaryName, l, r));
      }
      const canonical: FuncName | undefined = (FUNCS as string[]).includes(name)
        ? (name as FuncName)
        : FUNC_ALIASES[name];
      if (canonical && this.peek() === "(") {
        this.pos++;
        const arg = this.expr();
        if (this.peek() !== ")") throw new Error("Expected ')'");
        this.pos++;
        return fn(canonical, arg);
      }
      if (name === "pi") return num(Math.PI);
      if (name === "e") return num(Math.E);
      return v(name);
    }
    throw new Error(`Unexpected token at ${this.pos}: ${this.s.slice(this.pos)}`);
  }
}
