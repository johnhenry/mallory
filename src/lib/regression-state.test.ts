import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_REGRESSION_STATE, decodeRegressionState, encodeRegressionState } from "./regression-state.ts";

test("round-trips the default regression state through encode/decode", () => {
  const fragment = encodeRegressionState(DEFAULT_REGRESSION_STATE);
  assert.deepEqual(decodeRegressionState(fragment), DEFAULT_REGRESSION_STATE);
});

test("round-trips a custom single-dataset state", () => {
  const state = {
    v: 2 as const,
    datasets: [
      {
        points: [
          { x: "0", y: "0" },
          { x: "1", y: "1" },
        ],
        fitType: "linear" as const,
        modelExpr: "a*x",
        paramGuesses: { a: "1" },
        color: 0x2563eb,
        visible: true,
      },
    ],
  };
  assert.deepEqual(decodeRegressionState(encodeRegressionState(state)), state);
});

test("unlimited overlaid datasets: a legacy v1 (single-dataset) fragment upgrades to a one-dataset v2 list", () => {
  const legacyV1 = {
    v: 1 as const,
    rows: [
      { x: "1", y: "2.1" },
      { x: "2", y: "3.9" },
    ],
    fitType: "linear" as const,
    modelExpr: "a*exp(b*x)",
    paramGuesses: { a: "1", b: "0.1" },
  };
  const encodeLegacy = encodeRegressionState as unknown as (s: unknown) => string;
  const decoded = decodeRegressionState(encodeLegacy(legacyV1));
  assert.ok(decoded);
  assert.equal(decoded!.v, 2);
  assert.equal(decoded!.datasets.length, 1);
  assert.deepEqual(decoded!.datasets[0]?.points, legacyV1.rows);
  assert.equal(decoded!.datasets[0]?.fitType, legacyV1.fitType);
  assert.equal(decoded!.datasets[0]?.modelExpr, legacyV1.modelExpr);
  assert.deepEqual(decoded!.datasets[0]?.paramGuesses, legacyV1.paramGuesses);
  assert.equal(decoded!.datasets[0]?.color, 0x2563eb);
  assert.equal(decoded!.datasets[0]?.visible, true);
});

test("unlimited overlaid datasets: a v2 state with several datasets round-trips every dataset", () => {
  const state = {
    v: 2 as const,
    datasets: [
      {
        points: [
          { x: "1", y: "2.1" },
          { x: "2", y: "3.9" },
        ],
        fitType: "linear" as const,
        modelExpr: "a*exp(b*x)",
        paramGuesses: { a: "1", b: "0.1" },
        color: 0x2563eb,
        visible: true,
      },
      {
        points: [
          { x: "0", y: "1" },
          { x: "1", y: "3" },
          { x: "2", y: "9" },
        ],
        fitType: "nonlinear" as const,
        modelExpr: "a*b^x",
        paramGuesses: { a: "1", b: "2" },
        color: 0xdc2626,
        visible: false,
      },
    ],
  };
  assert.deepEqual(decodeRegressionState(encodeRegressionState(state)), state);
});

test("decodeRegressionState returns null for garbage or wrong-shape input rather than throwing", () => {
  assert.equal(decodeRegressionState("not-valid-base64url-json!!!"), null);
  assert.equal(decodeRegressionState(""), null);
  const badFragment = encodeRegressionState as unknown as (s: unknown) => string;
  assert.equal(decodeRegressionState(badFragment({ v: 1, rows: "not-an-array" })), null);
  assert.equal(decodeRegressionState(badFragment({ v: 2, datasets: "not-an-array" })), null);
});
