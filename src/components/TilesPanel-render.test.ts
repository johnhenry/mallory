/**
 * Render test for the "How this works" explainer added for issue #258
 * (the Wang tile lab's notation/purpose was unclear to a first-time user).
 * Locks in that the explainer actually renders, is expanded by default (so
 * a first-time visitor sees it without an extra click), and covers the
 * notation for every lattice -- not just a generic filler paragraph.
 *
 * Uses the shared happy-dom + React 19 harness (setupTestDom), same as
 * GeometryPanel-render.test.ts. TilesPanel takes no `graph` prop (unlike
 * GeometryPanel/RegressionPanel) -- it owns its own CellGraph internally
 * via useTilesGraph -- so this only needs to pass a unique `cellId`.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { setupTestDom } from "../lib/test-dom.ts";

const { createElement, mount } = await setupTestDom();
// TilesPanel's props parameter has a default value (`= {}`), which
// type-checks oddly against createElement's overloads once obtained via
// `await import(...)` -- explicitly retyped, same workaround
// GeometryPanel-render.test.ts / RegressionPanel-render.test.ts use for
// their own default-valued props parameters.
const TilesPanel = (await import("./TilesPanel.tsx")).TilesPanel as unknown as (props: {
  cellId?: string;
}) => ReturnType<typeof createElement>;

test("TilesPanel: the How this works explainer renders, expanded, with the page's purpose and notation", async () => {
  const { container, unmount } = await mount(createElement(TilesPanel, { cellId: "render-test-explainer" }));

  const details = container.querySelector("details");
  assert.ok(details, "expected a <details> explainer element");
  assert.equal(details?.hasAttribute("open"), true, "expected the explainer to be expanded by default");

  const summary = details?.querySelector("summary");
  assert.equal(summary?.textContent?.trim(), "How this works");

  const text = details?.textContent ?? "";
  assert.match(text, /Wang tile laboratory/, "expected the overall page purpose to be stated");
  assert.match(text, /labels on their touching edges match/, "expected the edge-matching rule to be explained");
  // Notation for every lattice format, not just the default square one.
  assert.match(text, /id N E S W/);
  assert.match(text, /id e0 e1 e2 e3 e4 e5/);
  assert.match(text, /id left right top bottom/);
  assert.match(text, /id N S E W U D/);
  // What the solver/analysis panels are actually doing.
  assert.match(text, /Backtracking/);
  assert.match(text, /Entropy/);
  assert.match(text, /Diffraction/);
  assert.match(text, /Differentiable relaxation/);

  await unmount();
});
