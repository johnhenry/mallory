import assert from "node:assert/strict";
import { encodeStateFragment } from "./url-fragment.ts";
import { test } from "node:test";
import {
  DEFAULT_MONTE_CARLO_STATE,
  decodeMonteCarloState,
  encodeMonteCarloState,
  isMonteCarloStateV1,
  isMonteCarloStateV2,
  type MonteCarloStateV1,
} from "./monte-carlo-state.ts";

test("encodeMonteCarloState/decodeMonteCarloState: round-trips the default state", () => {
  const encoded = encodeMonteCarloState(DEFAULT_MONTE_CARLO_STATE);
  const decoded = decodeMonteCarloState(encoded);
  assert.deepEqual(decoded, DEFAULT_MONTE_CARLO_STATE);
});

test("decodeMonteCarloState: returns null for garbage input rather than throwing", () => {
  assert.equal(decodeMonteCarloState("not-valid-base64url!!"), null);
});

test("decodeMonteCarloState: upgrades a v1 payload to v2, defaulting the integration fields", () => {
  const v1: MonteCarloStateV1 = {
    v: 1,
    seed: "7",
    dartCount: "1000",
    distType: "uniform",
    distMean: "0",
    distSd: "1",
    distA: "0",
    distB: "1",
    distRate: "1",
    distN: "10",
    distP: "0.5",
    distLambda: "4",
    sampleCount: "500",
  };
  const encoded = encodeStateFragment(v1);
  const decoded = decodeMonteCarloState(encoded);
  assert.ok(decoded);
  assert.equal(decoded.v, 2);
  assert.equal(decoded.seed, "7");
  assert.equal(decoded.distType, "uniform");
  assert.equal(decoded.integrandText, DEFAULT_MONTE_CARLO_STATE.integrandText);
  assert.equal(decoded.integrandA, DEFAULT_MONTE_CARLO_STATE.integrandA);
});

test("isMonteCarloStateV1/isMonteCarloStateV2: distinguish the two shapes by their v tag", () => {
  const v1: MonteCarloStateV1 = {
    v: 1,
    seed: "1",
    dartCount: "1",
    distType: "normal",
    distMean: "0",
    distSd: "1",
    distA: "0",
    distB: "1",
    distRate: "1",
    distN: "10",
    distP: "0.5",
    distLambda: "4",
    sampleCount: "1",
  };
  assert.equal(isMonteCarloStateV1(v1), true);
  assert.equal(isMonteCarloStateV2(v1), false);
  assert.equal(isMonteCarloStateV2(DEFAULT_MONTE_CARLO_STATE), true);
});
