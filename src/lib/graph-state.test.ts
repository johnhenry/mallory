import assert from "node:assert/strict";
import { encodeStateFragment } from "./url-fragment.ts";
import { test } from "node:test";
import { DEFAULT_GRAPH_STATE, decodeGraphState, encodeGraphState, type GraphState } from "./graph-state.ts";

test("round-trips the default graph state through encode/decode", () => {
  const fragment = encodeGraphState(DEFAULT_GRAPH_STATE);
  assert.deepEqual(decodeGraphState(fragment), DEFAULT_GRAPH_STATE);
});

test("round-trips unicode expression sources", () => {
  const state = { ...DEFAULT_GRAPH_STATE, cells: [{ id: "f", source: "sin(θ) + π", params: {}, structureModulus: null }] };
  const fragment = encodeGraphState(state);
  assert.deepEqual(decodeGraphState(fragment), state);
});

test("encoded fragment is URL-fragment-safe (no +, /, or = padding)", () => {
  const fragment = encodeGraphState(DEFAULT_GRAPH_STATE);
  assert.ok(!/[+/=]/.test(fragment), `fragment contains unsafe characters: ${fragment}`);
});

test("decode returns null for malformed input instead of throwing", () => {
  assert.equal(decodeGraphState("not-valid-base64!!"), null);
  assert.equal(decodeGraphState(""), null);
});

test("decode rejects a differently-shaped payload", () => {
  const notAGraphState = encodeStateFragment({ hello: "world" });
  assert.equal(decodeGraphState(notAGraphState), null);
});

test("round-trips per-cell params, structureModulus, and a global mode", () => {
  const state = {
    ...DEFAULT_GRAPH_STATE,
    cells: [{ id: "f", source: "a*x^2+b", params: { a: 2, b: -1 }, structureModulus: 7 }],
    mode: "exact" as const,
  };
  const fragment = encodeGraphState(state);
  assert.deepEqual(decodeGraphState(fragment), state);
});

test("round-trips multiple panes, each with independent params/structureModulus", () => {
  const state: GraphState = {
    v: 3,
    cells: [
      { id: "pane-a", source: "sin(x)", params: {}, structureModulus: null },
      { id: "pane-b", source: "a*x^2+b", params: { a: 2, b: -1 }, structureModulus: 5 },
    ],
    viewport: DEFAULT_GRAPH_STATE.viewport,
    mode: "float",
  };
  const fragment = encodeGraphState(state);
  assert.deepEqual(decodeGraphState(fragment), state);
});

test("upgrades a v1 fragment (no params/structureModulus/mode) to v3 defaults", () => {
  const v1 = { v: 1, cells: [{ id: "f", source: "x^2" }], viewport: DEFAULT_GRAPH_STATE.viewport };
  const fragment = encodeStateFragment(v1);
  assert.deepEqual(decodeGraphState(fragment), {
    v: 3,
    cells: [{ id: "f", source: "x^2", params: {}, structureModulus: null }],
    viewport: v1.viewport,
    mode: "float",
  });
});

test("upgrades a v2 fragment, folding its global params/structureModulus into the first cell only", () => {
  const v2 = {
    v: 2,
    cells: [
      { id: "f", source: "a*x" },
      { id: "g", source: "x^2" },
    ],
    viewport: DEFAULT_GRAPH_STATE.viewport,
    params: { a: 3 },
    structureModulus: 7,
    mode: "exact" as const,
  };
  const fragment = encodeStateFragment(v2);
  assert.deepEqual(decodeGraphState(fragment), {
    v: 3,
    cells: [
      { id: "f", source: "a*x", params: { a: 3 }, structureModulus: 7 },
      { id: "g", source: "x^2", params: {}, structureModulus: null },
    ],
    viewport: v2.viewport,
    mode: "exact",
  });
});
