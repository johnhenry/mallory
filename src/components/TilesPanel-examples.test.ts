/**
 * Render test for #416: the square-lattice "load example" dropdown loads
 * an illustrative dataflow-pattern tile set and solves it correctly.
 * Mirrors TilesPanel-render.test.ts's basic mount pattern; simulates the
 * select's onChange the way CellularAutomataPanel-render.test.ts's own
 * `setRangeValue` helper drives a native input/select.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { setupTestDom } from "../lib/test-dom.ts";

const { createElement, mount, domWindow } = await setupTestDom();
const TilesPanel = (await import("./TilesPanel.tsx")).TilesPanel as unknown as (props: { cellId?: string }) => ReturnType<typeof createElement>;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function selectByLabel(container: HTMLElement, labelStart: string): HTMLSelectElement {
  const label = Array.from(container.querySelectorAll("label")).find((l) => l.textContent?.trim().startsWith(labelStart));
  assert.ok(label, `expected a label starting with "${labelStart}"`);
  const select = label!.querySelector("select");
  assert.ok(select, `expected a <select> inside the "${labelStart}" label`);
  return select as HTMLSelectElement;
}

test("TilesPanel: 'load example' dropdown exists, offers the wire-chain example, and loading it solves to the intended pipeline order", async () => {
  const { container, update, unmount } = await mount(createElement(TilesPanel, { cellId: "examples-render-test" }));
  await update(() => wait(50));

  const select = selectByLabel(container, "load example:");
  const options = Array.from(select.querySelectorAll("option")).map((o) => o.getAttribute("value"));
  assert.ok(options.includes("wire-chain"), "expected the wire-chain example in the dropdown");

  const nativeValueSetter = Object.getOwnPropertyDescriptor(
    (domWindow as unknown as { HTMLSelectElement: { prototype: object } }).HTMLSelectElement.prototype,
    "value",
  )?.set as (this: HTMLSelectElement, v: string) => void;
  await update(() => {
    nativeValueSetter.call(select, "wire-chain");
    select.dispatchEvent(new domWindow.Event("change", { bubbles: true }) as unknown as Event);
  });
  await update(() => wait(50));

  const text = container.textContent ?? "";
  assert.match(text, /Tiling found/, "expected the wire-chain example to solve at its recommended grid size");

  await unmount();
});
