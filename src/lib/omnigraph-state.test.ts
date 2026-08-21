import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_OMNIGRAPH_STATE,
  decodeOmnigraphState,
  encodeOmnigraphState,
  type OmnigraphItem,
  type OmnigraphState,
} from "./omnigraph-state.ts";

/** One representative of every variant in the union -- the exhaustive round-trip fixture the state file's own doc comment promises. */
const ONE_OF_EACH: OmnigraphItem[] = [
  { type: "expression", expr: "sin(x)", color: 0x2563eb, visible: true },
  { type: "parametric", exprA: "cos(3*t)", exprB: "sin(2*t)", tMin: "0", tMax: "6.283", color: 0xdc2626, visible: true },
  { type: "polar", exprA: "1+cos(t)", tMin: "0", tMax: "6.283", color: 0x16a34a, visible: false },
  { type: "implicit", expr: "x^2+y^2=4", color: 0xd97706, visible: true },
  { type: "complex", expr: "z^2", visible: true },
  { type: "surface", expr: "sin(x)*cos(y)", color: 0x9333ea, visible: true },
  {
    type: "parametricSurface",
    exprA: "(2+cos(v))*cos(u)",
    exprB: "(2+cos(v))*sin(u)",
    exprC: "sin(v)",
    uMin: "0",
    uMax: "6.283",
    vMin: "0",
    vMax: "6.283",
    color: 0x0891b2,
    visible: true,
  },
  { type: "spaceCurve", exprA: "cos(t)", exprB: "sin(t)", exprC: "0.15*t", tMin: "0", tMax: "12.566", color: 0x2563eb, visible: true },
  { type: "vectorField3d", exprA: "-y", exprB: "x", exprC: "0.2*z", color: 0xdc2626, visible: true },
  {
    type: "complexGraph3d",
    expr: "x^2",
    axisX: "reX",
    axisY: "reY",
    axisZ: "imY",
    tMin: "-2",
    tMax: "2",
    sweepReX: true,
    sweepImX: false,
    highlightNearReal: false,
    color: 0x16a34a,
    visible: true,
  },
  { type: "gradientDescent", expr: "x^2+y^2", startX: "3", startY: "-2", stepSize: "0.1", steps: "100", color: 0xd97706, visible: true },
];

test("round-trips the default state through encode/decode", () => {
  assert.deepEqual(decodeOmnigraphState(encodeOmnigraphState(DEFAULT_OMNIGRAPH_STATE)), DEFAULT_OMNIGRAPH_STATE);
});

test("round-trips a state containing one of EVERY item variant", () => {
  const state: OmnigraphState = { version: 1, viewport: { xMin: -3, xMax: 7, yMin: -1, yMax: 9 }, items: ONE_OF_EACH };
  assert.deepEqual(decodeOmnigraphState(encodeOmnigraphState(state)), state);
});

for (const item of ONE_OF_EACH) {
  test(`round-trips a single "${item.type}" item on its own`, () => {
    const state: OmnigraphState = { version: 1, viewport: { xMin: -5, xMax: 5, yMin: -5, yMax: 5 }, items: [item] };
    assert.deepEqual(decodeOmnigraphState(encodeOmnigraphState(state)), state);
  });
}

test("decodeOmnigraphState returns null for garbage input rather than throwing", () => {
  assert.equal(decodeOmnigraphState("not-valid-base64!!"), null);
  assert.equal(decodeOmnigraphState(""), null);
});

test("decodeOmnigraphState rejects a wrong version", () => {
  const state = { ...DEFAULT_OMNIGRAPH_STATE, version: 2 };
  assert.equal(decodeOmnigraphState(encodeOmnigraphState(state as unknown as OmnigraphState)), null);
});

test("decodeOmnigraphState rejects an unknown item type", () => {
  const state = { version: 1, viewport: { xMin: -5, xMax: 5, yMin: -5, yMax: 5 }, items: [{ type: "hologram", expr: "x", color: 1, visible: true }] };
  assert.equal(decodeOmnigraphState(encodeOmnigraphState(state as unknown as OmnigraphState)), null);
});

test("decodeOmnigraphState rejects an item missing a required field for its type", () => {
  const missingExprB = { version: 1, viewport: { xMin: -5, xMax: 5, yMin: -5, yMax: 5 }, items: [{ type: "parametric", exprA: "cos(t)", tMin: "0", tMax: "1", color: 1, visible: true }] };
  assert.equal(decodeOmnigraphState(encodeOmnigraphState(missingExprB as unknown as OmnigraphState)), null);
});

test("decodeOmnigraphState rejects a non-finite viewport", () => {
  const state = { version: 1, viewport: { xMin: -5, xMax: Number.NaN, yMin: -5, yMax: 5 }, items: [] };
  assert.equal(decodeOmnigraphState(encodeOmnigraphState(state as unknown as OmnigraphState)), null);
});

test("decodeOmnigraphState rejects an invalid complexGraph3d axis value", () => {
  const state = {
    version: 1,
    viewport: { xMin: -5, xMax: 5, yMin: -5, yMax: 5 },
    items: [
      {
        type: "complexGraph3d",
        expr: "x^2",
        axisX: "bogus",
        axisY: "reY",
        axisZ: "imY",
        tMin: "-2",
        tMax: "2",
        sweepReX: true,
        sweepImX: false,
        highlightNearReal: false,
        color: 1,
        visible: true,
      },
    ],
  };
  assert.equal(decodeOmnigraphState(encodeOmnigraphState(state as unknown as OmnigraphState)), null);
});

test("an empty items array is valid (empty surface, axes only)", () => {
  const state: OmnigraphState = { version: 1, viewport: { xMin: -5, xMax: 5, yMin: -5, yMax: 5 }, items: [] };
  assert.deepEqual(decodeOmnigraphState(encodeOmnigraphState(state)), state);
});
