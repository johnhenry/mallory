import { EMPTY_CALCULATOR_STATE, submitCalculatorLine, type CalculatorMode, type CalculatorState } from "./calculator-eval.ts";

/**
 * A shared, subscribable store for CalculatorPanel's live state (issue
 * #340's floating calculator revealed a real gap: two CalculatorPanel
 * instances that are SUPPOSED to be the same calculator -- the standalone
 * `/calculator` route and the floating dock -- previously each held their
 * own independent `useState`, seeded from `localStorage` only once at
 * mount. They'd drift out of sync the instant you typed in one (only
 * synced again on a fresh page load), and their hardcoded-identical radio
 * `name="calc-mode"` attributes fought each other at the DOM level besides
 * (two separate React trees, one native single-selection-per-name-group).
 *
 * One module-level entry per `storageKey` (mirroring `angle-unit.ts`'s
 * get/set/subscribe shape, but keyed rather than a single global) is what
 * lets N CalculatorPanel instances sharing the same key genuinely mirror
 * each other live via `useSyncExternalStore`, while instances with
 * DIFFERENT keys (distinct notebook blocks, issue #255) stay exactly as
 * independent as before -- this is a superset of the old behavior, not a
 * behavior change for anyone not sharing a key.
 */
export interface CalculatorLiveState {
  data: CalculatorState;
  mode: CalculatorMode;
  modulus: number | null;
  input: string;
}

const DEFAULT_LIVE_STATE: Omit<CalculatorLiveState, "data"> = { mode: "float", modulus: null, input: "" };

interface StoreEntry {
  live: CalculatorLiveState;
  listeners: Set<() => void>;
}

const stores = new Map<string, StoreEntry>();

function loadPersistedData(storageKey: string): CalculatorState {
  if (typeof localStorage === "undefined") return EMPTY_CALCULATOR_STATE;
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return EMPTY_CALCULATOR_STATE;
    const parsed = JSON.parse(raw);
    return {
      history: Array.isArray(parsed.history) ? parsed.history : [],
      variables: parsed.variables && typeof parsed.variables === "object" ? parsed.variables : {},
    };
  } catch {
    return EMPTY_CALCULATOR_STATE;
  }
}

function getStore(storageKey: string): StoreEntry {
  let entry = stores.get(storageKey);
  if (!entry) {
    entry = { live: { ...DEFAULT_LIVE_STATE, data: loadPersistedData(storageKey) }, listeners: new Set() };
    stores.set(storageKey, entry);
  }
  return entry;
}

function persist(storageKey: string, data: CalculatorState): void {
  if (typeof localStorage !== "undefined") localStorage.setItem(storageKey, JSON.stringify(data));
}

/** A brand-new object reference exactly when something actually changed, the same object reference otherwise -- what `useSyncExternalStore`'s `getSnapshot` needs to avoid spurious re-renders (mirrors AlgebraView's own documented reasoning for the identical requirement). */
function update(storageKey: string, patch: Partial<CalculatorLiveState>): void {
  const entry = getStore(storageKey);
  entry.live = { ...entry.live, ...patch };
  for (const listener of entry.listeners) listener();
}

export function getCalculatorLiveState(storageKey: string): CalculatorLiveState {
  return getStore(storageKey).live;
}

export function subscribeToCalculator(storageKey: string, listener: () => void): () => void {
  const entry = getStore(storageKey);
  entry.listeners.add(listener);
  return () => entry.listeners.delete(listener);
}

export function setCalculatorMode(storageKey: string, mode: CalculatorMode): void {
  update(storageKey, { mode });
}

export function setCalculatorModulus(storageKey: string, modulus: number | null): void {
  update(storageKey, { modulus });
}

export function setCalculatorInput(storageKey: string, input: string): void {
  update(storageKey, { input });
}

/** Applies an already-computed `CalculatorState` directly and clears the input line -- used by both the Enter-key submit path and the WebMCP `_evaluate` tool handler, which (per this function's own former doc comment on CalculatorPanel) has to compute `next` up front rather than inside a setState-style updater, since a tool handler runs outside any React event handler. */
export function applyCalculatorState(storageKey: string, next: CalculatorState): void {
  persist(storageKey, next);
  update(storageKey, { data: next, input: "" });
}

/** Evaluates the store's own current input line against its own current mode/modulus, same as pressing Enter. No-ops on a blank/whitespace-only input. */
export function submitCalculatorInput(storageKey: string): void {
  const { live } = getStore(storageKey);
  const trimmed = live.input.trim();
  if (!trimmed) return;
  applyCalculatorState(storageKey, submitCalculatorLine(trimmed, live.data, live.mode, live.modulus));
}

/** Clears the history log only, not stored variables (issue #318's own distinction, preserved here) -- and NOT the current input line, unlike `applyCalculatorState` (a submitted evaluation clears input; clearing history is a separate, unrelated action). */
export function clearCalculatorHistory(storageKey: string): void {
  const { live } = getStore(storageKey);
  const next: CalculatorState = { history: [], variables: live.data.variables };
  persist(storageKey, next);
  update(storageKey, { data: next });
}
