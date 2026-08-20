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

/** Every "Fit (Huber)" button on the page, in DOM order -- one per dataset once linearLossMode is huber for that dataset. */
function fitHuberButtons(container: Element): Element[] {
  return Array.from(container.querySelectorAll("button")).filter((b) => b.textContent?.includes("Fit (Huber)"));
}

test("RegressionPanel: editing a dataset's points while its own Huber fit is in flight discards the stale result instead of applying it", async () => {
  const graph = new CellGraph();
  const containerIds = cellIdsRegression("regression-huber-stale");

  const { container, update } = await mount(createElement(RegressionPanel, { cellId: "regression-huber-stale", graph, syncUrl: false }));

  const [datasetId] = graph.get<string[]>(containerIds.list);
  assert.ok(datasetId, "expected the default single dataset to have been seeded");
  const ids = cellIdsRegression(datasetId as string);

  await update(() => graph.set(ids.linearLossMode, "huber"));
  const fitButton = fitHuberButtons(container)[0];
  assert.ok(fitButton, 'expected a "Fit (Huber)" button once linearLossMode is huber');

  // Deliberately NOT wrapped in `update`/`act`: handleFitHuber runs
  // synchronously up to its first `await fitRobustLinear(...)`, and act's
  // own flushing loop would otherwise keep pumping microtasks until that
  // real (if fast) async training run has already finished -- which would
  // make it impossible to land a point edit inside the "in flight" window
  // at all. Firing both the click and the point edit as raw, back-to-back
  // synchronous DOM/graph operations reproduces the actual browser race the
  // point <input>s (never disabled during a fit, per issue #237) allow:
  // click "Fit (Huber)", then edit a point before the fit resolves.
  clickButton(fitButton);
  assert.equal(graph.get<boolean>(ids.huberFitting), true, "expected the fit to be in flight immediately after clicking");
  assert.equal(graph.get<HuberFitResult>(ids.huberFitResult), null);

  const originalPoints = graph.get<{ id: string; x: string; y: string }[]>(ids.points);
  graph.set(
    ids.points,
    originalPoints.map((p, i) => (i === 0 ? { ...p, y: "999" } : p)),
  );

  await waitFor(() => graph.get<boolean>(ids.huberFitting) === false, update);

  assert.equal(
    graph.get<HuberFitResult>(ids.huberFitResult),
    null,
    "a Huber fit computed from the OLD (pre-edit) points must not be applied once this dataset's points changed mid-flight",
  );
});

test("RegressionPanel: editing dataset A's points does not discard dataset B's own in-flight Huber fit (per-dataset staleness, #336 item 7)", async () => {
  const graph = new CellGraph();
  const containerIds = cellIdsRegression("regression-huber-cross-dataset");

  const { container, update } = await mount(
    createElement(RegressionPanel, { cellId: "regression-huber-cross-dataset", graph, syncUrl: false }),
  );

  // Add a second dataset so there are two independent Huber generation counters.
  const addButton = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes("Add dataset"));
  assert.ok(addButton, 'expected a "+ Add dataset" button');
  await update(() => clickButton(addButton!));

  const [datasetAId, datasetBId] = graph.get<string[]>(containerIds.list);
  assert.ok(datasetAId && datasetBId, "expected two datasets after clicking + Add dataset");
  const idsA = cellIdsRegression(datasetAId as string);
  const idsB = cellIdsRegression(datasetBId as string);

  await update(() => graph.set(idsB.linearLossMode, "huber"));
  const fitButtonB = fitHuberButtons(container)[0];
  assert.ok(fitButtonB, 'expected a "Fit (Huber)" button for dataset B once its linearLossMode is huber');

  // Same raw, non-`act`-wrapped click as the single-dataset test above, so
  // dataset B's fit is genuinely still in flight when dataset A's points
  // are edited immediately after.
  clickButton(fitButtonB);
  assert.equal(graph.get<boolean>(idsB.huberFitting), true, "expected dataset B's fit to be in flight immediately after clicking");

  // Edit dataset A's own points -- must bump ONLY dataset A's own
  // generation counter, not dataset B's.
  const pointsA = graph.get<{ id: string; x: string; y: string }[]>(idsA.points);
  graph.set(
    idsA.points,
    pointsA.map((p, i) => (i === 0 ? { ...p, y: "999" } : p)),
  );

  await waitFor(() => graph.get<boolean>(idsB.huberFitting) === false, update);

  const resultB = graph.get<HuberFitResult>(idsB.huberFitResult);
  assert.ok(
    resultB?.ok,
    `editing dataset A's points must not discard dataset B's own in-flight Huber fit, got ${JSON.stringify(resultB)}`,
  );
});

test("RegressionPanel: happy path -- a Huber fit with no point edits during flight applies normally", async () => {
  const graph = new CellGraph();
  const containerIds = cellIdsRegression("regression-huber-happy");

  const { container, update } = await mount(createElement(RegressionPanel, { cellId: "regression-huber-happy", graph, syncUrl: false }));

  const [datasetId] = graph.get<string[]>(containerIds.list);
  const ids = cellIdsRegression(datasetId as string);

  await update(() => graph.set(ids.linearLossMode, "huber"));
  const fitButton = fitHuberButtons(container)[0];
  assert.ok(fitButton);

  await update(() => clickButton(fitButton));
  await waitFor(() => graph.get<boolean>(ids.huberFitting) === false, update);

  const result = graph.get<HuberFitResult>(ids.huberFitResult);
  assert.ok(result?.ok, `expected a successful Huber fit, got ${JSON.stringify(result)}`);
});
