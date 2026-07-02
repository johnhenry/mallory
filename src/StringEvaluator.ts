import { ComplexNumber } from "./ComplexNumber.ts";
import { Environment } from "./Environment.ts";
import { Expression } from "./Expression.ts";
import { SpecialOperator } from "./SpecialOperator.ts";
import { Vector } from "./Vector.ts";

/**
 * StringEvaluator — a small recursive evaluator for mathematical expression
 * strings such as `"3+4*2"`, `"sin(pi/2)"` or `"[1,2,3]"`. Ported from Mallory's
 * ActionScript `StringEvaluator`.
 *
 * Operator precedence follows the AS3 design (encoded by the internal operator
 * list order): `%` binds loosest, then `+`, `-`, `*`, `/`, and `^` binds tightest.
 *
 * Bug fixes from the AS3 original:
 *  - Associativity: the AS3 splitter was uniformly right-associative, so
 *    `10-2-3` evaluated as `10-(2-3)` and `8/4/2` as `8/(4/2)`. Non-power
 *    operators are now left-associative (`^` stays right-associative, as in
 *    standard notation).
 *  - The unresolved-parameter guard was dead code (`(p is String) is String`
 *    is always false); the intended symbolic passthrough is implemented, so an
 *    unbound `f(x)` returns the string `"f(x)"` instead of calling `f("x")`.
 */
export class StringEvaluator {
  /** Matches an acceptable variable/function name. */
  static readonly VarMatch = /[_a-zA-Z]+[_a-zA-Z0-9]*/g;

  private static readonly operatorList: SpecialOperator[] = [
    SpecialOperator.Modulous,
    SpecialOperator.Plus,
    SpecialOperator.Minus,
    SpecialOperator.Times,
    SpecialOperator.Divided,
    SpecialOperator.Power,
  ];

  /** Evaluate `expression` within `environment`. */
  static evaluate(expression: unknown, environment: Environment): unknown {
    if (typeof expression !== "string") return expression;

    const expr = expression.split("\r").join("").split(" ").join("");

    if (ComplexNumber.isComplex(expr)) return new ComplexNumber(expr);

    if (StringEvaluator.unSurroundOK(expr, "[", "]")) {
      return StringEvaluator.vectorEvaluate(StringEvaluator.unSurround(expr), environment);
    }

    if (StringEvaluator.unSurroundOK(expr, "(", ")")) {
      return StringEvaluator.evaluate(StringEvaluator.unSurround(expr), environment);
    }

    const pCount = StringEvaluator.countChar(expr, "(") - StringEvaluator.countChar(expr, ")");
    if (pCount > 0) return new Error(`Missing ${pCount} ')'.`);
    if (pCount < 0) return new Error(`Missing ${-pCount} '('.`);

    for (const op of StringEvaluator.operatorList) {
      const leftAssociative = op !== SpecialOperator.Power;
      const parts = StringEvaluator.splitBinary(expr, op.rep, leftAssociative);
      if (parts.length === 2) {
        return StringEvaluator.functionEvaluate(op.funct as string, parts, environment);
      }
    }

    const pPosition = expr.indexOf("(");
    if (pPosition > 0) {
      const functionName = expr.substr(0, pPosition);
      const args = StringEvaluator.seperateArray(expr.substr(pPosition + 1, expr.length - pPosition - 2));
      return StringEvaluator.functionEvaluate(functionName, args, environment);
    }

    return environment.retrieve(expr);
  }

  private static functionEvaluate(fName: string, parameters: unknown[], environment: Environment): unknown {
    const params = parameters.map((p) => StringEvaluator.evaluate(p, environment));

    if (!environment.existKey(fName)) return `${fName}(${params})`;

    const f = environment.retrieve(fName);

    if (f instanceof Environment) return f.retrieve(String(params[0]));

    // Symbolic passthrough for any still-unresolved (string) parameter.
    for (const p of params) {
      if (typeof p === "string" && p === StringEvaluator.evaluate(p, environment)) {
        return `${fName}(${params})`;
      }
    }

    if (f instanceof Expression) return f.evaluate(params, environment);

    if (typeof f === "function") return (f as (...a: unknown[]) => unknown)(...params);
    return f;
  }

  static vectorEvaluate(expression: string, environment: Environment): Vector<unknown> {
    const out = Vector.fromArray<unknown>(StringEvaluator.seperateArray(expression));
    for (let i = 0; i < out.length; i++) out[i] = StringEvaluator.evaluate(out[i], environment);
    return out;
  }

  // -- helpers -------------------------------------------------------------

  private static countChar(expression: string, char = " "): number {
    let count = 0;
    for (const c of expression) if (c === char) count++;
    return count;
  }

  private static isSurrounded(expression: string, leftBracket = "(", rightBracket = ")"): boolean {
    return expression.charAt(0) === leftBracket && expression.charAt(expression.length - 1) === rightBracket;
  }

  private static unSurroundOK(expression: string, leftBracket = "(", rightBracket = ")"): boolean {
    if (!StringEvaluator.isSurrounded(expression, leftBracket, rightBracket)) return false;
    const inner = expression.substring(1, expression.length - 1);
    // If the first inner closer precedes its opener, the brackets were not a pair.
    return inner.lastIndexOf(leftBracket) <= inner.lastIndexOf(rightBracket);
  }

  private static unSurround(expression: string): string {
    return expression.substring(1, expression.length - 1);
  }

  /** Split at top-level `splitter`s, rejoining pieces that fall inside brackets. */
  private static seperateArray(expression: string, splitter = ","): string[] {
    const exArray = expression.split(splitter);
    for (const [open, close] of [
      ["(", ")"],
      ["[", "]"],
      ["{", "}"],
    ] as const) {
      for (let i = 0; i < exArray.length - 1; i++) {
        if (
          StringEvaluator.countChar(exArray[i] as string, open) > StringEvaluator.countChar(exArray[i] as string, close)
        ) {
          exArray[i] = `${exArray[i]}${splitter}${exArray[i + 1]}`;
          exArray.splice(i + 1, 1);
          i--;
        }
      }
    }
    return exArray;
  }

  /**
   * Split an expression across the top-level occurrences of a binary operator
   * into `[left, right]`. Left-associative by default (split at the last
   * occurrence); right-associative (split at the first) when `leftAssociative`
   * is false, used for `^`.
   */
  private static splitBinary(expression: string, splitter = "+", leftAssociative = true): string[] {
    const pieces = StringEvaluator.seperateArray(expression, splitter);
    if (pieces.length <= 1) return pieces;
    if (leftAssociative) {
      const right = pieces[pieces.length - 1] as string;
      const left = pieces.slice(0, -1).join(splitter);
      return [left, right];
    }
    const left = pieces[0] as string;
    const right = pieces.slice(1).join(splitter);
    return [left, right];
  }

  /**
   * Build an {@link Environment} pre-populated with the arithmetic operators,
   * common {@link ComplexNumber} instance methods and the constants `pi`, `e`,
   * `i`, `phi` — enough to evaluate ordinary numeric expressions out of the box.
   */
  static mathEnvironment(): Environment {
    const env = new Environment();
    const cn = (x: unknown) => (x instanceof ComplexNumber ? x : new ComplexNumber(x as number));

    env.assignImmutable("add", (a: unknown, b: unknown) => cn(a).add(cn(b)));
    env.assignImmutable("subtract", (a: unknown, b: unknown) => cn(a).subtract(cn(b)));
    env.assignImmutable("multiply", (a: unknown, b: unknown) => cn(a).multiply(cn(b)));
    env.assignImmutable("divide", (a: unknown, b: unknown) => cn(a).divide(cn(b)));
    env.assignImmutable("power", (a: unknown, b: unknown) => cn(a).power(cn(b)));
    env.assignImmutable("mod", (a: unknown, b: unknown) => {
      const x = cn(a).value;
      const y = cn(b).value;
      return new ComplexNumber(((x % y) + y) % y, 0);
    });

    const unary: Record<string, (z: ComplexNumber) => ComplexNumber> = {
      sin: (z) => z.sine(),
      cos: (z) => z.cosine(),
      tan: (z) => z.tangent(),
      sqrt: (z) => z.squareRoot(),
      exp: (z) => ComplexNumber.E.power(z),
      ln: (z) => z.logarithm(),
      log: (z) => z.logarithm(10),
      abs: (z) => new ComplexNumber(z.magnitude(), 0),
      conj: (z) => z.conjugate(),
      neg: (z) => z.neg(),
    };
    for (const [name, fn] of Object.entries(unary)) {
      env.assignImmutable(name, (a: unknown) => fn(cn(a)));
    }

    env.assignImmutable("pi", ComplexNumber.PI);
    env.assignImmutable("e", ComplexNumber.E);
    env.assignImmutable("i", ComplexNumber.I);
    env.assignImmutable("phi", ComplexNumber.PHI);
    return env;
  }
}
