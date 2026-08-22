import { Symbolic } from "@johnhenry/math";
import { preprocessImplicitMultiplication } from "./implicit-mult.ts";

/**
 * One integration problem from mallory-math's Rubi-derived corpus
 * (`public/rubi-corpus.json`, MIT-licensed, derived from
 * RuleBasedIntegration/MaximaSyntaxTestSuite -- see the file's own
 * `attribution` field). `params` lists any free parameter besides the
 * integration `variable` (e.g. "a" in `(a^2-x^2)^(5/2)`) -- this v1 practice
 * mode only uses problems with an EMPTY `params` (152 of 771), since
 * checking an answer numerically (see `checkAnswer` below) would otherwise
 * need to also pick sample values for every extra parameter.
 */
export interface RubiProblem {
  source: string;
  index: number;
  integrand: string;
  variable: string;
  steps: number;
  antiderivative: string;
  params: string[];
}

export interface RubiCorpus {
  attribution: string;
  problems: RubiProblem[];
}

export type Difficulty = "easy" | "medium" | "hard";

/** Buckets by the corpus's own `steps` field (Rubi's own rule-count for solving the problem) -- a reasonable proxy for how hard a problem "feels" without re-deriving a fresh difficulty metric. */
export function difficultyOf(problem: RubiProblem): Difficulty {
  if (problem.steps <= 2) return "easy";
  if (problem.steps <= 5) return "medium";
  return "hard";
}

/** Problems usable by this v1 practice mode: no extra parameters beyond the integration variable (see RubiProblem's own doc comment). */
export function practiceableProblems(corpus: RubiCorpus): RubiProblem[] {
  return corpus.problems.filter((p) => p.params.length === 0);
}

export function problemsForDifficulty(problems: readonly RubiProblem[], difficulty: Difficulty | "any"): RubiProblem[] {
  if (difficulty === "any") return [...problems];
  return problems.filter((p) => difficultyOf(p) === difficulty);
}

export function pickRandomProblem(problems: readonly RubiProblem[]): RubiProblem | null {
  if (problems.length === 0) return null;
  return problems[Math.floor(Math.random() * problems.length)] as RubiProblem;
}

// Fixed, deliberately mixed sample points (small/large, positive/negative)
// for the numeric derivative-agreement check below -- not random, so a
// given check is reproducible/debuggable.
const SAMPLE_POINTS = [0.37, 1.13, 2.71, -0.53, 1.91, -1.7];

export interface AnswerCheckResult {
  correct: boolean;
  message: string;
}

/**
 * Checks a user's typed antiderivative by differentiating it and comparing
 * to the ORIGINAL integrand numerically at several sample points --
 * deliberately NOT a string/structural comparison against the corpus's own
 * `antiderivative` field, which is only one of possibly several equally
 * valid closed forms and would reject a correct-but-differently-written
 * answer. Comparing derivatives is also naturally "robust to additive
 * constants" (the issue's own requirement): d/dx[F(x)+C] = d/dx[F(x)] for
 * any constant C, so a user's `F(x)+7` checks exactly the same as `F(x)`.
 *
 * A sample point where either side is non-finite (a domain restriction or
 * genuine singularity -- confirmed directly against the corpus: 2 of 152
 * practiceable problems are only valid in a complex/formal sense for ANY
 * real x, e.g. involving `sqrt` of a value that's always negative) is
 * skipped rather than counted as a mismatch; correctness requires every
 * point that WAS comparable to agree, and at least one point to have been
 * comparable at all (an all-singular sample set reports "couldn't verify"
 * rather than silently "correct").
 */
export function checkAnswer(problem: RubiProblem, userAnswerText: string): AnswerCheckResult {
  let userDerivative: ReturnType<typeof Symbolic.differentiate>;
  try {
    const parsedAnswer = Symbolic.parse(preprocessImplicitMultiplication(userAnswerText));
    userDerivative = Symbolic.differentiate(parsedAnswer, problem.variable);
  } catch (e) {
    return { correct: false, message: `Couldn't parse your answer: ${e instanceof Error ? e.message : String(e)}` };
  }

  const integrandExpr = Symbolic.parse(problem.integrand);
  let comparable = 0;
  let matches = 0;
  for (const x of SAMPLE_POINTS) {
    try {
      const integrandVal = Symbolic.evaluate(integrandExpr, { [problem.variable]: x });
      const derivVal = Symbolic.evaluate(userDerivative, { [problem.variable]: x });
      if (!Number.isFinite(integrandVal) || !Number.isFinite(derivVal)) continue;
      comparable++;
      const scale = Math.max(1, Math.abs(integrandVal));
      if (Math.abs(integrandVal - derivVal) < 1e-2 * scale) matches++;
    } catch {
      // Singular at this point (e.g. division by zero, log of zero) -- skip it.
    }
  }

  if (comparable === 0) {
    return { correct: false, message: "Couldn't verify your answer numerically -- every sample point was undefined for this problem." };
  }
  const correct = matches === comparable;
  return {
    correct,
    message: correct
      ? `Correct! The derivative of your answer matches the integrand at ${comparable} sample point(s).`
      : `Not quite -- the derivative of your answer disagreed with the integrand at ${comparable - matches}/${comparable} sample point(s).`,
  };
}
