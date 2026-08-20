/**
 * Regression test for #374/#375: "Cannot read properties of undefined
 * (reading 'x'/'y')" reported after Cmd+Z, and while selecting/dragging an
 * anchor point.
 *
 * Root cause: undo/redo is bound via a DOCUMENT-level Ctrl/Cmd+Z keydown
 * listener (see use-undo-history.ts's own doc comment), entirely
 * independent of the canvas's own pointer handlers -- it can fire mid-drag
 * (a natural "abort this drag" instinct: hit Cmd+Z while still holding the
 * mouse button down). `dragRef` (the id currently being dragged) was never
 * reset by GeometryPanel's own undo/redo callback, unlike every other piece
 * of transient interaction state (`pending`/`pendingAngle`/`pendingPolygon`/
 * `selected`/`ikChain`) -- so the next `pointermove`/`pointerup` after an
 * undo mid-drag read a point cell for an id the restored snapshot no longer
 * contains. `CellGraph.get` on a nonexistent cell returns `undefined`
 * rather than throwing (see cell-graph.ts's own `ensure`), so reading
 * `.x`/`.y` off it crashes with exactly the reported message.
 *
 * This test drags a real anchor point, fires a genuine document-level
 * Ctrl+Z keydown mid-drag (removing the anchor via undo), then continues
 * the drag gesture (pointermove + pointerup) -- before the fix this throws;
 * after the fix, dragRef is reset by the undo, so the continued gesture is
 * simply a no-op.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { setupTestDom } from "../lib/test-dom.ts";
import { CellGraph } from "../lib/cell-graph.ts";
import { cellIdsGeometry } from "../lib/cell-ids.ts";
import type { GeometryOp } from "../lib/geometry-state.ts";

const { createElement, mount, domWindow } = await setupTestDom();
const { GeometryPanel, replayGeometryOps } = (await import("./GeometryPanel.tsx")) as unknown as {
  GeometryPanel: (props: import("./GeometryPanel.tsx").GeometryPanelProps) => ReturnType<typeof createElement>;
  replayGeometryOps: (graph: CellGraph, listIds: ReturnType<typeof cellIdsGeometry>, ops: GeometryOp[]) => void;
};

const WIDTH = 500;
const HEIGHT = 500;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("GeometryPanel: undo firing mid-drag (Cmd+Z while a point is still held) doesn't crash the next pointermove/pointerup", async () => {
  const graph = new CellGraph();
  const listIds = cellIdsGeometry("undo-drag-test");
  graph.set(listIds.objectList, [] as string[], { auxiliary: true });
  graph.set(listIds.opsLog, [] as GeometryOp[], { auxiliary: true });
  // Seed a circle (center (0,0), rim (1,0) -> radius 1) BEFORE mount, so the
  // undo history's own initial snapshot already has it -- undo below rolls
  // back to exactly this state, one step before the anchor existed.
  replayGeometryOps(graph, listIds, [
    { tool: "point", id: "center", x: 0, y: 0 },
    { tool: "point", id: "rim", x: 1, y: 0 },
    { tool: "circle", id: "c1", center: "center", radiusPoint: "rim" },
  ]);

  // syncUrl MUST be true here -- it doubles as useUndoHistory's own
  // `enabled` flag (see that hook's doc comment): false disables the
  // document-level Ctrl/Cmd+Z listener entirely, which is exactly the
  // mechanism under test. GeometryPanel itself doesn't call any router
  // hooks, so this doesn't need a live RouterProvider the way GraphCanvas's
  // own syncUrl:true would.
  const { container, update, unmount } = await mount(createElement(GeometryPanel, { cellId: "undo-drag-test", graph, syncUrl: true }));
  const canvas = container.querySelector("canvas") as HTMLCanvasElement;
  assert.ok(canvas, "expected a <canvas> to render");
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: WIDTH, height: HEIGHT, right: WIDTH, bottom: HEIGHT, x: 0, y: 0, toJSON: () => ({}) });
  // pointer capture isn't implemented in happy-dom's canvas -- no-op it out.
  (canvas as unknown as { setPointerCapture: () => void }).setPointerCapture = () => {};
  (canvas as unknown as { releasePointerCapture: () => void }).releasePointerCapture = () => {};

  // Wait past the debounce (250ms) so the seeded circle-only state is the
  // history's committed "present" before adding the anchor.
  await update(() => wait(300));

  // Now anchor a point to the circle at param=0 -- center + radius*(cos 0, sin 0) = (1, 0).
  await update(() => {
    replayGeometryOps(graph, listIds, [{ tool: "anchor", id: "anc1", target: "c1", param: 0 }]);
  });
  await update(() => wait(300)); // let this land in history as its own snapshot, distinct from the circle-only one

  // (1, 0) in data space -> screen space, per toDataX/toDataY's own inverse
  // (VIEWPORT is -5..5 both axes, WIDTH/HEIGHT 500): sx=300, sy=250.
  const sx = 300;
  const sy = 250;

  // Press down ON the anchor point -- starts the "anchor" drag.
  await update(() => {
    canvas.dispatchEvent(new domWindow.PointerEvent("pointerdown", { bubbles: true, cancelable: true, clientX: sx, clientY: sy, pointerId: 1 }) as unknown as Event);
  });

  // Move a bit first, past the drag threshold, so the drag is genuinely "moved".
  await update(() => {
    canvas.dispatchEvent(
      new domWindow.PointerEvent("pointermove", { bubbles: true, cancelable: true, clientX: sx + 10, clientY: sy, pointerId: 1 }) as unknown as Event,
    );
  });

  // Fire undo MID-DRAG, exactly like a real Cmd+Z while the mouse button is
  // still held -- this is a genuine document-level listener, so dispatching
  // on `document` (not the canvas) matches how the browser would deliver it.
  await update(() => {
    (domWindow.document as unknown as { dispatchEvent: (e: unknown) => void }).dispatchEvent(
      new domWindow.KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "z", metaKey: true }),
    );
  });

  // The anchor's point cell should be gone -- undo rolled back to the
  // circle-only snapshot.
  assert.equal(graph.has("geomPoint:anc1"), false, "expected undo to have removed the anchor's point cell");

  // Continue the (now-stale) drag gesture -- this is exactly what crashed
  // before the fix.
  await assert.doesNotReject(async () => {
    await update(() => {
      canvas.dispatchEvent(
        new domWindow.PointerEvent("pointermove", { bubbles: true, cancelable: true, clientX: sx + 20, clientY: sy, pointerId: 1 }) as unknown as Event,
      );
    });
    await update(() => {
      canvas.dispatchEvent(new domWindow.PointerEvent("pointerup", { bubbles: true, cancelable: true, clientX: sx + 20, clientY: sy, pointerId: 1 }) as unknown as Event);
    });
  }, "continuing a drag gesture after an undo removed the dragged point must not throw");

  // And the anchor must still be gone (the stale drag mustn't have
  // resurrected a phantom point cell for it).
  assert.equal(graph.has("geomPoint:anc1"), false, "the stale drag must not resurrect the undone anchor");

  await unmount();
});
