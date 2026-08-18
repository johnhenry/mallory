import assert from "node:assert/strict";
import { Symbolic } from "mallory-math";
import { test } from "node:test";
import {
  checkDerivativeAnswer,
  generateDerivativeProblem,
  revealDerivative,
  type DerivativeProblem,
} from "./derivative-practice.ts";
import type { Difficulty } from "./integration-practice.ts";

const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard"];
const INSTANCES_PER_DIFFICULTY = 60;

test("generateDerivativeProblem: produces a differentiable expression across many random instances, for every difficulty", () => {
  for (const difficulty of DIFFICULTIES) {
    for (let i = 0; i < INSTANCES_PER_DIFFICULTY; i++) {
      const problem = generateDerivativeProblem(difficulty);
      assert.equal(problem.difficulty, difficulty);
      assert.equal(problem.variable, "x");
      // Should parse and differentiate without throwing -- the generator only
      // ever emits atoms built from mallory-math's own grammar.
      const expr = Symbolic.parse(problem.expression);
      assert.doesNotThrow(() => Symbolic.differentiate(expr, problem.variable));
    }
  }
});

test("checkDerivativeAnswer: the revealed (true) derivative round-trips as correct, across many random instances and every difficulty", () => {
  for (const difficulty of DIFFICULTIES) {
    for (let i = 0; i < INSTANCES_PER_DIFFICULTY; i++) {
      const problem = generateDerivativeProblem(difficulty);
      const revealed = revealDerivative(problem);
      const result = checkDerivativeAnswer(problem, revealed);
      assert.equal(result.correct, true, `expression=${problem.expression} revealed=${revealed} message=${result.message}`);
    }
  }
});

test("checkDerivativeAnswer: an equivalent but differently-written correct answer is accepted (not a string comparison)", () => {
  // d/dx[x^2] = 2x, and so does d/dx[x+x] -- structurally different text, same value.
  const problem: DerivativeProblem = { expression: "x^2", variable: "x", difficulty: "easy" };
  const result = checkDerivativeAnswer(problem, "x + x");
  assert.equal(result.correct, true);
});

test("checkDerivativeAnswer: a wrong answer is rejected with a clear message", () => {
  const problem: DerivativeProblem = { expression: "x^2", variable: "x", difficulty: "easy" };
  const result = checkDerivativeAnswer(problem, "3*x");
  assert.equal(result.correct, false);
  assert.match(result.message, /disagreed/);
});

test("checkDerivativeAnswer: an unparseable answer is rejected with a clear message, not a crash", () => {
  const problem: DerivativeProblem = { expression: "x^2", variable: "x", difficulty: "easy" };
  const result = checkDerivativeAnswer(problem, "x +* 3");
  assert.equal(result.correct, false);
  assert.match(result.message, /Couldn't parse/);
});

test("checkDerivativeAnswer: known composite example (product rule)", () => {
  // d/dx[x*sin(x)] = sin(x) + x*cos(x)
  const problem: DerivativeProblem = { expression: "x*sin(x)", variable: "x", difficulty: "hard" };
  const correct = checkDerivativeAnswer(problem, "sin(x) + x*cos(x)");
  assert.equal(correct.correct, true);
  const wrong = checkDerivativeAnswer(problem, "cos(x)");
  assert.equal(wrong.correct, false);
});

test("revealDerivative: matches Symbolic.differentiate directly for a fixed example", () => {
  const problem: DerivativeProblem = { expression: "x^3 + exp(x)", variable: "x", difficulty: "medium" };
  const revealed = revealDerivative(problem);
  const expected = Symbolic.toString(Symbolic.simplify(Symbolic.differentiate("x^3 + exp(x)", "x")));
  assert.equal(revealed, expected);
});
