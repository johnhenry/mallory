/**
 * Symbolic — a small computer-algebra engine: an expression AST with parsing,
 * symbolic differentiation, algebraic simplification, basic symbolic
 * integration, Taylor expansion, and numeric evaluation.
 */

export type FuncName = "sin" | "cos" | "tan" | "exp" | "ln" | "sqrt";

export type Expr =
  | { type: "const"; value: number }
  | { type: "var"; name: string }
  | { type: "add"; left: Expr; right: Expr }
  | { type: "sub"; left: Expr; right: Expr }
  | { type: "mul"; left: Expr; right: Expr }
  | { type: "div"; left: Expr; right: Expr }
  | { type: "pow"; base: Expr; exp: Expr }
  | { type: "neg"; arg: Expr }
  | { type: "func"; name: FuncName; arg: Expr };

const FUNCS: FuncName[] = ["sin", "cos", "tan", "exp", "ln", "sqrt"];

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
      const next = simplifyOnce(e);
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
        result = mul(e, add(mul(diffTraced(e.exp, x, steps), fn("ln", e.base)), mul(e.exp, div(diffTraced(e.base, x, steps), e.base))));
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
      switch (e.name) {
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
    case "pow":
      return equal(a.base, (b as typeof a).base) && equal(a.exp, (b as typeof a).exp);
    default:
      return equal(a.left, (b as typeof a).left) && equal(a.right, (b as typeof a).right);
  }
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
      throw new NotIntegrableError();
    }
    case "div": {
      if (!containsVar(e.right, x)) return div(integ(e.left, x), e.right); // ∫ u/c
      // 1/x -> ln x
      if (isConst(e.left, 1) && e.right.type === "var" && e.right.name === x) return fn("ln", v(x));
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
      switch (e.name) {
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
      }
    }
  }
}

// -- compilation --------------------------------------------------------------
const FUNC_IMPLS: Record<FuncName, (x: number) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  exp: Math.exp,
  ln: Math.log,
  sqrt: Math.sqrt,
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
      if ((FUNCS as string[]).includes(name) && this.peek() === "(") {
        this.pos++;
        const arg = this.expr();
        if (this.peek() !== ")") throw new Error("Expected ')'");
        this.pos++;
        return fn(name as FuncName, arg);
      }
      if (name === "pi") return num(Math.PI);
      if (name === "e") return num(Math.E);
      return v(name);
    }
    throw new Error(`Unexpected token at ${this.pos}: ${this.s.slice(this.pos)}`);
  }
}
