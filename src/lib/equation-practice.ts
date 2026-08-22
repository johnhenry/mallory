import { Symbolic } from "@johnhenry/math";
import { preprocessImplicitMultiplication } from "./implicit-mult.ts";
import type { AnswerCheckResult, Difficulty } from "./integration-practice.ts";

/**
 * Equation-solving practice (issue #254's scoping pass, item 2 of 3): builds
 * a polynomial from a set of randomly chosen, distinct integer roots (so a
 * closed-form solve is always reachable), then asks the user to list every
 * real root. Ground truth is `Symbolic.solve` itself, not the constructed
 * root list -- deliberately using the same "solve machinery" the issue
 * points at rather than trusting this file's own construction; a
 * corresponding test asserts the two agree across many random instances.
 * Per-candidate checking reuses `Symbolic.verifySolution` (built for exactly
 * this: "is this numeric value approximately a root of this equation"),
 * rather than a fresh numeric-comparison routine.
 */
export interface EquationProblem {
  /** "expr implicitly equals zero" text, e.g. "x^2 - x - 6" (same convention as Symbolic.solve/verifySolution). */
  equationText: string;
  variable: string;
  /** Every real root, ascending -- from Symbolic.solve, not from the roots used to construct the polynomial (see file doc comment). */
  roots: number[];
  difficulty: Difficulty;
}

const VARIABLE = "x";

/** easy = linear (1 root), medium = quadratic (2 roots), hard = cubic (3 roots) -- degree ceiling is Symbolic.solve's own reliable range for guaranteed-rational-root polynomials like these. */
const DEGREE_BY_DIFFICULTY: Record<Difficulty, number> = { easy: 1, medium: 2, hard: 3 };
const ROOT_RANGE_BY_DIFFICULTY: Record<Difficulty, number> = { easy: 6, medium: 6, hard: 4 };

function randomInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

/**
 * Distinct nonzero integer roots. Nonzero is deliberate, not cosmetic: a
 * generated cubic with 0 as one of its three roots (a zero constant term)
 * reliably trips a real bug in @johnhenry/math's degree-≥3 rational-root
 * search (`Symbolic.solve` throws "no closed-form root found" even though
 * a rational root plainly exists -- confirmed via a 1000-instance stress
 * test, isolated to exactly the zero-constant-term case). Filed upstream as
 * johnhenry/math#52; this generator sidesteps it rather than depending
 * on a fix landing before this panel can ship.
 */
function distinctRoots(count: number, range: number): number[] {
  const roots = new Set<number>();
  while (roots.size < count) {
    const r = randomInt(-range, range);
    if (r !== 0) roots.add(r);
  }
  return [...roots];
}

/** Expands the monic product ∏(x - r) into ascending coefficients [a0, a1, ..., an]. */
function expandFromRoots(roots: number[]): number[] {
  let coeffs = [1];
  for (const r of roots) {
    const next = new Array(coeffs.length + 1).fill(0) as number[];
    for (let i = 0; i < coeffs.length; i++) {
      next[i] += (coeffs[i] as number) * -r;
      next[i + 1] += coeffs[i] as number;
    }
    coeffs = next;
  }
  return coeffs;
}

function polynomialText(coeffs: number[], variable: string): string {
  const parts: string[] = [];
  for (let deg = coeffs.length - 1; deg >= 0; deg--) {
    const c = coeffs[deg] as number;
    if (c === 0) continue;
    const abs = Math.abs(c);
    const magnitude = deg === 0 ? `${abs}` : deg === 1 ? (abs === 1 ? variable : `${abs}*${variable}`) : abs === 1 ? `${variable}^${deg}` : `${abs}*${variable}^${deg}`;
    parts.push(parts.length === 0 ? (c < 0 ? `-${magnitude}` : magnitude) : c < 0 ? `- ${magnitude}` : `+ ${magnitude}`);
  }
  return parts.length ? parts.join(" ") : "0";
}

export function generateEquationProblem(difficulty: Difficulty): EquationProblem {
  const degree = DEGREE_BY_DIFFICULTY[difficulty];
  const range = ROOT_RANGE_BY_DIFFICULTY[difficulty];
  const constructedRoots = distinctRoots(degree, range);
  const coeffs = expandFromRoots(constructedRoots);
  const equationText = polynomialText(coeffs, VARIABLE);
  const roots = Symbolic.solve(equationText, VARIABLE)
    .map((e) => Symbolic.evaluate(e))
    .sort((a, b) => a - b);
  return { equationText, variable: VARIABLE, roots, difficulty };
}

function formatNumber(n: number): string {
  return String(Math.round(n * 1e6) / 1e6);
}

/**
 * Checks a comma-separated list of candidate roots: every candidate must
 * pass `Symbolic.verifySolution` against the equation, no candidate may
 * repeat, and the count must match the expected number of real roots (so
 * giving just one root of a quadratic doesn't pass).
 */
export function checkEquationAnswer(problem: EquationProblem, userAnswerText: string): AnswerCheckResult {
  const parts = userAnswerText
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    return { correct: false, message: "Enter at least one root (comma-separated if there's more than one)." };
  }

  let values: number[];
  try {
    values = parts.map((p) => Symbolic.evaluate(Symbolic.parse(preprocessImplicitMultiplication(p))));
  } catch (e) {
    return { correct: false, message: `Couldn't parse your answer: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (values.some((v) => !Number.isFinite(v))) {
    return { correct: false, message: "Couldn't evaluate one of your roots to a real number." };
  }

  if (values.length !== problem.roots.length) {
    return {
      correct: false,
      message: `This equation has ${problem.roots.length} real root${problem.roots.length === 1 ? "" : "s"} -- you gave ${values.length}.`,
    };
  }

  const sorted = [...values].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) {
    if (Math.abs((sorted[i] as number) - (sorted[i - 1] as number)) < 1e-6) {
      return { correct: false, message: "You listed the same root more than once." };
    }
  }

  for (const v of values) {
    if (!Symbolic.verifySolution(problem.equationText, problem.variable, v)) {
      return { correct: false, message: `${formatNumber(v)} doesn't satisfy the equation.` };
    }
  }

  return { correct: true, message: `Correct! All ${values.length} root${values.length === 1 ? "" : "s"} check out.` };
}

/** Every root, formatted for the panel's "Show me" reveal. */
export function revealRoots(problem: EquationProblem): string {
  return problem.roots.map(formatNumber).join(", ");
}
