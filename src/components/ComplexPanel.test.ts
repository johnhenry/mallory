import assert from "node:assert/strict";
import { test } from "node:test";
import { CellGraph } from "../lib/cell-graph.ts";
import { cellIdsComplex } from "../lib/cell-ids.ts";
import { getCurrentComplexState } from "./ComplexPanel.tsx";

test("getCurrentComplexState reads back exactly what was written to each of the panel's cells (gallery save round-trip)", () => {
  const graph = new CellGraph();
  const ids = cellIdsComplex("complex-test");
  graph.set(ids.exprText, "z^3 - 1");
  graph.set(ids.probeRe, "2");
  graph.set(ids.probeIm, "-1");
  graph.set(ids.showRootsOfUnity, false);
  graph.set(ids.rootsN, "7");
  graph.set(ids.showConformalGrid, true);
  graph.set(ids.conformalGridType, "polar");
  graph.set(ids.conformalGridSpacing, "0.25");

  assert.deepEqual(getCurrentComplexState(graph, ids), {
    v: 2,
    exprText: "z^3 - 1",
    probeRe: "2",
    probeIm: "-1",
    showRootsOfUnity: false,
    rootsN: "7",
    showConformalGrid: true,
    conformalGridType: "polar",
    conformalGridSpacing: "0.25",
  });
});
