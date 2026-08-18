import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkMatrixDeterminantAnswer,
  generateMatrixDeterminantProblem,
  revealDeterminant,
  type MatrixDeterminantProblem,
} from "./matrix-determinant-practice.ts";
import type { Difficulty } from "./integration-practice.ts";
import { computeDeterminant } from "./matrix-ops.ts";

const SIZE_BY_DIFFICULTY: Record<Difficulty, number> = { easy: 2, medium: 3, hard: 4 };
const RANGE_BY_DIFFICULTY: Record<Difficulty, number> = { easy: 5, medium: 4, hard: 3 };
const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard"];
const INSTANCES_PER_DIFFICULTY = 60;

test("generateMatrixDeterminantProblem: right-sized integer matrix in range, determinant matches an independent recomputation, across many random instances", () => {
  for (const difficulty of DIFFICULTIES) {
    const size = SIZE_BY_DIFFICULTY[difficulty];
    const range = RANGE_BY_DIFFICULTY[difficulty];
    for (let i = 0; i < INSTANCES_PER_DIFFICULTY; i++) {
      const problem = generateMatrixDeterminantProblem(difficulty);
      assert.equal(problem.difficulty, difficulty);
      assert.equal(problem.matrix.length, size);
      for (const row of problem.matrix) {
        assert.equal(row.length, size);
        for (const v of row) {
          assert.ok(Number.isInteger(v) && Math.abs(v) <= range, `entry ${v} out of range`);
        }
      }
      const recomputed = computeDeterminant(problem.matrix).value;
      assert.equal(problem.determinant, recomputed);
    }
  }
});

test("checkMatrixDeterminantAnswer: the revealed determinant round-trips as correct, across many random instances and every difficulty", () => {
  for (const difficulty of DIFFICULTIES) {
    for (let i = 0; i < INSTANCES_PER_DIFFICULTY; i++) {
      const problem = generateMatrixDeterminantProblem(difficulty);
      const revealed = revealDeterminant(problem);
      const result = checkMatrixDeterminantAnswer(problem, revealed);
      assert.equal(result.correct, true, `matrix=${JSON.stringify(problem.matrix)} determinant=${problem.determinant} revealed=${revealed}`);
    }
  }
});

test("checkMatrixDeterminantAnswer: hand-computed 2x2 example", () => {
  // det([[4,3],[6,3]]) = 4*3 - 3*6 = -6
  const problem: MatrixDeterminantProblem = { matrix: [[4, 3], [6, 3]], determinant: -6, difficulty: "easy" };
  assert.equal(checkMatrixDeterminantAnswer(problem, "-6").correct, true);
  assert.equal(checkMatrixDeterminantAnswer(problem, "-5").correct, false);
});

test("checkMatrixDeterminantAnswer: an off-by-one wrong answer is rejected", () => {
  const problem = generateMatrixDeterminantProblem("medium");
  const wrong = checkMatrixDeterminantAnswer(problem, String(problem.determinant + 1));
  assert.equal(wrong.correct, false);
});

test("checkMatrixDeterminantAnswer: an unparseable answer is rejected with a clear message, not a crash", () => {
  const problem: MatrixDeterminantProblem = { matrix: [[1, 0], [0, 1]], determinant: 1, difficulty: "easy" };
  const result = checkMatrixDeterminantAnswer(problem, "not a number");
  assert.equal(result.correct, false);
  assert.match(result.message, /Couldn't parse/);
});

test("revealDeterminant: rounds away floating-point noise", () => {
  const problem: MatrixDeterminantProblem = { matrix: [[1, 0], [0, 1]], determinant: 0.9999999999998, difficulty: "easy" };
  assert.equal(revealDeterminant(problem), "1");
});
