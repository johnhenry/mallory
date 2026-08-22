import { useEffect, useRef } from "react";
import type { CellGraph } from "@johnhenry/math";
import { cellIdsOdeSystem } from "../lib/cell-ids.ts";
import type { OdeSystemState } from "../lib/ode-system-state.ts";
import { OdeSystemPanel, seedOdeSystemState } from "./OdeSystemPanel.tsx";

/** An ODE-system notebook block -- same thin-wrapper pattern as NotebookOdeBlock. */
export function NotebookOdeSystemBlock({
  graph,
  blockId,
  initialState,
}: {
  graph: CellGraph;
  blockId: string;
  initialState: OdeSystemState;
}) {
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;
    seedOdeSystemState(graph, cellIdsOdeSystem(blockId), initialState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <OdeSystemPanel cellId={blockId} graph={graph} syncUrl={false} />;
}
