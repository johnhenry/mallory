import { useEffect, useRef } from "react";
import type { CellGraph } from "@johnhenry/math";
import { cellIds3D } from "../lib/cell-ids.ts";
import { Graph3DCanvas, getPrimaryRow3D } from "./Graph3DCanvas.tsx";

/**
 * A 3D-surface notebook block -- a thin wrapper, not a NotebookGraphBlock-
 * style rewrite: Graph3DCanvas already accepts an external shared `graph` +
 * `cellId` (proven in production by Linked3DView), so this block is just
 * that component plus one seeding effect. The effect runs *after* mount
 * (not a pre-seed before Graph3DCanvas renders) because Graph3DCanvas's own
 * lazy graph construction only sets up its row's `graph.define`d mesh/
 * freeVars/params cells the first time its row list is unset -- pre-seeding
 * would skip that setup entirely (the same reasoning Linked3DView's own
 * hydrate effect documents). Cell-id namespacing (`cellId={blockId}`) and
 * WebMCP tool namespacing (`surface3d_${blockId}_*`, via Graph3DCanvas's own
 * `useCellGraphTools` call) both fall out of reusing the real component
 * directly -- full agent parity for free, no extra plumbing needed here.
 *
 * #336 item 7: Graph3DCanvas itself is now unlimited overlaid surfaces, but
 * this block's own persisted shape (`initialExpr`/`initialParams`, and
 * NotebookPanel.tsx's matching `getCurrentNotebookState`/`disposeBlockCells`
 * read/write) deliberately stays flat -- a notebook-embedded instance CAN
 * interactively add more surfaces via Graph3DCanvas's own "+ Add surface"
 * button, but only the PRIMARY (first) row is seeded here and read back on
 * save, via `getPrimaryRow3D`. A second, third, ... row added in the editor
 * is lost on save/reload -- a deliberate, documented scope limit (same
 * "small, low-risk notebook integration over a schema version bump" choice
 * as OdePanel/OdeSystemPanel's own video-export/vector-field primary-row
 * scoping), not a bug.
 */
export function NotebookGraph3DBlock({
  graph,
  blockId,
  initialExpr,
  initialParams,
}: {
  graph: CellGraph;
  blockId: string;
  initialExpr: string;
  initialParams: Record<string, number>;
}) {
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;
    const containerIds = cellIds3D(blockId);
    const primary = getPrimaryRow3D(graph, containerIds);
    if (!primary) return; // Graph3DCanvas's own lazy init always seeds one row first -- shouldn't happen.
    graph.set(primary.ids.expr, initialExpr);
    for (const [name, value] of Object.entries(initialParams)) graph.set(primary.ids.param(name), value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <Graph3DCanvas cellId={blockId} graph={graph} showTransport={false} />;
}
