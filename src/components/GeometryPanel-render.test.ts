/**
 * Render test for GeometryPanel's tool palette grouping (issue #252):
 * the flat point/line/circle/reflect/rotate/translate/scale/angle/polygon
 * radio list is now split into two `role="radiogroup"` sections --
 * "Objects" (point, line, circle, reflect, polygon, angle) and "Actions"
 * (rotate, translate, scale) -- see GeometryPanel.tsx's own TOOL_GROUPS
 * doc comment for the angle-placement reasoning. This test locks in the
 * grouping itself and confirms tool selection still works identically
 * (a plain UI reorganization, not a behavior change) regardless of which
 * group a tool now lives in.
 *
 * Uses the shared happy-dom + React 19 harness (setupTestDom, see its own
 * doc comment) that AlgebraView.test.ts etc. already use. `graph` is
 * passed in explicitly (as NotebookPanel-embedded instances do) with
 * `syncUrl: false`, the same pattern RegressionPanel-render.test.ts uses
 * to avoid needing a live TanStack Router context / `window.location.hash`
 * URL-sync plumbing this harness doesn't set up -- this test never clicks
 * "Save to gallery" (the one control that would need it) either.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { setupTestDom } from "../lib/test-dom.ts";
import { CellGraph } from "../lib/cell-graph.ts";
import { cellIdsGeometry } from "../lib/cell-ids.ts";

const { createElement, mount, domWindow } = await setupTestDom();
// GeometryPanel's props parameter has a default value (`= {}`), which
// type-checks oddly against createElement's overloads once obtained via
// `await import(...)` -- explicitly retyped against the real (type-only,
// erased at runtime) GeometryPanelProps, same as
// RegressionPanel-render.test.ts does for RegressionPanel.
const GeometryPanel = (await import("./GeometryPanel.tsx")).GeometryPanel as unknown as (
  props: import("./GeometryPanel.tsx").GeometryPanelProps,
) => ReturnType<typeof createElement>;

function radioLabels(group: Element): string[] {
  return Array.from(group.querySelectorAll("label")).map((l) => l.textContent?.trim() ?? "");
}

test("GeometryPanel: tool palette is split into Objects, Actions, and Select groups", async () => {
  const graph = new CellGraph();
  const listIds = cellIdsGeometry("render-test-groups");
  const { container, unmount } = await mount(
    createElement(GeometryPanel, { cellId: "render-test-groups", graph, syncUrl: false }),
  );

  const groups = container.querySelectorAll('[role="radiogroup"]');
  assert.equal(groups.length, 3, "expected exactly three radiogroups (Objects, Actions, Select)");

  const objectsGroup = Array.from(groups).find((g) => g.getAttribute("aria-label") === "Objects");
  const actionsGroup = Array.from(groups).find((g) => g.getAttribute("aria-label") === "Actions");
  const selectGroup = Array.from(groups).find((g) => g.getAttribute("aria-label") === "Select");
  assert.ok(objectsGroup, "expected a radiogroup labeled Objects");
  assert.ok(actionsGroup, "expected a radiogroup labeled Actions");
  assert.ok(selectGroup, "expected a radiogroup labeled Select (#336 item 1)");

  const objectLabels = radioLabels(objectsGroup as Element);
  const actionLabels = radioLabels(actionsGroup as Element);
  const selectLabels = radioLabels(selectGroup as Element);

  for (const t of ["point", "line", "circle", "reflect", "polygon", "angle"]) {
    assert.ok(objectLabels.includes(t), `expected "${t}" in the Objects group, got: ${objectLabels.join(", ")}`);
  }
  for (const t of ["rotate", "translate", "scale"]) {
    assert.ok(actionLabels.includes(t), `expected "${t}" in the Actions group, got: ${actionLabels.join(", ")}`);
  }
  assert.deepEqual(selectLabels, ["select"]);
  // No overlap, and no tool dropped in the split.
  assert.equal(objectLabels.length, 6);
  assert.equal(actionLabels.length, 3);

  assert.equal(graph.has(listIds.objectList), true);
  await unmount();
});

test("GeometryPanel: selecting a tool from either group still switches the active tool (radio behavior preserved across the split)", async () => {
  const graph = new CellGraph();
  const { container, update, unmount } = await mount(
    createElement(GeometryPanel, { cellId: "render-test-select", graph, syncUrl: false }),
  );

  function radioFor(label: string): HTMLInputElement {
    const found = Array.from(container.querySelectorAll("label")).find((l) => l.textContent?.trim() === label);
    assert.ok(found, `expected a radio label "${label}"`);
    const input = (found as Element).querySelector('input[type="radio"]');
    assert.ok(input, `expected an <input type="radio"> inside the "${label}" label`);
    return input as HTMLInputElement;
  }

  // Default tool is "point" -- its radio starts checked.
  assert.equal(radioFor("point").checked, true);
  assert.equal(radioFor("rotate").checked, false);

  // Switch to an Actions-group tool ("rotate"): its own extra angle input
  // should appear, proving the tool state actually changed, not just the
  // checked attribute in isolation. Default angle unit is radians, so the
  // label reads "angle (rad)", not "angle (°)".
  await update(() => {
    radioFor("rotate").dispatchEvent(new domWindow.MouseEvent("click", { bubbles: true, cancelable: true }) as unknown as Event);
  });
  assert.equal(radioFor("rotate").checked, true);
  assert.equal(radioFor("point").checked, false);
  assert.ok(container.textContent?.includes("angle (rad)"), "expected the rotate tool's angle input to appear");

  // Switch back to an Objects-group tool ("angle" itself, the disputed one).
  await update(() => {
    radioFor("angle").dispatchEvent(new domWindow.MouseEvent("click", { bubbles: true, cancelable: true }) as unknown as Event);
  });
  assert.equal(radioFor("angle").checked, true);
  assert.equal(radioFor("rotate").checked, false);
  assert.ok(
    container.textContent?.includes("Click a point, then the vertex, then the other point."),
    "expected the angle tool's own hint text once selected",
  );

  await unmount();
});
