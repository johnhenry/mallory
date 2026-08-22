import { useEffect, useRef } from "react";
import type { CellGraph } from "@johnhenry/math";
import { cellIdsOde } from "../lib/cell-ids.ts";
import type { OdeState } from "../lib/ode-state.ts";
import { OdePanel, seedOdeState } from "./OdePanel.tsx";

/**
 * An ODE notebook block -- a thin wrapper reusing the real standalone
 * OdePanel directly (`cellId={blockId}`, `syncUrl={false}` so the document,
 * not this instance, owns persistence). The seeding effect runs after
 * OdePanel's own lazy graph construction has already set up its
 * `graph.define`d solution/slopeField/closedForm cells (using OdePanel's own
 * hardcoded default) -- overwriting the free cells afterward is safe and
 * reactive, mirroring Linked3DView's identical hydrate-after-mount pattern.
 * Cell-id and WebMCP-tool namespacing (`calculus_ode_${blockId}_*`) fall out
 * of reusing OdePanel directly.
 */
export function NotebookOdeBlock({ graph, blockId, initialState }: { graph: CellGraph; blockId: string; initialState: OdeState }) {
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;
    seedOdeState(graph, cellIdsOde(blockId), initialState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <OdePanel cellId={blockId} graph={graph} syncUrl={false} />;
}
