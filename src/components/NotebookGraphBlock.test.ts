import assert from "node:assert/strict";
import { test } from "node:test";
import type { Path2D } from "@johnhenry/math";
import { CellGraph } from "@johnhenry/math";
import { cellIdsMultiRow, cellIdsNotebookBlock } from "../lib/cell-ids.ts";
import { visiblePaths } from "./NotebookGraphBlock.tsx";

/** A minimal fake Path2D -- only `commands`/`stroke` are read by pathsToSvgDocument, mirrors svg-export.test.ts's own fixture. */
function fakePath(color: number): Path2D {
  return {
    stroke: { thickness: 1, color, alpha: 1, pixelHinting: false, scaleMode: "normal", caps: null, joints: null, miterLimit: 3 },
    commands: [
      { op: "moveTo" as const, x: 0, y: 0 },
      { op: "lineTo" as const, x: 1, y: 1 },
    ],
  } as Path2D;
}

/** Sets up a row with a real path value and a `visible` flag -- the state shape `visiblePaths` reads. */
function seedRow(graph: CellGraph, id: string, visible: boolean, path: Path2D): void {
  const ids = cellIdsMultiRow(id);
  graph.set(ids.visible, visible);
  graph.set(ids.path, path);
}

test("visiblePaths: returns every visible row's path, in row order", () => {
  const graph = new CellGraph();
  const blockIds = cellIdsNotebookBlock("block-1");
  const pathA = fakePath(0x2563eb);
  const pathB = fakePath(0xdc2626);
  seedRow(graph, "a", true, pathA);
  seedRow(graph, "b", true, pathB);
  graph.set(blockIds.expressionList, ["a", "b"]);
  assert.deepEqual(visiblePaths(graph, blockIds), [pathA, pathB]);
});

test("visiblePaths: skips a row whose visible flag is false", () => {
  const graph = new CellGraph();
  const blockIds = cellIdsNotebookBlock("block-1");
  const pathA = fakePath(0x2563eb);
  const pathB = fakePath(0xdc2626);
  seedRow(graph, "a", true, pathA);
  seedRow(graph, "b", false, pathB);
  graph.set(blockIds.expressionList, ["a", "b"]);
  assert.deepEqual(visiblePaths(graph, blockIds), [pathA]);
});

test("visiblePaths: skips a row whose path cell hasn't registered yet, even if visible was set to true", () => {
  const graph = new CellGraph();
  const blockIds = cellIdsNotebookBlock("block-1");
  const ids = cellIdsMultiRow("a");
  graph.set(ids.visible, true);
  // Deliberately NOT setting ids.path -- simulates a row mid-setup, before
  // its path cell has a real value. get() on an unregistered cell would
  // auto-create a placeholder and return undefined rather than throwing
  // (see cell-graph.ts's own ensure()), so this specifically exercises the
  // hasValue() gate rather than a try/catch.
  graph.set(blockIds.expressionList, ["a"]);
  assert.deepEqual(visiblePaths(graph, blockIds), []);
});

test("visiblePaths: an empty expression list returns an empty array", () => {
  const graph = new CellGraph();
  const blockIds = cellIdsNotebookBlock("block-1");
  graph.set(blockIds.expressionList, []);
  assert.deepEqual(visiblePaths(graph, blockIds), []);
});

test("visiblePaths: preserves the expressionList's own order, independent of visibility mix", () => {
  const graph = new CellGraph();
  const blockIds = cellIdsNotebookBlock("block-1");
  const pathA = fakePath(0x2563eb);
  const pathB = fakePath(0xdc2626);
  const pathC = fakePath(0x16a34a);
  seedRow(graph, "a", true, pathA);
  seedRow(graph, "b", false, pathB);
  seedRow(graph, "c", true, pathC);
  graph.set(blockIds.expressionList, ["a", "b", "c"]);
  assert.deepEqual(visiblePaths(graph, blockIds), [pathA, pathC]);
});
