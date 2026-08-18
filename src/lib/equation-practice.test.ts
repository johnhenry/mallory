import assert from "node:assert/strict";
import { Symbolic } from "mallory-math";
import { test } from "node:test";
import {
  checkEquationAnswer,
  generateEquationProblem,
  revealRoots,
  type EquationProblem,
} from "./equation-practice.ts";
import type { Difficulty } from "./integration-practice.ts";

const DEGREE_BY_DIFFICULTY: Record<Difficulty, number> = { easy: 1, medium: 2, hard: 3 };
const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard"];
const INSTANCES_PER_DIFFICULTY = 60;

test("generateEquationProblem: Symbolic.solve recovers exactly as many real roots as the polynomial's degree, and each verifies, across many random instances", () => {
  for (const difficulty of DIFFICULTIES) {
    for (let i = 0; i < INSTANCES_PER_DIFFICULTY; i++) {
      const problem = generateEquationProblem(difficulty);
      assert.equal(problem.difficulty, difficulty);
      assert.equal(problem.roots.length, DEGREE_BY_DIFFICULTY[difficulty], `equationText=${problem.equationText}`);
      for (const r of problem.roots) {
        assert.ok(Symbolic.verifySolution(problem.equationText, problem.variable, r), `${r} should verify against ${problem.equationText}`);
      }
    }
  }
});

test("checkEquationAnswer: the revealed roots round-trip as correct, across many random instances and every difficulty", () => {
  for (const difficulty of DIFFICULTIES) {
    for (let i = 0; i < INSTANCES_PER_DIFFICULTY; i++) {
      const problem = generateEquationProblem(difficulty);
      const revealed = revealRoots(problem);
      const result = checkEquationAnswer(problem, revealed);
      assert.equal(result.correct, true, `equationText=${problem.equationText} revealed=${revealed} message=${result.message}`);
    }
  }
});

test("checkEquationAnswer: roots given in a different order are still accepted", () => {
  const problem: EquationProblem = { equationText: "x^2 - x - 6", variable: "x", roots: [-2, 3], difficulty: "medium" };
  const result = checkEquationAnswer(problem, "3, -2");
  assert.equal(result.correct, true);
});

test("checkEquationAnswer: wrong root count is rejected with a clear message", () => {
  const problem: EquationProblem = { equationText: "x^2 - x - 6", variable: "x", roots: [-2, 3], difficulty: "medium" };
  const result = checkEquationAnswer(problem, "-2");
  assert.equal(result.correct, false);
  assert.match(result.message, /2 real roots/);
});

test("checkEquationAnswer: a repeated root is rejected even when the count matches", () => {
  const problem: EquationProblem = { equationText: "x^2 - x - 6", variable: "x", roots: [-2, 3], difficulty: "medium" };
  const result = checkEquationAnswer(problem, "-2, -2");
  assert.equal(result.correct, false);
  assert.match(result.message, /same root more than once/);
});

test("checkEquationAnswer: a value that isn't actually a root is rejected", () => {
  const problem: EquationProblem = { equationText: "x^2 - x - 6", variable: "x", roots: [-2, 3], difficulty: "medium" };
  const result = checkEquationAnswer(problem, "0, 3");
  assert.equal(result.correct, false);
  assert.match(result.message, /doesn't satisfy/);
});

test("checkEquationAnswer: an unparseable answer is rejected with a clear message, not a crash", () => {
  const problem: EquationProblem = { equationText: "x - 5", variable: "x", roots: [5], difficulty: "easy" };
  const result = checkEquationAnswer(problem, "x +* 3");
  assert.equal(result.correct, false);
  assert.match(result.message, /Couldn't parse/);
});

test("checkEquationAnswer: empty input is rejected with a clear message", () => {
  const problem: EquationProblem = { equationText: "x - 5", variable: "x", roots: [5], difficulty: "easy" };
  const result = checkEquationAnswer(problem, "   ");
  assert.equal(result.correct, false);
  assert.match(result.message, /Enter at least one root/);
});

test("revealRoots: formats each root, comma-separated", () => {
  const problem: EquationProblem = { equationText: "x^2 - x - 6", variable: "x", roots: [-2, 3], difficulty: "medium" };
  assert.equal(revealRoots(problem), "-2, 3");
});
