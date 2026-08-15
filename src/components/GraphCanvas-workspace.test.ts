import assert from "node:assert/strict";
import { test } from "node:test";
import { CellGraph } from "../lib/cell-graph.ts";
import { cellIds, workspaceValueCellId } from "../lib/cell-ids.ts";

/**
 * Tests issue #42's workspace-fallback free-variable resolution against the
 * REAL singleton workspace graph (`getWorkspaceGraph()`), not a stand-in --
 * `computeParams` calls that singleton internally, and it only caches an
 * instance once `window` exists (SSR-safe by design; see
 * `workspace-graph.ts`'s own doc comment), so `setupTestDom()` must run
 * before importing `GraphCanvas.tsx` for `computeParams` to see a
 * persistent (not fresh-every-call) workspace graph, matching what a real
 * browser session gets. Distinct variable names per test avoid
 * cross-test interference on the shared singleton.
 */
const { setupTestDom } = await import("../lib/test-dom.ts");
await setupTestDom();
const { computeParams } = await import("./GraphCanvas.tsx");
const { getWorkspaceGraph } = await import("../lib/workspace-graph.ts");

function setupPane(cellId: string): { graph: CellGraph; ids: ReturnType<typeof cellIds>; freeVarName: string } {
  const graph = new CellGraph();
  const ids = cellIds(cellId);
  const freeVarName = `wsvar_${cellId}`;
  graph.define(ids.freeVars, () => [freeVarName], { auxiliary: true });
  graph.set(ids.param(freeVarName), 1); // local slider default
  return { graph, ids, freeVarName };
}

test("computeParams: falls back to the local slider param when no workspace variable of that name exists", () => {
  const { graph, ids, freeVarName } = setupPane("pane-a");
  assert.deepEqual(computeParams(graph, ids), { [freeVarName]: 1 });
});

test("computeParams: a workspace variable overrides the local slider param entirely", () => {
  const { graph, ids, freeVarName } = setupPane("pane-b");
  getWorkspaceGraph().set(workspaceValueCellId(freeVarName), 5);
  assert.deepEqual(computeParams(graph, ids), { [freeVarName]: 5 });
});

test("the redefine-on-subscribeAll bridge propagates a workspace change to the pane's dependents (the mechanism GraphCanvas.tsx's useEffect drives)", () => {
  const { graph, ids, freeVarName } = setupPane("pane-c");
  const workspace = getWorkspaceGraph();

  graph.define(ids.params, () => computeParams(graph, ids));

  // A downstream cell standing in for `ids.path` -- proves the change
  // propagates PAST `ids.params` to whatever depends on it, not just to
  // `ids.params` itself.
  graph.define(ids.derivative, () => {
    const params = graph.get<Record<string, number>>(ids.params);
    return params[freeVarName];
  });

  assert.equal(graph.get(ids.derivative), 1);

  // The exact bridge GraphCanvas.tsx's own useEffect installs.
  const unsubscribe = workspace.subscribeAll(() => {
    graph.define(ids.params, () => computeParams(graph, ids));
  });

  workspace.set(workspaceValueCellId(freeVarName), 5);
  assert.equal(graph.get(ids.derivative), 5);

  workspace.set(workspaceValueCellId(freeVarName), 42);
  assert.equal(graph.get(ids.derivative), 42);

  unsubscribe();
});
