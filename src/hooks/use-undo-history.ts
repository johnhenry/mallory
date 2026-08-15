import { useEffect, useRef, useState } from "react";
import type { CellGraph } from "../lib/cell-graph.ts";
import { UndoHistory } from "../lib/undo-history.ts";

export interface UndoControls {
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

/**
 * Wires a panel's full serializable state (its URL-codec payload) into a
 * debounced UndoHistory (issue #43). Every `graph.subscribeAll`
 * notification schedules a snapshot `debounceMs` later -- one burst of
 * mutations (a slider drag, a viewport pan, a multi-cell structural action)
 * collapses into ONE history entry, which is the ticket's coalescing
 * requirement handled at the recording layer instead of per-op.
 *
 * `extraTrigger` opts a caller into ALSO scheduling a snapshot whenever
 * this value changes (by reference/`Object.is`), independent of any
 * CellGraph mutation. Needed by panels whose editable state isn't fully
 * captured by CellGraph cells -- e.g. NotebookPanel's block add/remove/
 * reorder/text-edit is plain React state (`blocks`), the identical gap its
 * own URL-sync effect already has to work around with a second trigger
 * beyond `graph.subscribeAll`. Omitted (undefined) for callers like
 * GraphCanvasMulti whose entire state already lives in CellGraph cells, so
 * this doesn't change behavior for them.
 *
 * Undo/redo first FLUSH any pending debounced snapshot (otherwise an undo
 * issued mid-debounce would silently skip the newest edit), then apply the
 * target state through `applyState` under a guard flag so the synchronous
 * subscribeAll notifications the restore itself fires don't get recorded
 * as new edits (which would clear the redo stack and break redo).
 *
 * Keyboard: Ctrl/Cmd+Z undoes, Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y redoes --
 * EXCEPT when focus is in a text input/textarea/contentEditable, where the
 * browser's own text-level undo must win (intercepting there would break
 * normal typing undo inside expression fields).
 */
export function useUndoHistory<T>(
  graph: CellGraph,
  getState: () => T,
  applyState: (state: T) => void,
  debounceMs = 250,
  extraTrigger?: unknown,
): UndoControls {
  const historyRef = useRef<UndoHistory<T> | null>(null);
  if (!historyRef.current) historyRef.current = new UndoHistory(getState());
  const applyingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);

  const getStateRef = useRef(getState);
  getStateRef.current = getState;
  const applyStateRef = useRef(applyState);
  applyStateRef.current = applyState;

  const scheduleRecordRef = useRef<() => void>(() => {});
  scheduleRecordRef.current = () => {
    if (applyingRef.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      historyRef.current!.record(getStateRef.current());
      bump();
    }, debounceMs);
  };

  useEffect(() => {
    const unsubscribe = graph.subscribeAll(() => scheduleRecordRef.current());
    return () => {
      unsubscribe();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [graph, debounceMs]);

  // Skips the first run (mount): `getState()` at mount time is already
  // what seeded `historyRef`'s initial `present`, so scheduling a redundant
  // snapshot then would be a harmless but pointless no-op (UndoHistory.record
  // already no-ops on structural equality) -- skipping it just avoids an
  // unnecessary pending timer at mount.
  const mountedExtraRef = useRef(false);
  useEffect(() => {
    if (!mountedExtraRef.current) {
      mountedExtraRef.current = true;
      return;
    }
    scheduleRecordRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extraTrigger]);

  function flushPending() {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
      historyRef.current!.record(getStateRef.current());
    }
  }

  function applyTarget(target: T | null) {
    if (target === null) return;
    applyingRef.current = true;
    try {
      applyStateRef.current(target);
    } finally {
      applyingRef.current = false;
    }
    bump();
  }

  const undoRef = useRef(() => {});
  const redoRef = useRef(() => {});
  undoRef.current = () => {
    flushPending();
    applyTarget(historyRef.current!.undo());
  };
  redoRef.current = () => {
    flushPending();
    applyTarget(historyRef.current!.redo());
  };

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey)) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        undoRef.current();
      } else if ((key === "z" && e.shiftKey) || key === "y") {
        e.preventDefault();
        redoRef.current();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return {
    undo: () => undoRef.current(),
    redo: () => redoRef.current(),
    canUndo: historyRef.current.canUndo || timerRef.current !== null,
    canRedo: historyRef.current.canRedo,
  };
}
