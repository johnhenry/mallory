import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_GRAPH_THEORY_STATE, decodeGraphTheoryState, encodeGraphTheoryState, isGraphTheoryStateV1 } from "./graph-theory-state.ts";

test("encodeGraphTheoryState/decodeGraphTheoryState: round-trips the default state", () => {
  const decoded = decodeGraphTheoryState(encodeGraphTheoryState(DEFAULT_GRAPH_THEORY_STATE));
  assert.deepEqual(decoded, DEFAULT_GRAPH_THEORY_STATE);
});

test("decodeGraphTheoryState: returns null for garbage input rather than throwing", () => {
  assert.equal(decodeGraphTheoryState("not-valid-base64url!!"), null);
});

test("isGraphTheoryStateV1: accepts a pre-editor state missing showEditor/edgeWeight entirely (an old encoded URL hash)", () => {
  const preEditorState = { v: 1, edgeListText: "A B 1", directed: false, startVertex: "A", endVertex: "B", algorithm: "bfs" };
  assert.equal(isGraphTheoryStateV1(preEditorState), true);
});

test("isGraphTheoryStateV1: rejects an editor field with the wrong type when present", () => {
  const badShowEditor = { ...DEFAULT_GRAPH_THEORY_STATE, showEditor: "yes" };
  assert.equal(isGraphTheoryStateV1(badShowEditor), false);
  const badEdgeWeight = { ...DEFAULT_GRAPH_THEORY_STATE, edgeWeight: 1 };
  assert.equal(isGraphTheoryStateV1(badEdgeWeight), false);
});

test("encodeGraphTheoryState/decodeGraphTheoryState: round-trips the full state including editor fields", () => {
  const state = { ...DEFAULT_GRAPH_THEORY_STATE, showEditor: true, edgeWeight: "3.5" };
  const decoded = decodeGraphTheoryState(encodeGraphTheoryState(state));
  assert.deepEqual(decoded, state);
});

test("isGraphTheoryStateV1: accepts a pre-animation state missing showAnimation entirely (an old encoded URL hash)", () => {
  const preAnimationState = { v: 1, edgeListText: "A B 1", directed: false, startVertex: "A", endVertex: "B", algorithm: "bfs", showEditor: false, edgeWeight: "1" };
  assert.equal(isGraphTheoryStateV1(preAnimationState), true);
});

test("isGraphTheoryStateV1: rejects a showAnimation field with the wrong type when present", () => {
  const badShowAnimation = { ...DEFAULT_GRAPH_THEORY_STATE, showAnimation: "yes" };
  assert.equal(isGraphTheoryStateV1(badShowAnimation), false);
});

test("encodeGraphTheoryState/decodeGraphTheoryState: round-trips showAnimation=true", () => {
  const state = { ...DEFAULT_GRAPH_THEORY_STATE, showAnimation: true };
  const decoded = decodeGraphTheoryState(encodeGraphTheoryState(state));
  assert.deepEqual(decoded, state);
});

test("isGraphTheoryStateV1: accepts a pre-vertexPositions state missing the field entirely (an old encoded URL hash)", () => {
  const preVertexPositionsState = { v: 1, edgeListText: "A B 1", directed: false, startVertex: "A", endVertex: "B", algorithm: "bfs", showEditor: true, edgeWeight: "1", showAnimation: false };
  assert.equal(isGraphTheoryStateV1(preVertexPositionsState), true);
});

test("encodeGraphTheoryState/decodeGraphTheoryState: round-trips editor-placed vertex positions, hand-computed", () => {
  const state = { ...DEFAULT_GRAPH_THEORY_STATE, showEditor: true, vertexPositions: { A: { x: 0.5, y: -0.3 }, G: { x: 1, y: 1 } } };
  const decoded = decodeGraphTheoryState(encodeGraphTheoryState(state));
  assert.deepEqual(decoded, state);
});

test("encodeGraphTheoryState/decodeGraphTheoryState: an empty vertexPositions object round-trips too", () => {
  const state = { ...DEFAULT_GRAPH_THEORY_STATE, vertexPositions: {} };
  const decoded = decodeGraphTheoryState(encodeGraphTheoryState(state));
  assert.deepEqual(decoded, state);
});

test("isGraphTheoryStateV1: rejects a vertexPositions value that isn't an object, or whose entries are missing/wrongly-typed x/y", () => {
  assert.equal(isGraphTheoryStateV1({ ...DEFAULT_GRAPH_THEORY_STATE, vertexPositions: "nope" }), false);
  assert.equal(isGraphTheoryStateV1({ ...DEFAULT_GRAPH_THEORY_STATE, vertexPositions: { A: { x: 1 } } }), false);
  assert.equal(isGraphTheoryStateV1({ ...DEFAULT_GRAPH_THEORY_STATE, vertexPositions: { A: { x: "1", y: 2 } } }), false);
  assert.equal(isGraphTheoryStateV1({ ...DEFAULT_GRAPH_THEORY_STATE, vertexPositions: { A: null } }), false);
  assert.equal(isGraphTheoryStateV1({ ...DEFAULT_GRAPH_THEORY_STATE, vertexPositions: null }), false);
});
