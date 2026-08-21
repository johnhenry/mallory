/**
 * Render tests for the Omnigraph unified surface (Phase 1, 2D): the panel
 * hydrates from a hash-seeded state containing one of EVERY 2D item type,
 * mounts without throwing, renders a row editor per item, and round-trips
 * its state back out through the URL hash. Uses the shared happy-dom +
 * React 19 harness (setupTestDom), same "seed window.location.hash before
 * mounting" pattern as TilesPanel-compound-render.test.ts.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { setupTestDom } from "../lib/test-dom.ts";
import { decodeOmnigraphState, encodeOmnigraphState, type OmnigraphState } from "../lib/omnigraph-state.ts";

const { createElement, mount, domWindow } = await setupTestDom();

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const ALL_2D_STATE: OmnigraphState = {
  version: 1,
  viewport: { xMin: -4, xMax: 4, yMin: -4, yMax: 4 },
  items: [
    { type: "expression", expr: "sin(x)", color: 0x2563eb, visible: true },
    { type: "parametric", exprA: "cos(3*t)", exprB: "sin(2*t)", tMin: "0", tMax: "6.283", color: 0xdc2626, visible: true },
    { type: "polar", exprA: "1+cos(t)", tMin: "0", tMax: "6.283", color: 0x16a34a, visible: true },
    { type: "implicit", expr: "x^2+y^2=4", color: 0xd97706, visible: true },
    { type: "complex", expr: "z^2", visible: true },
  ],
};

test("OmnigraphPanel: hydrates one of every 2D item type from the URL hash and renders without throwing", async () => {
  domWindow.location.hash = encodeOmnigraphState(ALL_2D_STATE);
  const OmnigraphPanel = (await import("./OmnigraphPanel.tsx")).OmnigraphPanel as unknown as (props: { cellId?: string }) => ReturnType<typeof createElement>;
  const { container, update, unmount } = await mount(createElement(OmnigraphPanel, { cellId: "omni-render-test" }));
  await update(() => wait(50));

  // One type <select> per row -- confirms every item became a row editor.
  const selects = Array.from(container.querySelectorAll("select"));
  assert.equal(selects.length, 5, "expected one type dropdown per seeded item");
  assert.deepEqual(
    selects.map((s) => (s as HTMLSelectElement).value),
    ["expression", "parametric", "polar", "implicit", "complex"],
  );

  // No row-level error message rendered (every default expression parses).
  const text = container.textContent ?? "";
  assert.doesNotMatch(text, /must be a number|Unexpected|Unknown/i);

  // The complex row notes its background-layer semantics.
  assert.match(text, /background layer/);

  await unmount();
});

test("OmnigraphPanel: state round-trips back out through the URL hash after mount", async () => {
  domWindow.location.hash = encodeOmnigraphState(ALL_2D_STATE);
  const OmnigraphPanel = (await import("./OmnigraphPanel.tsx")).OmnigraphPanel as unknown as (props: { cellId?: string }) => ReturnType<typeof createElement>;
  const { update, unmount } = await mount(createElement(OmnigraphPanel, { cellId: "omni-roundtrip-test" }));
  await update(() => wait(50));

  const decoded = decodeOmnigraphState(domWindow.location.hash.slice(1));
  assert.ok(decoded, "expected the written hash to decode");
  assert.deepEqual(decoded, ALL_2D_STATE, "expected hydrate -> cells -> URL-sync to be lossless");

  await unmount();
});

test("OmnigraphPanel: a 3D item in the state upgrades the surface to 3D mode (2D canvas unmounted, Three container mounted)", async () => {
  domWindow.location.hash = encodeOmnigraphState({
    version: 1,
    viewport: { xMin: -5, xMax: 5, yMin: -5, yMax: 5 },
    items: [
      { type: "expression", expr: "sin(x)", color: 0x2563eb, visible: true },
      { type: "surface", expr: "sin(x)*cos(y)", color: 0x9333ea, visible: true },
    ],
  });
  const OmnigraphPanel = (await import("./OmnigraphPanel.tsx")).OmnigraphPanel as unknown as (props: { cellId?: string }) => ReturnType<typeof createElement>;
  const { container, update, unmount } = await mount(createElement(OmnigraphPanel, { cellId: "omni-3d-mode-test" }));
  await update(() => wait(50));

  // The 2D drawing canvas is gone; only the Three container div remains.
  // (In this GL-less test environment the scene itself fails to init and
  // the panel degrades to its WebGL-unavailable message -- the MODE switch
  // is what's under test, not GL rendering, matching the repo's own
  // "3D panels test pure functions, not GL" policy.)
  const canvases = Array.from(container.querySelectorAll("canvas"));
  assert.equal(canvases.length, 0, "expected the 2D drawing canvas to be unmounted in 3D mode (GL canvas can't init here)");
  const text = container.textContent ?? "";
  assert.match(text, /3D mode: drag to orbit|3D scene unavailable/, "expected 3D-mode UI");

  await unmount();
});

test("OmnigraphPanel: removing the only 3D item downgrades the surface back to the 2D canvas", async () => {
  domWindow.location.hash = encodeOmnigraphState({
    version: 1,
    viewport: { xMin: -5, xMax: 5, yMin: -5, yMax: 5 },
    items: [
      { type: "expression", expr: "sin(x)", color: 0x2563eb, visible: true },
      { type: "surface", expr: "sin(x)*cos(y)", color: 0x9333ea, visible: true },
    ],
  });
  const OmnigraphPanel = (await import("./OmnigraphPanel.tsx")).OmnigraphPanel as unknown as (props: { cellId?: string }) => ReturnType<typeof createElement>;
  const { container, update, unmount } = await mount(createElement(OmnigraphPanel, { cellId: "omni-downgrade-test" }));
  await update(() => wait(50));
  assert.equal(container.querySelectorAll("canvas").length, 0, "starts in 3D mode");

  // Remove the surface row (the second row's ✕ button).
  const removeButtons = Array.from(container.querySelectorAll("button")).filter((b) => b.textContent?.trim() === "✕");
  assert.equal(removeButtons.length, 2, "expected a remove button per row");
  await update(() => {
    (removeButtons[1] as HTMLButtonElement).dispatchEvent(new domWindow.MouseEvent("click", { bubbles: true, cancelable: true }) as unknown as Event);
  });
  await update(() => wait(20));

  assert.equal(container.querySelectorAll("canvas").length, 1, "expected the 2D canvas back after removing the only 3D item");
  const decoded = decodeOmnigraphState(domWindow.location.hash.slice(1));
  assert.equal(decoded?.items.length, 1);
  assert.equal(decoded?.items[0]?.type, "expression");

  await unmount();
});

test("OmnigraphPanel: a HIDDEN 3D item still keeps the surface in 3D mode (existence, not visibility)", async () => {
  domWindow.location.hash = encodeOmnigraphState({
    version: 1,
    viewport: { xMin: -5, xMax: 5, yMin: -5, yMax: 5 },
    items: [{ type: "surface", expr: "sin(x)*cos(y)", color: 0x9333ea, visible: false }],
  });
  const OmnigraphPanel = (await import("./OmnigraphPanel.tsx")).OmnigraphPanel as unknown as (props: { cellId?: string }) => ReturnType<typeof createElement>;
  const { container, update, unmount } = await mount(createElement(OmnigraphPanel, { cellId: "omni-hidden-3d-test" }));
  await update(() => wait(50));
  assert.equal(container.querySelectorAll("canvas").length, 0, "hidden 3D item still means 3D mode -- no 2D canvas");
  await unmount();
});

test("OmnigraphPanel: the Add item button appends a new expression row", async () => {
  domWindow.location.hash = encodeOmnigraphState({ version: 1, viewport: { xMin: -5, xMax: 5, yMin: -5, yMax: 5 }, items: [{ type: "expression", expr: "sin(x)", color: 0x2563eb, visible: true }] });
  const OmnigraphPanel = (await import("./OmnigraphPanel.tsx")).OmnigraphPanel as unknown as (props: { cellId?: string }) => ReturnType<typeof createElement>;
  const { container, update, unmount } = await mount(createElement(OmnigraphPanel, { cellId: "omni-add-test" }));
  await update(() => wait(50));

  const addButton = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes("Add item"));
  assert.ok(addButton, "expected an Add item button");
  await update(() => {
    (addButton as HTMLButtonElement).dispatchEvent(new domWindow.MouseEvent("click", { bubbles: true, cancelable: true }) as unknown as Event);
  });
  await update(() => wait(20));

  const selects = Array.from(container.querySelectorAll("select"));
  assert.equal(selects.length, 2, "expected a second row after clicking Add item");

  const decoded = decodeOmnigraphState(domWindow.location.hash.slice(1));
  assert.equal(decoded?.items.length, 2, "expected the new row in the synced URL state");

  await unmount();
});
