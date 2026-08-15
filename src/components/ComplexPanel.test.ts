import assert from "node:assert/strict";
import { test } from "node:test";
import { ComplexNumber } from "mallory-math";
import { CellGraph } from "../lib/cell-graph.ts";
import { cellIdsComplex } from "../lib/cell-ids.ts";
import { setupTestDom } from "../lib/test-dom.ts";
import { complexParamEnv, getCurrentComplexState } from "./ComplexPanel.tsx";

const { createElement, mount } = await setupTestDom();
const complexPanelModule = await import("./ComplexPanel.tsx");
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

  assert.deepEqual(getCurrentComplexState(graph, ids), {
    v: 2,
    exprText: "z^3 - 1",
    probeRe: "2",
    probeIm: "-1",
    showRootsOfUnity: false,
    rootsN: "7",
    showConformalGrid: true,
    conformalGridType: "polar",
    conformalGridSpacing: "0.25",
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
