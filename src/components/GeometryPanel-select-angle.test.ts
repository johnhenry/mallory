/**
 * Regression test: the select tool's hit test (`nearestObjectId`) never
 * checked angle markers, so an angle could never be clicked into the
 * `selected` set and therefore could never be deleted (or recolored) from
 * the canvas -- reported directly by the user. `drawAngle` draws the
 * measurement arc at a fixed 20px screen-space radius from the vertex;
 * this test clicks a point ON that arc (in select mode) and confirms the
 * angle both selects and, via "Delete selected", actually deletes.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { setupTestDom } from "../lib/test-dom.ts";
import { CellGraph } from "../lib/cell-graph.ts";
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
// VIEWPORT is -5..5 on both axes (GeometryPanel has no pan/zoom) -- same
// data-to-screen formula GeometryPanel-undo-drag.test.ts's own comment uses.
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

test("GeometryPanel: clicking on an angle's measurement arc (select tool) selects it, and Delete selected removes it", async () => {
  const graph = new CellGraph();
  const listIds = cellIdsGeometry("select-angle-test");
  graph.set(listIds.objectList, [] as string[], { auxiliary: true });
  graph.set(listIds.opsLog, [] as GeometryOp[], { auxiliary: true });
  // a=(1,0), vertex=(0,0), c=(0,1) -- a clean 90 degree angle, rays along +x and +y.
  replayGeometryOps(graph, listIds, [
    { tool: "point", id: "a", x: 1, y: 0 },
    { tool: "point", id: "vertex", x: 0, y: 0 },
    { tool: "point", id: "c", x: 0, y: 1 },
    { tool: "angle", id: "ang1", a: "a", vertex: "vertex", c: "c" },
  ]);

  const { container, update, unmount } = await mount(createElement(GeometryPanel, { cellId: "select-angle-test", graph, syncUrl: false }));
  const canvas = container.querySelector("canvas") as HTMLCanvasElement;
  assert.ok(canvas, "expected a <canvas> to render");
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: WIDTH, height: HEIGHT, right: WIDTH, bottom: HEIGHT, x: 0, y: 0, toJSON: () => ({}) });
  (canvas as unknown as { setPointerCapture: () => void }).setPointerCapture = () => {};
  (canvas as unknown as { releasePointerCapture: () => void }).releasePointerCapture = () => {};

  await update(() => {
    radioFor(container, "select").dispatchEvent(new domWindow.MouseEvent("click", { bubbles: true, cancelable: true }) as unknown as Event);
  });

  // The arc sweeps 0deg (toward a=(1,0)) to 90deg (toward c=(0,1)); click its
  // midpoint at 45deg, radius 0.4 data units (20px / 500px * 10-unit span)
  // from the vertex -- exactly on the drawn stroke.
  const arcRadiusData = (20 / WIDTH) * 10;
  const midX = arcRadiusData * Math.SQRT1_2;
  const midY = arcRadiusData * Math.SQRT1_2;
  const { sx, sy } = toScreen(midX, midY);

  await update(() => {
    canvas.dispatchEvent(new domWindow.PointerEvent("pointerdown", { bubbles: true, cancelable: true, clientX: sx, clientY: sy, pointerId: 1 }) as unknown as Event);
  });
  await update(() => {
    canvas.dispatchEvent(new domWindow.PointerEvent("pointerup", { bubbles: true, cancelable: true, clientX: sx, clientY: sy, pointerId: 1 }) as unknown as Event);
  });

  assert.match(container.textContent ?? "", /1 selected/, "expected the click on the arc to select the angle");

  const deleteButton = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Delete selected");
  assert.ok(deleteButton, "expected a Delete selected button once something is selected");
  await update(() => {
    (deleteButton as HTMLButtonElement).dispatchEvent(new domWindow.MouseEvent("click", { bubbles: true, cancelable: true }) as unknown as Event);
  });

  const ops = getCurrentGeometryState(graph, listIds).ops;
  assert.equal(
    ops.some((op) => op.tool === "angle" && op.id === "ang1"),
    false,
    "expected the angle op to be gone after Delete selected",
  );

  await unmount();
});

test("GeometryPanel: clicking near an angle's vertex but OUTSIDE its swept wedge does not select it", async () => {
  const graph = new CellGraph();
  const listIds = cellIdsGeometry("select-angle-miss-test");
  graph.set(listIds.objectList, [] as string[], { auxiliary: true });
  graph.set(listIds.opsLog, [] as GeometryOp[], { auxiliary: true });
  replayGeometryOps(graph, listIds, [
    { tool: "point", id: "a", x: 1, y: 0 },
    { tool: "point", id: "vertex", x: 0, y: 0 },
    { tool: "point", id: "c", x: 0, y: 1 },
    { tool: "angle", id: "ang1", a: "a", vertex: "vertex", c: "c" },
  ]);

  const { container, update, unmount } = await mount(createElement(GeometryPanel, { cellId: "select-angle-miss-test", graph, syncUrl: false }));
  const canvas = container.querySelector("canvas") as HTMLCanvasElement;
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: WIDTH, height: HEIGHT, right: WIDTH, bottom: HEIGHT, x: 0, y: 0, toJSON: () => ({}) });
  (canvas as unknown as { setPointerCapture: () => void }).setPointerCapture = () => {};
  (canvas as unknown as { releasePointerCapture: () => void }).releasePointerCapture = () => {};

  await update(() => {
    radioFor(container, "select").dispatchEvent(new domWindow.MouseEvent("click", { bubbles: true, cancelable: true }) as unknown as Event);
  });

  // Same radius from the vertex as the arc, but at 225deg -- squarely
  // opposite the 0-90deg wedge between the two rays. Also far enough from
  // the origin point itself (0.4 data units) to miss the vertex point hit
  // test, which runs first.
  const arcRadiusData = (20 / WIDTH) * 10;
  const missX = -arcRadiusData * Math.SQRT1_2;
  const missY = -arcRadiusData * Math.SQRT1_2;
  const { sx, sy } = toScreen(missX, missY);

  await update(() => {
    canvas.dispatchEvent(new domWindow.PointerEvent("pointerdown", { bubbles: true, cancelable: true, clientX: sx, clientY: sy, pointerId: 1 }) as unknown as Event);
  });
  await update(() => {
    canvas.dispatchEvent(new domWindow.PointerEvent("pointerup", { bubbles: true, cancelable: true, clientX: sx, clientY: sy, pointerId: 1 }) as unknown as Event);
  });

  assert.doesNotMatch(container.textContent ?? "", /\d+ selected/, "expected a click outside the swept wedge to miss the angle");

  await unmount();
});
