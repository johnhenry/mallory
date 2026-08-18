/**
 * Render test for the slider controls added alongside the existing bounded
 * number inputs (issue #248's "slider opportunities" item): 1D rule # (0-255)
 * and 2D/3D initial density (0-1) each already had a clearly-bounded
 * `<input type="number">` with no accompanying slider. This locks in that
 * the paired `<input type="range">` exists, shares the same min/max/value,
 * and moving it updates the same underlying cell the number input reads
 * from (both controls stay in sync).
 *
 * Uses the shared happy-dom + React 19 harness (setupTestDom), same as
 * ExportPreviewScrubber.test.ts -- including its `setRangeValue` helper for
 * driving a range input the way React's onChange actually observes it.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { setupTestDom } from "../lib/test-dom.ts";

const { createElement, mount, domWindow } = await setupTestDom();
// CellularAutomataPanel's props parameter has a default value (`= {}`),
// which type-checks oddly against createElement's overloads once obtained
// via `await import(...)` -- same workaround GeometryPanel-render.test.ts /
// TilesPanel-render.test.ts use for their own default-valued props.
const CellularAutomataPanel = (await import("./CellularAutomataPanel.tsx")).CellularAutomataPanel as unknown as (props: {
  cellId?: string;
}) => ReturnType<typeof createElement>;

function setRangeValue(input: HTMLInputElement, value: string) {
  const nativeValueSetter = Object.getOwnPropertyDescriptor(
    (domWindow as unknown as { HTMLInputElement: { prototype: object } }).HTMLInputElement.prototype,
    "value",
  )?.set as (this: HTMLInputElement, v: string) => void;
  nativeValueSetter.call(input, value);
  input.dispatchEvent(new domWindow.Event("input", { bubbles: true }) as unknown as Event);
}

function inputAfterLabel(container: HTMLElement, labelText: string, type: string): HTMLInputElement {
  const label = Array.from(container.querySelectorAll("label")).find((l) => l.textContent?.trim().startsWith(labelText));
  assert.ok(label, `expected a label starting with "${labelText}"`);
  const input = (label as Element).querySelector(`input[type="${type}"]`);
  assert.ok(input, `expected an input[type="${type}"] inside the "${labelText}" label`);
  return input as HTMLInputElement;
}

test("CellularAutomataPanel: 1D rule # has a paired range slider synced to the same value, 0-255", async () => {
  const { container, update, unmount } = await mount(createElement(CellularAutomataPanel, { cellId: "render-test-rule" }));

  const number = inputAfterLabel(container, "rule #:", "number");
  const range = inputAfterLabel(container, "rule #:", "range");
  assert.equal(range.min, "0");
  assert.equal(range.max, "255");
  assert.equal(range.value, number.value);

  await update(() => setRangeValue(range, "110"));
  assert.equal(number.value, "110", "moving the slider should update the number input via the shared cell");

  await unmount();
});

test("CellularAutomataPanel: 2D initial density has a paired range slider synced to the same value, 0-1", async () => {
  const { container, update, unmount } = await mount(createElement(CellularAutomataPanel, { cellId: "render-test-density" }));

  // Density controls only render once the dimension is switched to 2D.
  const dimensionSelect = container.querySelector("select") as HTMLSelectElement;
  await update(() => {
    const setter = Object.getOwnPropertyDescriptor(
      (domWindow as unknown as { HTMLSelectElement: { prototype: object } }).HTMLSelectElement.prototype,
      "value",
    )?.set as (this: HTMLSelectElement, v: string) => void;
    setter.call(dimensionSelect, "2d");
    dimensionSelect.dispatchEvent(new domWindow.Event("change", { bubbles: true }) as unknown as Event);
  });

  const number = inputAfterLabel(container, "density:", "number");
  const range = inputAfterLabel(container, "density:", "range");
  assert.equal(range.min, "0");
  assert.equal(range.max, "1");
  assert.equal(range.value, number.value);

  await update(() => setRangeValue(range, "0.65"));
  assert.equal(number.value, "0.65", "moving the slider should update the number input via the shared cell");

  await unmount();
});
