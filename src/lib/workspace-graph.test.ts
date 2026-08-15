import assert from "node:assert/strict";
import { test } from "node:test";
import { getWorkspaceGraph } from "./workspace-graph.ts";

test("getWorkspaceGraph: without a window (SSR), returns a fresh throwaway graph on every call -- no state leaks across requests", () => {
  assert.equal(typeof window, "undefined");
  const a = getWorkspaceGraph();
  const b = getWorkspaceGraph();
  assert.notEqual(a, b);
  a.set("workspace:k", 1);
  assert.equal(b.hasValue("workspace:k"), false);
});

test("getWorkspaceGraph: with a window (client), returns the SAME cached instance every call -- proves it's a genuine singleton, not a lookalike per-call construction", async () => {
  const { setupTestDom } = await import("./test-dom.ts");
  await setupTestDom();
  const a = getWorkspaceGraph();
  const b = getWorkspaceGraph();
  assert.equal(a, b);
  a.set("workspace:k", 42);
  assert.equal(b.get("workspace:k"), 42);
});
