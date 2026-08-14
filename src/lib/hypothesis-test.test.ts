import assert from "node:assert/strict";
import { test } from "node:test";
import { runHypothesisTest } from "./hypothesis-test.ts";

test("oneSampleT: rejects a null hypothesis clearly contradicted by the sample", () => {
  // Sample tightly clustered around 10, testing against mu0=0 -- should reject overwhelmingly.
  const sample = [9.8, 10.1, 9.9, 10.2, 10.0, 9.95, 10.05];
  const outcome = runHypothesisTest("oneSampleT", { sample, mu0: 0, alpha: 0.05 });
  assert.ok(outcome.ok);
  if (outcome.ok && outcome.testType === "oneSampleT") {
    assert.ok(outcome.result.pValue < 0.05);
    assert.match(outcome.verdict, /^Reject H₀/);
  }
});

test("oneSampleT: fails to reject when the sample is consistent with mu0", () => {
  const sample = [9.8, 10.1, 9.9, 10.2, 10.0, 9.95, 10.05];
  const outcome = runHypothesisTest("oneSampleT", { sample, mu0: 10, alpha: 0.05 });
  assert.ok(outcome.ok);
  if (outcome.ok && outcome.testType === "oneSampleT") {
    assert.ok(outcome.result.pValue >= 0.05);
    assert.match(outcome.verdict, /^Fail to reject H₀/);
  }
});

test("oneSampleT: requires at least 2 data points", () => {
  const outcome = runHypothesisTest("oneSampleT", { sample: [5], mu0: 0, alpha: 0.05 });
  assert.equal(outcome.ok, false);
});

test("twoSampleT: rejects when the two samples are clearly different", () => {
  const a = [1, 2, 1.5, 2.2, 1.8];
  const b = [10, 11, 9.5, 10.5, 10.2];
  const outcome = runHypothesisTest("twoSampleT", { sample: a, sampleB: b, alpha: 0.05 });
  assert.ok(outcome.ok);
  if (outcome.ok && outcome.testType === "twoSampleT") {
    assert.ok(outcome.result.pValue < 0.05);
    assert.match(outcome.verdict, /^Reject H₀/);
  }
});

test("twoSampleT: fails to reject when the two samples are drawn from the same distribution", () => {
  const a = [5.1, 4.9, 5.0, 5.2, 4.8, 5.05];
  const b = [4.95, 5.1, 5.0, 4.85, 5.15, 5.02];
  const outcome = runHypothesisTest("twoSampleT", { sample: a, sampleB: b, alpha: 0.05 });
  assert.ok(outcome.ok);
  if (outcome.ok && outcome.testType === "twoSampleT") {
    assert.ok(outcome.result.pValue >= 0.05);
  }
});

test("chiSquareGoF: rejects a fair-die hypothesis given a heavily loaded sample", () => {
  const observed = [5, 5, 5, 5, 5, 300]; // massively over-represented 6
  const expected = [55, 55, 55, 55, 55, 55];
  const outcome = runHypothesisTest("chiSquareGoF", { sample: observed, expected, alpha: 0.05 });
  assert.ok(outcome.ok);
  if (outcome.ok && outcome.testType === "chiSquareGoF") {
    assert.ok(outcome.result.pValue < 0.05);
  }
});

test("chiSquareGoF: requires observed and expected to have matching lengths", () => {
  const outcome = runHypothesisTest("chiSquareGoF", { sample: [1, 2, 3], expected: [1, 2], alpha: 0.05 });
  assert.equal(outcome.ok, false);
});

test("chiSquareGoF: rejects non-positive expected frequencies", () => {
  const outcome = runHypothesisTest("chiSquareGoF", { sample: [1, 2], expected: [1, 0], alpha: 0.05 });
  assert.equal(outcome.ok, false);
});

test("confidenceInterval: the sample mean falls inside its own confidence interval", () => {
  const sample = [4, 5, 6, 5, 5, 4, 6, 5];
  const outcome = runHypothesisTest("confidenceInterval", { sample, alpha: 0.05 });
  assert.ok(outcome.ok);
  if (outcome.ok && outcome.testType === "confidenceInterval") {
    const mean = sample.reduce((a, b) => a + b, 0) / sample.length;
    assert.ok(outcome.interval[0] <= mean && mean <= outcome.interval[1]);
    assert.ok(outcome.interval[0] < outcome.interval[1]);
  }
});

test("confidenceInterval: a wider confidence level produces a wider interval", () => {
  const sample = [4, 5, 6, 5, 5, 4, 6, 5, 7, 3];
  const narrow = runHypothesisTest("confidenceInterval", { sample, alpha: 0.05, level: 0.8 });
  const wide = runHypothesisTest("confidenceInterval", { sample, alpha: 0.05, level: 0.99 });
  assert.ok(narrow.ok && wide.ok);
  if (narrow.ok && narrow.testType === "confidenceInterval" && wide.ok && wide.testType === "confidenceInterval") {
    const narrowWidth = narrow.interval[1] - narrow.interval[0];
    const wideWidth = wide.interval[1] - wide.interval[0];
    assert.ok(wideWidth > narrowWidth);
  }
});

test("rejects an out-of-range alpha", () => {
  assert.equal(runHypothesisTest("oneSampleT", { sample: [1, 2, 3], mu0: 0, alpha: 0 }).ok, false);
  assert.equal(runHypothesisTest("oneSampleT", { sample: [1, 2, 3], mu0: 0, alpha: 1 }).ok, false);
});
