import { Symbolic } from "@johnhenry/math";
import { preprocessImplicitMultiplication } from "./implicit-mult.ts";
import type { AnswerCheckResult, Difficulty } from "./integration-practice.ts";
import { computeDeterminant, type Mat } from "./matrix-ops.ts";

/**
 * Matrix determinant practice (issue #254's scoping pass, item 3 of 3):
 * generate a random small integer matrix, ask for its determinant, and
 * verify with `computeDeterminant` -- the same function `MatrixPanel.tsx`
 * already uses, cheap to call per-problem since `Structure.realField()`'s
 * determinant is O(n^3) (this session's own earlier fix). Scoped to just
 * the determinant (a single-number answer) rather than also adding an
 * inverse mode (a matrix-shaped answer needs its own input UI and
 * element-wise comparison) -- see the file's own "further expansion" note.
 */
export interface MatrixDeterminantProblem {
  matrix: Mat;
  determinant: number;
  difficulty: Difficulty;
}

/** easy = 2x2, medium = 3x3, hard = 4x4; entry range shrinks as size grows so the determinant (which scales roughly with entry^size) stays a comfortable mental-math/scratch-paper size. */
const SIZE_BY_DIFFICULTY: Record<Difficulty, number> = { easy: 2, medium: 3, hard: 4 };
const RANGE_BY_DIFFICULTY: Record<Difficulty, number> = { easy: 5, medium: 4, hard: 3 };

function randomInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function randomMatrix(size: number, range: number): Mat {
  return Array.from({ length: size }, () => Array.from({ length: size }, () => randomInt(-range, range)));
}

export function generateMatrixDeterminantProblem(difficulty: Difficulty): MatrixDeterminantProblem {
  const size = SIZE_BY_DIFFICULTY[difficulty];
  const range = RANGE_BY_DIFFICULTY[difficulty];
  const matrix = randomMatrix(size, range);
  const determinant = computeDeterminant(matrix).value;
  return { matrix, determinant, difficulty };
}

/**
 * Checks a typed numeric answer against the computed determinant. Integer
 * entries give a mathematically-exact-integer determinant, but
 * `computeDeterminant` gets there via floating-point Gaussian elimination
 * (see `Structure.realField().determinant`), so a small relative tolerance
 * absorbs that roundoff rather than requiring bit-exact equality.
 */
export function checkMatrixDeterminantAnswer(problem: MatrixDeterminantProblem, userAnswerText: string): AnswerCheckResult {
  let value: number;
  try {
    value = Symbolic.evaluate(Symbolic.parse(preprocessImplicitMultiplication(userAnswerText)));
  } catch (e) {
    return { correct: false, message: `Couldn't parse your answer: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!Number.isFinite(value)) {
    return { correct: false, message: "Your answer isn't a finite number." };
  }

  const tolerance = 1e-6 * Math.max(1, Math.abs(problem.determinant));
  const correct = Math.abs(value - problem.determinant) < tolerance;
  return { correct, message: correct ? "Correct!" : "Not quite -- that's not the determinant of this matrix." };
}

/** The determinant, rounded to absorb floating-point noise, for the panel's "Show me" reveal. */
export function revealDeterminant(problem: MatrixDeterminantProblem): string {
  return String(Math.round(problem.determinant * 1e6) / 1e6);
}
