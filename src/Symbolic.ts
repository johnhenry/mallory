/**
 * Symbolic — a small computer-algebra engine: an expression AST with parsing,
 * symbolic differentiation, algebraic simplification, basic symbolic
 * integration, Taylor expansion, polynomial equation solving/factoring,
 * limits, LaTeX rendering, and numeric evaluation.
 */
import { MatrixMath } from "./MatrixMath.ts";
import { Numerical } from "./Numerical.ts";
import { Rational } from "./Rational.ts";
import { SpecialFunctions } from "./SpecialFunctions.ts";
import type { Structure } from "./Structure.ts";

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

/** Comparison operators (see the `cmp` `Expr` variant). Evaluate to `1`/`0` (boolean-as-number). */
export type CmpOp = "lt" | "le" | "gt" | "ge" | "eq" | "ne";

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
  | { type: "call2"; name: BinaryFuncName; left: Expr; right: Expr }
  | { type: "cmp"; op: CmpOp; left: Expr; right: Expr }
  | { type: "piecewise"; branches: { cond: Expr; expr: Expr }[]; otherwise: Expr }
  | { type: "sum"; variable: string; from: Expr; to: Expr; body: Expr }
  | { type: "product"; variable: string; from: Expr; to: Expr; body: Expr };

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
  "piecewise",
  "sum",
  "product",
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
const cmp = (op: CmpOp, left: Expr, right: Expr): Expr => ({ type: "cmp", op, left, right });
const piecewise = (branches: { cond: Expr; expr: Expr }[], otherwise: Expr): Expr => ({
  type: "piecewise",
  branches,
  otherwise,
});
const sumExpr = (variable: string, from: Expr, to: Expr, body: Expr): Expr => ({
  type: "sum",
  variable,
  from,
  to,
  body,
});
const productExpr = (variable: string, from: Expr, to: Expr, body: Expr): Expr => ({
  type: "product",
  variable,
  from,
  to,
  body,
});

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
    case "piecewise":
      return (
        e.branches.some((br) => containsVar(br.cond, name) || containsVar(br.expr, name)) ||
        containsVar(e.otherwise, name)
      );
    case "sum":
    case "product":
      return containsVar(e.from, name) || containsVar(e.to, name) || (e.variable !== name && containsVar(e.body, name));
    default:
      return containsVar(e.left, name) || containsVar(e.right, name);
  }
};

/** Collects every distinct `var` node name referenced anywhere in `e`. */
const collectFreeVars = (e: Expr, found: Set<string> = new Set()): Set<string> => {
  switch (e.type) {
    case "const":
      return found;
    case "var":
      found.add(e.name);
      return found;
    case "neg":
    case "func":
      collectFreeVars(e.arg, found);
      return found;
    case "pow":
      collectFreeVars(e.base, found);
      collectFreeVars(e.exp, found);
      return found;
    case "piecewise":
      for (const br of e.branches) {
        collectFreeVars(br.cond, found);
        collectFreeVars(br.expr, found);
      }
      collectFreeVars(e.otherwise, found);
      return found;
    case "sum":
    case "product": {
      collectFreeVars(e.from, found);
      collectFreeVars(e.to, found);
      // e.variable is bound within e.body -- collect its free vars into a
      // scratch set and merge everything except the bound name, so a
      // same-named free variable elsewhere in `e` isn't shadowed out.
      const bodyFound = collectFreeVars(e.body, new Set());
      for (const n of bodyFound) if (n !== e.variable) found.add(n);
      return found;
    }
    default:
      collectFreeVars(e.left, found);
      collectFreeVars(e.right, found);
      return found;
  }
};

export type Assumption = "positive" | "negative" | "nonnegative" | "nonpositive" | "nonzero";

/** See {@link Symbolic.simplifyAssuming} -- the tree-walk applying each assumption's specific rewrite patterns. */
function applyAssumptions(e: Expr, assumptions: Record<string, Assumption>): Expr {
  const isNonneg = (name: string) => assumptions[name] === "positive" || assumptions[name] === "nonnegative";
  const isNonpos = (name: string) => assumptions[name] === "negative" || assumptions[name] === "nonpositive";

  function walk(node: Expr): Expr {
    switch (node.type) {
      case "const":
      case "var":
        return node;
      case "neg":
        return { type: "neg", arg: walk(node.arg) };
      case "func": {
        const arg = walk(node.arg);
        if (node.name === "sqrt" && arg.type === "pow" && isConst(arg.exp, 2) && arg.base.type === "var") {
          if (isNonneg(arg.base.name)) return arg.base;
          if (isNonpos(arg.base.name)) return { type: "neg", arg: arg.base };
        }
        if (node.name === "abs" && arg.type === "var") {
          if (isNonneg(arg.name)) return arg;
          if (isNonpos(arg.name)) return { type: "neg", arg };
        }
        return { type: "func", name: node.name, arg };
      }
      case "pow":
        return { type: "pow", base: walk(node.base), exp: walk(node.exp) };
      case "piecewise":
        return {
          type: "piecewise",
          branches: node.branches.map((br) => ({ cond: walk(br.cond), expr: walk(br.expr) })),
          otherwise: walk(node.otherwise),
        };
      case "sum":
      case "product":
        return { ...node, from: walk(node.from), to: walk(node.to), body: walk(node.body) };
      default:
        return { ...node, left: walk(node.left), right: walk(node.right) };
    }
  }

  return walk(e);
}

export class NotIntegrableError extends Error {
  constructor(message = "This expression cannot be integrated by the elementary rules implemented.") {
    super(message);
    this.name = "NotIntegrableError";
  }
}

export class NonLinearSystemError extends Error {
  constructor(message = "solveSystem only supports systems that are linear in the given variables.") {
    super(message);
    this.name = "NonLinearSystemError";
  }
}

export class SingularSystemError extends Error {
  constructor(
    message = "solveSystem: the system is singular (rank < number of variables) and has no unique solution.",
  ) {
    super(message);
    this.name = "SingularSystemError";
  }
}

export class SeriesDivergesError extends Error {
  constructor(
    message = "sumSeries: the series does not appear to converge (or converges too slowly to sum numerically).",
  ) {
    super(message);
    this.name = "SeriesDivergesError";
  }
}

export class UndeclaredVariableError extends Error {
  readonly names: string[];
  constructor(names: string[]) {
    super(
      `Expression references variable${names.length === 1 ? "" : "s"} not in the declared set: ${names.join(", ")}`,
    );
    this.name = "UndeclaredVariableError";
    this.names = names;
  }
}

export class SystemDidNotConvergeError extends Error {
  constructor(message = "solveSystemNumeric: Newton's method did not converge from the given initial guess.") {
    super(message);
    this.name = "SystemDidNotConvergeError";
  }
}

export class IntegrationSingularityError extends Error {
  constructor(
    message = "integrateDefinite: the integrand appears to have a singularity strictly inside the integration bounds.",
  ) {
    super(message);
    this.name = "IntegrationSingularityError";
  }
}

export class ProductNotDifferentiableError extends Error {
  constructor(
    message = 'differentiate: a "product" (Π) node has no mechanical differentiation rule -- it needs the general Leibniz/logarithmic-derivative rule, which isn\'t implemented.',
  ) {
    super(message);
    this.name = "ProductNotDifferentiableError";
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

  /**
   * Simplifies `expr` with additional domain knowledge about specific
   * variables (e.g. "x is positive"), unlocking simplifications that aren't
   * sound in general -- `sqrt(x^2) -> x` requires x >= 0 (otherwise the
   * correct simplification is |x|), and `abs(x) -> x`/`-x` requires knowing
   * x's sign. Runs ordinary `simplify` first, then a second tree-walk pass
   * applying the specific patterns each assumption unlocks, then
   * `simplify`s once more in case a rewrite exposes a further reduction
   * (e.g. `sqrt(x^2)*2` -> `x*2` -> could combine with a like term
   * elsewhere).
   *
   * NON-GOALS: a small, explicit pattern set (`sqrt(x^2)`, `abs(x)`), not a
   * general constraint-propagation/theorem-proving simplifier; assumptions
   * are a flat per-variable fact (`Assumption`), not compound/derived
   * assumptions (e.g. "x+y is positive" isn't expressible).
   */
  static simplifyAssuming(expr: Expr | string, assumptions: Record<string, Assumption>): Expr {
    const simplified = Symbolic.simplify(expr);
    const rewritten = applyAssumptions(simplified, assumptions);
    return Symbolic.simplify(rewritten);
  }

  /** Symbolic anti-derivative (elementary rules; throws {@link NotIntegrableError} otherwise). */
  static integrate(expr: Expr | string, variable = "x"): Expr {
    const e = typeof expr === "string" ? Symbolic.parse(expr) : expr;
    return Symbolic.simplify(integ(e, variable));
  }

  /**
   * Definite integral of `expr` over `[lower, upper]` with respect to
   * `variable`. Tries the elementary symbolic antiderivative first
   * (evaluating `F(upper) - F(lower)`); falls back to adaptive-Simpson
   * numeric quadrature when {@link integrate} would throw
   * {@link NotIntegrableError}. `env` binds any other free variables/
   * constants appearing in `expr` (same convention as {@link evaluate}/
   * {@link compile}); if `env` also happens to bind `variable`, the
   * integration bound always wins.
   *
   * `lower > upper` needs no special-casing -- both the closed-form
   * `F(upper) - F(lower)` and {@link Numerical.adaptiveSimpson} are
   * antisymmetric in their two bounds (verified directly against
   * `adaptiveSimpson`'s implementation), so reversed bounds just negate
   * the result, matching the standard ∫[a,b] = -∫[b,a] convention.
   *
   * Detects (best-effort) a singularity strictly inside `(lower, upper)` --
   * e.g. `1/x` from -1 to 1 -- via {@link hasInteriorSingularity} and throws
   * {@link IntegrationSingularityError} rather than silently returning a
   * finite-looking but meaningless value, for both the closed-form path (a
   * naive `F(upper) - F(lower)` is wrong across a pole even when `F` itself
   * evaluates to finite numbers at both ends) and the numeric fallback.
   *
   * NON-GOAL: the detector is a bounded-effort numeric heuristic (see its
   * own doc comment), not an analytic proof -- a sufficiently narrow
   * singularity can in principle still slip through uniform sampling.
   *
   * @throws {IntegrationSingularityError} if an interior singularity is detected.
   */
  static integrateDefinite(
    expr: Expr | string,
    lower: number,
    upper: number,
    variable = "x",
    env: Record<string, number> = {},
  ): number {
    const e = Symbolic.simplify(typeof expr === "string" ? Symbolic.parse(expr) : expr);
    const probe = compileExpr(e);
    if (hasInteriorSingularity((val: number) => probe({ ...env, [variable]: val }), lower, upper)) {
      throw new IntegrationSingularityError();
    }
    try {
      const F = Symbolic.simplify(integ(e, variable));
      const at = (val: number) => evalExpr(F, { ...env, [variable]: val });
      return at(upper) - at(lower);
    } catch (err) {
      if (!(err instanceof NotIntegrableError)) throw err;
      const f = compileExpr(e);
      return Numerical.adaptiveSimpson((val: number) => f({ ...env, [variable]: val }), lower, upper);
    }
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

  /**
   * Every distinct variable name referenced anywhere in `expr`, sorted. This
   * is auto-detection, not validation -- see {@link assertVariables} for a
   * strict-mode check against a declared list.
   */
  static freeVariables(expr: Expr | string): string[] {
    const e = typeof expr === "string" ? Symbolic.parse(expr) : expr;
    return [...collectFreeVars(e)].sort();
  }

  /**
   * Strict-mode companion to {@link freeVariables}: throws
   * {@link UndeclaredVariableError} if `expr` references any variable
   * outside `declared`. Useful to catch typos or ambiguous-parse fallout
   * before they silently become spurious sliders/parameters or silently
   * evaluate to `NaN`.
   */
  static assertVariables(expr: Expr | string, declared: string[]): void {
    const e = typeof expr === "string" ? Symbolic.parse(expr) : expr;
    const declaredSet = new Set(declared);
    const undeclared = Symbolic.freeVariables(e).filter((name) => !declaredSet.has(name));
    if (undeclared.length > 0) throw new UndeclaredVariableError(undeclared);
  }

  /**
   * @param options.declaredVariables When provided, throws
   * {@link UndeclaredVariableError} if `expr` references any variable
   * outside this list, instead of the default behavior of silently
   * resolving an undeclared variable to `NaN` via a missing `env` entry.
   */
  static evaluate(
    expr: Expr | string,
    env: Record<string, number> = {},
    options?: { declaredVariables?: string[] },
  ): number {
    const e = typeof expr === "string" ? Symbolic.parse(expr) : expr;
    if (options?.declaredVariables) Symbolic.assertVariables(e, options.declaredVariables);
    return evalExpr(e, env);
  }

  /**
   * Compile `expr` into a closure tree, walking the AST once instead of on
   * every call. Prefer this over {@link evaluate} when the same expression is
   * evaluated many times (e.g. sampling a curve across hundreds of x values).
   *
   * @param options.declaredVariables Same strict-mode check as
   * {@link evaluate}, checked once up front rather than per call.
   */
  static compile(
    expr: Expr | string,
    options?: { declaredVariables?: string[] },
  ): (env: Record<string, number>) => number {
    const e = typeof expr === "string" ? Symbolic.parse(expr) : expr;
    if (options?.declaredVariables) Symbolic.assertVariables(e, options.declaredVariables);
    return compileExpr(e);
  }

  /**
   * Evaluates `expr` exactly over {@link Rational} arithmetic instead of
   * floats (e.g. `1/3` stays an exact fraction, not `0.333...`). Throws
   * whenever the expression isn't exactly representable -- any `func`/
   * `call2` node (sin/cos/sqrt/atan2/etc. are generally irrational) or a
   * `pow` whose exponent isn't an integer -- so callers should fall back to
   * a plain float evaluation on catch. `cmp` evaluates to exactly `1`/`0`
   * via `Rational.compare`; `piecewise` selects the branch exactly (first
   * `cond` whose Rational is nonzero).
   */
  static evaluateExact(expr: Expr | string, env: Record<string, Rational> = {}): Rational {
    const e = typeof expr === "string" ? Symbolic.parse(expr) : expr;
    return evalExprExact(e, env);
  }

  /**
   * Evaluates `expr` by folding it through an arbitrary {@link Structure}'s
   * own algebra instead of native JS math, so e.g. plotting can work over
   * Z/7Z instead of the reals. Throws on any `func`/`call2` node (no
   * general meaning over an abstract structure), a `pow` whose exponent
   * isn't a literal integer constant, or an ordering comparison (`lt`/`le`/
   * `gt`/`ge` -- several structures, e.g. quaternions, have no order
   * compatible with their ring operations). `eq`/`ne` and `piecewise` work
   * over any structure via its own `.equality()`.
   */
  static evaluateOverStructure<T>(expr: Expr | string, structure: Structure<T>, env: Record<string, T> = {}): T {
    const e = typeof expr === "string" ? Symbolic.parse(expr) : expr;
    return evalExprOverStructure(e, structure, env);
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
   * Solve a system of linear equations, each written in the same "expr
   * implicitly equals zero" convention as {@link solve} (no `=` operator
   * needed -- e.g. `"2*x + y - 5"` means `2x+y=5`). Requires exactly one
   * equation per variable (a square system) with a unique solution.
   *
   * NON-GOAL (v1): nonlinear systems are not supported -- throws
   * {@link NonLinearSystemError}. A future multivariable-Newton extension
   * (seeded from an initial guess, iterating via the Jacobian) would slot in
   * here as a fallback when linearity detection fails, but is out of scope now.
   *
   * @throws {NonLinearSystemError} if any equation isn't linear in `variables`.
   * @throws {SingularSystemError} if the coefficient matrix is singular/rank-deficient.
   */
  static solveSystem(equations: (Expr | string)[], variables: string[]): Record<string, number> {
    const exprs = equations.map((eq) => Symbolic.simplify(typeof eq === "string" ? Symbolic.parse(eq) : eq));
    if (exprs.length !== variables.length) {
      throw new Error(
        `solveSystem: expected ${variables.length} equations for ${variables.length} variables, got ${exprs.length}.`,
      );
    }
    const A: number[][] = [];
    const b: number[] = [];
    exprs.forEach((eq, i) => {
      const row = linearCoeffsForSystem(eq, variables);
      if (!row) {
        throw new NonLinearSystemError(
          `solveSystem: equation ${i} ("${Symbolic.toString(eq)}") is not linear in [${variables.join(", ")}].`,
        );
      }
      A.push(row.slice(0, variables.length));
      b.push(-(row[variables.length] as number)); // eq = A·v + c = 0  =>  A·v = -c
    });
    const rank = MatrixMath.rank(A);
    if (rank < variables.length) {
      throw new SingularSystemError(
        `solveSystem: the system is singular (rank ${rank} < ${variables.length} variables) and has no unique solution.`,
      );
    }
    const x = MatrixMath.solve(A, b);
    const result: Record<string, number> = {};
    variables.forEach((name, i) => {
      result[name] = x[i] as number;
    });
    return result;
  }

  /**
   * Numerically solves a square system of (possibly nonlinear) equations
   * via multivariable Newton's method with a finite-difference Jacobian,
   * starting from `initialGuess` (default: all 1s). Unlike `solveSystem`,
   * this never throws `NonLinearSystemError` -- a genuinely linear system
   * just converges in one Newton step, since Newton's method reduces to a
   * single linear solve whenever the Jacobian is already constant. Added as
   * a separate opt-in method (not `solveSystem`'s new default behavior) so
   * `solveSystem`'s existing "throw on nonlinear" contract, and the tests
   * that rely on it, stay unchanged -- callers who want a nonlinear-capable
   * solve opt in explicitly.
   *
   * Each Newton step is damped by a backtracking line search: the full step
   * is tried first, halved up to 20 times until it actually reduces the
   * residual norm (or leaves the function's domain), rather than being
   * taken unconditionally -- this is what keeps a merely-nearby (not
   * exact) initial guess from overshooting past a real root, the concrete
   * failure mode plain undamped Newton has no defense against.
   *
   * NON-GOALS: still no trust-region step (backtracking damps the step
   * length but never changes its *direction* the way a trust region
   * would), so a genuinely bad initial guess -- one on the wrong side of a
   * local max/min of the residual, not just far from the root -- can still
   * fail to converge; only ever finds one root near the initial guess, not
   * every root of a system with multiple solutions.
   *
   * @throws {SystemDidNotConvergeError} if the residual doesn't shrink
   *   below tolerance within the iteration budget, if evaluation produces a
   *   non-finite value (e.g. leaving the function's domain) at some step,
   *   or if no damped step size improves the residual at some iterate.
   */
  static solveSystemNumeric(
    equations: (Expr | string)[],
    variables: string[],
    initialGuess?: number[],
  ): Record<string, number> {
    const exprs = equations.map((eq) => (typeof eq === "string" ? Symbolic.parse(eq) : eq));
    if (exprs.length !== variables.length) {
      throw new Error(
        `solveSystemNumeric: expected ${variables.length} equations for ${variables.length} variables, got ${exprs.length}.`,
      );
    }
    const n = variables.length;
    const compiled = exprs.map((e) => Symbolic.compile(e));
    const evalF = (point: number[]): number[] => {
      const env: Record<string, number> = {};
      variables.forEach((v, i) => {
        env[v] = point[i] as number;
      });
      return compiled.map((f) => f(env));
    };

    let x = initialGuess ? [...initialGuess] : new Array(n).fill(1);
    const h = 1e-6;
    const maxIterations = 100;
    const tolerance = 1e-10;

    for (let iter = 0; iter < maxIterations; iter++) {
      const fx = evalF(x);
      if (!fx.every(Number.isFinite)) {
        throw new SystemDidNotConvergeError("solveSystemNumeric: evaluation produced a non-finite value.");
      }
      const residualNorm = Math.sqrt(fx.reduce((sum, v) => sum + v * v, 0));
      if (residualNorm < tolerance) {
        const result: Record<string, number> = {};
        variables.forEach((name, i) => {
          result[name] = x[i] as number;
        });
        return result;
      }

      const jacobian: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
      for (let col = 0; col < n; col++) {
        const perturbed = [...x];
        perturbed[col] = (perturbed[col] as number) + h;
        const fPerturbed = evalF(perturbed);
        for (let row = 0; row < n; row++) {
          (jacobian[row] as number[])[col] = ((fPerturbed[row] as number) - (fx[row] as number)) / h;
        }
      }

      let delta: number[];
      try {
        delta = MatrixMath.solve(
          jacobian,
          fx.map((v) => -v),
        );
      } catch {
        throw new SystemDidNotConvergeError("solveSystemNumeric: the Jacobian became singular during iteration.");
      }

      let stepScale = 1;
      let accepted = false;
      for (let backtrack = 0; backtrack < 20 && !accepted; backtrack++) {
        const candidate = x.map((xi, i) => xi + stepScale * (delta[i] as number));
        const fCandidate = evalF(candidate);
        if (fCandidate.every(Number.isFinite)) {
          const candidateNorm = Math.sqrt(fCandidate.reduce((sum, v) => sum + v * v, 0));
          if (candidateNorm < residualNorm) {
            x = candidate;
            accepted = true;
            break;
          }
        }
        stepScale /= 2;
      }
      if (!accepted) {
        throw new SystemDidNotConvergeError(
          "solveSystemNumeric: no damped step improved the residual from the current iterate.",
        );
      }
    }
    throw new SystemDidNotConvergeError(
      `solveSystemNumeric: did not converge within ${maxIterations} iterations from the given initial guess.`,
    );
  }

  /**
   * Numerically spot-checks that `candidate` is (approximately) a root of
   * `equation` (the same "implicitly equals zero" convention `solve` uses):
   * substitutes `candidate` for `variable` and checks the result is near
   * zero. A lightweight reviewer/verification pass over a CAS result, not a
   * proof of exactness -- catches an outright wrong candidate (e.g. from a
   * heuristic search or a downstream bug) before it's presented, using the
   * same probe-and-compare technique this codebase's own test suite already
   * relies on for anything heuristic.
   */
  static verifySolution(
    equation: Expr | string,
    variable: string,
    candidate: number,
    env: Record<string, number> = {},
    tolerance = 1e-6,
  ): boolean {
    const value = Symbolic.evaluate(equation, { ...env, [variable]: candidate });
    return Number.isFinite(value) && Math.abs(value) < tolerance;
  }

  /**
   * The `solveSystem`/`solveSystemNumeric` analog of {@link verifySolution}:
   * substitutes `solution` into every equation and requires all of them to
   * land near zero.
   */
  static verifySystemSolution(
    equations: (Expr | string)[],
    solution: Record<string, number>,
    tolerance = 1e-6,
  ): boolean {
    return equations.every((eq) => {
      const value = Symbolic.evaluate(eq, solution);
      return Number.isFinite(value) && Math.abs(value) < tolerance;
    });
  }

  /**
   * Sum `expr` over integer values of `variable` from `from` to `to`
   * (inclusive); `to` may be `Infinity` for an infinite series. A finite
   * range is a plain partial sum. An infinite range first tries to recognize
   * `expr` as a geometric series (`c·r^(a·variable+b)`, closed form
   * `c·r^(a·from+b)/(1-r^a)`), falling back to numeric partial summation with
   * a convergence/divergence check otherwise.
   *
   * `variable` defaults to `"n"` (not `"x"`), matching conventional
   * summation-index notation.
   *
   * NON-GOALS: no general convergence-radius/ratio-test analysis beyond a
   * simple term-growth divergence heuristic; no summation acceleration
   * (Euler transform etc.) for slowly-converging or conditionally-convergent
   * alternating series; closed-form recognition covers geometric series
   * only, not arbitrary known series (no telescoping, no p-series/zeta
   * recognition).
   *
   * If the term-magnitude stopping rule alone can't confirm convergence
   * within the term budget (e.g. `Σ 1/n^2`, a slowly-decaying polynomial
   * tail the per-term check isn't a valid proxy for), a second pass tries
   * an integral-test tail bound instead of immediately declaring divergence:
   * see {@link estimateConvergentTail}'s own doc comment for how. This
   * recovers the correct value for a genuinely convergent slow-decay
   * series without weakening the divergence check for a genuinely
   * divergent one (e.g. `Σ 1/n`) -- the tail estimator itself confirms
   * whether the integral is actually shrinking before trusting it.
   *
   * @throws {SeriesDivergesError} if the numeric fallback (including the
   *   integral-test tail estimate) still can't confirm convergence within
   *   its budget, or detects the terms growing.
   */
  static sumSeries(
    expr: Expr | string,
    from: number,
    to: number,
    variable = "n",
    env: Record<string, number> = {},
  ): number {
    const e = typeof expr === "string" ? Symbolic.parse(expr) : expr;
    if (Number.isFinite(to)) {
      if (from > to) return 0; // empty sum
      const f = compileExpr(e);
      let total = 0;
      for (let k = from; k <= to; k++) total += f({ ...env, [variable]: k });
      return total;
    }
    const closedForm = tryGeometricSeriesClosedForm(e, variable, from, env);
    if (closedForm !== null) return closedForm;
    return sumSeriesNumeric(e, variable, from, env);
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
    case "cmp":
      rule = "Comparison Rule (locally constant)";
      result = num(0);
      break;
    case "piecewise":
      rule = "Piecewise Rule (branch-wise)";
      result = piecewise(
        e.branches.map((br) => ({ cond: br.cond, expr: diffTraced(br.expr, x, steps) })),
        diffTraced(e.otherwise, x, steps),
      );
      break;
    case "sum":
      // Mechanical by linearity: differentiate the body, keep the bound
      // variable/bounds unchanged. NON-GOAL: a differentiation variable
      // that happens to share a name with e.variable (a bound-variable
      // shadowing collision) isn't specially detected -- same class of
      // edge case as any other variable shadowing in this file.
      rule = "Sum Rule (Σ, term-wise by linearity)";
      result = sumExpr(e.variable, e.from, e.to, diffTraced(e.body, x, steps));
      break;
    case "product":
      throw new ProductNotDifferentiableError();
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
      const binaryName = e.name;
      switch (binaryName) {
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
      throw new Error(`Unhandled binary function: ${binaryName}`);
    }
    case "cmp":
      return num(0);
    case "piecewise":
      return piecewise(
        e.branches.map((br) => ({ cond: br.cond, expr: diff(br.expr, x) })),
        diff(e.otherwise, x),
      );
    case "sum":
      return sumExpr(e.variable, e.from, e.to, diff(e.body, x));
    case "product":
      throw new ProductNotDifferentiableError();
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
  // Early returns (not switch cases below) for "cmp"/"piecewise" -- the
  // generic `(e as {left:Expr}).left` extraction a few lines down silently
  // no-ops for "cmp" (falls through to `return e`, discarding the simplified
  // children) and would crash at runtime for "piecewise" (no `.left` at
  // all), since neither is caught by the trailing `switch (e.type)` either.
  if (e.type === "cmp") {
    const l = simplifyOnce(e.left);
    const r = simplifyOnce(e.right);
    if (l.type === "const" && r.type === "const") return num(CMP_IMPLS[e.op](l.value, r.value) ? 1 : 0);
    return cmp(e.op, l, r);
  }
  if (e.type === "piecewise") {
    return piecewise(
      e.branches.map((br) => ({ cond: simplifyOnce(br.cond), expr: simplifyOnce(br.expr) })),
      simplifyOnce(e.otherwise),
    );
  }
  if (e.type === "sum") return sumExpr(e.variable, simplifyOnce(e.from), simplifyOnce(e.to), simplifyOnce(e.body));
  if (e.type === "product") {
    return productExpr(e.variable, simplifyOnce(e.from), simplifyOnce(e.to), simplifyOnce(e.body));
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
    case "cmp": {
      const bb = b as typeof a;
      return a.op === bb.op && equal(a.left, bb.left) && equal(a.right, bb.right);
    }
    case "piecewise": {
      const bb = b as typeof a;
      return (
        a.branches.length === bb.branches.length &&
        a.branches.every((br, i) => equal(br.cond, bb.branches[i].cond) && equal(br.expr, bb.branches[i].expr)) &&
        equal(a.otherwise, bb.otherwise)
      );
    }
    case "sum":
    case "product": {
      const bb = b as typeof a;
      return a.variable === bb.variable && equal(a.from, bb.from) && equal(a.to, bb.to) && equal(a.body, bb.body);
    }
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
    case "cmp":
      return cmp(e.op, subst(e.left, name, r), subst(e.right, name, r));
    case "piecewise":
      return piecewise(
        e.branches.map((br) => ({ cond: subst(br.cond, name, r), expr: subst(br.expr, name, r) })),
        subst(e.otherwise, name, r),
      );
    case "sum":
    case "product": {
      // Capture-avoidance: e.variable is bound within e.body, so a
      // substitution targeting that same name must not reach inside it --
      // only from/to (and body, when name differs from the bound variable)
      // are substituted.
      const from = subst(e.from, name, r);
      const to = subst(e.to, name, r);
      const body = e.variable === name ? e.body : subst(e.body, name, r);
      return e.type === "sum" ? sumExpr(e.variable, from, to, body) : productExpr(e.variable, from, to, body);
    }
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
    case "cmp":
      return cmp(e.op, expandOnce(e.left), expandOnce(e.right));
    case "piecewise":
      return piecewise(
        e.branches.map((br) => ({ cond: expandOnce(br.cond), expr: expandOnce(br.expr) })),
        expandOnce(e.otherwise),
      );
    case "sum":
      return sumExpr(e.variable, expandOnce(e.from), expandOnce(e.to), expandOnce(e.body));
    case "product":
      return productExpr(e.variable, expandOnce(e.from), expandOnce(e.to), expandOnce(e.body));
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
    case "cmp":
      return cmp(e.op, collectLikeTerms(e.left), collectLikeTerms(e.right));
    case "piecewise":
      return piecewise(
        e.branches.map((br) => ({ cond: collectLikeTerms(br.cond), expr: collectLikeTerms(br.expr) })),
        collectLikeTerms(e.otherwise),
      );
    case "sum":
      return sumExpr(e.variable, collectLikeTerms(e.from), collectLikeTerms(e.to), collectLikeTerms(e.body));
    case "product":
      return productExpr(e.variable, collectLikeTerms(e.from), collectLikeTerms(e.to), collectLikeTerms(e.body));
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
function integRules(e: Expr, x: string): Expr {
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

// -- u-substitution (fallback when integRules can't find a direct rule) ----

/** Structural "does e contain target as an exact subtree" check, via {@link equal}. */
function containsExpr(e: Expr, target: Expr): boolean {
  if (equal(e, target)) return true;
  switch (e.type) {
    case "const":
    case "var":
      return false;
    case "neg":
      return containsExpr(e.arg, target);
    case "func":
      return containsExpr(e.arg, target);
    case "pow":
      return containsExpr(e.base, target) || containsExpr(e.exp, target);
    case "piecewise":
      return (
        e.branches.some((br) => containsExpr(br.cond, target) || containsExpr(br.expr, target)) ||
        containsExpr(e.otherwise, target)
      );
    // sum/product aren't u-substitution candidates or targets (integration
    // over them isn't supported -- see integRules's default case), so no
    // structural descent is needed beyond the equal() check above.
    case "sum":
    case "product":
      return false;
    default:
      return containsExpr(e.left, target) || containsExpr(e.right, target);
  }
}

/**
 * Structural subexpression replacement -- distinct from {@link subst}, which
 * only replaces a *named variable*, not an arbitrary subtree.
 */
function substExpr(e: Expr, target: Expr, replacement: Expr): Expr {
  if (equal(e, target)) return replacement;
  switch (e.type) {
    case "const":
    case "var":
      return e;
    case "neg":
      return neg(substExpr(e.arg, target, replacement));
    case "func":
      return fn(e.name, substExpr(e.arg, target, replacement));
    case "pow":
      return pow(substExpr(e.base, target, replacement), substExpr(e.exp, target, replacement));
    case "piecewise":
      return piecewise(
        e.branches.map((br) => ({
          cond: substExpr(br.cond, target, replacement),
          expr: substExpr(br.expr, target, replacement),
        })),
        substExpr(e.otherwise, target, replacement),
      );
    // Not a substitution target (see containsExpr above) -- returned as-is.
    case "sum":
    case "product":
      return e;
    default:
      return { ...e, left: substExpr(e.left, target, replacement), right: substExpr(e.right, target, replacement) };
  }
}

/** Flatten a chain of `mul` nodes into its (unordered) list of factors. */
function flattenFactors(e: Expr): Expr[] {
  if (e.type === "mul") return [...flattenFactors(e.left), ...flattenFactors(e.right)];
  return [e];
}

/**
 * Attempts `e / divisor` by canceling matching multiplicative factors
 * directly (structural match via {@link equal}, plus numeric-coefficient
 * division) -- {@link simplifyOnce}'s `div` case has no general polynomial-
 * factor cancellation for products, so `simplify(div(e, divisor))` alone
 * would never collapse e.g. `(2·x·sin(x²))/(2·x)` down to `sin(x²)`. Returns
 * `null` if `divisor`'s symbolic factors aren't all found in `e`'s.
 */
function divideOutFactors(e: Expr, divisor: Expr): Expr | null {
  let eNumeric = 1;
  const eSymbolic: Expr[] = [];
  for (const f of flattenFactors(e)) {
    if (f.type === "const") eNumeric *= f.value;
    else eSymbolic.push(f);
  }
  let dNumeric = 1;
  const dSymbolic: Expr[] = [];
  for (const f of flattenFactors(divisor)) {
    if (f.type === "const") dNumeric *= f.value;
    else dSymbolic.push(f);
  }
  if (dNumeric === 0) return null;
  for (const df of dSymbolic) {
    const idx = eSymbolic.findIndex((ef) => equal(ef, df));
    if (idx === -1) return null;
    eSymbolic.splice(idx, 1);
  }
  const coeff = eNumeric / dNumeric;
  const factors = coeff === 1 ? eSymbolic : [num(coeff), ...eSymbolic];
  if (factors.length === 0) return num(coeff);
  return factors.reduce((acc, f) => (acc ? mul(acc, f) : f)) as Expr;
}

/**
 * Heuristic search for candidate "inner functions" g(x) for u-substitution:
 * function-call arguments, call2 operands, and pow base/exponent -- the
 * classic "spot the inner function" spots -- rather than every subexpression,
 * to keep this fast and avoid pathological false-positive matches. Dedupes
 * structurally-equal candidates and drops the trivial "g(x) = x" candidate.
 */
function collectSubstitutionCandidates(e: Expr, x: string): Expr[] {
  const found: Expr[] = [];
  const visit = (node: Expr) => {
    switch (node.type) {
      case "const":
      case "var":
        return;
      case "neg":
        visit(node.arg);
        return;
      case "func":
        if (containsVar(node.arg, x)) found.push(node.arg);
        visit(node.arg);
        return;
      case "pow":
        if (containsVar(node.base, x)) found.push(node.base);
        if (containsVar(node.exp, x)) found.push(node.exp);
        visit(node.base);
        visit(node.exp);
        return;
      case "call2":
        if (containsVar(node.left, x)) found.push(node.left);
        if (containsVar(node.right, x)) found.push(node.right);
        visit(node.left);
        visit(node.right);
        return;
      case "piecewise":
        for (const br of node.branches) {
          visit(br.cond);
          visit(br.expr);
        }
        visit(node.otherwise);
        return;
      // Not a u-substitution candidate site (see containsExpr above).
      case "sum":
      case "product":
        return;
      default:
        visit(node.left);
        visit(node.right);
        return;
    }
  };
  visit(e);
  const unique: Expr[] = [];
  for (const c of found) {
    if (c.type === "var" && c.name === x) continue;
    if (!unique.some((u) => equal(u, c))) unique.push(c);
  }
  return unique;
}

/** A variable name that appears nowhere in `e` and isn't `x` itself, for a temporary substitution variable. */
function freshVariableName(e: Expr, x: string): string {
  let name = "u";
  let i = 2;
  while (name === x || containsVar(e, name)) name = `u${i++}`;
  return name;
}

/**
 * Defensive safety net for the heuristic u-substitution search below: confirm
 * that `d/dx candidate` actually matches the original integrand `e` at a
 * handful of probe points (same probe-point convention as
 * {@link polynomialCoeffs}), rather than ever trusting the substitution
 * blindly. Requires agreement at at least 2 of the 3 probe points (some may
 * legitimately hit a domain error/NaN on either side).
 */
function verifyByDifferentiation(candidate: Expr, e: Expr, x: string): boolean {
  const check = Symbolic.simplify(diff(candidate, x));
  let agreements = 0;
  for (const p of [0.7, 1.3, -0.9]) {
    const expected = evalExpr(e, { [x]: p });
    const actual = evalExpr(check, { [x]: p });
    if (!Number.isFinite(expected) || !Number.isFinite(actual)) continue;
    if (Math.abs(actual - expected) > 1e-6 * Math.max(1, Math.abs(expected))) return false;
    agreements++;
  }
  return agreements >= 2;
}

/**
 * Attempts to integrate `e` w.r.t. `x` via u-substitution: searches for a
 * candidate inner function g(x) such that `e = h(g(x))·g'(x)` for some `h`,
 * and if found, integrates `h(u)` and substitutes `g(x)` back in. Only a
 * single level of substitution is attempted for the transformed `h(u)`
 * problem (calls {@link integRules} directly, not {@link integ}, so this
 * doesn't recurse into another substitution attempt on the same
 * sub-problem); if multiple candidates verify successfully, the first one
 * found wins. Returns `null` (never throws) if no candidate works out, so
 * the caller can fall back to the original `NotIntegrableError`.
 */
function tryUSubstitution(e: Expr, x: string): Expr | null {
  for (const g of collectSubstitutionCandidates(e, x)) {
    const gPrime = Symbolic.simplify(diff(g, x));
    if (isConst(gPrime, 0)) continue;
    const quotient = Symbolic.simplify(divideOutFactors(e, gPrime) ?? div(e, gPrime));
    if (!containsExpr(quotient, g)) continue;
    const uName = freshVariableName(quotient, x);
    const substituted = substExpr(quotient, g, v(uName));
    if (containsVar(substituted, x)) continue;
    try {
      const antiderivativeInU = integRules(substituted, uName);
      const candidate = Symbolic.simplify(substExpr(antiderivativeInU, v(uName), g));
      if (verifyByDifferentiation(candidate, e, x)) return candidate;
    } catch (err) {
      if (!(err instanceof NotIntegrableError)) throw err;
    }
  }
  return null;
}

/**
 * Best-effort numeric detector for a pole strictly inside `(lower, upper)`
 * (used by {@link Symbolic.integrateDefinite}). Distinguishes a genuine
 * pole from a legitimate-but-steep bounded peak (e.g. a narrow Gaussian) by
 * repeatedly zooming a sampling window in on the current sample-max and
 * checking whether the observed maximum keeps growing as the window
 * narrows: near a true `1/(x-c)`-style singularity the maximum keeps
 * roughly multiplying each zoom-in pass (it grows as 1/distance-to-pole,
 * and each pass shrinks that distance by a consistent factor), whereas a
 * bounded peak's maximum converges and stops growing once the window is
 * smaller than the peak's own width. A single fixed-resolution sampling
 * pass can't tell these apart on its own -- a steep peak and a nearby-but-
 * finite sample near a pole can look identical at one resolution.
 *
 * Deliberately excludes a small margin (1% of the interval width) at each
 * end from every pass's sampling and zoom range -- an *endpoint* singularity
 * (e.g. `1/sqrt(x)` from 0 to 1) is the classic convergent improper
 * integral of the first kind, a legitimate and common case the
 * "`lower`/`upper` themselves" NON-GOAL wording deliberately excludes, and
 * without this margin the zoom would immediately walk right up to the
 * endpoint and flag it as if it were interior.
 *
 * NON-GOAL: this is a bounded-effort heuristic (6 zoom passes, 64 samples
 * each), not an analytic proof -- a sufficiently narrow singularity that
 * the first pass's coarse grid steps entirely over (landing nowhere near
 * it) can still be missed, since each pass zooms toward the *current*
 * sample-max rather than searching the whole interval again.
 */
function hasInteriorSingularity(f: (x: number) => number, lower: number, upper: number): boolean {
  const lo = Math.min(lower, upper);
  const hi = Math.max(lower, upper);
  const margin = (hi - lo) * 0.01;
  let a = lo + margin;
  let b = hi - margin;
  const SAMPLES = 64;
  let prevMax = -Infinity;
  for (let pass = 0; pass < 6; pass++) {
    let maxAbs = -Infinity;
    let argmax = (a + b) / 2;
    for (let i = 1; i < SAMPLES; i++) {
      const x = a + (i / SAMPLES) * (b - a);
      const y = f(x);
      if (!Number.isFinite(y)) return true;
      const m = Math.abs(y);
      if (m > maxAbs) {
        maxAbs = m;
        argmax = x;
      }
    }
    if (pass > 0 && maxAbs > prevMax * 4) return true;
    prevMax = maxAbs;
    const width = (b - a) / SAMPLES;
    a = Math.max(lo + margin, argmax - width * 2);
    b = Math.min(hi - margin, argmax + width * 2);
    if (b - a < 1e-9) return true;
  }
  return false;
}

/**
 * Symbolic anti-derivative dispatcher: tries the elementary rules in
 * {@link integRules} first, falling back to one attempt at
 * {@link tryUSubstitution} when those rules throw {@link NotIntegrableError}.
 */
function integ(e: Expr, x: string): Expr {
  try {
    return integRules(e, x);
  } catch (err) {
    if (!(err instanceof NotIntegrableError)) throw err;
    const bySubstitution = tryUSubstitution(e, x);
    if (bySubstitution) return bySubstitution;
    throw err;
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

// -- series/summation --------------------------------------------------------

/**
 * Recognizes `e` as a geometric series term `coeff · base^(a·variable + b)`
 * (`coeff` and `base` constant w.r.t. `variable`; `coeff` defaults to 1 if
 * `e` is a bare `pow` node). Reuses {@link linearCoeffs} on the exponent, so
 * shifted/scaled exponents are handled too (e.g. `r^(2n+1)` is still
 * geometric, with ratio `r^2`). Returns the closed-form sum
 * `Σ_{k=from}^∞ coeff·base^(a·k+b)` if it converges (`|base^a| < 1`), else
 * `null` (not recognized as geometric, or doesn't converge).
 */
function tryGeometricSeriesClosedForm(
  e: Expr,
  variable: string,
  from: number,
  env: Record<string, number>,
): number | null {
  let coeff = 1;
  let powNode = e;
  if (e.type === "mul") {
    if (!containsVar(e.left, variable) && e.right.type === "pow") {
      coeff = evalExpr(e.left, env);
      powNode = e.right;
    } else if (!containsVar(e.right, variable) && e.left.type === "pow") {
      coeff = evalExpr(e.right, env);
      powNode = e.left;
    } else {
      return null;
    }
  } else if (e.type !== "pow") {
    return null;
  }
  if (powNode.type !== "pow" || containsVar(powNode.base, variable)) return null;
  const lin = linearCoeffs(powNode.exp, variable);
  if (!lin) return null;
  const base = evalExpr(powNode.base, env);
  const ratio = base ** lin.a;
  if (!Number.isFinite(ratio) || Math.abs(ratio) >= 1) return null;
  const firstExponent = lin.a * from + lin.b;
  const firstTerm = coeff * base ** firstExponent;
  return firstTerm / (1 - ratio);
}

/**
 * Numeric partial-sum fallback for {@link Symbolic.sumSeries} when no closed
 * form is recognized: sums terms until several consecutive terms fall below
 * a tolerance relative to the running total. If that per-term check alone
 * doesn't confirm convergence within the term budget, tries
 * {@link estimateConvergentTail} on the remainder before throwing
 * {@link SeriesDivergesError} -- which still throws if the terms are
 * visibly growing instead of shrinking, or if neither check confirms
 * convergence.
 */
function sumSeriesNumeric(e: Expr, variable: string, from: number, env: Record<string, number>): number {
  const f = compileExpr(e);
  const tolerance = 1e-12;
  const maxTerms = 200_000;
  let total = 0;
  let consecutiveSmall = 0;
  let firstTermMag = 0;
  for (let i = 0; i < maxTerms; i++) {
    const k = from + i;
    const term = f({ ...env, [variable]: k });
    if (!Number.isFinite(term)) throw new SeriesDivergesError(`sumSeries: term at index ${k} is not finite.`);
    if (i === 0) firstTermMag = Math.abs(term) || 1;
    total += term;
    if (Math.abs(term) < tolerance * Math.max(1, Math.abs(total))) {
      consecutiveSmall++;
      if (consecutiveSmall >= 5) return total;
    } else {
      consecutiveSmall = 0;
    }
    if (i > 100 && Math.abs(term) > firstTermMag * 10) {
      throw new SeriesDivergesError(
        "sumSeries: terms are growing (not shrinking toward 0) -- the series appears to diverge.",
      );
    }
  }
  const tail = estimateConvergentTail((x: number) => f({ ...env, [variable]: x }), from + maxTerms);
  if (tail !== null) return total + tail;
  throw new SeriesDivergesError(
    `sumSeries: did not converge to within tolerance after ${maxTerms} terms -- the series may converge too slowly to sum numerically, or may not converge at all.`,
  );
}

/**
 * Integral-test tail estimate for `Σ_{k=start}^∞ f(k)`, used by
 * {@link sumSeriesNumeric} once the per-term stopping rule alone can't
 * confirm convergence within its term budget (the case a per-term check
 * structurally can't handle: a polynomially-decaying tail like `1/n^2`,
 * where individual terms shrink far slower than any fixed tolerance
 * requires, even though the tail itself is provably small).
 *
 * Estimates the tail by numerically integrating `f` over successively
 * doubling intervals `[start, 2·start], [2·start, 4·start], ...` (each via
 * {@link Numerical.adaptiveSimpson}) and accumulating them, rather than
 * attempting one improper integral to infinity. This doubling scheme is
 * itself the confirmation of convergence, not just a computation of the
 * answer: for `f(x) ~ C/x^p` with `p > 1`, each doubling's integral
 * contribution shrinks geometrically (by a factor of `2^(p-1)`) as the
 * interval moves outward, so the increments visibly shrinking toward zero
 * *is* the integral test passing; for a genuinely divergent tail (e.g.
 * `f(x) = 1/x`, harmonic), each doubling contributes very close to the same
 * amount (`∫ 1/x dx` over `[N, 2N]` is `ln 2` regardless of `N`) and never
 * shrinks, so the loop exhausts its budget and returns `null` -- the
 * existing divergence behavior for that case is unchanged.
 *
 * Returns `null` (never a wrong number) whenever the tail can't be
 * confirmed convergent, so the caller falls through to its own
 * `SeriesDivergesError`.
 */
function estimateConvergentTail(f: (x: number) => number, start: number): number | null {
  let lo = start;
  let width = Math.max(1, start);
  let tail = 0;
  let prevIncrement = Number.POSITIVE_INFINITY;
  const MAX_DOUBLINGS = 40;
  for (let d = 0; d < MAX_DOUBLINGS; d++) {
    const hi = lo + width;
    const increment = Numerical.adaptiveSimpson(f, lo, hi);
    if (!Number.isFinite(increment)) return null;
    tail += increment;
    if (d > 5 && Math.abs(increment) > Math.abs(prevIncrement) * 1.5) return null; // growing, not shrinking -- doesn't confirm convergence
    if (Math.abs(increment) < 1e-13 * Math.max(1, Math.abs(tail)) && d > 2) return tail;
    prevIncrement = increment;
    lo = hi;
    width *= 2;
  }
  return null;
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
    case "cmp":
      return CMP_IMPLS[e.op](evalExpr(e.left, env), evalExpr(e.right, env)) ? 1 : 0;
    case "piecewise": {
      for (const br of e.branches) {
        if (evalExpr(br.cond, env) !== 0) return evalExpr(br.expr, env);
      }
      return evalExpr(e.otherwise, env);
    }
    case "sum":
      return evalSum(e, env);
    case "product":
      return evalProduct(e, env);
  }
}

/**
 * Delegates entirely to {@link Symbolic.sumSeries}'s existing finite-loop /
 * geometric-closed-form / numeric-tail-convergence logic (`to` may be
 * `Infinity`, same convention `sumSeries` itself uses for an infinite
 * series) -- shared by {@link evalExpr} and {@link compileExpr} so neither
 * reimplements it.
 */
function evalSum(e: Extract<Expr, { type: "sum" }>, env: Record<string, number>): number {
  const from = Math.round(evalExpr(e.from, env));
  const to = evalExpr(e.to, env);
  return Symbolic.sumSeries(e.body, from, Number.isFinite(to) ? Math.round(to) : to, e.variable, env);
}

/**
 * Unlike {@link evalSum}, an infinite product's convergence isn't handled --
 * v1 only supports finite bounds (mirrors {@link ProductNotDifferentiableError}'s
 * scope note on `differentiate`). Shared by {@link evalExpr} and {@link compileExpr}.
 */
function evalProduct(e: Extract<Expr, { type: "product" }>, env: Record<string, number>): number {
  const from = Math.round(evalExpr(e.from, env));
  const to = evalExpr(e.to, env);
  if (!Number.isFinite(to)) throw new Error("product (Π): only finite upper bounds are supported.");
  const roundedTo = Math.round(to);
  if (from > roundedTo) return 1; // empty product
  const f = compileExpr(e.body);
  let total = 1;
  for (let k = from; k <= roundedTo; k++) total *= f({ ...env, [e.variable]: k });
  return total;
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

const CMP_IMPLS: Record<CmpOp, (a: number, b: number) => boolean> = {
  lt: (a, b) => a < b,
  le: (a, b) => a <= b,
  gt: (a, b) => a > b,
  ge: (a, b) => a >= b,
  eq: (a, b) => a === b,
  ne: (a, b) => a !== b,
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
    case "cmp": {
      const l = compileExpr(e.left);
      const r = compileExpr(e.right);
      const impl = CMP_IMPLS[e.op];
      return (env) => (impl(l(env), r(env)) ? 1 : 0);
    }
    case "piecewise": {
      const branches = e.branches.map((br) => ({ cond: compileExpr(br.cond), expr: compileExpr(br.expr) }));
      const otherwise = compileExpr(e.otherwise);
      return (env) => {
        for (const br of branches) {
          if (br.cond(env) !== 0) return br.expr(env);
        }
        return otherwise(env);
      };
    }
    // Not pre-compiled further -- evalSum/evalProduct each recompile the body
    // per call via Symbolic.sumSeries/compileExpr(e.body), matching evalExpr's
    // own approach (this is a rare node type, not the hot per-sample path
    // compile() is meant to speed up).
    case "sum":
      return (env) => evalSum(e, env);
    case "product":
      return (env) => evalProduct(e, env);
  }
}

// -- exact (Rational) and structure-aware evaluation -------------------------
// Moved here from mallory-graph's app-level rational-eval.ts/structure-eval.ts:
// these are generic "evaluate an Expr over an alternate algebra" utilities
// with no graphing-calculator-specific logic, so they belong alongside
// evalExpr/compileExpr where this file's own exhaustiveness checking keeps
// them in sync with new Expr variants automatically.

/** Maps a {@link Rational.compare} result (-1/0/1) to a truth value per {@link CmpOp}. */
const CMP_FROM_COMPARE: Record<CmpOp, (c: number) => boolean> = {
  lt: (c) => c < 0,
  le: (c) => c <= 0,
  gt: (c) => c > 0,
  ge: (c) => c >= 0,
  eq: (c) => c === 0,
  ne: (c) => c !== 0,
};

function evalExprExact(e: Expr, env: Record<string, Rational>): Rational {
  switch (e.type) {
    case "const":
      return Rational.fromNumber(e.value);
    case "var": {
      const value = env[e.name];
      if (!value) throw new Error(`No exact value bound for "${e.name}"`);
      return value;
    }
    case "add":
      return evalExprExact(e.left, env).add(evalExprExact(e.right, env));
    case "sub":
      return evalExprExact(e.left, env).subtract(evalExprExact(e.right, env));
    case "mul":
      return evalExprExact(e.left, env).multiply(evalExprExact(e.right, env));
    case "div":
      return evalExprExact(e.left, env).divide(evalExprExact(e.right, env));
    case "pow": {
      const exponent = evalExprExact(e.exp, env);
      if (exponent.denominator !== 1n) throw new Error("Exact pow requires an integer exponent");
      return evalExprExact(e.base, env).pow(Number(exponent.numerator));
    }
    case "neg":
      return evalExprExact(e.arg, env).negate();
    case "func":
      throw new Error(`"${e.name}" is not exactly representable as a Rational`);
    case "call2":
      throw new Error(`"${e.name}" is not exactly representable as a Rational`);
    case "cmp": {
      const l = evalExprExact(e.left, env);
      const r = evalExprExact(e.right, env);
      const truth = CMP_FROM_COMPARE[e.op](l.compare(r));
      return truth ? Rational.One : Rational.Zero;
    }
    case "piecewise": {
      for (const branch of e.branches) {
        if (!evalExprExact(branch.cond, env).isZero()) return evalExprExact(branch.expr, env);
      }
      return evalExprExact(e.otherwise, env);
    }
    case "sum":
      throw new Error("sum (Σ) is not exactly representable as a Rational");
    case "product":
      throw new Error("product (Π) is not exactly representable as a Rational");
  }
}

const ORDERING_CMP_OPS = new Set<CmpOp>(["lt", "le", "gt", "ge"]);

function evalExprOverStructure<T>(e: Expr, structure: Structure<T>, env: Record<string, T>): T {
  switch (e.type) {
    case "const":
      return structure.wrap(e.value);
    case "var": {
      const value = env[e.name];
      if (value === undefined) throw new Error(`No value bound for "${e.name}"`);
      return structure.wrap(value);
    }
    case "add":
      return structure.add(
        evalExprOverStructure(e.left, structure, env),
        evalExprOverStructure(e.right, structure, env),
      );
    case "sub":
      return structure.subtract(
        evalExprOverStructure(e.left, structure, env),
        evalExprOverStructure(e.right, structure, env),
      );
    case "mul":
      return structure.multiply(
        evalExprOverStructure(e.left, structure, env),
        evalExprOverStructure(e.right, structure, env),
      );
    case "div":
      return structure.divide(
        evalExprOverStructure(e.left, structure, env),
        evalExprOverStructure(e.right, structure, env),
      );
    case "pow": {
      if (e.exp.type !== "const" || !Number.isInteger(e.exp.value)) {
        throw new Error("Structure-aware pow requires a literal integer exponent");
      }
      return structure.multiplyPower(evalExprOverStructure(e.base, structure, env), e.exp.value);
    }
    case "neg":
      return structure.negative(evalExprOverStructure(e.arg, structure, env));
    case "func":
      throw new Error(`"${e.name}" has no meaning over this structure`);
    case "call2":
      throw new Error(`"${e.name}" has no meaning over this structure`);
    case "cmp": {
      if (ORDERING_CMP_OPS.has(e.op)) {
        throw new Error(`Ordering comparisons ("${e.op}") have no general meaning over this structure`);
      }
      const l = evalExprOverStructure(e.left, structure, env);
      const r = evalExprOverStructure(e.right, structure, env);
      const equal = structure.equality(l, r);
      const truth = e.op === "eq" ? equal : !equal;
      return truth ? structure.one : structure.zero;
    }
    case "piecewise": {
      for (const branch of e.branches) {
        const condValue = evalExprOverStructure(branch.cond, structure, env);
        if (!structure.equality(condValue, structure.zero)) {
          return evalExprOverStructure(branch.expr, structure, env);
        }
      }
      return evalExprOverStructure(e.otherwise, structure, env);
    }
    case "sum":
      throw new Error("sum (Σ) has no general meaning over this structure");
    case "product":
      throw new Error("product (Π) has no general meaning over this structure");
  }
}

// -- rendering --------------------------------------------------------------
const PREC: Record<string, number> = { add: 1, sub: 1, mul: 2, div: 2, neg: 3, pow: 4, cmp: 0 };
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
    case "cmp": {
      const opStr = CMP_OP_TEXT[e.op];
      return wrap(`${render(e.left, PREC.cmp + 1)}${opStr}${render(e.right, PREC.cmp + 1)}`, PREC.cmp, parentPrec);
    }
    case "piecewise": {
      const parts = e.branches.map((br) => `${render(br.cond, 0)}, ${render(br.expr, 0)}`);
      return `piecewise(${parts.join(", ")}, ${render(e.otherwise, 0)})`;
    }
    case "sum":
      return `sum(${e.variable}, ${render(e.from, 0)}, ${render(e.to, 0)}, ${render(e.body, 0)})`;
    case "product":
      return `product(${e.variable}, ${render(e.from, 0)}, ${render(e.to, 0)}, ${render(e.body, 0)})`;
  }
}
const wrap = (s: string, prec: number, parentPrec: number): string => (prec < parentPrec ? `(${s})` : s);

/** Plain-text infix spelling for each `CmpOp`, matching what the parser's `comparison()` tier accepts. */
const CMP_OP_TEXT: Record<CmpOp, string> = { lt: "<", le: "<=", gt: ">", ge: ">=", eq: "==", ne: "!=" };

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
    case "cmp": {
      const latexOp = CMP_OP_LATEX[e.op];
      return wrap(
        `${toLatexRec(e.left, PREC.cmp + 1)} ${latexOp} ${toLatexRec(e.right, PREC.cmp + 1)}`,
        PREC.cmp,
        parentPrec,
      );
    }
    case "piecewise": {
      // \begin{cases} is self-delimiting -- never needs outer parens, same as \frac.
      // No space directly after the "\\" row separator: latexToInfix's
      // cleaning regex (which strips LaTeX spacing commands like `\ `) would
      // otherwise eat the second backslash, seeing "\<space>" and mangling
      // the separator down to a single backslash -- verified empirically.
      const rows = e.branches.map((br) => `${toLatexRec(br.expr, 0)} & ${toLatexRec(br.cond, 0)}`);
      rows.push(`${toLatexRec(e.otherwise, 0)} & \\text{otherwise}`);
      return `\\begin{cases}${rows.join("\\\\")}\\end{cases}`;
    }
    // \sum_{}^{}/\prod_{}^{} are self-delimiting via their sub/superscript,
    // same as \frac/\begin{cases} above -- never need outer parens.
    case "sum":
      return `\\sum_{${e.variable}=${toLatexRec(e.from, 0)}}^{${toLatexRec(e.to, 0)}} ${toLatexRec(e.body, 0)}`;
    case "product":
      return `\\prod_{${e.variable}=${toLatexRec(e.from, 0)}}^{${toLatexRec(e.to, 0)}} ${toLatexRec(e.body, 0)}`;
  }
}

/** LaTeX symbol for each `CmpOp`. */
const CMP_OP_LATEX: Record<CmpOp, string> = { lt: "<", le: "\\leq", gt: ">", ge: "\\geq", eq: "=", ne: "\\neq" };

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

/** Split `s` on top-level occurrences of a (possibly multi-char) separator, ignoring ones nested inside `{}`/`()`/`[]`. */
function splitTopLevelOn(s: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "{" || ch === "(" || ch === "[") depth++;
    else if (ch === "}" || ch === ")" || ch === "]") depth--;
    else if (depth === 0 && s.startsWith(sep, i)) {
      parts.push(s.slice(start, i));
      start = i + sep.length;
      i += sep.length - 1;
    }
  }
  parts.push(s.slice(start));
  return parts;
}

/** LaTeX command spellings for comparison operators, mapped to the plain-infix text {@link Parser.matchCmpOp} understands. */
const CMP_LATEX_CMDS: Record<string, string> = {
  "\\leq": "<=",
  "\\le": "<=",
  "\\geq": ">=",
  "\\ge": ">=",
  "\\neq": "!=",
  "\\ne": "!=",
};

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
      const cmpText = CMP_LATEX_CMDS[cmd];
      if (cmpText) {
        out += cmpText;
        continue;
      }
      if (cmd === "\\begin") {
        const envName = readGroup();
        if (envName !== "cases") throw new Error(`Unsupported LaTeX environment: \\begin{${envName}}`);
        const endMarker = "\\end{cases}";
        const endIdx = s.indexOf(endMarker, i);
        if (endIdx === -1) throw new Error("Unmatched \\begin{cases} in LaTeX source");
        const body = s.slice(i, endIdx);
        i = endIdx + endMarker.length;
        const rows = splitTopLevelOn(body, "\\\\");
        const parts: string[] = [];
        let otherwise: string | null = null;
        for (const row of rows) {
          if (row.trim() === "") continue;
          const cols = splitTopLevelOn(row, "&");
          if (cols.length !== 2) throw new Error(`Expected 'expr & cond' in \\begin{cases} row: ${row}`);
          const [exprPart, condPart] = cols;
          if (condPart.trim() === "\\text{otherwise}") {
            if (otherwise !== null) throw new Error("\\begin{cases} may have only one \\text{otherwise} row");
            otherwise = transformLatex(exprPart);
          } else {
            parts.push(`${transformLatex(condPart)}, ${transformLatex(exprPart)}`);
          }
        }
        if (otherwise === null) {
          throw new Error("\\begin{cases} must have exactly one \\text{otherwise} row (as its last row)");
        }
        out += `piecewise(${parts.concat(otherwise).join(", ")})`;
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
    if (ch === "=") {
      // toLatexRec's "eq" case emits a bare "=" (standard LaTeX), but the
      // parser's comparison() requires 2 chars ("==") -- translate here so
      // toLatex/fromLatex round-trips for "eq".
      out += "==";
      i++;
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

// -- systems of linear equations --------------------------------------------

/**
 * If `eq` is linear in every name in `variables` (i.e. `eq = c1*v1 + ... +
 * cn*vn + constant`), returns `[c1, ..., cn, constant]`; otherwise `null`.
 * Linearity is checked by differentiating `eq` w.r.t. each variable and
 * confirming the derivative contains none of the system's variables (so it's
 * a true constant, not just constant-looking at the probe point).
 */
function linearCoeffsForSystem(eq: Expr, variables: string[]): number[] | null {
  const zeroEnv: Record<string, number> = {};
  for (const name of variables) zeroEnv[name] = 0;
  const constant = evalExpr(eq, zeroEnv);
  if (!Number.isFinite(constant)) return null;
  const coeffs: number[] = [];
  for (const name of variables) {
    const derivative = Symbolic.simplify(diff(eq, name));
    if (variables.some((other) => containsVar(derivative, other))) return null;
    const coeff = evalExpr(derivative, zeroEnv);
    if (!Number.isFinite(coeff)) return null;
    coeffs.push(coeff);
  }
  return [...coeffs, constant];
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
      // Simplify between successive L'Hopital differentiations -- otherwise
      // the expression tree grows without bound across iterations (each
      // product/quotient-rule application duplicates an undifferentiated
      // operand verbatim into the result) and a limit needing more than a
      // couple of rounds (e.g. most limits at infinity) blows up memory
      // long before the depth<12 cap is reached.
      const df = Symbolic.simplify(diff(e.left, x));
      const dg = Symbolic.simplify(diff(e.right, x));
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
    const e = this.comparison();
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

  /**
   * Comparisons bind loosest of all (below `+`/`-`), and are non-chaining --
   * `a < b < c` is not supported, only one comparison per level, matching
   * typical CAS grammars. 2-char operators (`<=`,`>=`,`==`,`!=`) need
   * lookahead before falling back to the 1-char `<`/`>` (no other multi-char
   * operator exists elsewhere in this grammar).
   */
  private comparison(): Expr {
    const left = this.expr();
    const op = this.matchCmpOp();
    if (!op) return left;
    return cmp(op, left, this.expr());
  }

  private matchCmpOp(): CmpOp | null {
    const CMP_TWO_CHAR: Record<string, CmpOp> = { "<=": "le", ">=": "ge", "==": "eq", "!=": "ne" };
    const two = this.s.slice(this.pos, this.pos + 2);
    const twoOp = CMP_TWO_CHAR[two];
    if (twoOp) {
      this.pos += 2;
      return twoOp;
    }
    if (this.peek() === "<") {
      this.pos++;
      return "lt";
    }
    if (this.peek() === ">") {
      this.pos++;
      return "gt";
    }
    return null;
  }

  /**
   * `piecewise(cond1, expr1, cond2, expr2, ..., otherwise)` -- alternating
   * (cond, expr) pairs plus a trailing `otherwise`, so an odd arg count >= 3
   * is required. Both cond and expr slots parse at `comparison()` level
   * (not the generic `argList()`/`expr()`) since cond slots need comparison
   * operators; `comparison()` gracefully degrades to plain `expr()` when no
   * `<`/`>`/etc. is found, so this is a strict superset with no downside for
   * the expr slots.
   */
  private piecewiseArgs(): Expr {
    const args: Expr[] = [this.comparison()];
    while (this.peek() === ",") {
      this.pos++;
      args.push(this.comparison());
    }
    if (this.peek() !== ")") throw new Error("Expected ')'");
    this.pos++;
    if (args.length < 3 || args.length % 2 === 0) {
      throw new Error(
        `piecewise() expects an odd number of arguments >= 3 (cond, expr, ..., otherwise), got ${args.length}`,
      );
    }
    const branches: { cond: Expr; expr: Expr }[] = [];
    for (let i = 0; i + 1 < args.length - 1; i += 2) branches.push({ cond: args[i], expr: args[i + 1] });
    return piecewise(branches, args[args.length - 1]);
  }

  /**
   * `sum(i, from, to, body)` / `product(i, from, to, body)` -- the bound
   * variable is a bare identifier (not a general expression, unlike the
   * other three slots), parsed directly off `this.s` rather than through
   * `comparison()`/`expr()`. `from`/`to`/`body` parse at `comparison()`
   * level, same rationale as `piecewiseArgs`.
   */
  private sumOrProductArgs(kind: "sum" | "product"): Expr {
    const idMatch = /^[a-zA-Z_]\w*/.exec(this.s.slice(this.pos));
    if (!idMatch) throw new Error(`${kind}() expects a bound variable name as its first argument`);
    const variable = idMatch[0];
    this.pos += variable.length;
    if (this.peek() !== ",") throw new Error("Expected ','");
    this.pos++;
    const from = this.comparison();
    if (this.peek() !== ",") throw new Error("Expected ','");
    this.pos++;
    const to = this.comparison();
    if (this.peek() !== ",") throw new Error("Expected ','");
    this.pos++;
    const body = this.comparison();
    if (this.peek() !== ")") throw new Error("Expected ')'");
    this.pos++;
    return kind === "sum" ? sumExpr(variable, from, to, body) : productExpr(variable, from, to, body);
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
      const e = this.comparison(); // comparison() (not expr()) so `(x<3)*5` parses
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
      if (name === "piecewise" && this.peek() === "(") {
        this.pos++;
        return this.piecewiseArgs();
      }
      if ((name === "sum" || name === "product") && this.peek() === "(") {
        this.pos++;
        return this.sumOrProductArgs(name);
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
