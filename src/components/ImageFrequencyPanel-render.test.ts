/**
 * Render test for the wedge-mask slider controls added alongside the
 * existing bounded number inputs (issue #248's "slider opportunities" item):
 * the wedge mask's "angle (deg)" (0-360) and "width (deg)" (0-180) fields
 * are naturally bounded but previously had no accompanying slider. This
 * locks in that a paired `<input type="range">` exists for each, shares the
 * same min/max/value, and moving it updates the same underlying cell the
 * number input reads from.
 *
 * Uses the shared happy-dom + React 19 harness (setupTestDom), same as
 * CellularAutomataPanel-render.test.ts / ExportPreviewScrubber.test.ts,
 * including the latter's `setRangeValue` helper.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { setupTestDom } from "../lib/test-dom.ts";

const { createElement, mount, domWindow } = await setupTestDom();
// ImageFrequencyPanel's props parameter has a default value (`= {}`), which
// type-checks oddly against createElement's overloads once obtained via
// `await import(...)` -- same workaround CellularAutomataPanel-render.test.ts
// / GeometryPanel-render.test.ts use for their own default-valued props.
const ImageFrequencyPanel = (await import("./ImageFrequencyPanel.tsx")).ImageFrequencyPanel as unknown as (props: {
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

function setSelectValue(select: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    (domWindow as unknown as { HTMLSelectElement: { prototype: object } }).HTMLSelectElement.prototype,
    "value",
  )?.set as (this: HTMLSelectElement, v: string) => void;
  setter.call(select, value);
  select.dispatchEvent(new domWindow.Event("change", { bubbles: true }) as unknown as Event);
}

function labelFor(container: HTMLElement, labelText: string): Element {
  const label = Array.from(container.querySelectorAll("label")).find((l) => l.textContent?.trim().startsWith(labelText));
  assert.ok(label, `expected a label starting with "${labelText}"`);
  return label as Element;
}

function inputIn(label: Element, type: string): HTMLInputElement {
  const input = label.querySelector(`input[type="${type}"]`);
  assert.ok(input, `expected an input[type="${type}"] inside the label`);
  return input as HTMLInputElement;
}

test("ImageFrequencyPanel: wedge mask's angle and width each have a paired range slider synced to the same value", async () => {
  const { container, update, unmount } = await mount(createElement(ImageFrequencyPanel, { cellId: "render-test-wedge" }));

  const select = labelFor(container, "mask:").querySelector("select") as HTMLSelectElement;
  assert.ok(select, "expected the mask type <select>");
  await update(() => setSelectValue(select, "wedge"));

  const angleNumber = inputIn(labelFor(container, "angle (deg):"), "number");
  const angleRange = inputIn(labelFor(container, "angle (deg):"), "range");
  assert.equal(angleRange.min, "0");
  assert.equal(angleRange.max, "360");
  assert.equal(angleRange.value, angleNumber.value);
  await update(() => setRangeValue(angleRange, "200"));
  assert.equal(angleNumber.value, "200", "moving the angle slider should update the number input via the shared cell");

  const widthNumber = inputIn(labelFor(container, "width (deg):"), "number");
  const widthRange = inputIn(labelFor(container, "width (deg):"), "range");
  assert.equal(widthRange.min, "0");
  assert.equal(widthRange.max, "180");
  assert.equal(widthRange.value, widthNumber.value);
  await update(() => setRangeValue(widthRange, "45"));
  assert.equal(widthNumber.value, "45", "moving the width slider should update the number input via the shared cell");

  await unmount();
});
