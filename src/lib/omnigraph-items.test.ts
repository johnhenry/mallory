import assert from "node:assert/strict";
import { test } from "node:test";
import { CellGraph } from "./cell-graph.ts";
import { cellIdsOmnigraphRow } from "./cell-ids.ts";
import { OMNIGRAPH_ITEM_TYPES, defaultOmnigraphItem, omnigraphIs3D, readOmnigraphItem, seedOmnigraphRow } from "./omnigraph-items.ts";
import type { OmnigraphItemType } from "./omnigraph-state.ts";

const ALL_TYPES = Object.keys(OMNIGRAPH_ITEM_TYPES) as OmnigraphItemType[];

test("OMNIGRAPH_ITEM_TYPES covers exactly the state union's 11 types", () => {
  assert.equal(ALL_TYPES.length, 11);
});

for (const type of ALL_TYPES) {
  test(`seed/read round-trip for "${type}": defaultOmnigraphItem -> cells -> readOmnigraphItem is lossless`, () => {
    const graph = new CellGraph();
    const item = defaultOmnigraphItem(type, 0xdc2626);
    seedOmnigraphRow(graph, "row-1", item);
    assert.deepEqual(readOmnigraphItem(graph, "row-1"), item);
  });
}

test("readOmnigraphItem returns null for a never-seeded row", () => {
  const graph = new CellGraph();
  assert.equal(readOmnigraphItem(graph, "ghost"), null);
});

test("readOmnigraphItem returns null for an unrecognized type value", () => {
  const graph = new CellGraph();
  graph.set(cellIdsOmnigraphRow("row-1").type, "hologram");
  assert.equal(readOmnigraphItem(graph, "row-1"), null);
});

test("seedOmnigraphRow over an existing row of a DIFFERENT type switches cleanly (type-switch path)", () => {
  const graph = new CellGraph();
  seedOmnigraphRow(graph, "row-1", defaultOmnigraphItem("parametric", 0x2563eb));
  seedOmnigraphRow(graph, "row-1", defaultOmnigraphItem("expression", 0x2563eb));
  assert.deepEqual(readOmnigraphItem(graph, "row-1"), defaultOmnigraphItem("expression", 0x2563eb));
});

test("omnigraphIs3D: false for all-2D, true as soon as any 3D type exists, regardless of visibility", () => {
  assert.equal(omnigraphIs3D([{ type: "expression" }, { type: "implicit" }, { type: "complex" }]), false);
  assert.equal(omnigraphIs3D([{ type: "expression" }, { type: "surface" }]), true);
  const hiddenSurface = { ...defaultOmnigraphItem("surface", 1), visible: false };
  assert.equal(omnigraphIs3D([hiddenSurface]), true, "existence, not visibility, drives the mode");
  assert.equal(omnigraphIs3D([]), false);
});

test("every 3D-flagged type is exactly the 3D-panel-derived set", () => {
  const threeD = ALL_TYPES.filter((t) => OMNIGRAPH_ITEM_TYPES[t].is3D).sort();
  assert.deepEqual(threeD, ["complexGraph3d", "gradientDescent", "parametricSurface", "spaceCurve", "surface", "vectorField3d"]);
});
