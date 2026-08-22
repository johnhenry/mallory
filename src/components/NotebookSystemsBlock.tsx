import { useEffect, useRef } from "react";
import type { CellGraph } from "@johnhenry/math";
import { cellIdsSystem } from "../lib/cell-ids.ts";
import type { SystemState } from "../lib/system-state.ts";
import { SystemSolverPanel, seedSystemState } from "./SystemSolverPanel.tsx";

/** A system-solver notebook block -- same thin-wrapper pattern as NotebookOdeBlock. */
export function NotebookSystemsBlock({ graph, blockId, initialState }: { graph: CellGraph; blockId: string; initialState: SystemState }) {
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;
    seedSystemState(graph, cellIdsSystem(blockId), initialState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <SystemSolverPanel cellId={blockId} graph={graph} syncUrl={false} />;
}
