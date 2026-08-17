import assert from "node:assert/strict";
import { test } from "node:test";
import { CellGraph } from "../lib/cell-graph.ts";
import { cellIdsRegression } from "../lib/cell-ids.ts";
import { setupTestDom } from "../lib/test-dom.ts";
import type { HuberFitResult } from "./RegressionPanel.tsx";

const { createElement, mount, domWindow } = await setupTestDom();
const regressionPanelModule = await import("./RegressionPanel.tsx");
// RegressionPanel's single, all-optional-with-default props parameter
// doesn't satisfy createElement's overload resolution -- same gap
// DiscretePanel/ComplexPanel's own tests work around with a re-typed local alias.
const RegressionPanel = regressionPanelModule.RegressionPanel as (props: {
  cellId: string;
  graph: CellGraph;
  syncUrl: boolean;
}) => ReturnType<typeof createElement>;

function clickButton(el: Element) {
  el.dispatchEvent(new domWindow.MouseEvent("click", { bubbles: true, cancelable: true }) as unknown as Event);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Polls `predicate`, letting each tick settle inside `update` (act) so any
 * state updates fitRobustLinear's real (fast but non-instant) training loop
 * triggers along the way are properly flushed -- mirrors
 * use-undo-history.test.ts's own `await update(() => wait(ms))` pattern.
 */
async function waitFor(predicate: () => boolean, update: (fn: () => unknown) => Promise<void>, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error(`waitFor: condition not met within ${timeoutMs}ms`);
    await update(() => wait(5));
  }
}

test("RegressionPanel: editing a row while a Huber fit is in flight discards the stale result instead of applying it", async () => {
  const graph = new CellGraph();
  const ids = cellIdsRegression("regression-huber-stale");

  const { container, update } = await mount(createElement(RegressionPanel, { cellId: "regression-huber-stale", graph, syncUrl: false }));

  await update(() => graph.set(ids.linearLossMode, "huber"));
  const fitButton = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes("Fit (Huber)"));
  assert.ok(fitButton, "expected a \"Fit (Huber)\" button once linearLossMode is huber");

  // Deliberately NOT wrapped in `update`/`act`: handleFitHuber runs
  // synchronously up to its first `await fitRobustLinear(...)`, and act's
  // own flushing loop would otherwise keep pumping microtasks until that
  // real (if fast) async training run has already finished -- which would
  // make it impossible to land a row edit inside the "in flight" window at
  // all. Firing both the click and the row edit as raw, back-to-back
  // synchronous DOM/graph operations reproduces the actual browser
  // race the row `<input>`s (never disabled during a fit, per issue #237)
  // allow: click "Fit (Huber)", then edit a row before the fit resolves.
  clickButton(fitButton!);
  assert.equal(graph.get<boolean>(ids.huberFitting), true, "expected the fit to be in flight immediately after clicking");
  assert.equal(graph.get<HuberFitResult>(ids.huberFitResult), null);

  const originalRows = graph.get<{ id: string; x: string; y: string }[]>(ids.rows);
  graph.set(
    ids.rows,
    originalRows.map((row, i) => (i === 0 ? { ...row, y: "999" } : row)),
  );

  await waitFor(() => graph.get<boolean>(ids.huberFitting) === false, update);

  assert.equal(
    graph.get<HuberFitResult>(ids.huberFitResult),
    null,
    "a Huber fit computed from the OLD (pre-edit) points must not be applied once rows changed mid-flight",
  );
});

test("RegressionPanel: happy path -- a Huber fit with no row edits during flight applies normally", async () => {
  const graph = new CellGraph();
  const ids = cellIdsRegression("regression-huber-happy");

  const { container, update } = await mount(createElement(RegressionPanel, { cellId: "regression-huber-happy", graph, syncUrl: false }));

  await update(() => graph.set(ids.linearLossMode, "huber"));
  const fitButton = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes("Fit (Huber)"));
  assert.ok(fitButton);

  await update(() => clickButton(fitButton!));
  await waitFor(() => graph.get<boolean>(ids.huberFitting) === false, update);

  const result = graph.get<HuberFitResult>(ids.huberFitResult);
  assert.ok(result?.ok, `expected a successful Huber fit, got ${JSON.stringify(result)}`);
});
