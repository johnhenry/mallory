import assert from "node:assert/strict";
import { test } from "node:test";
import { CellGraph } from "@johnhenry/math";
import { analyzeGraph, parseEdgeListText, runBfs } from "./graph-ops.ts";

/**
 * Feasibility spike for issue #163 item 2 ("true CellGraph-level session
 * parity" -- can this app's reactive compute graph run with no DOM at
 * all, not just the block-level gallery read/write #163 item 1 already
 * covers). This test file runs under plain `node --test` with NO jsdom
 * shim (unlike `TilesPanel.test.ts`'s `jsx-test-loader.mjs`, which only
 * transforms JSX syntax -- it doesn't polyfill `window`/`document`), so a
 * passing run here is itself the empirical answer: `typeof window` is
 * `"undefined"` for the whole file.
 *
 * Finding: `CellGraph` (cell-graph.ts) itself has ZERO references to
 * `window`/`document` anywhere in its ~500 lines -- `set`/`define`/`get`/
 * `subscribe`/`subscribeAll` are plain data-structure + closure code, no
 * browser API at all. A panel's own *compute* pipeline (parse -> analyze
 * -> algorithm, matching GraphTheoryPanel's own `graph.define` chain) is
 * therefore trivially headless-viable: this test builds and drives one
 * with no rendering, no React, no DOM, and gets byte-identical results to
 * what the live panel computes.
 *
 * What this spike does NOT establish (out of scope, per the issue's own
 * "spike first, not a build" framing): most panels' `useXGraph()` seed
 * step reads `window.location.hash`/`getComputedStyle` for URL-state
 * hydration and theming -- both already guarded with
 * `typeof window !== "undefined"` checks (existing SSR-safety code, not
 * new), so they degrade gracefully rather than crash headlessly, but a
 * REAL agent-drivable session needs a way to seed state from something
 * other than a browser's URL bar (an MCP tool argument, presumably) and
 * canvas rendering has no headless analog at all (rasterizing was never
 * the point of "session parity" -- an agent doesn't need pixels, it needs
 * the same get/set/list contract WebMCP already gives an in-page agent).
 * Building that -- an MCP-facing "open a session, drive its cells, read
 * results" API with no DOM -- remains a real, not-yet-started project;
 * this spike only confirms the reactive core underneath it has no
 * structural blocker.
 */

test("headless spike: `typeof window` is genuinely undefined in this process (proves no jsdom/browser shim is silently making this easier than a real server environment)", () => {
  assert.equal(typeof window, "undefined");
  assert.equal(typeof document, "undefined");
});

test("headless spike: a CellGraph reactive pipeline (parse -> analyze -> BFS) computes correctly with zero DOM APIs available, matching GraphTheoryPanel's own graph.define chain shape", () => {
  const graph = new CellGraph();
  graph.set("edgeListText", "A B 4\nA C 2\nC B 1\nB D 5");
  graph.set("directed", false);
  graph.set("startVertex", "A");

  graph.define("graphResult", () => parseEdgeListText(graph.get<string>("edgeListText"), graph.get<boolean>("directed")));
  graph.define("analysis", () => analyzeGraph(graph.get("graphResult")));
  graph.define("bfsOrder", () => runBfs(graph.get("graphResult"), graph.get<string>("startVertex")).order);

  assert.deepEqual(graph.get("bfsOrder"), ["A", "B", "C", "D"]);
  const analysis = graph.get<ReturnType<typeof analyzeGraph>>("analysis");
  assert.equal(analysis.hasCycle, true);
  assert.equal(analysis.connectedComponents.length, 1);

  // Reactivity itself works headlessly too: a write propagates through the
  // whole define chain and downstream cells recompute lazily on next get().
  graph.set("startVertex", "D");
  assert.deepEqual(graph.get("bfsOrder"), ["D", "B", "A", "C"]);
});
