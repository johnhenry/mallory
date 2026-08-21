/**
 * Render test for #383: wiring polyomino-supported (multi-cell footprint)
 * tiles into TilesPanel. Seeds `window.location.hash` with a compound
 * (`@row,col`) tile set BEFORE mounting -- same "state arrives exactly as a
 * real shared/bookmarked URL would" pattern MlPlaygroundPanel.test.ts uses
 * -- and confirms the panel takes the compound solve path (not the unit
 * one, which would either error or silently mis-solve on this text -- see
 * TilesPanel.tsx's own `tileSetResult` doc comment) and renders a result
 * without throwing.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { setupTestDom } from "../lib/test-dom.ts";
import { encodeTilesState, type TilesStateV7 } from "../lib/tiles-state.ts";

const { createElement, mount, domWindow } = await setupTestDom();

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("TilesPanel: a tile set with an @row,col multi-cell tile takes the compound solve path and renders without error", async () => {
  const state: TilesStateV7 = {
    v: 7,
    // A horizontal domino tile covering (0,0)-(0,1); tiles a 2x1 grid in
    // exactly one placement.
    tilesText: "AB@0,0 1 ? 3 4\nAB@0,1 5 6 7 ?",
    width: 2,
    height: 1,
    solver: "wang",
    showAnimation: true,
    symmetry: "none",
    lattice: "square",
    hexTilesText: "",
    triTilesText: "",
    cubeTilesText: "",
    depth: 1,
    cornerTilesText: "",
    tileWeights: {},
    weightedSeed: 1,
    linearTilesText: "",
    linearPeriodic: false,
  };
  domWindow.location.hash = encodeTilesState(state);

  const TilesPanel = (await import("./TilesPanel.tsx")).TilesPanel as unknown as (props: { cellId?: string }) => ReturnType<typeof createElement>;
  const { container, update, unmount } = await mount(createElement(TilesPanel, { cellId: "compound-render-test" }));
  await update(() => wait(50));

  const text = container.textContent ?? "";
  assert.match(text, /Multi-cell tile set/, "expected the compound-mode note to render");
  assert.match(text, /Compound tile palette/, "expected the compound palette section to render");
  assert.match(text, /AB.*2 cells|2 cells.*AB|AB/, "expected the compound tile's id to appear in the palette");
  assert.match(text, /Tiling found/, "expected the compound solver to find the trivial domino tiling");
  assert.doesNotMatch(text, /symmetry\/entropy\/diffraction\/relaxation aren't available.*undefined/i, "sanity: no stray undefined leaking into the note");

  await unmount();
});
