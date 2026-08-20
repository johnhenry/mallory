import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_STATISTICS_STATE, decodeStatisticsState, encodeStatisticsState } from "./statistics-state.ts";

test("round-trips the default statistics state through encode/decode", () => {
  const fragment = encodeStatisticsState(DEFAULT_STATISTICS_STATE);
  assert.deepEqual(decodeStatisticsState(fragment), DEFAULT_STATISTICS_STATE);
});

test("round-trips a custom single-dataset state", () => {
  const state = {
    v: 2 as const,
    rows: [
      {
        data: "1, 2, 3",
        distType: "poisson" as const,
        distMean: "0",
        distSd: "1",
        distN: "10",
        distP: "0.5",
        distLambda: "3",
        distDf: "5",
        queryLower: "0",
        queryUpper: "5",
        color: 0x2563eb,
        visible: true,
      },
    ],
  };
  assert.deepEqual(decodeStatisticsState(encodeStatisticsState(state)), state);
});

test("unlimited independent datasets: a legacy v1 (single-dataset) fragment upgrades to a one-dataset v2 list", () => {
  const legacyV1 = {
    v: 1 as const,
    data: "2, 4, 4, 4, 5, 5, 7, 9",
    distType: "normal" as const,
    distMean: "0",
    distSd: "1",
    distN: "10",
    distP: "0.5",
    distLambda: "4",
    distDf: "5",
    queryLower: "-1",
    queryUpper: "1",
  };
  const encodeLegacy = encodeStatisticsState as unknown as (s: unknown) => string;
  const decoded = decodeStatisticsState(encodeLegacy(legacyV1));
  assert.ok(decoded);
  assert.equal(decoded!.v, 2);
  assert.equal(decoded!.rows.length, 1);
  assert.equal(decoded!.rows[0]?.data, legacyV1.data);
  assert.equal(decoded!.rows[0]?.distType, legacyV1.distType);
  assert.equal(decoded!.rows[0]?.distMean, legacyV1.distMean);
  assert.equal(decoded!.rows[0]?.queryLower, legacyV1.queryLower);
  assert.equal(decoded!.rows[0]?.queryUpper, legacyV1.queryUpper);
  assert.equal(decoded!.rows[0]?.color, 0x2563eb);
  assert.equal(decoded!.rows[0]?.visible, true);
});

test("unlimited independent datasets: a v2 state with several rows round-trips every row", () => {
  const state = {
    v: 2 as const,
    rows: [
      {
        data: "1, 2, 3, 4, 5",
        distType: "normal" as const,
        distMean: "0",
        distSd: "1",
        distN: "10",
        distP: "0.5",
        distLambda: "4",
        distDf: "5",
        queryLower: "-1",
        queryUpper: "1",
        color: 0x2563eb,
        visible: true,
      },
      {
        data: "10, 20, 30",
        distType: "chiSquare" as const,
        distMean: "0",
        distSd: "1",
        distN: "10",
        distP: "0.5",
        distLambda: "4",
        distDf: "3",
        queryLower: "0",
        queryUpper: "10",
        color: 0xdc2626,
        visible: false,
      },
    ],
  };
  assert.deepEqual(decodeStatisticsState(encodeStatisticsState(state)), state);
});

test("decodeStatisticsState returns null for garbage or wrong-shape input rather than throwing", () => {
  assert.equal(decodeStatisticsState("not-valid-base64url-json!!!"), null);
  assert.equal(decodeStatisticsState(""), null);
  const badFragment = encodeStatisticsState as unknown as (s: unknown) => string;
  assert.equal(decodeStatisticsState(badFragment({ v: 1, data: "1", distType: "not-a-type" })), null);
  assert.equal(decodeStatisticsState(badFragment({ v: 2, rows: "not-an-array" })), null);
});
