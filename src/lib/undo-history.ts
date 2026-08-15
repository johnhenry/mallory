/**
 * Bounded snapshot-based undo/redo (issue #43): past/present/future stacks
 * over a serializable state value. Snapshot-based rather than the ticket's
 * sketched per-mutation op log, deliberately: every panel already maintains
 * a full serializable state (its URL-sync codec), so recording THAT --
 * debounced -- gives working undo/redo with zero changes to the ~30
 * `graph.set` call sites per panel, atomic undo of structural actions
 * (add/remove row) for free, and natural coalescing of slider drags and
 * viewport pans (one debounce window = one entry). WebMCP/agent mutations
 * flow through the same cells, so they're captured identically -- the
 * ticket's agent-safety property holds.
 *
 * Pure and clock-free: debouncing lives in the React hook
 * (use-undo-history.ts), not here, so this class is directly unit-testable.
 */
export class UndoHistory<T> {
  private past: T[] = [];
  private present: T;
  private future: T[] = [];
  private readonly maxDepth: number;

  constructor(initial: T, options: { maxDepth?: number } = {}) {
    this.present = initial;
    this.maxDepth = options.maxDepth ?? 100;
  }

  /** Structural equality via JSON round-trip -- states are small, serializable-by-construction objects (they ARE the URL codec's payload). */
  private static equal(a: unknown, b: unknown): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  /** Records a new present. A no-op when structurally equal to the current present; otherwise pushes the old present into the past and CLEARS the redo stack (the standard branch-discard discipline). */
  record(next: T): void {
    if (UndoHistory.equal(next, this.present)) return;
    this.past.push(this.present);
    if (this.past.length > this.maxDepth) this.past.shift();
    this.present = next;
    this.future = [];
  }

  /** Steps back one state, returning the new present -- or null when there's nothing to undo. */
  undo(): T | null {
    const previous = this.past.pop();
    if (previous === undefined) return null;
    this.future.push(this.present);
    this.present = previous;
    return previous;
  }

  /** Steps forward one previously-undone state, returning the new present -- or null when there's nothing to redo. */
  redo(): T | null {
    const next = this.future.pop();
    if (next === undefined) return null;
    this.past.push(this.present);
    this.present = next;
    return next;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }
}
