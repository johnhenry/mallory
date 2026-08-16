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
