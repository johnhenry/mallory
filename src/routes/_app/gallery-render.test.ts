/**
 * Render test for issue #256's Gallery explainer copy: locks in that the
 * page states what gets saved, how retrieval works, and how short-link
 * sharing works, plus that it's one list shared by everyone (not private
 * per-browser).
 *
 * `@tanstack/react-start`'s `useServerFn` needs a live TanStack Router
 * context this test harness doesn't set up -- mocked to a passthrough,
 * same convention RegressionPanel-render.test.ts uses. `../../lib/
 * saved-graphs.ts` and `../../lib/short-links.ts` pull in `node:sqlite`
 * file storage at import time -- mocked to stubs, since the save/list path
 * itself is irrelevant to the explainer copy being tested here (this test
 * never waits on `listSavedGraphsFn`'s result, only checks the always-
 * rendered static explainer text above the list).
 */
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { Window } from "happy-dom";

const domWindow = new Window();
(globalThis as Record<string, unknown>).window = domWindow;
(globalThis as Record<string, unknown>).document = domWindow.document;
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

mock.module("@tanstack/react-start", {
  namedExports: { useServerFn: (fn: unknown) => fn },
});
mock.module("~/lib/saved-graphs.ts", {
  namedExports: {
    listSavedGraphs: async () => [],
    getSavedGraph: async () => ({}),
    deleteSavedGraph: async () => {},
    saveGraph: async () => ({ id: "fake" }),
  },
});
mock.module("~/lib/short-links.ts", {
  namedExports: { createShortLink: async () => ({ id: "fake" }) },
});

const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { GalleryPage } = await import("./gallery.tsx");

async function mount() {
  const container = domWindow.document.createElement("div");
  domWindow.document.body.appendChild(container as never);
  const root = createRoot(container as unknown as Element);
  await act(async () => {
    root.render(createElement(GalleryPage));
  });
  return {
    container: container as unknown as HTMLElement,
    unmount: () => act(async () => root.unmount()),
  };
}

test("GalleryPage: explainer covers what's saved, how retrieval works, and how short-link sharing works", async () => {
  const { container, unmount } = await mount();
  const text = container.textContent ?? "";

  assert.ok(text.includes("snapshot"), "expected the explainer to say a save is a snapshot, not a live link");
  assert.ok(text.includes("Copy short link"), "expected the explainer to mention the short-link sharing feature by its button name");
  assert.ok(text.includes("/s/:id"), "expected the explainer to mention the short-link URL shape");
  assert.ok(text.includes("shared by everyone"), "expected the explainer to clarify the shared gallery is not private per-browser");
  assert.ok(text.includes("Curated"), "expected the explainer to mention curated, undeletable entries");
  // #320 step 3's local-first split: both sections present, publishing is
  // explicit, and the shared side's redeploy-ephemerality is stated plainly.
  assert.ok(text.includes("My saves"), "expected the private local-saves section");
  assert.ok(text.includes("Shared gallery"), "expected the shared server-store section");
  assert.ok(text.includes("Publish"), "expected the explainer to name the explicit publish action");
  assert.ok(text.includes("redeployed"), "expected the explainer to state that published entries/short links are cleared on redeploy");

  await unmount();
});
