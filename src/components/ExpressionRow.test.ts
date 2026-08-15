import assert from "node:assert/strict";
import { test } from "node:test";
import { CellGraph } from "../lib/cell-graph.ts";
import { cellIdsMultiRow, VIEWPORT_CELL } from "../lib/cell-ids.ts";
import { setupTestDom } from "../lib/test-dom.ts";

const { createElement, mount, domWindow } = await setupTestDom();
const { ExpressionRow } = await import("./ExpressionRow.tsx");

function seedRow(graph: CellGraph, rowId: string, expr: string) {
  const ids = cellIdsMultiRow(rowId);
  graph.set(VIEWPORT_CELL, { xMin: -5, xMax: 5, yMin: -5, yMax: 5 }, { auxiliary: true });
  graph.set(ids.expr, expr);
  graph.set(ids.color, 0x2563eb);
  graph.set(ids.visible, true);
  return ids;
}

/**
 * Sets a text input's value via the NATIVE HTMLInputElement.value setter
 * (not `el.value = x` directly), then dispatches a real "input" event --
 * the standard workaround for React's internal value-change tracker, which
 * wraps the DOM node's own value setter once mounted. Assigning through the
 * wrapped instance setter updates React's tracked "last known value" at the
 * same time, so a subsequently dispatched event sees old===new and skips
 * calling onChange; going through the native prototype setter bypasses
 * that tracker, so the dispatched event is correctly seen as a real change.
 */
function typeIntoInput(input: HTMLInputElement, value: string) {
  const nativeValueSetter = Object.getOwnPropertyDescriptor(
    (domWindow as unknown as { HTMLInputElement: { prototype: object } }).HTMLInputElement.prototype,
    "value",
  )?.set as (this: HTMLInputElement, v: string) => void;
  nativeValueSetter.call(input, value);
  input.dispatchEvent(new domWindow.Event("input", { bubbles: true }) as unknown as Event);
}

/** A real click toggles `.checked` itself (browser + happy-dom native behavior) and fires both "click" and "change" -- more faithful than programmatically setting `.checked` and firing "change" alone. */
function clickCheckbox(input: HTMLInputElement) {
  input.dispatchEvent(new domWindow.MouseEvent("click", { bubbles: true, cancelable: true }) as unknown as Event);
}

test("ExpressionRow: typing into the expression input flows through to the row's expr cell", async () => {
  const graph = new CellGraph();
  const ids = seedRow(graph, "row-1", "x^2");

  const { container, update, unmount } = await mount(createElement(ExpressionRow, { graph, rowId: "row-1" }));
  const inputs = Array.from(container.querySelectorAll("input")) as HTMLInputElement[];
  const exprInput = inputs.find((el) => el.type === "text");
  assert.ok(exprInput, "expected a plain text input for the expression");
  assert.equal(exprInput!.value, "x^2");

  await update(() => typeIntoInput(exprInput!, "x^3"));
  assert.equal(graph.get<string>(ids.expr), "x^3");
  assert.equal(exprInput!.value, "x^3");
  await unmount();
});

test("ExpressionRow: the visibility checkbox toggles the row's visible cell", async () => {
  const graph = new CellGraph();
  const ids = seedRow(graph, "row-2", "sin(x)");

  const { container, update, unmount } = await mount(createElement(ExpressionRow, { graph, rowId: "row-2" }));
  const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
  assert.ok(checkbox);
  assert.equal(checkbox.checked, true);

  await update(() => clickCheckbox(checkbox));
  assert.equal(graph.get<boolean>(ids.visible), false);
  await unmount();
});

test("ExpressionRow: regionMask stays null for a plain (non-inequality) expression", async () => {
  const graph = new CellGraph();
  const ids = seedRow(graph, "row-4", "x^2");

  const { unmount } = await mount(createElement(ExpressionRow, { graph, rowId: "row-4" }));
  assert.equal(graph.get<boolean[] | null>(ids.regionMask), null);
  await unmount();
});

test("ExpressionRow: regionMask is populated for an inequality expression, hand-verified at the domain boundaries", async () => {
  const graph = new CellGraph();
  const ids = seedRow(graph, "row-5", "x<0");

  const { unmount } = await mount(createElement(ExpressionRow, { graph, rowId: "row-5" }));
  const mask = graph.get<boolean[] | null>(ids.regionMask);
  assert.ok(mask, "expected a populated region mask for an inequality expression");
  // Viewport is [-5, 5] (see seedRow) -- the first sample is at x=-5 (-5<0
  // is true), the last sample is at x=5 (5<0 is false), same "sample at
  // domain.min/domain.max" formula sampleRegionMask's own oracle test
  // (sample-function.test.ts) verifies against.
  assert.equal(mask![0], true);
  assert.equal(mask![mask!.length - 1], false);
  await unmount();
});

test("ExpressionRow: clicking remove calls the onRemove callback", async () => {
  const graph = new CellGraph();
  seedRow(graph, "row-3", "cos(x)");
  let removed = false;

  const { container, update, unmount } = await mount(
    createElement(ExpressionRow, { graph, rowId: "row-3", onRemove: () => (removed = true) }),
  );
  const removeButton = container.querySelector('button[title="Remove this expression"]') as HTMLButtonElement | null;
  assert.ok(removeButton, "expected the remove button (title='Remove this expression')");

  await update(() => removeButton!.dispatchEvent(new domWindow.Event("click", { bubbles: true }) as unknown as Event));
  assert.equal(removed, true);
  await unmount();
});
