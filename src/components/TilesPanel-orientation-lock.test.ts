/**
 * Render test for #414: the square-lattice tile palette visually flags a
 * `*`-suffixed (orientation-locked) tile. Mirrors TilesPanel-weighted-
 * tiling.test.ts's "seed window.location.hash before mounting" pattern.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { setupTestDom } from "../lib/test-dom.ts";
import { encodeTilesState, type TilesStateV7 } from "../lib/tiles-state.ts";

const { createElement, mount, domWindow } = await setupTestDom();

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("TilesPanel: a *-suffixed tile id shows an orientation-locked badge in the palette, and the plain sibling doesn't", async () => {
  const state: TilesStateV7 = {
    v: 7,
    tilesText: "A* 1 2 3 4\nB x x x x",
    width: 2,
    height: 1,
    solver: "wang",
    showAnimation: true,
    symmetry: "rotations-reflections",
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
  const { container, update, unmount } = await mount(createElement(TilesPanel, { cellId: "orientation-lock-render-test" }));
  await update(() => wait(50));

  const lockedBadges = Array.from(container.querySelectorAll("span")).filter((el) => el.textContent?.trim() === "locked");
  assert.equal(lockedBadges.length, 1, "expected exactly one 'locked' badge, for tile A only");

  await unmount();
});
