import type { Expr } from "@johnhenry/math";

/**
 * Tree-walks a Symbolic Expr collecting every `var` node name except the
 * cell's axis variable, deduplicated and sorted for stable slider ordering.
 */
export function collectFreeVars(expr: Expr, axisVariable: string): string[] {
  const found = new Set<string>();

  function walk(node: Expr): void {
    switch (node.type) {
      case "const":
        return;
      case "var":
        if (node.name !== axisVariable) found.add(node.name);
        return;
      case "add":
      case "sub":
      case "mul":
      case "div":
      case "call2": // pre-existing gap: this case was entirely missing (verified via typecheck-free `void`-returning switch)
      case "cmp":
        walk(node.left);
        walk(node.right);
        return;
      case "pow":
        walk(node.base);
        walk(node.exp);
        return;
      case "neg":
        walk(node.arg);
        return;
      case "func":
        walk(node.arg);
        return;
      case "piecewise":
        for (const branch of node.branches) {
          walk(branch.cond);
          walk(branch.expr);
        }
        walk(node.otherwise);
        return;
      case "sum":
      case "product":
        walk(node.from);
        walk(node.to);
        // node.variable is bound within node.body -- recurse via this same
        // function (already excludes one bound name) then filter its result
        // against the outer axisVariable before merging.
        for (const name of collectFreeVars(node.body, node.variable)) {
          if (name !== axisVariable) found.add(name);
        }
        return;
    }
  }

  walk(expr);
  return [...found].sort();
}

export interface SliderRange {
  min: number;
  max: number;
  step: number;
  default: number;
}

const INTEGER_STEPPER_NAMES = new Set(["n", "k", "i", "j", "m"]);
const GREEK_LETTER_NAMES = new Set([
  "alpha",
  "beta",
  "gamma",
  "delta",
  "epsilon",
  "zeta",
  "eta",
  "theta",
  "iota",
  "kappa",
  "lambda",
  "mu",
  "nu",
  "xi",
  "omicron",
  "rho",
  "sigma",
  "tau",
  "upsilon",
  "phi",
  "chi",
  "psi",
  "omega",
]);

/**
 * Name-based default range heuristic (GeoGebra/Desmos convention): short
 * loop-index-like names get an integer stepper, Greek names get an angle
 * range, everything else gets a generic [-10, 10] continuous range.
 */
export function defaultSliderRange(name: string): SliderRange {
  if (INTEGER_STEPPER_NAMES.has(name)) return { min: -10, max: 10, step: 1, default: 1 };
  if (GREEK_LETTER_NAMES.has(name)) return { min: 0, max: 2 * Math.PI, step: 0.01, default: 0 };
  return { min: -10, max: 10, step: 0.1, default: 1 };
}
