import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  checkAnswer,
  difficultyOf,
  pickRandomProblem,
  practiceableProblems,
  problemsForDifficulty,
  type RubiCorpus,
  type RubiProblem,
} from "./integration-practice.ts";

// The real corpus, loaded straight from the public static asset -- this
// gives realistic coverage against the actual 771-problem dataset rather
// than a handful of hand-picked fixtures, and doubles as a regression check
// that the file this app actually fetches at runtime parses/behaves as
// expected.
const corpus = JSON.parse(readFileSync(new URL("../../public/rubi-corpus.json", import.meta.url), "utf8")) as RubiCorpus;

test("practiceableProblems: filters to problems with no extra parameters (152 of the corpus's 771)", () => {
  const practiceable = practiceableProblems(corpus);
  assert.equal(practiceable.length, 152);
  for (const p of practiceable) assert.equal(p.params.length, 0);
});

test("difficultyOf: buckets by the corpus's own steps field", () => {
  const easy: RubiProblem = { source: "", index: 0, integrand: "x", variable: "x", steps: 2, antiderivative: "x^2/2", params: [] };
  const medium: RubiProblem = { ...easy, steps: 4 };
  const hard: RubiProblem = { ...easy, steps: 9 };
  assert.equal(difficultyOf(easy), "easy");
  assert.equal(difficultyOf(medium), "medium");
  assert.equal(difficultyOf(hard), "hard");
});

test("problemsForDifficulty: 'any' returns every problem; a specific difficulty filters", () => {
  const practiceable = practiceableProblems(corpus);
  assert.equal(problemsForDifficulty(practiceable, "any").length, practiceable.length);
  const easy = problemsForDifficulty(practiceable, "easy");
  assert.ok(easy.length > 0 && easy.length < practiceable.length);
  for (const p of easy) assert.equal(difficultyOf(p), "easy");
});

test("pickRandomProblem: returns null for an empty list, and a member of a nonempty one", () => {
  assert.equal(pickRandomProblem([]), null);
  const practiceable = practiceableProblems(corpus);
  const picked = pickRandomProblem(practiceable);
  assert.ok(picked && practiceable.includes(picked));
});

test("checkAnswer: the corpus's own listed antiderivative is accepted as correct", () => {
  const problem = practiceableProblems(corpus).find((p) => p.integrand === "sqrt(1+2*x)");
  assert.ok(problem);
  const result = checkAnswer(problem!, problem!.antiderivative);
  assert.equal(result.correct, true);
});

test("checkAnswer: is robust to an additive constant (d/dx[F(x)+C] = d/dx[F(x)])", () => {
  const problem = practiceableProblems(corpus).find((p) => p.integrand === "sqrt(1+2*x)");
  assert.ok(problem);
  const result = checkAnswer(problem!, `${problem!.antiderivative} + 7`);
  assert.equal(result.correct, true);
});

test("checkAnswer: an equivalent but differently-written correct answer is accepted (not a string comparison)", () => {
  // d/dx[x^2] = 2x, and so does d/dx[x*x] -- structurally different text, same derivative.
  const problem: RubiProblem = { source: "", index: 0, integrand: "2*x", variable: "x", steps: 1, antiderivative: "x^2", params: [] };
  const result = checkAnswer(problem, "x*x");
  assert.equal(result.correct, true);
});

test("checkAnswer: a wrong answer is rejected with a clear message", () => {
  const problem: RubiProblem = { source: "", index: 0, integrand: "2*x", variable: "x", steps: 1, antiderivative: "x^2", params: [] };
  const result = checkAnswer(problem, "x^3");
  assert.equal(result.correct, false);
  assert.match(result.message, /disagreed/);
});

test("checkAnswer: an unparseable answer is rejected with a clear message, not a crash", () => {
  const problem: RubiProblem = { source: "", index: 0, integrand: "2*x", variable: "x", steps: 1, antiderivative: "x^2", params: [] };
  const result = checkAnswer(problem, "x +* 3");
  assert.equal(result.correct, false);
  assert.match(result.message, /Couldn't parse/);
});

test("checkAnswer: tolerance scales with the integrand's magnitude (large-value problems tolerate proportionally larger absolute slack)", () => {
  const problem: RubiProblem = { source: "", index: 0, integrand: "1000*x", variable: "x", steps: 1, antiderivative: "500*x^2", params: [] };
  // 500.01*x^2 differs from the exact antiderivative by a tiny relative amount --
  // negligible next to integrand values in the thousands, so it should still pass.
  const closeEnough = checkAnswer(problem, "500.01*x^2");
  assert.equal(closeEnough.correct, true);
  // But the same absolute-magnitude answer error against a small-valued integrand
  // is NOT negligible, and must still be rejected.
  const small: RubiProblem = { ...problem, integrand: "x", antiderivative: "x^2/2" };
  const notCloseEnough = checkAnswer(small, "0.51*x^2");
  assert.equal(notCloseEnough.correct, false);
});

test("checkAnswer: every practiceable problem's own listed antiderivative round-trips as correct (a regression check against the real corpus)", () => {
  const practiceable = practiceableProblems(corpus);
  const failures: string[] = [];
  for (const p of practiceable) {
    const result = checkAnswer(p, p.antiderivative);
    if (!result.correct) failures.push(`${p.integrand} -> ${p.antiderivative}: ${result.message}`);
  }
  // A small number of corpus entries are only valid in a complex/formal
  // sense for any real x (confirmed via direct sampling before writing this
  // suite) -- allow a small, explicit slack rather than 100%, so a genuine
  // regression (many failures) still fails this test loudly.
  assert.ok(failures.length <= 3, `expected at most 3 failures, got ${failures.length}:\n${failures.join("\n")}`);
});
