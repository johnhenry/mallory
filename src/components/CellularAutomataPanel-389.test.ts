/**
 * Render tests for issue #389's UI requests:
 * 1. 1D's visual rule picker restyled to match 2D/3D's `NeighborCountIcon`
 *    interaction (whole-icon `<button aria-pressed>`, not a bare row of
 *    divs plus a separate small outcome button).
 * 2. A 3D custom initial-state editor now exists (previously: "isn't
 *    available for 3D yet").
 *
 * Uses the shared happy-dom + React 19 harness, same pattern as
 * CellularAutomataPanel-render.test.ts. The 3D test seeds
 * `window.location.hash` directly (rather than clicking through the
 * dimension dropdown) with a deliberately over-`MAX_3D_GRID_CELLS` grid --
 * a valid 3D solve would mount `Voxel3DFrameView`'s real Three.js/WebGL
 * scene, which this headless harness can't create a context for (no
 * existing test exercised the 3D dimension before #389 for exactly this
 * reason); an over-cap grid keeps `spacetime3dResult` in its error state,
 * so only the editor controls above it -- what this test actually
 * covers -- ever mount.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { setupTestDom } from "../lib/test-dom.ts";
import { DEFAULT_CA_STATE, encodeCaState, type CaState } from "../lib/ca-state.ts";

const { createElement, mount, domWindow } = await setupTestDom();
const CellularAutomataPanel = (await import("./CellularAutomataPanel.tsx")).CellularAutomataPanel as unknown as (props: {
  cellId?: string;
}) => ReturnType<typeof createElement>;

test("1D visual rule picker: each of the 8 neighborhoods is one aria-pressed button (NeighborCountIcon's own interaction pattern), not a bare div row", async () => {
  const { container, update, unmount } = await mount(createElement(CellularAutomataPanel, { cellId: "issue-389-1d-picker" }));
  const details = Array.from(container.querySelectorAll("details")).find((d) => d.querySelector("summary")?.textContent === "Visual rule picker");
  assert.ok(details, "expected a 'Visual rule picker' <details>");
  await update(() => {
    (details as HTMLDetailsElement).open = true;
  });

  const buttons = details!.querySelectorAll("button[aria-pressed]");
  assert.equal(buttons.length, 8, "expected 8 neighborhood buttons (2^3 possible 3-cell neighborhoods)");
  // Rule 30's neighborhood "111" maps to 0 (dead) and "011" maps to 1 (alive) --
  // hand-verified against elementary.ts's own ruleTable(30) = [0,1,1,1,1,0,0,0]
  // read MSB-first, i.e. index 7("111")=0, index 3("011")=1.
  const active = details!.querySelector('button[aria-pressed="true"]');
  assert.ok(active, "expected at least one active (outcome=alive) neighborhood button under the default Rule 30");

  await unmount();
});

test("3D custom initial-state editor: the layer navigator and per-layer painter render, and switching/painting a layer doesn't throw (issue #389)", async () => {
  const state: CaState = {
    ...DEFAULT_CA_STATE,
    dimension: "3d",
    initial3d: "custom",
    // Over MAX_3D_GRID_CELLS (4000) -- keeps spacetime3dResult in its error
    // state so Voxel3DFrameView's Three.js/WebGL scene never mounts (see
    // this file's own top-of-file doc comment).
    width3d: 20,
    height3d: 20,
    depth3d: 20,
  };
  domWindow.location.hash = encodeCaState(state);

  const { container, update, unmount } = await mount(createElement(CellularAutomataPanel, { cellId: "issue-389-3d-editor" }));

  const text = container.textContent ?? "";
  assert.match(text, /layer 1 of 20/, "expected a layer navigator sized to depth3d");
  assert.match(text, /Prev layer/);
  assert.match(text, /Next layer/);
  assert.match(text, /exceeds the 4000 cap/, "sanity: confirms the WebGL-mounting path was actually avoided, not accidentally skipped for some other reason");

  const canvas = container.querySelector("canvas") as HTMLCanvasElement;
  assert.ok(canvas, "expected the per-layer CustomGridEditor's canvas");
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: canvas.width, height: canvas.height, right: canvas.width, bottom: canvas.height, x: 0, y: 0, toJSON: () => ({}) });
  await update(() => {
    canvas.dispatchEvent(new domWindow.PointerEvent("pointerdown", { bubbles: true, cancelable: true, clientX: 5, clientY: 5, pointerId: 1 }) as unknown as Event);
  });

  const buttons = Array.from(container.querySelectorAll("button"));
  const nextLayerBtn = buttons.find((b) => b.textContent?.includes("Next layer"));
  assert.ok(nextLayerBtn, "expected a Next layer button");
  await update(() => nextLayerBtn!.click());
  assert.match(container.textContent ?? "", /layer 2 of 20/, "expected the layer navigator to advance to layer 2");

  const clearBtn = buttons.find((b) => b.textContent === "Clear all layers");
  assert.ok(clearBtn, "expected a Clear all layers button");
  await update(() => clearBtn!.click());

  await unmount();
});
