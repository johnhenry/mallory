/**
 * Render test for issue #256's Workspace explainer copy: locks in that the
 * panel accurately states its actual scope (verified against the real
 * getWorkspaceGraph()/GraphCanvas.tsx wiring -- only Graphing's "Compare"
 * tab and 3D & Surfaces' "z = f(x, y)" 2D pane read it, nothing else does)
 * rather than the old "every panel, app-wide" overclaim. Uses the shared
 * happy-dom + React 19 harness (setupTestDom), same pattern
 * GeometryPanel-render.test.ts uses.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { setupTestDom } from "../lib/test-dom.ts";

const { createElement, mount } = await setupTestDom();
const { WorkspacePanel } = await import("./WorkspacePanel.tsx");

test("WorkspacePanel: explainer states its actual, narrower scope rather than an app-wide claim", async () => {
  const { container, unmount } = await mount(createElement(WorkspacePanel, {}));

  const text = container.textContent ?? "";
  assert.ok(text.includes("Compare"), "expected the explainer to name the Compare tab as a place it's usable");
  assert.ok(text.includes("z = f(x, y)"), "expected the explainer to name the 3D height-field pane as a place it's usable");
  assert.ok(text.includes("Expression"), "expected the explainer to call out the main Expression view as NOT reading workspace variables");
  assert.ok(text.includes("Calculator"), "expected the explainer to call out the Calculator as NOT reading workspace variables");
  assert.ok(
    !text.includes("every panel, app-wide"),
    "the old overclaiming phrasing should be gone, replaced with the verified, narrower scope",
  );

  await unmount();
});
