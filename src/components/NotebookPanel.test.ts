/**
 * Unit tests for `hydrateBlocks`/`disposeBlockCells`/`STABLE_ID_BLOCK_TYPES`
 * (issue #238): `hydrateBlocks` doubles as NotebookPanel's undo/redo restore
 * function, and used to unconditionally mint a fresh `crypto.randomUUID()`
 * for EVERY block on every restore -- forcing every block's `<div
 * key={id}>` to unmount/remount on a single undo/redo step (not just
 * "graph"/"value" as an earlier version of NotebookPanel's own doc comment
 * claimed), leaking that block's old CellGraph cells in the process since
 * nothing ever cleaned up the id it stopped using.
 *
 * These tests exercise `hydrateBlocks`/`disposeBlockCells` directly against
 * a real `CellGraph` -- no React rendering needed, matching this codebase's
 * existing convention for testing exported pure helpers extracted from a
 * component (see e.g. GraphCanvasMulti.test.ts's `getMultiGraphSvg`).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { CellGraph } from "../lib/cell-graph.ts";
import { cellIdsGeometry, cellIdsOde, cellIdsNotebookBlock, notebookValueCellId } from "../lib/cell-ids.ts";
import { DEFAULT_ODE_STATE } from "../lib/ode-state.ts";
import type { NotebookState } from "../lib/notebook-state.ts";
import { disposeBlockCells, hydrateBlocks, STABLE_ID_BLOCK_TYPES, type Block } from "./NotebookPanel.tsx";

/** A representative mix covering every "stable" type and a sample of "remount-needing" types. */
function mixedState(overrides?: { valueValue?: number; odeExpr?: string }): NotebookState {
  return {
    v: 1,
    blocks: [
      { type: "text", content: "hello" },
      { type: "value", name: "k", value: overrides?.valueValue ?? 1 },
      { type: "graph", rows: [{ source: "sin(x)", color: 0x2563eb, visible: true, params: {} }], viewport: { xMin: -10, xMax: 10, yMin: -10, yMax: 10 } },
      { type: "tensor", source: "1 2\n3 4", op: "none" },
      { type: "calculator" },
      {
        type: "ode",
        state: {
          ...DEFAULT_ODE_STATE,
          rows: [{ x0: "0", y0: "1", color: 0x2563eb, visible: true, expr: overrides?.odeExpr ?? "x - y" }],
        },
      },
      { type: "geometry", state: { v: 1, ops: [] } },
    ],
  };
}

test("hydrateBlocks: initial (mount-time) hydrate mints a fresh id for every block", () => {
  const graph = new CellGraph();
  const blocks = hydrateBlocks(graph, mixedState());
  const ids = blocks.map((b) => b.id);
  assert.equal(new Set(ids).size, ids.length, "every block gets its own id");
  for (const id of ids) assert.match(id, /^[0-9a-f-]{36}$/);
});

test("hydrateBlocks (restore): text/value/graph/tensor keep their existing id; ode/geometry get a fresh one", () => {
  const graph = new CellGraph();
  const initial = hydrateBlocks(graph, mixedState());

  const restored = hydrateBlocks(graph, mixedState(), initial);

  assert.equal(restored.length, initial.length);
  restored.forEach((block, i) => {
    const before = initial[i]!;
    assert.equal(block.type, before.type);
    if (STABLE_ID_BLOCK_TYPES.has(block.type)) {
      assert.equal(block.id, before.id, `${block.type} block at index ${i} must keep its id across restore`);
    } else {
      assert.notEqual(block.id, before.id, `${block.type} block at index ${i} must get a fresh id (its wrapper only seeds once on mount)`);
    }
  });

  // Sanity: every stable type is actually represented in the mix above, and
  // every non-stable type used here is NOT in the stable set -- guards
  // against the mix silently losing coverage of one branch or the other.
  const typesInMix = new Set(initial.map((b) => b.type));
  assert.ok(["text", "value", "graph", "tensor", "calculator"].every((t) => typesInMix.has(t as Block["type"])));
  assert.ok(["ode", "geometry"].every((t) => typesInMix.has(t as Block["type"]) && !STABLE_ID_BLOCK_TYPES.has(t as Block["type"])));
});

test("hydrateBlocks (restore): a stable-id block's CellGraph state is reused in place, not reset/lost", () => {
  const graph = new CellGraph();
  const initial = hydrateBlocks(graph, mixedState({ valueValue: 5 }));
  const graphBlock = initial.find((b) => b.type === "graph")!;
  const blockIds = cellIdsNotebookBlock(graphBlock.id);

  // Simulate an unrelated edit having happened after mount (e.g. the user
  // panned the graph block's viewport) -- something a fresh remount would
  // have no way to preserve.
  graph.set(blockIds.viewport, { xMin: -1, xMax: 1, yMin: -1, yMax: 1 }, { auxiliary: true });

  // Restore back to a state where the value block's number differs (5 -> 1,
  // as a real undo would) but the graph block's content is unchanged.
  const restored = hydrateBlocks(graph, mixedState({ valueValue: 1 }), initial);

  const restoredGraphBlock = restored.find((b) => b.type === "graph")!;
  assert.equal(restoredGraphBlock.id, graphBlock.id, "graph block keeps its id (same viewport/expressionList cell ids)");
  // seedGraphBlock re-applies the (unchanged) viewport from state on every
  // hydrate -- the cell is still there, addressable under the SAME id, not
  // deleted and orphaned under a new one.
  assert.ok(graph.hasValue(blockIds.viewport), "graph block's viewport cell still exists under the reused id");

  const restoredValueBlock = restored.find((b) => b.type === "value")!;
  const initialValueBlock = initial.find((b) => b.type === "value")!;
  assert.equal(restoredValueBlock.id, initialValueBlock.id, "value block keeps its id");
  assert.equal(graph.get<number>(notebookValueCellId("k")), 1, "value cell correctly reflects the restored (undone) value");
});

test("hydrateBlocks (restore): a replaced remount-needing block's old CellGraph cells are disposed", () => {
  const graph = new CellGraph();
  const initial = hydrateBlocks(graph, mixedState());
  const odeBlock = initial.find((b) => b.type === "ode")!;
  const geometryBlock = initial.find((b) => b.type === "geometry")!;

  // Simulate what NotebookOdeBlock's/NotebookGeometryBlock's own mount
  // effect would have seeded into the graph for these ids (hydrateBlocks
  // itself never seeds these types -- see its own doc comment).
  const oldOdeIds = cellIdsOde(odeBlock.id);
  graph.set(oldOdeIds.expr, "x - y");
  const oldGeometryIds = cellIdsGeometry(geometryBlock.id);
  graph.set(oldGeometryIds.objectList, ["obj-1"], { auxiliary: true });

  const restored = hydrateBlocks(graph, mixedState({ odeExpr: "x + y" }), initial);
  const restoredOdeBlock = restored.find((b) => b.type === "ode")!;
  const restoredGeometryBlock = restored.find((b) => b.type === "geometry")!;

  assert.notEqual(restoredOdeBlock.id, odeBlock.id);
  assert.notEqual(restoredGeometryBlock.id, geometryBlock.id);
  assert.equal(graph.has(oldOdeIds.expr), false, "old ode block's cell is disposed, not leaked");
  assert.equal(graph.has(oldGeometryIds.objectList), false, "old geometry block's cell is disposed, not leaked");
});

test("hydrateBlocks (restore): a stable-id block is never passed to disposal (its cells survive even though it 'changed position' in the previous list)", () => {
  const graph = new CellGraph();
  const initial = hydrateBlocks(graph, mixedState());
  const valueId = initial.find((b) => b.type === "value")!.id;

  hydrateBlocks(graph, mixedState(), initial);

  assert.ok(graph.hasValue(notebookValueCellId("k")), "value cell was never disposed");
  assert.equal(graph.get<number>(notebookValueCellId("k")), 1);
  void valueId;
});

test("disposeBlockCells: value block -- deletes its name-keyed cell unless another still-active block shares the name", () => {
  const graph = new CellGraph();
  graph.set(notebookValueCellId("k"), 7);
  const block: Block = { id: "v1", type: "value", name: "k", value: 7 };

  disposeBlockCells(graph, block, new Set(["k"]));
  assert.equal(graph.hasValue(notebookValueCellId("k")), true, "still-active name is preserved");

  disposeBlockCells(graph, block, new Set());
  assert.equal(graph.hasValue(notebookValueCellId("k")), false, "cell is deleted once no longer active anywhere");
});

test("disposeBlockCells: geometry block -- deletes only its own objectList/opsLog cells (pre-existing partial-cleanup contract, unchanged by issue #238)", () => {
  const graph = new CellGraph();
  const block: Block = { id: "g1", type: "geometry", initialOps: [] };
  const ids = cellIdsGeometry("g1");
  graph.set(ids.objectList, ["obj-1"], { auxiliary: true });
  graph.set(ids.opsLog, [], { auxiliary: true });

  disposeBlockCells(graph, block, new Set());

  assert.equal(graph.has(ids.objectList), false);
  assert.equal(graph.has(ids.opsLog), false);
});

test("disposeBlockCells: text/tensor/calculator blocks own no CellGraph cells -- a no-op that doesn't throw", () => {
  const graph = new CellGraph();
  const textBlock: Block = { id: "t1", type: "text", content: "hi" };
  const tensorBlock: Block = {
    id: "tn1",
    type: "tensor",
    source: "1 2\n3 4",
    op: "none",
    opArg: 1,
    sourceMode: "literal",
    curveName: "",
    splitEnabled: false,
    splitAxis: 0,
    splitSections: "2",
  };
  const calculatorBlock: Block = { id: "c1", type: "calculator" };
  assert.doesNotThrow(() => disposeBlockCells(graph, textBlock, new Set()));
  assert.doesNotThrow(() => disposeBlockCells(graph, tensorBlock, new Set()));
  assert.doesNotThrow(() => disposeBlockCells(graph, calculatorBlock, new Set()));
});
