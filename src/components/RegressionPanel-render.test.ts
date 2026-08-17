/**
 * Behavioral test for RegressionPanel's `regressionPlot` memoization
 * (issue #236): regressionPlot does real work (a viewport bounds scan,
 * curve sampling -- up to CURVE_SAMPLES Symbolic evaluations for a
 * nonlinear model -- and outlier detection), so it must be recomputed only
 * when one of its actual inputs (fit/modelExpr/linearLossMode/
 * huberFitResult/showOutliers) changes, not on every render.
 *
 * Kept in its own file (rather than RegressionPanel.test.ts, which already
 * statically imports RegressionPanel.tsx to test the pure `regressionPlot`
 * export) because `mock.module` only intercepts imports that happen AFTER
 * it's called -- RegressionPanel.tsx and its own `@tanstack/react-start`/
 * `../lib/saved-graphs.ts` imports must not already be loaded (by a static
 * import elsewher in the same file) by the time the mocks below are
 * registered.
 *
 * `@tanstack/react-start`'s `useServerFn` (used for the "Save to gallery"
 * button) needs a live TanStack Router context this test harness doesn't
 * set up -- mocked to a passthrough. `../lib/saved-graphs.ts` pulls in
 * `node:sqlite` file storage at import time -- mocked to a stub, since the
 * save path itself is irrelevant to the memoization being tested here.
 *
 * Same happy-dom + React 19 `act()` harness as use-cell.test.ts.
 */
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { Window } from "happy-dom";
import type { RegressionPanelProps } from "./RegressionPanel.tsx";

const domWindow = new Window();
(globalThis as Record<string, unknown>).window = domWindow;
(globalThis as Record<string, unknown>).document = domWindow.document;
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

mock.module("@tanstack/react-start", {
  namedExports: { useServerFn: (fn: unknown) => fn },
});
mock.module("../lib/saved-graphs.ts", {
  namedExports: { saveGraph: async () => ({ id: "fake" }) },
});

const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { GraphUtils } = await import("mallory-math");
const { CellGraph } = await import("../lib/cell-graph.ts");
const { cellIdsRegression } = await import("../lib/cell-ids.ts");
// A component whose props parameter has a default value (`= {}`, as
// RegressionPanel's does) type-checks oddly against createElement's own
// overloads once obtained via `await import(...)` -- explicitly retyped
// against the real (type-only, so erased at runtime -- doesn't affect
// mock.module's timing) RegressionPanelProps to sidestep that.
const RegressionPanel = (await import("./RegressionPanel.tsx"))
  .RegressionPanel as unknown as (props: RegressionPanelProps) => ReturnType<typeof createElement>;

async function mount(element: ReturnType<typeof createElement>) {
  const container = domWindow.document.createElement("div");
  domWindow.document.body.appendChild(container as never);
  const root = createRoot(container as unknown as Element);
  await act(async () => {
    root.render(element);
  });
  return {
    update: (fn: () => void) => act(async () => fn()),
    unmount: () => act(async () => root.unmount()),
  };
}

test("RegressionPanel: an unrelated cell change does not re-invoke the curve-sampling work, but a real regressionPlot input does", async () => {
  // GraphUtils.vectorToCurve is called exactly once per regressionPlot()
  // invocation for the default (linear, 2-endpoint) fit -- a clean, easily
  // spied proxy for "did regressionPlot actually recompute".
  const curveSpy = mock.method(GraphUtils, "vectorToCurve");

  const graph = new CellGraph();
  const ids = cellIdsRegression("render-test-1");
  const { update, unmount } = await mount(
    createElement(RegressionPanel, { cellId: "render-test-1", graph, syncUrl: false }),
  );
  const afterMount = curveSpy.mock.callCount();
  assert.equal(afterMount, 1, "expected exactly one curve computation on mount");

  // Irrelevant change: `huberFitting` is a transient loading flag for the
  // "Fit (Huber)" button -- read via useCell (so it re-renders the panel)
  // but never read by regressionPlot's own five inputs.
  await update(() => graph.set(ids.huberFitting, true));
  assert.equal(
    curveSpy.mock.callCount(),
    afterMount,
    "an unrelated cell change must not re-invoke the curve computation",
  );

  // Relevant change: showOutliers is one of regressionPlot's own five
  // arguments -- the memoized curve must recompute.
  await update(() => graph.set(ids.showOutliers, true));
  assert.equal(
    curveSpy.mock.callCount(),
    afterMount + 1,
    "a real regressionPlot input change must re-invoke the curve computation",
  );

  await unmount();
});
