import assert from "node:assert/strict";
import { test } from "node:test";
import { CellGraph } from "../lib/cell-graph.ts";
import { setupTestDom } from "../lib/test-dom.ts";

const { createElement, mount } = await setupTestDom();
const { AlgebraView } = await import("./AlgebraView.tsx");

test("AlgebraView: lists a free cell and a dependent cell with their formatted values", async () => {
  const graph = new CellGraph();
  graph.set("radius", 3);
  graph.define("area", () => Math.PI * graph.get<number>("radius") ** 2);
  graph.get("area"); // force the compute so hasValue is true (AlgebraView only lists cells with a value)

  const { container, unmount } = await mount(createElement(AlgebraView, { graph }));
  const text = container.textContent ?? "";
  assert.ok(text.includes("radius"), `expected "radius" in: ${text}`);
  assert.ok(text.includes("area"), `expected "area" in: ${text}`);
  assert.ok(text.includes("3"), `expected radius's value (3) in: ${text}`);
  await unmount();
});

test("AlgebraView: an auxiliary cell is hidden by default and shown when showAuxiliary is true", async () => {
  const graph = new CellGraph();
  graph.set("visibleCell", "shown");
  graph.set("internalCell", "hidden-by-default", { auxiliary: true });

  const { container, unmount, update } = await mount(createElement(AlgebraView, { graph }));
  let text = container.textContent ?? "";
  assert.ok(text.includes("visibleCell"));
  assert.ok(!text.includes("internalCell"), `auxiliary cell should be hidden: ${text}`);

  await update(() => {}); // no-op, just to exercise the update path before remounting with a new prop below
  await unmount();

  const { container: container2, unmount: unmount2 } = await mount(createElement(AlgebraView, { graph, showAuxiliary: true }));
  text = container2.textContent ?? "";
  assert.ok(text.includes("internalCell"), `auxiliary cell should be shown with showAuxiliary=true: ${text}`);
  await unmount2();
});

test("AlgebraView: renders nothing (returns null) when the graph has no visible cells", async () => {
  const graph = new CellGraph();
  const { container, unmount } = await mount(createElement(AlgebraView, { graph }));
  assert.equal(container.textContent, "");
  await unmount();
});
