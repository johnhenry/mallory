import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_GRADIENT_DESCENT_STATE,
  decodeGradientDescentState,
  encodeGradientDescentState,
  isGradientDescentStateV1,
} from "./gradient-descent-state.ts";

test("isGradientDescentStateV1: accepts a pre-#33 state missing the schedule fields entirely (an old encoded URL hash)", () => {
  const preScheduleState = {
    v: 1,
    exprText: "x^2 + y^2",
    startX: "1",
    startY: "1",
    lr: "0.1",
    steps: "20",
    showSgd: true,
    showAdam: false,
    showRmsprop: false,
  };
  assert.equal(isGradientDescentStateV1(preScheduleState), true);
});

test("isGradientDescentStateV1: rejects a schedule field with the wrong type when present", () => {
  const badUseSchedule = { ...DEFAULT_GRADIENT_DESCENT_STATE, useSchedule: "yes" };
  assert.equal(isGradientDescentStateV1(badUseSchedule), false);
  const badStepSize = { ...DEFAULT_GRADIENT_DESCENT_STATE, stepSize: 10 };
  assert.equal(isGradientDescentStateV1(badStepSize), false);
});

test("decodeGradientDescentState: a pre-#33 encoded fragment (no schedule fields) decodes successfully rather than falling back to defaults", () => {
  const preScheduleState = {
    v: 1,
    exprText: "x^2 + y^2",
    startX: "1",
    startY: "1",
    lr: "0.1",
    steps: "20",
    showSgd: true,
    showAdam: false,
    showRmsprop: false,
  };
  const encoded = encodeGradientDescentState(preScheduleState as never);
  const decoded = decodeGradientDescentState(encoded);
  assert.notEqual(decoded, null);
  assert.equal(decoded?.exprText, "x^2 + y^2");
  assert.equal(decoded?.useSchedule, undefined);
});

test("encodeGradientDescentState/decodeGradientDescentState round-trips the full state including the new schedule fields", () => {
  const state = { ...DEFAULT_GRADIENT_DESCENT_STATE, useSchedule: true, stepSize: "5", gamma: "0.9" };
  const decoded = decodeGradientDescentState(encodeGradientDescentState(state));
  assert.deepEqual(decoded, state);
});
