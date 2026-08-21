/**
 * Render test for #403: wiring #398's library-level weighted random tiling
 * (`solveWangWeighted`, `weighted-tiling.ts`) into the square-lattice
 * solver dropdown. `weighted-tiling.test.ts` already proves the solver
 * itself is order-biased and complete; this only needs to confirm the UI
 * wiring is live end to end -- per-tile weight inputs render in the
 * palette when "Weighted random" is selected, editing one persists into
 * `TilesState.tileWeights` (round-tripped through the URL hash the same
 * way every other panel input does), and the weighted solve itself still
 * completes without error.
 *
 * Uses the shared happy-dom + React 19 harness (setupTestDom), same as
 * CellularAutomataPanel-render.test.ts -- including its native-value-setter
 * helper for driving a controlled `<input>` the way React's onChange
 * actually observes it, and TilesPanel-compound-render.test.ts's "seed
 * window.location.hash before mounting" pattern for exercising a specific
 * TilesState up front.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { setupTestDom } from "../lib/test-dom.ts";
import { decodeTilesState, encodeTilesState, type TilesStateV6 } from "../lib/tiles-state.ts";

const { createElement, mount, domWindow } = await setupTestDom();

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setNumberValue(input: HTMLInputElement, value: string) {
  const nativeValueSetter = Object.getOwnPropertyDescriptor(
    (domWindow as unknown as { HTMLInputElement: { prototype: object } }).HTMLInputElement.prototype,
    "value",
  )?.set as (this: HTMLInputElement, v: string) => void;
  nativeValueSetter.call(input, value);
  input.dispatchEvent(new domWindow.Event("input", { bubbles: true }) as unknown as Event);
}

test("TilesPanel: selecting the weighted-random solver shows a per-tile weight input, and editing one persists into TilesState.tileWeights", async () => {
  const state: TilesStateV6 = {
    v: 6,
    // Two tiles, all edges the same label -- both self- and cross-
    // compatible everywhere, so a 1x1 grid always solves regardless of
    // which tile (or weight) is chosen; this isolates "does the weighted
    // wiring work" from "does backtracking find a valid tiling".
    tilesText: "A 1 1 1 1\nB 1 1 1 1",
    width: 1,
    height: 1,
    solver: "weighted",
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
  };
  domWindow.location.hash = encodeTilesState(state);

  const TilesPanel = (await import("./TilesPanel.tsx")).TilesPanel as unknown as (props: { cellId?: string }) => ReturnType<typeof createElement>;
  const { container, update, unmount } = await mount(createElement(TilesPanel, { cellId: "weighted-render-test" }));
  await update(() => wait(50));

  // Solver dropdown reflects the seeded state.
  const solverSelect = container.querySelector("select") as HTMLSelectElement | null;
  assert.ok(solverSelect, "expected at least one <select> (the solver dropdown is the first)");

  // A weight input exists per tile, labeled with its own tile id.
  const weightInputA = container.querySelector('label[title*="tile A"] input[type="number"]') as HTMLInputElement | null;
  const weightInputB = container.querySelector('label[title*="tile B"] input[type="number"]') as HTMLInputElement | null;
  assert.ok(weightInputA, "expected a weight input for tile A");
  assert.ok(weightInputB, "expected a weight input for tile B");
  assert.equal(weightInputA?.value, "1", "expected tile A's default weight to display as 1 (weightedShuffle's own default)");

  // A seed input for the weighted solver's own Rng also renders.
  const seedLabel = Array.from(container.querySelectorAll("label")).find((l) => l.textContent?.trim().startsWith("seed:"));
  assert.ok(seedLabel, "expected a seed input for the weighted solver");

  await update(() => setNumberValue(weightInputA!, "7"));
  await update(() => wait(50));

  const decoded = decodeTilesState(domWindow.location.hash.slice(1));
  assert.ok(decoded, "expected the URL hash to decode back to a valid TilesState");
  assert.equal(decoded?.tileWeights.A, 7, "expected editing tile A's weight input to persist into TilesState.tileWeights");

  // The weighted solve still completes without error after the edit.
  const text = container.textContent ?? "";
  assert.match(text, /Tiling found/, "expected the weighted solver to still find a valid tiling on this trivially-compatible tile set");

  await unmount();
});
