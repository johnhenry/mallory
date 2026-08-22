import { useEffect, useRef } from "react";
import type { CellGraph } from "@johnhenry/math";
import { cellIdsRegression } from "../lib/cell-ids.ts";
import type { RegressionState } from "../lib/regression-state.ts";
import { RegressionPanel, seedRegressionState } from "./RegressionPanel.tsx";

/** A regression notebook block -- same thin-wrapper pattern as NotebookOdeBlock. */
export function NotebookRegressionBlock({
  graph,
  blockId,
  initialState,
}: {
  graph: CellGraph;
  blockId: string;
  initialState: RegressionState;
}) {
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;
    seedRegressionState(graph, cellIdsRegression(blockId), initialState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <RegressionPanel cellId={blockId} graph={graph} syncUrl={false} />;
}
