import { HypothesisTests, type TestResult } from "mallory-math";

export type HypothesisTestType = "oneSampleT" | "twoSampleT" | "chiSquareGoF" | "confidenceInterval";

export const HYPOTHESIS_TEST_LABELS: Record<HypothesisTestType, string> = {
  oneSampleT: "One-sample t-test",
  twoSampleT: "Two-sample t-test (Welch)",
  chiSquareGoF: "Chi-square goodness-of-fit",
  confidenceInterval: "Confidence interval for the mean",
};

export interface HypothesisTestOutcomeTest {
  ok: true;
  testType: "oneSampleT" | "twoSampleT" | "chiSquareGoF";
  result: TestResult;
  /** Plain-language verdict at the given significance level -- reject/fail-to-reject H0. */
  verdict: string;
}

export interface HypothesisTestOutcomeInterval {
  ok: true;
  testType: "confidenceInterval";
  interval: [number, number];
}

export type HypothesisTestOutcome = HypothesisTestOutcomeTest | HypothesisTestOutcomeInterval;
export type HypothesisTestResult = HypothesisTestOutcome | { ok: false; message: string };

/** "Reject H0" iff the p-value falls below the chosen significance level -- the standard frequentist decision rule, phrased explicitly rather than left for the reader to infer from a bare p-value. */
function verdictFor(pValue: number, alpha: number): string {
  return pValue < alpha
    ? `Reject H₀ at α = ${alpha} (p = ${pValue.toFixed(4)} < ${alpha})`
    : `Fail to reject H₀ at α = ${alpha} (p = ${pValue.toFixed(4)} ≥ ${alpha})`;
}

/**
 * Runs one of the four inference procedures `HypothesisTests`/`Distributions`
 * expose, uniformly validated and packaged for the Statistics panel's
 * "Inference" section. Each branch is pure input validation plus a single
 * call into mallory-math -- no new statistical logic is implemented here.
 */
export function runHypothesisTest(
  testType: HypothesisTestType,
  params: { sample: number[]; sampleB?: number[]; mu0?: number; expected?: number[]; alpha: number; level?: number },
): HypothesisTestResult {
  const { sample, sampleB, mu0, expected, alpha, level } = params;
  try {
    if (alpha <= 0 || alpha >= 1) throw new Error("α must be strictly between 0 and 1.");
    switch (testType) {
      case "oneSampleT": {
        if (sample.length < 2) throw new Error("Need at least 2 data points.");
        if (mu0 === undefined || Number.isNaN(mu0)) throw new Error("μ₀ must be a number.");
        const result = HypothesisTests.tTestOneSample(sample, mu0);
        return { ok: true, testType, result, verdict: verdictFor(result.pValue, alpha) };
      }
      case "twoSampleT": {
        if (sample.length < 2 || !sampleB || sampleB.length < 2) throw new Error("Both samples need at least 2 data points.");
        const result = HypothesisTests.tTestTwoSample(sample, sampleB);
        return { ok: true, testType, result, verdict: verdictFor(result.pValue, alpha) };
      }
      case "chiSquareGoF": {
        if (!expected || expected.length === 0) throw new Error("Enter expected frequencies.");
        if (sample.length !== expected.length) throw new Error("Observed and expected must have the same number of categories.");
        if (expected.some((e) => e <= 0)) throw new Error("Expected frequencies must be positive.");
        const result = HypothesisTests.chiSquareGoodnessOfFit(sample, expected);
        return { ok: true, testType, result, verdict: verdictFor(result.pValue, alpha) };
      }
      case "confidenceInterval": {
        if (sample.length < 2) throw new Error("Need at least 2 data points.");
        const lvl = level ?? 1 - alpha;
        if (lvl <= 0 || lvl >= 1) throw new Error("Confidence level must be strictly between 0 and 1.");
        const interval = HypothesisTests.confidenceIntervalMean(sample, lvl);
        return { ok: true, testType, interval };
      }
    }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
