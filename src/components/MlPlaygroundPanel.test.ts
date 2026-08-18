/**
 * Component-level coverage for issue #253's two ML playground additions:
 * loading a CSV-imported ("csv" dataset) point set, and training/rendering
 * more than two classes. Uses the same happy-dom + React 19 `act()` harness
 * as DigitClassifierPanel.test.ts/use-cell.test.ts (see test-dom.ts) --
 * MlPlaygroundPanel reads its initial state from `window.location.hash` on
 * mount (see useMlGraph in MlPlaygroundPanel.tsx), so the hash is seeded
 * BEFORE mounting, exactly as a real shared/bookmarked URL would arrive.
 *
 * happy-dom's canvas has no real 2D rendering context (`getContext("2d")`
 * returns null), so MlPlaygroundPanel's draw effects no-op harmlessly --
 * this exercises the surrounding React state/training logic, not actual
 * pixel output (ml-playground.test.ts already covers predictClassGrid's
 * pixel-level math directly).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeMlPlaygroundState, DEFAULT_ML_PLAYGROUND_STATE } from "../lib/ml-playground-state.ts";
import { setupTestDom } from "../lib/test-dom.ts";

const { createElement, domWindow, mount } = await setupTestDom();

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Three tight, well-separated clusters within the panel's [-4,4] domain -- few points per class so a training run settles fast in a test. */
function threeClassCsvPoints() {
  const centers: Array<[number, number, number]> = [
    [-2, -2, 0],
    [2, -2, 1],
    [0, 2, 2],
  ];
  const points: { x: number; y: number; label: number }[] = [];
  for (const [cx, cy, label] of centers) {
    for (let i = 0; i < 4; i++) points.push({ x: cx + ((i % 2) - 0.5) * 0.1, y: cy + (Math.floor(i / 2) - 0.5) * 0.1, label });
  }
  return points;
}

// MlPlaygroundPanel's `cellId` prop has a default value (`= {}`), which
// type-checks oddly against createElement's own overloads once obtained via
// `await import(...)` -- same gotcha RegressionPanel-render.test.ts's own
// doc comment describes; sidestepped the same way, with an explicit retype.
type MlPlaygroundPanelComponent = (props: { cellId?: string }) => ReturnType<typeof createElement>;

test('MlPlaygroundPanel: a "csv" dataset seeded via the URL hash renders the imported point/class count and a legend using classNames', async () => {
  const state = {
    ...DEFAULT_ML_PLAYGROUND_STATE,
    dataset: "csv" as const,
    csvPoints: threeClassCsvPoints(),
    classNames: ["cat", "dog", "bird"],
  };
  domWindow.location.hash = encodeMlPlaygroundState(state);

  const MlPlaygroundPanel = (await import("./MlPlaygroundPanel.tsx")).MlPlaygroundPanel as unknown as MlPlaygroundPanelComponent;
  const { container } = await mount(createElement(MlPlaygroundPanel, { cellId: "csv-test-1" }));

  assert.ok(container.textContent?.includes("12 points imported"), `expected the imported point count, got: ${container.textContent}`);
  assert.ok(container.textContent?.includes("3 classes"), `expected the imported class count, got: ${container.textContent}`);
  assert.ok(container.textContent?.includes("cat"), "expected the legend to show the CSV's own class name 'cat'");
  assert.ok(container.textContent?.includes("dog"), "expected the legend to show the CSV's own class name 'dog'");
  assert.ok(container.textContent?.includes("bird"), "expected the legend to show the CSV's own class name 'bird'");
});

test("MlPlaygroundPanel: training a 3-class csv dataset completes without error and advances past the initial Train button state", async () => {
  const state = {
    ...DEFAULT_ML_PLAYGROUND_STATE,
    dataset: "csv" as const,
    csvPoints: threeClassCsvPoints(),
    classNames: ["a", "b", "c"],
    hidden: "8",
    modelSeed: "3",
    lr: "0.2",
    epochs: "8",
  };
  domWindow.location.hash = encodeMlPlaygroundState(state);

  const MlPlaygroundPanel = (await import("./MlPlaygroundPanel.tsx")).MlPlaygroundPanel as unknown as MlPlaygroundPanelComponent;
  const { container, update } = await mount(createElement(MlPlaygroundPanel, { cellId: "csv-test-2" }));

  const trainButton = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Train");
  assert.ok(trainButton, "expected a 'Train' button before any training has happened");
  assert.equal(trainButton.hasAttribute("disabled"), false, "Train should be enabled once 3 classes' worth of csv points are loaded");

  await update(() => trainButton.dispatchEvent(new domWindow.MouseEvent("click", { bubbles: true }) as unknown as Event));
  // Multiple event-loop turns: handleTrain yields once per epoch (8 epochs here).
  for (let i = 0; i < 10; i++) {
    await update(() => wait(50));
  }

  assert.ok(!container.textContent?.includes("Dataset is empty"), `unexpected training error: ${container.textContent}`);
  const trainMoreButton = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Train more");
  assert.ok(trainMoreButton, `expected the Train button to read "Train more" after a completed run, got: ${container.textContent}`);
});
