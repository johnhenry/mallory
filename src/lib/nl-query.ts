/**
 * Thin natural-language-to-expression layer (Wolfram-Alpha-style input
 * forgiveness), distinct from a full conversational co-editing agent: a
 * query like "derivative of x^2 sin(x)" pattern-matches to a
 * Symbolic.parse + differentiate call and resolves to plain expression
 * source, without the user needing to write formal CAS syntax. Falls
 * through to null (treat the input as a normal expression) on anything
 * that doesn't match a known phrasing, or that fails to resolve.
 */
import { Symbolic } from "@johnhenry/math";
import { equationToImplicitZero } from "./equation-to-zero.ts";
import { preprocessImplicitMultiplication } from "./implicit-mult.ts";

interface QueryPattern {
  regex: RegExp;
  /**
   * `axisVariable` is the calling panel's own variable name (e.g. "x" for
   * GraphCanvas/TaylorPanel, "z" for the complex-plane panel, "t" for the
   * signal panel) -- used as the implicit differentiate/integrate/Taylor
   * variable whenever a pattern doesn't have the user name one explicitly
   * in the query text itself (unlike e.g. "limit of X as w approaches 0",
   * where the variable is always spelled out inline).
   */
  resolve: (match: RegExpMatchArray, axisVariable: string) => string;
}

const PATTERNS: QueryPattern[] = [
  {
    regex: /^\s*(?:the\s+)?derivative\s+of\s+(.+)$/i,
    resolve: (match, axisVariable) =>
      Symbolic.toString(Symbolic.differentiate(preprocessImplicitMultiplication(match[1] as string), axisVariable)),
  },
  {
    regex: /^\s*d\s*\/\s*dx\s+(?:of\s+)?(.+)$/i,
    resolve: (match, axisVariable) =>
      Symbolic.toString(Symbolic.differentiate(preprocessImplicitMultiplication(match[1] as string), axisVariable)),
  },
  {
    // Must come before the bare integral pattern below -- that one is greedy
    // (`.+`) and would otherwise swallow the "from...to" suffix as part of
    // the expression and fail, and the resolver loop doesn't fall through to
    // a later pattern once an earlier regex has matched.
    regex: /^\s*(?:the\s+)?(?:definite\s+)?(?:integral|antiderivative)\s+of\s+(.+?)\s+from\s+(-?[\d.]+)\s+to\s+(-?[\d.]+)\s*$/i,
    resolve: (match, axisVariable) => {
      const inner = match[1] as string;
      const lower = Number(match[2]);
      const upper = Number(match[3]);
      return String(Symbolic.integrateDefinite(preprocessImplicitMultiplication(inner), lower, upper, axisVariable));
    },
  },
  {
    regex: /^\s*(?:the\s+)?(?:integral|antiderivative)\s+of\s+(.+)$/i,
    resolve: (match, axisVariable) => Symbolic.toString(Symbolic.integrate(preprocessImplicitMultiplication(match[1] as string), axisVariable)),
  },
  {
    regex: /^\s*simplify\s+(.+)$/i,
    resolve: (match) => Symbolic.toString(Symbolic.simplify(preprocessImplicitMultiplication(match[1] as string))),
  },
  {
    regex: /^\s*factor\s+(.+)$/i,
    resolve: (match, axisVariable) => Symbolic.toString(Symbolic.factor(preprocessImplicitMultiplication(match[1] as string), axisVariable)),
  },
  {
    regex: /^\s*expand\s+(.+)$/i,
    resolve: (match) => Symbolic.toString(Symbolic.expand(preprocessImplicitMultiplication(match[1] as string))),
  },
  {
    // "solve X" or "solve X for v" -- accepts "lhs = rhs" via the same
    // implicit-zero conversion the system-solver panel uses. Only resolves
    // when there's exactly one real root: multiple roots don't reduce to a
    // single plottable expression, and returning just the first would
    // silently discard the others, so this falls through to null instead.
    // The found root is numerically spot-checked via Symbolic.verifySolution
    // before being returned -- a CAS "reviewer" pass (see the research
    // roadmap): if the root doesn't actually zero the equation (a bug, or a
    // numerically-fragile symbolic result), this falls through to null
    // rather than silently plotting a wrong constant.
    regex: /^\s*solve\s+(.+?)(?:\s+for\s+(\w+))?\s*$/i,
    resolve: (match, axisVariable) => {
      const inner = equationToImplicitZero(preprocessImplicitMultiplication(match[1] as string));
      const variable = (match[2] as string | undefined) ?? axisVariable;
      const roots = Symbolic.solve(inner, variable);
      if (roots.length !== 1) throw new Error("solve: ambiguous or no result for NL resolution");
      const candidate = Symbolic.evaluate(roots[0]);
      if (!Symbolic.verifySolution(inner, variable, candidate)) {
        throw new Error("solve: candidate root failed verification");
      }
      return Symbolic.toString(roots[0]);
    },
  },
  {
    // "limit of X as x approaches A" (also accepts "->"/"→", and
    // "infinity"/"-infinity" for A). The limit variable is always named
    // explicitly in the query text itself, so this ignores axisVariable
    // (unlike every other pattern here).
    regex:
      /^\s*(?:the\s+)?limit\s+of\s+(.+?)\s+as\s+(\w+)\s*(?:approaches|->|→)\s*(-?infinity|-?[\d.]+)\s*$/i,
    resolve: (match) => {
      const inner = preprocessImplicitMultiplication(match[1] as string);
      const variable = match[2] as string;
      const pointText = (match[3] as string).toLowerCase();
      const point = pointText === "infinity" ? Infinity : pointText === "-infinity" ? -Infinity : Number(pointText);
      return String(Symbolic.limit(inner, variable, point));
    },
  },
  {
    // "taylor series of X [at C] [to degree N]" -- both suffixes optional
    // (center defaults to 0, degree to Symbolic.taylor's own default).
    // Resolves to the expanded POLYNOMIAL itself, not the original
    // expression -- usable in any expression field (GraphCanvas, the
    // complex-plane panel, the signal panel, TaylorPanel's own expr input)
    // exactly like "derivative of"/"integral of" already are, rather than
    // needing bespoke per-panel wiring to fill separate center/degree cells.
    regex: /^\s*taylor\s+series\s+of\s+(.+?)(?:\s+at\s+(-?[\d.]+))?(?:\s+to\s+degree\s+(\d+))?\s*$/i,
    resolve: (match, axisVariable) => {
      const inner = preprocessImplicitMultiplication(match[1] as string);
      const center = match[2] !== undefined ? Number(match[2]) : 0;
      const order = match[3] !== undefined ? Number(match[3]) : undefined;
      return Symbolic.toString(Symbolic.taylor(inner, axisVariable, center, order));
    },
  },
];

/**
 * Resolves a natural-language query to plain expression source, or null if
 * `input` doesn't match a known phrasing (or fails to resolve). `axisVariable`
 * (default `"x"`, matching GraphCanvas's own convention) is the calling
 * panel's variable name -- see `QueryPattern.resolve`'s own doc comment.
 */
export function resolveNaturalLanguageQuery(input: string, axisVariable = "x"): string | null {
  for (const { regex, resolve } of PATTERNS) {
    const match = input.match(regex);
    if (!match) continue;
    try {
      return resolve(match, axisVariable);
    } catch {
      return null;
    }
  }
  return null;
}
