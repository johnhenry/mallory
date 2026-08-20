import assert from "node:assert/strict";
import { test } from "node:test";
import { setupTestDom } from "./test-dom.ts";

const { domWindow } = await setupTestDom();
(globalThis as Record<string, unknown>).localStorage = domWindow.localStorage;

const {
  applyCalculatorState,
  clearCalculatorHistory,
  getCalculatorLiveState,
  setCalculatorInput,
  setCalculatorMode,
  setCalculatorModulus,
  submitCalculatorInput,
  subscribeToCalculator,
} = await import("./calculator-store.ts");

function freshKey(): string {
  return `test:calculator-store:${crypto.randomUUID()}`;
}

test("two subscribers sharing a storageKey see the same live state object -- the actual mirroring guarantee", () => {
  const key = freshKey();
  setCalculatorInput(key, "1+1");
  const a = getCalculatorLiveState(key);
  const b = getCalculatorLiveState(key);
  assert.equal(a, b, "same reference: a second 'instance' reading the same key sees the exact same state, not a stale copy");
  assert.equal(a.input, "1+1");
});

test("subscribeToCalculator: a change from one 'instance' notifies a listener registered by another", () => {
  const key = freshKey();
  let notified = 0;
  const unsubscribe = subscribeToCalculator(key, () => {
    notified++;
  });
  setCalculatorInput(key, "typing...");
  assert.equal(notified, 1);
  unsubscribe();
  setCalculatorInput(key, "more typing"); // no longer subscribed
  assert.equal(notified, 1);
});

test("getSnapshot-style stability: the live state reference only changes on an actual mutation, not on every read", () => {
  const key = freshKey();
  const before = getCalculatorLiveState(key);
  const stillBefore = getCalculatorLiveState(key);
  assert.equal(before, stillBefore, "no mutation happened between reads -- same reference, satisfies useSyncExternalStore's requirement");
  setCalculatorMode(key, "exact");
  const after = getCalculatorLiveState(key);
  assert.notEqual(before, after, "a real mutation produces a new reference");
});

test("submitCalculatorInput: evaluates the current input against the current mode, then clears input (mirrors both input and output)", () => {
  const key = freshKey();
  setCalculatorMode(key, "exact");
  setCalculatorInput(key, "1/3 + 1/3");
  submitCalculatorInput(key);
  const live = getCalculatorLiveState(key);
  assert.equal(live.input, "", "submitting clears the input line, visible to every mirrored subscriber");
  assert.equal(live.data.history.length, 1);
  assert.equal(live.data.history[0]?.display, "2/3");
});

test("submitCalculatorInput: a blank/whitespace-only input is a no-op", () => {
  const key = freshKey();
  setCalculatorInput(key, "   ");
  submitCalculatorInput(key);
  assert.equal(getCalculatorLiveState(key).data.history.length, 0);
});

test("clearCalculatorHistory: clears history and keeps stored variables, without touching the current input line", () => {
  const key = freshKey();
  setCalculatorInput(key, "k = 5");
  submitCalculatorInput(key);
  setCalculatorInput(key, "not yet submitted");

  clearCalculatorHistory(key);

  const live = getCalculatorLiveState(key);
  assert.deepEqual(live.data.history, []);
  assert.equal(live.data.variables.k, 5);
  assert.equal(live.input, "not yet submitted", "clearing history must not clobber in-progress typing");
});

test("applyCalculatorState: the WebMCP tool handler's path -- applies an already-computed state and clears input", () => {
  const key = freshKey();
  setCalculatorInput(key, "stale, should be cleared");
  applyCalculatorState(key, { history: [{ input: "2+2", display: "4", isAssignment: false, isError: false }], variables: {} });
  const live = getCalculatorLiveState(key);
  assert.equal(live.input, "");
  assert.equal(live.data.history[0]?.display, "4");
});

test("two different storageKeys stay fully independent (issue #255's own guarantee, preserved)", () => {
  const keyA = freshKey();
  const keyB = freshKey();
  setCalculatorInput(keyA, "for A only");
  assert.equal(getCalculatorLiveState(keyB).input, "");
});
