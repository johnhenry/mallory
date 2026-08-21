/**
 * Render test for #397: wiring the 1D "linear" Wang-tile lattice
 * (`linear-tile-model.ts`, `linear-tile-set-text.ts`) into TilesPanel.
 * Mirrors TilesPanel-compound-render.test.ts's / TilesPanel-weighted-
 * tiling.test.ts's "seed window.location.hash with a specific TilesState
 * before mounting" pattern.
 *
 * Uses the two-tile chain A(left=2,right=1) / B(left=1,right=2): A -> B and
 * B -> A are both compatible, so "A B A" (length 3) is a valid NON-periodic
 * row, but it can never close into a ring -- A's right ("1") never matches
 * A's own left ("2") -- so the SAME tile set at the SAME length only solves
 * when "periodic" is off. This makes the periodic checkbox's effect
 * directly observable in the rendered status text, not just "it renders."
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { setupTestDom } from "../lib/test-dom.ts";
import { encodeTilesState, type TilesStateV7 } from "../lib/tiles-state.ts";

const { createElement, mount, domWindow } = await setupTestDom();

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function baseState(overrides: Partial<TilesStateV7>): TilesStateV7 {
  return {
    v: 7,
    tilesText: "",
    width: 3,
    height: 1,
    solver: "wang",
    showAnimation: true,
    symmetry: "none",
    lattice: "linear",
    hexTilesText: "",
    triTilesText: "",
    cubeTilesText: "",
    depth: 1,
    cornerTilesText: "",
    tileWeights: {},
    weightedSeed: 1,
    linearTilesText: "A 2 1\nB 1 2",
    linearPeriodic: false,
    ...overrides,
  };
}

test("TilesPanel: linear lattice (non-periodic) finds a valid chain and renders without error", async () => {
  const state = baseState({ linearPeriodic: false });
  domWindow.location.hash = encodeTilesState(state);

  const TilesPanel = (await import("./TilesPanel.tsx")).TilesPanel as unknown as (props: { cellId?: string }) => ReturnType<typeof createElement>;
  const { container, update, unmount } = await mount(createElement(TilesPanel, { cellId: "linear-render-test-nonperiodic" }));
  await update(() => wait(50));

  const text = container.textContent ?? "";
  assert.match(text, /Tiling found/, "expected the non-periodic linear solver to find A,B,A at length 3");
  assert.doesNotMatch(text, /No .*tiling exists/, "expected no failure message when a valid chain exists");

  await unmount();
});

test("TilesPanel: linear lattice (periodic) fails to close the SAME tile set into a ring at the SAME length -- proving the checkbox is observable", async () => {
  const state = baseState({ linearPeriodic: true });
  domWindow.location.hash = encodeTilesState(state);

  const TilesPanel = (await import("./TilesPanel.tsx")).TilesPanel as unknown as (props: { cellId?: string }) => ReturnType<typeof createElement>;
  const { container, update, unmount } = await mount(createElement(TilesPanel, { cellId: "linear-render-test-periodic" }));
  await update(() => wait(50));

  const text = container.textContent ?? "";
  assert.match(text, /No periodic tiling exists/, "expected the periodic solver to fail to close A,B,A into a ring (A's right never matches A's own left)");
  assert.doesNotMatch(text, /^Tiling found/, "sanity: should not report a bare success");

  await unmount();
});
