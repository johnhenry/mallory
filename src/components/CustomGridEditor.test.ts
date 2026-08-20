/**
 * Regression test for #389: the 1D custom initial-state editor's clicks
 * landed on the wrong cell ("the square to the left of it, not directly
 * underneath"). Root cause, confirmed live via chrome-devtools MCP: a
 * canvas's CSS-rendered size (`getBoundingClientRect()`) isn't guaranteed
 * to exactly equal its backing-store `width`/`height` attributes -- browser
 * zoom, OS display scaling, or fractional layout rounding can all
 * introduce a small mismatch (one ordinary run measured a 280px-wide
 * canvas at 281.9 CSS px). `CustomGridEditor`'s `indexAt` used to divide a
 * raw CSS-pixel click offset by the fixed `EDITOR_CELL_SIZE`, silently
 * drifting by a growing fraction of a cell the further a click lands from
 * the origin -- for a wide grid (1D's up to 300 cells vs. 2D's much
 * smaller typical width) that drift accumulates into a whole-cell error
 * well before the far edge, exactly the reported symptom.
 *
 * This test mounts `CustomGridEditor` directly and mocks
 * `getBoundingClientRect` to return a CSS size deliberately different from
 * the canvas's backing-store size (mirroring the live-confirmed mismatch),
 * then clicks at the CSS-space center of a specific cell far from the
 * origin and asserts the correct cell (not a neighbor) was toggled.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { setupTestDom } from "../lib/test-dom.ts";
import { blankBits, decodeBits } from "../lib/ca/custom-grid.ts";

const { createElement, mount, domWindow } = await setupTestDom();
const CustomGridEditor = (await import("./CellularAutomataPanel.tsx")).CustomGridEditor as unknown as (props: {
  bits: string;
  width: number;
  height: number;
  onChange: (bits: string) => void;
}) => ReturnType<typeof createElement>;

const EDITOR_CELL_SIZE = 14;
const WIDTH = 20;

test("CustomGridEditor: a click lands on the intended cell even when the canvas's CSS size doesn't exactly match its backing-store size", async () => {
  let bits = blankBits(WIDTH);
  const { container, update, unmount } = await mount(
    createElement(CustomGridEditor, {
      bits,
      width: WIDTH,
      height: 1,
      onChange: (next) => {
        bits = next;
      },
    }),
  );
  const canvas = container.querySelector("canvas") as HTMLCanvasElement;
  assert.ok(canvas, "expected a <canvas>");
  const nativeWidth = WIDTH * EDITOR_CELL_SIZE; // 280
  // A deliberately large CSS/backing-store mismatch (50% wider in CSS space)
  // -- makes the direction and magnitude of the bug unambiguous regardless
  // of exactly where within a cell a click lands, unlike the smaller
  // (~0.68%) mismatch actually measured live, whose error can land close
  // enough to a cell boundary that `Math.floor` absorbs it depending on
  // click position. The mechanism is identical either way; this just picks
  // a scale guaranteed to discriminate.
  const cssWidth = nativeWidth * 1.5; // 420
  canvas.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    width: cssWidth,
    height: EDITOR_CELL_SIZE,
    right: cssWidth,
    bottom: EDITOR_CELL_SIZE,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });

  // Click near the CSS-space right edge, at the rightmost cell (index 19).
  // Without correcting for the CSS/backing-store scale, this computes a
  // raw index of ~30 (280 * 1.5 / 14, well past width=20) -- out of
  // bounds, so `pixelToCellIndex` returns null and the click is silently
  // dropped; with the fix, it correctly resolves to index 19.
  const targetIndex = WIDTH - 1;
  const cssCellWidth = cssWidth / WIDTH;
  const clientX = (targetIndex + 0.9) * cssCellWidth;
  const clientY = EDITOR_CELL_SIZE / 2;
  await update(() => {
    canvas.dispatchEvent(new domWindow.PointerEvent("pointerdown", { bubbles: true, cancelable: true, clientX, clientY, pointerId: 1 }) as unknown as Event);
  });

  const cells = decodeBits(bits, WIDTH);
  assert.deepEqual(
    cells.map((c, i) => (c === 1 ? i : null)).filter((i) => i !== null),
    [targetIndex],
    `expected exactly cell ${targetIndex} to be set, got: ${JSON.stringify(cells)}`,
  );

  await unmount();
});
