import { Symbolic } from "@johnhenry/math";
import { preprocessImplicitMultiplication } from "./implicit-mult.ts";
import type { AnswerCheckResult, Difficulty } from "./integration-practice.ts";

/**
 * Derivative practice (issue #254's scoping pass, item 1 of 3): the inverse
 * of `integration-practice.ts` -- generate a random expression, ask the user
 * to type its derivative, and check numerically. Reuses the same
 * `Symbolic.parse`/`differentiate`/`evaluate` plumbing and the same
 * "compare derivative values at sample points, skip non-finite ones" shape
 * `checkAnswer` there already uses, so this file is deliberately close to a
 * mirror of it rather than a fresh design.
 *
 * Unlike the antiderivative mode (which draws from a fixed 152-problem Rubi
 * corpus), there's no ready-made "derivative corpus" to draw from, so
 * problems are generated on the fly from a small pool of building blocks
 * (polynomial/trig/exp terms, combined by difficulty into sums, products,
 * and simple chain-rule compositions) -- randomized instances within a
 * difficulty band, per the issue's own suggestion, rather than a fixed list.
 */
export interface DerivativeProblem {
  expression: string;
  variable: string;
  difficulty: Difficulty;
}

const VARIABLE = "x";

// Same "fixed, deliberately mixed sample points" rationale as
// integration-practice.ts's own SAMPLE_POINTS: reproducible/debuggable
// rather than random, small/large and positive/negative. Duplicated rather
// than imported -- these two files' numeric-agreement checks are
// independent and each should stay understandable/testable on its own.
const SAMPLE_POINTS = [0.37, 1.13, 2.71, -0.53, 1.91, -1.7];

function randomInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function choice<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)] as T;
}

function monomialAtom(minDeg: number, maxDeg: number): string {
  const deg = randomInt(minDeg, maxDeg);
  const c = randomInt(1, 6);
  if (deg === 1) return c === 1 ? VARIABLE : `${c}*${VARIABLE}`;
  return c === 1 ? `${VARIABLE}^${deg}` : `${c}*${VARIABLE}^${deg}`;
}

function trigOrExpAtom(): string {
  const fn = choice(["sin", "cos", "exp"] as const);
  const k = randomInt(1, 3);
  const inner = k === 1 ? VARIABLE : `${k}*${VARIABLE}`;
  return `${fn}(${inner})`;
}

/** A single-rule building block: one monomial, or one sin/cos/exp of a linear argument. */
function simpleAtom(): string {
  return Math.random() < 0.5 ? monomialAtom(1, 4) : trigOrExpAtom();
}

/** Two simple atoms multiplied -- exercises the product rule. */
function productAtom(): string {
  return `${simpleAtom()}*${simpleAtom()}`;
}

/** A trig/exp function applied to a small quadratic -- exercises the chain rule. */
function chainAtom(): string {
  const fn = choice(["sin", "cos", "exp"] as const);
  const a = randomInt(1, 3);
  const inner = a === 1 ? `${VARIABLE}^2` : `${a}*${VARIABLE}^2`;
  return `${fn}(${inner})`;
}

function pickAtom(difficulty: Difficulty): string {
  if (difficulty !== "hard") return simpleAtom();
  const kind = choice(["simple", "simple", "product", "chain"] as const);
  if (kind === "product") return productAtom();
  if (kind === "chain") return chainAtom();
  return simpleAtom();
}

function combineAtoms(atoms: string[]): string {
  return atoms
    .map((atom, i) => {
      if (i === 0) return Math.random() < 0.15 ? `-${atom}` : atom;
      return `${Math.random() < 0.5 ? "+" : "-"} ${atom}`;
    })
    .join(" ");
}

/** Buckets: easy = one term (single differentiation rule), medium = sum of two simple terms (sum rule), hard = 2-3 terms that may themselves be products/chain compositions. */
export function generateDerivativeProblem(difficulty: Difficulty): DerivativeProblem {
  const atomCount = difficulty === "easy" ? 1 : difficulty === "medium" ? 2 : randomInt(2, 3);
  const atoms = Array.from({ length: atomCount }, () => pickAtom(difficulty));
  return { expression: combineAtoms(atoms), variable: VARIABLE, difficulty };
}

/**
 * Checks a user's typed derivative by evaluating it and the TRUE derivative
 * (via `Symbolic.differentiate` on the original expression) at several
 * sample points, deliberately not a string/structural comparison -- same
 * rationale as `checkAnswer` in integration-practice.ts, an equivalent-but-
 * differently-written correct answer (e.g. `2*x*x` for `2*x^2`) must still
 * pass.
 */
export function checkDerivativeAnswer(problem: DerivativeProblem, userAnswerText: string): AnswerCheckResult {
  let userExpr: ReturnType<typeof Symbolic.parse>;
  try {
    userExpr = Symbolic.parse(preprocessImplicitMultiplication(userAnswerText));
  } catch (e) {
    return { correct: false, message: `Couldn't parse your answer: ${e instanceof Error ? e.message : String(e)}` };
  }

  const target = Symbolic.differentiate(Symbolic.parse(problem.expression), problem.variable);

  let comparable = 0;
  let matches = 0;
  for (const x of SAMPLE_POINTS) {
    try {
      const targetVal = Symbolic.evaluate(target, { [problem.variable]: x });
      const userVal = Symbolic.evaluate(userExpr, { [problem.variable]: x });
      if (!Number.isFinite(targetVal) || !Number.isFinite(userVal)) continue;
      comparable++;
      const scale = Math.max(1, Math.abs(targetVal));
      if (Math.abs(targetVal - userVal) < 1e-2 * scale) matches++;
    } catch {
      // Singular at this point -- skip it.
    }
  }

  if (comparable === 0) {
    return { correct: false, message: "Couldn't verify your answer numerically -- every sample point was undefined for this problem." };
  }
  const correct = matches === comparable;
  return {
    correct,
    message: correct
      ? `Correct! Your answer matches the derivative at ${comparable} sample point(s).`
      : `Not quite -- your answer disagreed with the derivative at ${comparable - matches}/${comparable} sample point(s).`,
  };
}

/** The derivative in a simplified, human-readable form, for the panel's "Show me" reveal. */
export function revealDerivative(problem: DerivativeProblem): string {
  const target = Symbolic.differentiate(Symbolic.parse(problem.expression), problem.variable);
  return Symbolic.toString(Symbolic.simplify(target));
}
