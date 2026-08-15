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
export function useUndoHistory<T>(graph: CellGraph, getState: () => T, applyState: (state: T) => void, debounceMs = 250): UndoControls {
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

  useEffect(() => {
    const unsubscribe = graph.subscribeAll(() => {
      if (applyingRef.current) return;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        historyRef.current!.record(getStateRef.current());
        bump();
      }, debounceMs);
    });
    return () => {
      unsubscribe();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [graph, debounceMs]);

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
