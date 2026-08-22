import { useEffect, useRef } from "react";
import type { CellGraph } from "@johnhenry/math";
import { cellIdsGeometry } from "../lib/cell-ids.ts";
import type { GeometryOp } from "../lib/geometry-state.ts";
import { GeometryPanel, replayGeometryOps } from "./GeometryPanel.tsx";

/**
 * A geometry-construction notebook block -- same thin-wrapper pattern as
 * NotebookOdeBlock, except seeding replays the construction log through the
 * real add* functions (`replayGeometryOps`) rather than a flat `graph.set`
 * dump, since Reflect/Rotate/Translate/Scale results have no free cell to
 * set directly (see geometry-state.ts's own doc comment).
 */
export function NotebookGeometryBlock({ graph, blockId, initialOps }: { graph: CellGraph; blockId: string; initialOps: GeometryOp[] }) {
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;
    replayGeometryOps(graph, cellIdsGeometry(blockId), initialOps);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <GeometryPanel cellId={blockId} graph={graph} syncUrl={false} />;
}
