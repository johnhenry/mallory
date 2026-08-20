import assert from "node:assert/strict";
import { test } from "node:test";
import { ComplexNumber, Symbolic } from "mallory-math";
import { CellGraph } from "../lib/cell-graph.ts";
import { cellIdsComplex } from "../lib/cell-ids.ts";
import { appendRow, removeRow } from "../lib/multi-panel-rows.ts";
import { setupTestDom } from "../lib/test-dom.ts";
import { complexParamEnv, getCurrentComplexState, seedComplexRow, seedComplexState } from "./ComplexPanel.tsx";

const { createElement, mount, domWindow } = await setupTestDom();
const complexPanelModule = await import("./ComplexPanel.tsx");

/** Same click-then-native-events pattern as ExpressionRow.test.ts's identically-named helper. */
function clickCheckbox(input: HTMLInputElement) {
  input.dispatchEvent(new domWindow.MouseEvent("click", { bubbles: true, cancelable: true }) as unknown as Event);
}
// ComplexPanel's single, all-optional-with-default props parameter doesn't
// satisfy createElement's overload resolution -- same gap DiscretePanel's
// own test works around with a re-typed local alias.
const ComplexPanel = complexPanelModule.ComplexPanel as (props: { cellId: string; graph: CellGraph; syncUrl: boolean }) => ReturnType<typeof createElement>;

const ROW_A = {
  exprText: "z^3 - 1",
  probeRe: "2",
  probeIm: "-1",
  showRootsOfUnity: false,
  rootsN: "7",
  showConformalGrid: true,
  conformalGridType: "polar" as const,
  conformalGridSpacing: "0.25",
  showZeros: true,
  showPoles: false,
  color: 0x2563eb,
  visible: true,
};

// #336 item 7: ComplexPanel now holds an ordered list of fully independent
// function rows on one shared CellGraph, each with its own expression,
// probe/overlay state, pan/zoom viewport, and pair of canvases -- mirrors
// OdePanel.test.ts's own "seed rows directly on a CellGraph, no React
// rendering" style for the non-DOM tests below.

test("getCurrentComplexState reads back exactly what was written to each row's cells (gallery save round-trip)", () => {
  const graph = new CellGraph();
  const containerIds = cellIdsComplex("complex-test");
  graph.set(containerIds.list, [] as string[], { auxiliary: true });
  seedComplexRow(graph, "row-1", ROW_A);
  graph.set(containerIds.list, ["row-1"], { auxiliary: true });

  assert.deepEqual(getCurrentComplexState(graph, containerIds), {
    v: 4,
    rows: [ROW_A],
  });
});

test("appendRow/removeRow: grow and shrink a ComplexPanel's row list, cleaning up a removed row's own cells", () => {
  const graph = new CellGraph();
  const containerIds = cellIdsComplex("complex-test");
  const rowId = crypto.randomUUID();
  seedComplexRow(graph, rowId, ROW_A);
  graph.set(containerIds.list, [rowId], { auxiliary: true });

  const { id: id2, index } = appendRow(graph, containerIds.list);
  assert.equal(index, 1);
  seedComplexRow(graph, id2, { ...ROW_A, color: 0x16a34a });
  assert.deepEqual(graph.get<string[]>(containerIds.list), [rowId, id2]);

  removeRow(graph, containerIds.list, id2, cellIdsComplex(id2));
  assert.deepEqual(graph.get<string[]>(containerIds.list), [rowId]);
  assert.equal(graph.hasValue(cellIdsComplex(id2).exprText), false);
});

test("seedComplexState: re-seeding an already-populated container replaces every row (not appends), the shape NotebookComplexBlock's post-mount overwrite relies on", () => {
  const graph = new CellGraph();
  const containerIds = cellIdsComplex("complex-test");
  graph.set(containerIds.list, [] as string[], { auxiliary: true });
  seedComplexState(graph, containerIds, { v: 4, rows: [ROW_A] });
  const firstRowId = graph.get<string[]>(containerIds.list)[0] as string;

  seedComplexState(graph, containerIds, { v: 4, rows: [ROW_A, { ...ROW_A, exprText: "z^2" }] });

  assert.equal(graph.get<string[]>(containerIds.list).length, 2, "replaced with exactly the new rows, not appended onto the old one");
  assert.equal(graph.has(cellIdsComplex(firstRowId).exprText), false, "the old row's cells are gone, not orphaned");
});

test("getCurrentComplexState round-trips through seedComplexState for multiple rows", () => {
  const graph = new CellGraph();
  const containerIds = cellIdsComplex("complex-test");
  graph.set(containerIds.list, [] as string[], { auxiliary: true });
  const state = { v: 4 as const, rows: [ROW_A, { ...ROW_A, exprText: "1/z", visible: false }] };
  seedComplexState(graph, containerIds, state);
  assert.deepEqual(getCurrentComplexState(graph, containerIds), state);
});

test("complexParamEnv: binds z plus every free-variable param as a real-valued ComplexNumber, hand-computed", () => {
  const z = new ComplexNumber(2, 3);
  const env = complexParamEnv({ c: 5, n: -1.5 }, z);
  assert.equal(env.z, z);
  assert.ok(env.c!.equals(new ComplexNumber(5, 0)), `c: ${env.c}`);
  assert.ok(env.n!.equals(new ComplexNumber(-1.5, 0)), `n: ${env.n}`);
});

test("complexParamEnv: an empty params record binds only z", () => {
  const z = ComplexNumber.One;
  assert.deepEqual(Object.keys(complexParamEnv({}, z)), ["z"]);
});

test("ComplexPanel: a free variable in f(z) (e.g. c in z^2+c) surfaces a slider, and dragging it changes the probe reading", async () => {
  const graph = new CellGraph();
  const containerIds = cellIdsComplex("complex-freevar");

  // Mount on a genuinely fresh graph first (`useComplexGraph` gates its
  // one-time reactive-cell setup on `!graph.has(containerIds.list)`, so
  // pre-seeding before mount -- as seedComplexState would -- would skip
  // that setup entirely); update to "z^2 + c" afterward instead, on the
  // default single row that mounting creates.
  const { container, update, unmount } = await mount(createElement(ComplexPanel, { cellId: "complex-freevar", graph, syncUrl: false }));
  const rowId = graph.get<string[]>(containerIds.list)[0] as string;
  const ids = cellIdsComplex(rowId);
  await update(() => {
    graph.set(ids.exprText, "z^2 + c");
    graph.set(ids.probeRe, "0");
    graph.set(ids.probeIm, "0");
  });

  const sliderLabel = Array.from(container.querySelectorAll("label")).find((el) => el.textContent?.startsWith("c ="));
  assert.ok(sliderLabel, "expected a slider labeled \"c =\" for the free variable discovered in \"z^2 + c\"");
  const slider = sliderLabel!.querySelector("input[type=range]") as HTMLInputElement;
  assert.ok(slider, "expected a range input inside the c slider's label");

  // f(0) = 0^2 + c = c -- defaultSliderRange's generic default is 1, so the
  // probe reading should show re=1 before any drag.
  assert.ok(container.textContent?.includes("= 1.0000+0.0000i"), container.textContent ?? "");

  await update(() => graph.set(ids.param("c"), 5));
  assert.equal(slider.value, "5");
  assert.ok(container.textContent?.includes("= 5.0000+0.0000i"), container.textContent ?? "");

  await unmount();
});

test("ComplexPanel: the math keyboard checkbox swaps the plain input for a math-field seeded with f(z)'s LaTeX", async () => {
  const graph = new CellGraph();

  // Mount on a fresh graph first -- same reason as the free-var test above:
  // useComplexGraph's one-time reactive-cell setup is gated on
  // !graph.has(containerIds.list). DEFAULT_COMPLEX_STATE's default row's
  // exprText is "z^2 + 1", so no pre-seed is needed here.
  const { container, update, unmount } = await mount(createElement(ComplexPanel, { cellId: "complex-mathkb", graph, syncUrl: false }));
  assert.ok(container.querySelector('input[type="text"], input:not([type])'), "expected the plain text input by default");
  assert.equal(container.querySelector("math-field"), null);

  const toggle = Array.from(container.querySelectorAll('input[type="checkbox"]')).find(
    (el) => el.closest("label")?.textContent?.includes("math keyboard"),
  ) as HTMLInputElement;
  assert.ok(toggle, "expected a \"math keyboard\" checkbox");

  await update(() => clickCheckbox(toggle));
  const field = container.querySelector("math-field") as unknown as { value: string } | null;
  assert.ok(field, "expected a <math-field> once the math-keyboard toggle is on");
  // Hand-computed: Symbolic.toLatex(Symbolic.parse("z^2 + 1")) round-trips
  // through Symbolic.fromLatex back to the same expression source.
  assert.equal(Symbolic.toString(Symbolic.fromLatex(field!.value)), "z^2 + 1");

  await unmount();
});

test("ComplexPanel: typing into the math-field flows LaTeX -> expression source -> the exprText cell", async () => {
  const graph = new CellGraph();
  const containerIds = cellIdsComplex("complex-mathkb-2");

  const { container, update, unmount } = await mount(createElement(ComplexPanel, { cellId: "complex-mathkb-2", graph, syncUrl: false }));
  const rowId = graph.get<string[]>(containerIds.list)[0] as string;
  const ids = cellIdsComplex(rowId);
  await update(() => graph.set(ids.exprText, "z"));
  const toggle = Array.from(container.querySelectorAll('input[type="checkbox"]')).find(
    (el) => el.closest("label")?.textContent?.includes("math keyboard"),
  ) as HTMLInputElement;
  await update(() => clickCheckbox(toggle));
  const field = container.querySelector("math-field") as unknown as { value: string; dispatchEvent: (e: Event) => void } | null;
  assert.ok(field);

  await update(() => {
    field!.value = "z^3+c";
    field!.dispatchEvent(new domWindow.Event("input", { bubbles: true }) as unknown as Event);
  });
  // Hand-computed: fromLatex("z^3+c") -> Pow(z,3)+c -> toString "z^3 + c".
  assert.equal(graph.get<string>(ids.exprText), "z^3 + c");

  await unmount();
});

test("ComplexPanel: incomplete LaTeX typed into the math-field (fromLatex throws) leaves exprText at its last good value", async () => {
  const graph = new CellGraph();
  const containerIds = cellIdsComplex("complex-mathkb-3");

  const { container, update, unmount } = await mount(createElement(ComplexPanel, { cellId: "complex-mathkb-3", graph, syncUrl: false }));
  const rowId = graph.get<string[]>(containerIds.list)[0] as string;
  const ids = cellIdsComplex(rowId);
  await update(() => graph.set(ids.exprText, "z"));
  const toggle = Array.from(container.querySelectorAll('input[type="checkbox"]')).find(
    (el) => el.closest("label")?.textContent?.includes("math keyboard"),
  ) as HTMLInputElement;
  await update(() => clickCheckbox(toggle));
  const field = container.querySelector("math-field") as unknown as { value: string; dispatchEvent: (e: Event) => void } | null;
  assert.ok(field);

  await update(() => {
    // "\frac{1}{" is a mid-edit incomplete LaTeX fragment -- fromLatex throws.
    field!.value = "\\frac{1}{";
    field!.dispatchEvent(new domWindow.Event("input", { bubbles: true }) as unknown as Event);
  });
  assert.equal(graph.get<string>(ids.exprText), "z", "exprText should be unchanged on a parse failure");

  await unmount();
});

test("ComplexPanel: '+ Add function' appends a second independent function row, and it can be removed again", async () => {
  const graph = new CellGraph();
  const containerIds = cellIdsComplex("complex-multi");

  const { container, update, unmount } = await mount(createElement(ComplexPanel, { cellId: "complex-multi", graph, syncUrl: false }));
  assert.equal(graph.get<string[]>(containerIds.list).length, 1);

  const addButton = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes("Add function"));
  assert.ok(addButton, 'expected a "+ Add function" button');
  await update(() => addButton!.dispatchEvent(new domWindow.MouseEvent("click", { bubbles: true, cancelable: true }) as unknown as Event));

  assert.equal(graph.get<string[]>(containerIds.list).length, 2, "a second independent function row was appended");
  const [rowIdA, rowIdB] = graph.get<string[]>(containerIds.list) as [string, string];
  assert.notEqual(rowIdA, rowIdB);

  const removeButtons = Array.from(container.querySelectorAll("button")).filter((b) => b.title === "Remove this function");
  assert.equal(removeButtons.length, 2, "remove buttons only appear once there is more than one row");
  await update(() => removeButtons[0]!.dispatchEvent(new domWindow.MouseEvent("click", { bubbles: true, cancelable: true }) as unknown as Event));

  assert.equal(graph.get<string[]>(containerIds.list).length, 1, "back down to one row after removal");

  await unmount();
});
