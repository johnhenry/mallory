/**
 * Render tests for angle mode selection: the "Adjust transforms & angles"
 * list's per-angle mode dropdown (shorter/clickOrder/reflex -- see
 * AngleMode's own doc comment in geometry.ts), and the "smaller middle
 * ground" selection link -- a transform/angle's row highlights when its
 * own object is currently selected via the select tool, without fully
 * merging the two UIs (selection stays the mechanism for delete/recolor;
 * the always-visible params list stays the mechanism for editing
 * angle/transform parameters).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { setupTestDom } from "../lib/test-dom.ts";
import { CellGraph } from "@johnhenry/math";
import { cellIdsGeometry } from "../lib/cell-ids.ts";
import type { GeometryOp } from "../lib/geometry-state.ts";

const { createElement, mount, domWindow } = await setupTestDom();
const { GeometryPanel, replayGeometryOps, getCurrentGeometryState } = (await import("./GeometryPanel.tsx")) as unknown as {
  GeometryPanel: (props: import("./GeometryPanel.tsx").GeometryPanelProps) => ReturnType<typeof createElement>;
  replayGeometryOps: (graph: CellGraph, listIds: ReturnType<typeof cellIdsGeometry>, ops: GeometryOp[]) => void;
  getCurrentGeometryState: (graph: CellGraph, listIds: ReturnType<typeof cellIdsGeometry>) => { ops: GeometryOp[] };
};

const WIDTH = 500;
const HEIGHT = 500;
function toScreen(x: number, y: number): { sx: number; sy: number } {
  return { sx: ((x + 5) / 10) * WIDTH, sy: ((5 - y) / 10) * HEIGHT };
}

function radioFor(container: Element, label: string): HTMLInputElement {
  const found = Array.from(container.querySelectorAll("label")).find((l) => l.textContent?.trim() === label);
  assert.ok(found, `expected a radio label "${label}"`);
  const input = (found as Element).querySelector('input[type="radio"]');
  assert.ok(input, `expected an <input type="radio"> inside the "${label}" label`);
  return input as HTMLInputElement;
}

function setupAngle(cellId: string) {
  const graph = new CellGraph();
  const listIds = cellIdsGeometry(cellId);
  graph.set(listIds.objectList, [] as string[], { auxiliary: true });
  graph.set(listIds.opsLog, [] as GeometryOp[], { auxiliary: true });
  replayGeometryOps(graph, listIds, [
    { tool: "point", id: "a", x: 1, y: 0 },
    { tool: "point", id: "vertex", x: 0, y: 0 },
    { tool: "point", id: "c", x: 0, y: 1 },
    { tool: "angle", id: "ang1", a: "a", vertex: "vertex", c: "c" },
  ]);
  return { graph, listIds };
}

test("GeometryPanel: the angle mode dropdown appears, defaults to 'shorter', and changing it patches the op via editGeometryOp", async () => {
  const cellId = "angle-mode-dropdown-test";
  const { graph, listIds } = setupAngle(cellId);
  const { container, update, unmount } = await mount(createElement(GeometryPanel, { cellId, graph, syncUrl: false }));

  assert.match(container.textContent ?? "", /Adjust transforms & angles/);
  const selects = Array.from(container.querySelectorAll("select"));
  const modeSelect = selects.find((s) => Array.from(s.options).some((o) => o.value === "reflex")) as HTMLSelectElement | undefined;
  assert.ok(modeSelect, "expected a mode <select> with a 'reflex' option");
  assert.equal(modeSelect.value, "shorter", "expected 'shorter' as the default selection");

  await update(() => {
    modeSelect.value = "reflex";
    modeSelect.dispatchEvent(new domWindow.Event("change", { bubbles: true }) as unknown as Event);
  });

  const ops = getCurrentGeometryState(graph, listIds).ops;
  const angleOp = ops.find((op) => op.tool === "angle" && op.id === "ang1");
  assert.ok(angleOp && angleOp.tool === "angle");
  assert.equal(angleOp.mode, "reflex", "expected editGeometryOp to have patched the op's mode");

  await unmount();
});

test("GeometryPanel: selecting an angle (click its arc, select tool) highlights its row in the transforms & angles list", async () => {
  const cellId = "angle-mode-highlight-test";
  const { graph } = setupAngle(cellId);
  const { container, update, unmount } = await mount(createElement(GeometryPanel, { cellId, graph, syncUrl: false }));
  const canvas = container.querySelector("canvas") as HTMLCanvasElement;
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: WIDTH, height: HEIGHT, right: WIDTH, bottom: HEIGHT, x: 0, y: 0, toJSON: () => ({}) });
  (canvas as unknown as { setPointerCapture: () => void }).setPointerCapture = () => {};
  (canvas as unknown as { releasePointerCapture: () => void }).releasePointerCapture = () => {};

  function angleRow(): HTMLLIElement {
    const li = Array.from(container.querySelectorAll("li")).find((el) => el.textContent?.includes("Angle"));
    assert.ok(li, "expected the angle's <li> row in the params list");
    return li as HTMLLIElement;
  }

  // Not selected yet -- no highlight color inline style.
  assert.equal(angleRow().style.color, "", "expected no highlight before selection");

  await update(() => {
    radioFor(container, "select").dispatchEvent(new domWindow.MouseEvent("click", { bubbles: true, cancelable: true }) as unknown as Event);
  });

  const arcRadiusData = (20 / WIDTH) * 10;
  const { sx, sy } = toScreen(arcRadiusData * Math.SQRT1_2, arcRadiusData * Math.SQRT1_2);
  await update(() => {
    canvas.dispatchEvent(new domWindow.PointerEvent("pointerdown", { bubbles: true, cancelable: true, clientX: sx, clientY: sy, pointerId: 1 }) as unknown as Event);
  });
  await update(() => {
    canvas.dispatchEvent(new domWindow.PointerEvent("pointerup", { bubbles: true, cancelable: true, clientX: sx, clientY: sy, pointerId: 1 }) as unknown as Event);
  });

  assert.match(container.textContent ?? "", /1 selected/, "expected the click to select the angle");
  assert.notEqual(angleRow().style.color, "", "expected the row to pick up a highlight color once selected");

  await unmount();
});
