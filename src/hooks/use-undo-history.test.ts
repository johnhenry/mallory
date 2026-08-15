import assert from "node:assert/strict";
import { test } from "node:test";
import { CellGraph } from "../lib/cell-graph.ts";
import { setupTestDom } from "../lib/test-dom.ts";

const { createElement, mount } = await setupTestDom();
const { useState } = await import("react");
const { useUndoHistory } = await import("./use-undo-history.ts");

/** Waits past the hook's debounce window (10ms here) so a scheduled record has actually landed. */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface HarnessProps {
  graph: CellGraph;
  getState: () => number;
  applyState: (s: number) => void;
  initialExtraTrigger?: unknown;
  enabled?: boolean;
}

/**
 * Exposes the hook's live return value AND a setter for `extraTrigger` to
 * the test via a mutable box, since a hook can't be called (or have its
 * inputs changed) from outside a component. `extraTrigger` is owned as the
 * harness's OWN `useState`, not a plain prop re-passed via `createElement`
 * -- `mount`'s `update()` only runs an arbitrary side-effecting callback
 * inside `act()`, it doesn't re-render the mounted tree with new props, so
 * changing what `useUndoHistory` sees requires a real state update inside
 * the already-mounted component, not a fresh (and unmounted) element.
 */
function makeHarness() {
  const box: { history: ReturnType<typeof useUndoHistory<number>> | null; setExtraTrigger: ((v: unknown) => void) | null } = {
    history: null,
    setExtraTrigger: null,
  };
  function Harness({ graph, getState, applyState, initialExtraTrigger, enabled }: HarnessProps) {
    const [extraTrigger, setExtraTrigger] = useState<unknown>(initialExtraTrigger);
    box.setExtraTrigger = setExtraTrigger;
    box.history = useUndoHistory(graph, getState, applyState, 10, extraTrigger, enabled);
    return null;
  }
  return { box, Harness };
}

test("useUndoHistory: a graph mutation schedules a debounced record; after the debounce, canUndo is true and undo restores the previous getState()", async () => {
  const graph = new CellGraph();
  graph.set("n", 1);
  const { box, Harness } = makeHarness();

  const { update, unmount } = await mount(
    createElement(Harness, { graph, getState: () => graph.get<number>("n"), applyState: (v: number) => graph.set("n", v) }),
  );
  assert.equal(box.history!.canUndo, false, "nothing to undo right after mount");

  await update(() => graph.set("n", 2));
  await update(() => wait(30));

  assert.equal(box.history!.canUndo, true);
  await update(() => box.history!.undo());
  assert.equal(graph.get<number>("n"), 1, "undo restored the pre-mutation value");
  await unmount();
});

test("useUndoHistory: extraTrigger changing schedules a debounced record independent of any graph mutation", async () => {
  const graph = new CellGraph();
  graph.set("n", 10);
  // Stands in for a piece of state that lives OUTSIDE the graph entirely
  // (e.g. NotebookPanel's own `blocks` array) -- folded into getState()'s
  // output so a change to it ALONE, with the graph itself untouched,
  // still produces a genuinely different recorded state. This is the same
  // shape a real `getCurrentNotebookState(graph, blocks)` has, and the
  // exact gap `extraTrigger` exists to cover: a graph-only listener
  // (`graph.subscribeAll`) would never notice this half of state changing.
  let externalCounter = 0;
  const { box, Harness } = makeHarness();

  const { update, unmount } = await mount(
    createElement(Harness, {
      graph,
      getState: () => graph.get<number>("n") * 1000 + externalCounter,
      applyState: (v: number) => graph.set("n", Math.floor(v / 1000)),
      initialExtraTrigger: "v1",
    }),
  );
  assert.equal(box.history!.canUndo, false);

  externalCounter = 1;
  await update(() => box.setExtraTrigger!("v2"));
  await update(() => wait(30));

  assert.equal(box.history!.canUndo, true);
  await update(() => box.history!.undo());
  assert.equal(graph.get<number>("n"), 10, "undo restored the graph's pre-change value -- the graph itself was never mutated, only the external half of state changed");
  await unmount();
});

test("useUndoHistory: extraTrigger's initial value at mount does not seed a spurious history entry", async () => {
  const graph = new CellGraph();
  graph.set("n", 5);
  const { box, Harness } = makeHarness();

  const { update, unmount } = await mount(
    createElement(Harness, {
      graph,
      getState: () => graph.get<number>("n"),
      applyState: (v: number) => graph.set("n", v),
      initialExtraTrigger: "initial",
    }),
  );
  // NOTE: this only checks the settled outcome, not the mount-time "skip
  // the first effect run" guard specifically -- `UndoHistory.record`'s own
  // structural-equality dedup already no-ops a record taken at mount
  // (getState() hasn't changed since it seeded the history), so the guard
  // is a harmless micro-optimization (avoids an unnecessary pending timer)
  // with no behavior this test -- or any public-API-only test -- can
  // distinguish from "the guard doesn't exist."
  await update(() => wait(30));
  assert.equal(box.history!.canUndo, false, "mounting with an extraTrigger value already set shouldn't count as a change");
  await unmount();
});

test("useUndoHistory: undo then redo round-trips back to the latest recorded state", async () => {
  const graph = new CellGraph();
  graph.set("n", 100);
  const { box, Harness } = makeHarness();

  const { update, unmount } = await mount(
    createElement(Harness, { graph, getState: () => graph.get<number>("n"), applyState: (v: number) => graph.set("n", v) }),
  );
  await update(() => graph.set("n", 200));
  await update(() => wait(30));

  await update(() => box.history!.undo());
  assert.equal(graph.get<number>("n"), 100);
  await update(() => box.history!.redo());
  assert.equal(graph.get<number>("n"), 200);
  await unmount();
});

test("useUndoHistory: enabled=false skips recording graph mutations entirely (a notebook-embedded panel deferring to the document's own history, issue #43's RegressionPanel adoption)", async () => {
  const graph = new CellGraph();
  graph.set("n", 1);
  const { box, Harness } = makeHarness();

  const { update, unmount } = await mount(
    createElement(Harness, {
      graph,
      getState: () => graph.get<number>("n"),
      applyState: (v: number) => graph.set("n", v),
      enabled: false,
    }),
  );
  await update(() => graph.set("n", 2));
  await update(() => wait(30));

  assert.equal(box.history!.canUndo, false, "a disabled history never records the mutation");
  await update(() => box.history!.undo());
  assert.equal(graph.get<number>("n"), 2, "undo is a no-op when nothing was ever recorded");
  await unmount();
});

test("useUndoHistory: enabled=false also skips extraTrigger-driven recording (the extraTrigger effect isn't itself gated on `enabled` -- only scheduleRecordRef's own internal check is)", async () => {
  const graph = new CellGraph();
  graph.set("n", 10);
  // getState must actually change when extraTrigger changes (not just the
  // graph, which stays untouched here) -- otherwise UndoHistory.record's own
  // structural-equality dedup would no-op the record regardless of whether
  // the `enabled` guard exists, and this test couldn't tell the two apart.
  // Same externalCounter-folded-into-getState shape as the plain (enabled
  // defaulting true) extraTrigger test above.
  let externalCounter = 0;
  const { box, Harness } = makeHarness();

  const { update, unmount } = await mount(
    createElement(Harness, {
      graph,
      getState: () => graph.get<number>("n") * 1000 + externalCounter,
      applyState: (v: number) => graph.set("n", Math.floor(v / 1000)),
      initialExtraTrigger: "v1",
      enabled: false,
    }),
  );
  externalCounter = 1;
  await update(() => box.setExtraTrigger!("v2"));
  await update(() => wait(30));

  assert.equal(box.history!.canUndo, false, "a disabled history ignores extraTrigger changes too, even when the resulting state genuinely differs");
  await unmount();
});
