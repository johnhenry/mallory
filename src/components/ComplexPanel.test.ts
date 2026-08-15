import assert from "node:assert/strict";
import { test } from "node:test";
import { ComplexNumber, Symbolic } from "mallory-math";
import { CellGraph } from "../lib/cell-graph.ts";
import { cellIdsComplex } from "../lib/cell-ids.ts";
import { setupTestDom } from "../lib/test-dom.ts";
import { complexParamEnv, getCurrentComplexState } from "./ComplexPanel.tsx";

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

test("getCurrentComplexState reads back exactly what was written to each of the panel's cells (gallery save round-trip)", () => {
  const graph = new CellGraph();
  const ids = cellIdsComplex("complex-test");
  graph.set(ids.exprText, "z^3 - 1");
  graph.set(ids.probeRe, "2");
  graph.set(ids.probeIm, "-1");
  graph.set(ids.showRootsOfUnity, false);
  graph.set(ids.rootsN, "7");
  graph.set(ids.showConformalGrid, true);
  graph.set(ids.conformalGridType, "polar");
  graph.set(ids.conformalGridSpacing, "0.25");
  graph.set(ids.showZeros, true);
  graph.set(ids.showPoles, false);

  assert.deepEqual(getCurrentComplexState(graph, ids), {
    v: 3,
    exprText: "z^3 - 1",
    probeRe: "2",
    probeIm: "-1",
    showRootsOfUnity: false,
    rootsN: "7",
    showConformalGrid: true,
    conformalGridType: "polar",
    conformalGridSpacing: "0.25",
    showZeros: true,
    showPoles: false,
  });
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
  const ids = cellIdsComplex("complex-freevar");

  // Mount on a genuinely fresh graph first (`useComplexGraph` gates its
  // one-time reactive-cell setup on `!graph.has(ids.exprText)`, so
  // pre-seeding before mount -- as seedComplexState would -- would skip
  // that setup entirely); update to "z^2 + c" afterward instead.
  const { container, update, unmount } = await mount(createElement(ComplexPanel, { cellId: "complex-freevar", graph, syncUrl: false }));
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
  // !graph.has(ids.exprText). DEFAULT_COMPLEX_STATE.exprText is "z^2 + 1",
  // so no pre-seed is needed here.
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
  const ids = cellIdsComplex("complex-mathkb-2");

  const { container, update, unmount } = await mount(createElement(ComplexPanel, { cellId: "complex-mathkb-2", graph, syncUrl: false }));
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
  const ids = cellIdsComplex("complex-mathkb-3");

  const { container, update, unmount } = await mount(createElement(ComplexPanel, { cellId: "complex-mathkb-3", graph, syncUrl: false }));
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
