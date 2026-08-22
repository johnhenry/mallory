/**
 * Hook-level tests for `useCell` -- the useSyncExternalStore wrapper every
 * reactive panel in this app is built on.
 *
 * INFRASTRUCTURE CHOICE (so future test-writers don't re-litigate it):
 * these tests render real React trees under node's own test runner using
 * `happy-dom` (the single testing devDependency) as the DOM shim, React 19's
 * stable `act()` export, and `react-dom/client` directly -- no
 * @testing-library/react, no react-test-renderer. Rationale:
 * - react-test-renderer is deprecated by the React team as of React 19 and
 *   warns at runtime; not a foundation to build new infrastructure on.
 * - @testing-library/react would work but adds a dependency layer whose main
 *   value (user-event simulation, DOM queries) `useCell` doesn't need -- the
 *   hook never touches the DOM; asserting on a module-level variable written
 *   during render is sufficient and keeps the harness ~20 lines.
 * - happy-dom over jsdom: lighter, faster to install, and sufficient for
 *   react-dom/client's createRoot (which just needs a real-enough Document).
 *
 * IMPORT-ORDER GOTCHA: react-dom/client must see the DOM shim on globalThis
 * at import time, but ESM static imports are hoisted and evaluated before
 * this module's body runs. So the shim is installed first in the module
 * body, and React/ReactDOM are pulled in via top-level `await import(...)`
 * afterward. Do not convert those to static imports. (`navigator` is a
 * getter-only global in modern Node and must not be assigned; React doesn't
 * need it.)
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { Window } from "happy-dom";
import { CellGraph } from "@johnhenry/math";
import { useCell } from "./use-cell.ts";

const domWindow = new Window();
(globalThis as Record<string, unknown>).window = domWindow;
(globalThis as Record<string, unknown>).document = domWindow.document;
// React's act() refuses to run (warns) unless this flag is set.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { renderToString } = await import("react-dom/server");

/**
 * Mounts `component` into a fresh happy-dom container and returns an
 * `update` runner (wraps act) plus `unmount`. Assertions read whatever the
 * probe component wrote during its render -- no DOM queries needed.
 */
async function mount(element: ReturnType<typeof createElement>) {
  const container = domWindow.document.createElement("div");
  domWindow.document.body.appendChild(container as never);
  const root = createRoot(container as unknown as Element);
  await act(async () => {
    root.render(element);
  });
  return {
    /** Run a graph mutation (or anything) inside act, flushing the resulting re-render. */
    update: (fn: () => void) => act(async () => fn()),
    unmount: () => act(async () => root.unmount()),
  };
}

test("useCell re-renders when the cell's value changes via graph.set", async () => {
  const graph = new CellGraph();
  graph.set("greeting", "hello");
  let seen = "";
  function Probe() {
    seen = useCell<string>(graph, "greeting");
    return null;
  }
  const { update, unmount } = await mount(createElement(Probe));
  assert.equal(seen, "hello");
  await update(() => graph.set("greeting", "world"));
  assert.equal(seen, "world");
  await unmount();
});

test("useCell on a derived (define'd) cell re-renders when a dependency changes", async () => {
  const graph = new CellGraph();
  graph.set("base", 3);
  graph.define("double", () => graph.get<number>("base") * 2);
  let seen = 0;
  function Probe() {
    seen = useCell<number>(graph, "double");
    return null;
  }
  const { update, unmount } = await mount(createElement(Probe));
  assert.equal(seen, 6);
  await update(() => graph.set("base", 10));
  assert.equal(seen, 20);
  await unmount();
});

test("staleness regression: an item's value change re-renders its reader even when the list cell is untouched", async () => {
  // The AlgebraView bug class: a list-shaped cell (array of ids) doesn't
  // change shape/reference, but one listed item's own cell value does. A
  // component reading the ITEM via useCell must still re-render -- per-cell
  // subscription must not be fooled by anything caching at the list level.
  const graph = new CellGraph();
  graph.set("list", ["a"]);
  graph.set("item:a", 1);
  let seenList: string[] = [];
  let seenItem = 0;
  function ListProbe() {
    seenList = useCell<string[]>(graph, "list");
    return null;
  }
  function ItemProbe() {
    seenItem = useCell<number>(graph, "item:a");
    return null;
  }
  const { update, unmount } = await mount(
    createElement("div", null, createElement(ListProbe), createElement(ItemProbe)),
  );
  assert.deepEqual(seenList, ["a"]);
  assert.equal(seenItem, 1);
  const listBefore = seenList;
  await update(() => graph.set("item:a", 2));
  assert.equal(seenItem, 2, "item reader must re-render on a value-only mutation");
  assert.equal(seenList, listBefore, "list cell's reference must be untouched by an item-only mutation");
  await unmount();
});

test("SSR: renderToString renders the current cell value via the server snapshot", () => {
  const graph = new CellGraph();
  graph.set("label", "server-side");
  function Probe() {
    return createElement("span", null, useCell<string>(graph, "label"));
  }
  const html = renderToString(createElement(Probe));
  assert.ok(html.includes("server-side"), `expected server render to include the value, got: ${html}`);
});

test("delete() of a dependency re-renders a derived cell's reader with the recomputed value", async () => {
  // CellGraph.delete() notifies former dependents (the e633fa6 fix); the
  // hook must surface that recompute. get() on a deleted id returns
  // undefined ("never existed" semantics), so the derived compute falls back.
  const graph = new CellGraph();
  graph.set("source", "live");
  graph.define("display", () => graph.get<string | undefined>("source") ?? "fallback");
  let seen = "";
  function Probe() {
    seen = useCell<string>(graph, "display");
    return null;
  }
  const { update, unmount } = await mount(createElement(Probe));
  assert.equal(seen, "live");
  await update(() => graph.delete("source"));
  assert.equal(seen, "fallback");
  await unmount();
});

test("reference stability: a structurally-equal recompute does not re-render", async () => {
  // The other half of the useSyncExternalStore contract (see useCell's doc
  // comment): CellGraph.get preserves the old reference on a recompute whose
  // result is structurally equal, so Object.is bails and the component must
  // NOT re-render.
  const graph = new CellGraph();
  graph.set("width", 100);
  graph.define("box", () => ({ w: graph.get<number>("width"), h: 50 }));
  let renders = 0;
  function Probe() {
    renders++;
    useCell<{ w: number; h: number }>(graph, "box");
    return null;
  }
  const { update, unmount } = await mount(createElement(Probe));
  const rendersAfterMount = renders;
  // Same value: box recomputes to a structurally-equal object, reference is
  // preserved, no re-render.
  await update(() => graph.set("width", 100));
  assert.equal(renders, rendersAfterMount, "structurally-equal recompute must not re-render");
  // Different value: sanity-check the counter does move when it should.
  await update(() => graph.set("width", 200));
  assert.ok(renders > rendersAfterMount, "a real change must re-render");
  await unmount();
});
