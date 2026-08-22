import { useEffect, useRef } from "react";
import type { CellGraph } from "@johnhenry/math";
import { cellIdsStatistics } from "../lib/cell-ids.ts";
import type { StatisticsState } from "../lib/statistics-state.ts";
import { StatisticsPanel, seedStatisticsState } from "./StatisticsPanel.tsx";

/** A statistics notebook block -- same thin-wrapper pattern as NotebookOdeBlock. */
export function NotebookStatisticsBlock({
  graph,
  blockId,
  initialState,
}: {
  graph: CellGraph;
  blockId: string;
  initialState: StatisticsState;
}) {
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;
    seedStatisticsState(graph, cellIdsStatistics(blockId), initialState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <StatisticsPanel cellId={blockId} graph={graph} syncUrl={false} />;
}
