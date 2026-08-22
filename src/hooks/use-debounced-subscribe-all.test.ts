import assert from "node:assert/strict";
import { test } from "node:test";
import { CellGraph } from "@johnhenry/math";
import { setupTestDom } from "../lib/test-dom.ts";

const { createElement, mount } = await setupTestDom();
const { useDebouncedSubscribeAll } = await import("./use-debounced-subscribe-all.ts");

/** Waits past the hook's debounce window so a scheduled call has actually landed. */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function Harness({
  graph,
  onFire,
  delayMs,
  enabled,
}: {
  graph: CellGraph;
  onFire: () => void;
  delayMs?: number;
  enabled?: boolean;
}) {
  useDebouncedSubscribeAll(graph, onFire, delayMs, enabled);
  return null;
}

// Issue #235: GraphCanvasMulti/LinkedGraphPanes/GraphCanvas's writeUrl reads
// a dynamic (per-row/per-free-variable) cell set that can't be enumerated
// ahead of time the way subscribeMany needs, so they're debounced instead --
// these tests model the exact hot path that motivated it: a burst of
// high-frequency writes (an RAF-driven playback clock, a live drag preview)
// that plain subscribeAll would fire on once per write.
test("useDebouncedSubscribeAll: a burst of rapid writes (simulating RAF ticks) coalesces into one call after the debounce window, not one call per write", async () => {
  const graph = new CellGraph();
  let calls = 0;
  const { update, unmount } = await mount(createElement(Harness, { graph, onFire: () => calls++, delayMs: 10 }));
  assert.equal(calls, 0);

  await update(() => {
    for (let frame = 0; frame < 60; frame++) graph.set("time", frame); // 60 "RAF ticks" in one burst
  });
  assert.equal(calls, 0, "still pending -- the debounce window hasn't elapsed yet");

  await update(() => wait(30));
  assert.equal(calls, 1, "60 rapid writes collapsed into exactly one call, not 60 (plain subscribeAll would have fired 60 times)");
  await unmount();
});

test("useDebouncedSubscribeAll: a single write still fires (after the debounce window elapses)", async () => {
  const graph = new CellGraph();
  let calls = 0;
  const { update, unmount } = await mount(createElement(Harness, { graph, onFire: () => calls++, delayMs: 10 }));

  await update(() => graph.set("a", 1));
  assert.equal(calls, 0, "not yet -- still within the debounce window");
  await update(() => wait(30));
  assert.equal(calls, 1);
  await unmount();
});

test("useDebouncedSubscribeAll: two bursts separated by more than the debounce window each fire their own call", async () => {
  const graph = new CellGraph();
  let calls = 0;
  const { update, unmount } = await mount(createElement(Harness, { graph, onFire: () => calls++, delayMs: 10 }));

  await update(() => graph.set("a", 1));
  await update(() => wait(30));
  assert.equal(calls, 1);

  await update(() => graph.set("a", 2));
  await update(() => wait(30));
  assert.equal(calls, 2);
  await unmount();
});

test("useDebouncedSubscribeAll: enabled=false (mirrors GraphCanvas's syncUrl=false) registers no listener at all -- writes never schedule a call", async () => {
  const graph = new CellGraph();
  let calls = 0;
  const { update, unmount } = await mount(createElement(Harness, { graph, onFire: () => calls++, delayMs: 10, enabled: false }));

  await update(() => graph.set("a", 1));
  await update(() => wait(30));
  assert.equal(calls, 0);
  await unmount();
});

test("useDebouncedSubscribeAll: unmounting mid-debounce cancels the pending call", async () => {
  const graph = new CellGraph();
  let calls = 0;
  const { update, unmount } = await mount(createElement(Harness, { graph, onFire: () => calls++, delayMs: 30 }));

  await update(() => graph.set("a", 1));
  await unmount();
  await wait(60);
  assert.equal(calls, 0, "the component unmounted before the debounce fired, so the scheduled call must never run");
});
