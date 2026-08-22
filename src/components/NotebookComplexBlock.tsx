import { useEffect, useRef } from "react";
import type { CellGraph } from "@johnhenry/math";
import { cellIdsComplex } from "../lib/cell-ids.ts";
import type { ComplexState } from "../lib/complex-state.ts";
import { ComplexPanel, seedComplexState } from "./ComplexPanel.tsx";

/** A complex-plane notebook block -- same thin-wrapper pattern as NotebookRegressionBlock. */
export function NotebookComplexBlock({
  graph,
  blockId,
  initialState,
}: {
  graph: CellGraph;
  blockId: string;
  initialState: ComplexState;
}) {
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;
    seedComplexState(graph, cellIdsComplex(blockId), initialState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <ComplexPanel cellId={blockId} graph={graph} syncUrl={false} />;
}
