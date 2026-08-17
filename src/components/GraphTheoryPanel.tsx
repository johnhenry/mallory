import type { Edge, Graph } from "mallory-math";
import { useEffect, useRef, useState } from "react";
import { CellGraph } from "../lib/cell-graph.ts";
import { cellIdsGraphTheory, TIME_CELL, type CellIdsGraphTheory } from "../lib/cell-ids.ts";
import { appendEdgeLine, appendVertexLine, computeLayout, findVertexAt, nextVertexLabel } from "../lib/graph-editor.ts";
import {
  bfsDistances,
  bfsLayerSteps,
  dijkstraSteps,
  mstSteps,
  pathSteps,
  traversalSteps,
  type AlgorithmStep,
} from "../lib/graph-algorithm-steps.ts";
import {
  analyzeGraph,
  parseEdgeListText,
  runBfs,
  runDfs,
  runDijkstra,
  runMst,
  runShortestPath,
  type GraphAnalysis,
  type LayoutPoint,
} from "../lib/graph-ops.ts";
import {
  DEFAULT_GRAPH_THEORY_STATE,
  decodeGraphTheoryState,
  encodeGraphTheoryState,
  type GraphTheoryState,
} from "../lib/graph-theory-state.ts";
import { COARSE_POINTER_HIT_RADIUS_MULTIPLIER, isCoarsePointer } from "../lib/pointer-media.ts";
import { canvasEventPoint, toDataX, toDataY, toScreenX, toScreenY, type Viewport } from "../lib/viewport.ts";
import { drawHeatmap } from "../lib/heatmap.ts";
import { useCellGraphTools } from "../hooks/use-cell-graph-tools.ts";
import { useModelContextTool } from "../hooks/use-model-context-tool.ts";
import { useCell } from "../lib/use-cell.ts";
import { useTimelinePlayback } from "../lib/use-timeline-playback.ts";
import { PngExportButton } from "./PngExportButton.tsx";
import { TransportControls } from "./TransportControls.tsx";

type Result<T> = { ok: true; value: T } | { ok: false; message: string };
type Algorithm = "bfs" | "dfs" | "dijkstra" | "shortest-path" | "mst";

type AlgorithmResult =
  | { kind: "order"; order: string[] }
  | { kind: "distances"; distances: Array<{ vertex: string; distance: number }> }
  | { kind: "path"; distance: number; path: string[] }
  | { kind: "mst"; edges: Array<Edge<string>>; totalWeight: number };

const WIDTH = 500;
const HEIGHT = 500;
const VIEWPORT: Viewport = { xMin: -1.3, xMax: 1.3, yMin: -1.3, yMax: 1.3 };
const HEATMAP_SIZE = 360;
// Step-by-step algorithm animation (issue #24's remaining scope, item 2):
// 1 algorithm step = this many seconds of the shared TIME_CELL clock.
// Coarser than GradientDescentPanel's 0.1s/step (each step here is a whole
// vertex/edge/layer event, not a numeric optimizer step, so it reads
// better paced slower).
const STEP_SECONDS = 0.6;

function seedState(graph: CellGraph, ids: CellIdsGraphTheory, state: GraphTheoryState): void {
  graph.set(ids.edgeListText, state.edgeListText);
  graph.set(ids.directed, state.directed);
  graph.set(ids.startVertex, state.startVertex);
  graph.set(ids.endVertex, state.endVertex);
  graph.set(ids.algorithm, state.algorithm);
  graph.set(ids.showEditor, state.showEditor ?? DEFAULT_GRAPH_THEORY_STATE.showEditor);
  graph.set(ids.edgeWeight, state.edgeWeight ?? DEFAULT_GRAPH_THEORY_STATE.edgeWeight);
  graph.set(ids.showAnimation, state.showAnimation ?? DEFAULT_GRAPH_THEORY_STATE.showAnimation);
}

function getCurrentState(graph: CellGraph, ids: CellIdsGraphTheory): GraphTheoryState {
  const vertexPositions = graph.get<Record<string, LayoutPoint>>(ids.vertexPositions);
  return {
    v: 1,
    edgeListText: graph.get<string>(ids.edgeListText),
    directed: graph.get<boolean>(ids.directed),
    startVertex: graph.get<string>(ids.startVertex),
    endVertex: graph.get<string>(ids.endVertex),
    algorithm: graph.get<string>(ids.algorithm),
    showEditor: graph.get<boolean>(ids.showEditor),
    edgeWeight: graph.get<string>(ids.edgeWeight),
    showAnimation: graph.get<boolean>(ids.showAnimation),
    ...(Object.keys(vertexPositions).length > 0 ? { vertexPositions } : {}),
  };
}

const VERTEX_RADIUS = 14;

function useGraphTheoryGraph(cellId: string): CellGraph {
  const ref = useRef<CellGraph | null>(null);
  if (!ref.current) {
    const graph = new CellGraph();
    const ids = cellIdsGraphTheory(cellId);
    const decoded = typeof window !== "undefined" ? decodeGraphTheoryState(window.location.hash.slice(1)) : null;
    seedState(graph, ids, decoded ?? DEFAULT_GRAPH_THEORY_STATE);
    // Editor-placed vertex positions (issue #24's remaining scope, item 3):
    // seeded from the decoded URL state when present, so a shared/reloaded
    // link keeps the exact visual layout instead of falling back to
    // circularLayout for editor-placed vertices.
    if (!graph.has(ids.vertexPositions)) {
      graph.set(ids.vertexPositions, (decoded?.vertexPositions ?? {}) as Record<string, LayoutPoint>, { auxiliary: true });
    }
    if (!graph.has(TIME_CELL)) graph.set(TIME_CELL, 0, { auxiliary: true });

    graph.define(ids.graphResult, (): Result<Graph<string>> => {
      try {
        return { ok: true, value: parseEdgeListText(graph.get<string>(ids.edgeListText), graph.get<boolean>(ids.directed)) };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
    });

    graph.define(ids.analysis, (): Result<GraphAnalysis> => {
      const parsed = graph.get<Result<Graph<string>>>(ids.graphResult);
      if (!parsed.ok) return parsed;
      try {
        return { ok: true, value: analyzeGraph(parsed.value) };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
    });

    graph.define(ids.algorithmResult, (): Result<AlgorithmResult> => {
      const parsed = graph.get<Result<Graph<string>>>(ids.graphResult);
      if (!parsed.ok) return parsed;
      try {
        const algorithm = graph.get<Algorithm>(ids.algorithm);
        const start = graph.get<string>(ids.startVertex);
        switch (algorithm) {
          case "bfs":
            return { ok: true, value: { kind: "order", order: runBfs(parsed.value, start).order } };
          case "dfs":
            return { ok: true, value: { kind: "order", order: runDfs(parsed.value, start).order } };
          case "dijkstra":
            return { ok: true, value: { kind: "distances", distances: runDijkstra(parsed.value, start).distances } };
          case "shortest-path": {
            const end = graph.get<string>(ids.endVertex);
            const { distance, path } = runShortestPath(parsed.value, start, end);
            return { ok: true, value: { kind: "path", distance, path } };
          }
          case "mst": {
            const { edges, totalWeight } = runMst(parsed.value);
            return { ok: true, value: { kind: "mst", edges, totalWeight } };
          }
        }
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
    });

    // Step-by-step algorithm animation (issue #24's remaining scope, item
    // 2): derives an AlgorithmStep[] from the already-computed
    // algorithmResult, one animation frame per array entry -- no algorithm
    // is reimplemented here, see graph-algorithm-steps.ts's own doc
    // comment for why each step order is authentic to what mallory-math
    // itself returned.
    graph.define(ids.algorithmSteps, (): AlgorithmStep[] => {
      const parsed = graph.get<Result<Graph<string>>>(ids.graphResult);
      const result = graph.get<Result<AlgorithmResult>>(ids.algorithmResult);
      if (!parsed.ok || !result.ok) return [];
      const r = result.value;
      if (r.kind === "order") {
        if (graph.get<Algorithm>(ids.algorithm) === "bfs") {
          const distances = bfsDistances((v) => parsed.value.neighbors(v), graph.get<string>(ids.startVertex));
          return bfsLayerSteps(r.order, distances);
        }
        return traversalSteps(r.order);
      }
      if (r.kind === "distances") return dijkstraSteps(r.distances);
      if (r.kind === "path") return pathSteps(r.path);
      return mstSteps(r.edges);
    });

    ref.current = graph;
  }
  return ref.current;
}

/** A graph from a text edge list, drawn with a deterministic circular layout, with BFS/DFS/Dijkstra/shortest-path/MST results highlighted and a structural summary (cycle/components/topological order/adjacency matrix). */
export function GraphTheoryPanel({ cellId = "graph-theory-1" }: { cellId?: string } = {}) {
  const graph = useGraphTheoryGraph(cellId);
  useCellGraphTools(`data_graphtheory_${cellId}`, graph);
  const ids = cellIdsGraphTheory(cellId);

  // geo-style per-tool WebMCP construction tools (issue #24's remaining
  // scope, last item) -- an agent-drivable counterpart to the visual
  // editor's click-to-add-vertex/drag-to-add-edge, mirroring
  // GeometryPanel's own graphthy_add_point/graphthy_add_line convention,
  // including its per-instance `${toolPrefix}_...` namespacing (matches
  // this panel's own existing `data_graphtheory_${cellId}` prefix on
  // useCellGraphTools above) -- without it, two GraphTheoryPanel
  // instances on screen at once would register colliding tool names.
  // Both append to the same edgeListText cell every other input path
  // (text box, visual editor) writes to, via the same appendVertexLine/
  // appendEdgeLine helpers those paths now share.
  useModelContextTool({
    name: `graphthy_${cellId}_add_vertex`,
    description:
      "Add a vertex to the graph-theory panel's graph. If label is omitted, the next unused spreadsheet-style label (A, B, ..., Z, AA, ...) is assigned. If x/y are both given, the vertex is placed at that position (as if added via the visual editor); otherwise it falls back to the panel's default circular layout. Returns the vertex's label.",
    inputSchema: {
      type: "object",
      properties: {
        label: { type: "string", description: "Vertex label. Auto-generated if omitted." },
        x: { type: "number", description: "Data-space x position (visual editor placement). Requires y." },
        y: { type: "number", description: "Data-space y position (visual editor placement). Requires x." },
      },
    },
    handler: (input: Record<string, unknown>) => {
      const existing = graph.get<Result<Graph<string>>>(ids.graphResult);
      const existingLabels = existing.ok ? existing.value.vertices() : [];
      const label = typeof input.label === "string" && input.label.trim() ? input.label : nextVertexLabel(existingLabels);
      graph.set(ids.edgeListText, appendVertexLine(graph.get<string>(ids.edgeListText), label));
      if (typeof input.x === "number" && typeof input.y === "number") {
        graph.set(ids.vertexPositions, { ...graph.get<Record<string, LayoutPoint>>(ids.vertexPositions), [label]: { x: input.x, y: input.y } }, { auxiliary: true });
      }
      return { label };
    },
  });

  useModelContextTool({
    name: `graphthy_${cellId}_add_edge`,
    description: "Add a weighted edge between two vertices (by label) to the graph-theory panel's graph. Vertices that don't already exist are created implicitly, same as typing a new edge line in the text box. weight defaults to 1.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string" },
        to: { type: "string" },
        weight: { type: "number" },
      },
      required: ["from", "to"],
    },
    handler: (input: Record<string, unknown>) => {
      const weight = typeof input.weight === "number" ? input.weight : 1;
      graph.set(ids.edgeListText, appendEdgeLine(graph.get<string>(ids.edgeListText), String(input.from), String(input.to), weight));
      return { ok: true };
    },
  });
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const heatmapCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const edgeListText = useCell<string>(graph, ids.edgeListText);
  const directed = useCell<boolean>(graph, ids.directed);
  const graphResult = useCell<Result<Graph<string>>>(graph, ids.graphResult);
  const analysis = useCell<Result<GraphAnalysis>>(graph, ids.analysis);
  const startVertex = useCell<string>(graph, ids.startVertex);
  const endVertex = useCell<string>(graph, ids.endVertex);
  const algorithm = useCell<Algorithm>(graph, ids.algorithm);
  const algorithmResult = useCell<Result<AlgorithmResult>>(graph, ids.algorithmResult);
  const showEditor = useCell<boolean>(graph, ids.showEditor);
  const edgeWeight = useCell<string>(graph, ids.edgeWeight);
  const vertexPositions = useCell<Record<string, LayoutPoint>>(graph, ids.vertexPositions);
  const showAnimation = useCell<boolean>(graph, ids.showAnimation);
  const algorithmSteps = useCell<AlgorithmStep[]>(graph, ids.algorithmSteps);
  const time = useCell<number>(graph, TIME_CELL);
  const dragFromRef = useRef<string | null>(null);

  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(false);
  const [speed, setSpeed] = useState(1);
  const duration = showAnimation ? algorithmSteps.length * STEP_SECONDS : 0;
  useTimelinePlayback(graph, playing, loop, speed, duration, setPlaying);
  // A changed algorithm result (new graph, new algorithm, new start/end
  // vertex) restarts the animation from the beginning rather than leaving
  // the scrub head wherever it was, same reasoning as GradientDescentPanel's
  // own analogous reset effect.
  useEffect(() => {
    graph.set(TIME_CELL, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [algorithmSteps]);
  const currentStepIndex = algorithmSteps.length > 0 ? Math.min(algorithmSteps.length - 1, Math.floor(time / STEP_SECONDS)) : -1;
  const currentStep = currentStepIndex >= 0 ? algorithmSteps[currentStepIndex] : undefined;

  const [edgeListInput, setEdgeListInput] = useState(edgeListText);
  useEffect(() => {
    setEdgeListInput(edgeListText);
  }, [edgeListText]);

  // subscribeMany (not subscribeAll, issue #235) -- getCurrentState only
  // reads the fixed cell list below, never TIME_CELL, so a subscribeAll
  // here used to re-run writeUrl on every RAF tick of the step-by-step
  // algorithm animation (useTimelinePlayback above) even though the URL
  // never encodes playback position at all.
  useEffect(() => {
    function writeUrl() {
      window.history.replaceState(null, "", `#${encodeGraphTheoryState(getCurrentState(graph, ids))}`);
    }
    writeUrl();
    return graph.subscribeMany(
      [ids.edgeListText, ids.directed, ids.startVertex, ids.endVertex, ids.algorithm, ids.showEditor, ids.edgeWeight, ids.showAnimation, ids.vertexPositions],
      writeUrl,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    if (!graphResult.ok) return;

    const g = graphResult.value;
    const layout = computeLayout(g.vertices(), vertexPositions, showEditor);
    const highlightedEdges = new Set<string>();
    const highlightedVertices = new Set<string>();
    if (showAnimation && currentStep) {
      // Animation on: only the current step's cumulative reveal is
      // highlighted, not the whole result at once.
      for (const v of currentStep.visitedVertices) highlightedVertices.add(v);
      for (const e of currentStep.visitedEdges) highlightedEdges.add(`${e.from} ${e.to}`);
    } else if (algorithmResult.ok) {
      const r = algorithmResult.value;
      if (r.kind === "path") for (let i = 0; i < r.path.length - 1; i++) highlightedEdges.add(`${r.path[i]} ${r.path[i + 1]}`);
      if (r.kind === "mst") for (const e of r.edges) highlightedEdges.add(`${e.from} ${e.to}`);
      if (r.kind === "order") for (const v of r.order) highlightedVertices.add(v);
    }
    const edgeKey = (a: string, b: string) =>
      highlightedEdges.has(`${a} ${b}`) || highlightedEdges.has(`${b} ${a}`);

    // Edges
    ctx.save();
    for (const e of g.edges()) {
      const from = layout.get(e.from);
      const to = layout.get(e.to);
      if (!from || !to) continue;
      const highlighted = edgeKey(e.from, e.to);
      ctx.strokeStyle = highlighted ? "#dc2626" : "#9ca3af";
      ctx.lineWidth = highlighted ? 3 : 1.5;
      ctx.beginPath();
      ctx.moveTo(toScreenX(from.x, VIEWPORT, WIDTH), toScreenY(from.y, VIEWPORT, HEIGHT));
      ctx.lineTo(toScreenX(to.x, VIEWPORT, WIDTH), toScreenY(to.y, VIEWPORT, HEIGHT));
      ctx.stroke();
      const midX = toScreenX((from.x + to.x) / 2, VIEWPORT, WIDTH);
      const midY = toScreenY((from.y + to.y) / 2, VIEWPORT, HEIGHT);
      ctx.fillStyle = "#374151";
      ctx.font = "11px sans-serif";
      ctx.fillText(String(e.weight), midX, midY);
    }
    ctx.restore();

    // Vertices
    ctx.save();
    ctx.font = "13px sans-serif";
    for (const v of g.vertices()) {
      const p = layout.get(v);
      if (!p) continue;
      const sx = toScreenX(p.x, VIEWPORT, WIDTH);
      const sy = toScreenY(p.y, VIEWPORT, HEIGHT);
      ctx.fillStyle = v === startVertex ? "#16a34a" : highlightedVertices.has(v) ? "#2563eb" : "#1f2937";
      ctx.beginPath();
      ctx.arc(sx, sy, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(v, sx, sy);
    }
    ctx.restore();
  }, [graphResult, algorithmResult, startVertex, vertexPositions, showEditor, showAnimation, currentStep]);

  useEffect(() => {
    const ctx = heatmapCanvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, HEATMAP_SIZE, HEATMAP_SIZE);
    if (!analysis.ok) return;
    const { matrix, order } = analysis.value.adjacencyMatrix;
    drawHeatmap(ctx, matrix, order, HEATMAP_SIZE, HEATMAP_SIZE);
  }, [analysis]);

  // Interactive editor (issue #24's remaining scope, item 1): click empty
  // canvas space to add a vertex; drag from one vertex to another to add a
  // weighted edge. Both operations append a line to the SAME edgeListText
  // cell the text box already edits (matching #159's "the builder writes a
  // generated string into the same cell" convention) -- the algorithm/
  // analysis pipeline needs zero changes since it's all still just text.
  function screenPositions(g: Graph<string>): Map<string, { sx: number; sy: number }> {
    const layout = computeLayout(g.vertices(), vertexPositions, showEditor);
    const screen = new Map<string, { sx: number; sy: number }>();
    for (const [v, p] of layout) screen.set(v, { sx: toScreenX(p.x, VIEWPORT, WIDTH), sy: toScreenY(p.y, VIEWPORT, HEIGHT) });
    return screen;
  }

  function hitRadiusPx(): number {
    return VERTEX_RADIUS * (isCoarsePointer() ? COARSE_POINTER_HIT_RADIUS_MULTIPLIER : 1);
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!showEditor || !graphResult.ok) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { sx, sy } = canvasEventPoint(e, canvas, WIDTH, HEIGHT);
    const hit = findVertexAt({ sx, sy }, screenPositions(graphResult.value), hitRadiusPx());
    if (hit) {
      dragFromRef.current = hit;
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    // Empty space -- add a new vertex here.
    const label = nextVertexLabel(graphResult.value.vertices());
    const x = toDataX(sx, VIEWPORT, WIDTH);
    const y = toDataY(sy, VIEWPORT, HEIGHT);
    graph.set(ids.vertexPositions, { ...vertexPositions, [label]: { x, y } }, { auxiliary: true });
    graph.set(ids.edgeListText, appendVertexLine(graph.get<string>(ids.edgeListText), label));
  }

  function handlePointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    const from = dragFromRef.current;
    dragFromRef.current = null;
    if (!from || !showEditor || !graphResult.ok) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { sx, sy } = canvasEventPoint(e, canvas, WIDTH, HEIGHT);
    const to = findVertexAt({ sx, sy }, screenPositions(graphResult.value), hitRadiusPx());
    if (!to) return; // released over empty space -- drag cancelled, no edge added
    graph.set(ids.edgeListText, appendEdgeLine(graph.get<string>(ids.edgeListText), from, to, Number(edgeWeight)));
  }

  function updateEdgeList(value: string) {
    setEdgeListInput(value);
    graph.set(ids.edgeListText, value);
  }

  return (
    <div>
      <div style={{ margin: "0.25rem 0" }}>
        <textarea
          value={edgeListInput}
          onChange={(e) => updateEdgeList(e.target.value)}
          rows={5}
          style={{ font: "inherit", fontFamily: "monospace", width: "24ch" }}
        />
      </div>
      <div style={{ margin: "0.25rem 0" }}>
        <label>
          <input type="checkbox" checked={directed} onChange={(e) => graph.set(ids.directed, e.target.checked)} /> Directed
        </label>{" "}
        <label>
          <input type="checkbox" checked={showEditor} onChange={(e) => graph.set(ids.showEditor, e.target.checked)} /> Edit graph visually
        </label>
        {showEditor && (
          <label style={{ marginLeft: "0.75rem" }}>
            new edge weight:{" "}
            <input
              value={edgeWeight}
              onChange={(e) => graph.set(ids.edgeWeight, e.target.value)}
              style={{ font: "inherit", width: "5ch" }}
            />
          </label>
        )}
      </div>
      {showEditor && (
        <p style={{ fontSize: "0.8rem", color: "var(--muted)", margin: "0.25rem 0" }}>
          Click empty space to add a vertex. Drag from one vertex to another to add an edge with the weight above.
        </p>
      )}
      <canvas
        ref={canvasRef}
        width={WIDTH}
        height={HEIGHT}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        style={{ border: "1px solid #ccc", cursor: showEditor ? "crosshair" : "default", touchAction: showEditor ? "none" : "auto" }}
      />
      <div style={{ margin: "0.25rem 0" }}>
        <PngExportButton getCanvas={() => canvasRef.current} label="graph-theory" />
      </div>
      {!graphResult.ok && <p style={{ color: "crimson" }}>{graphResult.message}</p>}

      <h3>Algorithm</h3>
      <div style={{ margin: "0.25rem 0", display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
        <select value={algorithm} onChange={(e) => graph.set(ids.algorithm, e.target.value as Algorithm)}>
          <option value="bfs">BFS</option>
          <option value="dfs">DFS</option>
          <option value="dijkstra">Dijkstra (distances from start)</option>
          <option value="shortest-path">Shortest path (start → end)</option>
          <option value="mst">Minimum spanning tree</option>
        </select>
        <label>
          start: <input value={startVertex} onChange={(e) => graph.set(ids.startVertex, e.target.value)} style={{ font: "inherit", width: "6ch" }} />
        </label>
        {algorithm === "shortest-path" && (
          <label>
            end: <input value={endVertex} onChange={(e) => graph.set(ids.endVertex, e.target.value)} style={{ font: "inherit", width: "6ch" }} />
          </label>
        )}
        <label>
          <input type="checkbox" checked={showAnimation} onChange={(e) => graph.set(ids.showAnimation, e.target.checked)} /> Animate step by step
        </label>
      </div>
      {showAnimation && algorithmResult.ok && (
        <>
          <TransportControls graph={graph} time={time} duration={duration} playing={playing} setPlaying={setPlaying} loop={loop} setLoop={setLoop} speed={speed} setSpeed={setSpeed} />
          {currentStep && <p style={{ fontSize: "0.85rem", color: "var(--muted)" }}>{currentStep.label}</p>}
        </>
      )}
      {algorithmResult.ok ? (
        <div>
          {algorithmResult.value.kind === "order" && <p>Visit order: {algorithmResult.value.order.join(" → ")}</p>}
          {algorithmResult.value.kind === "distances" && (
            <p>{algorithmResult.value.distances.map((d) => `${d.vertex}: ${d.distance}`).join(", ")}</p>
          )}
          {algorithmResult.value.kind === "path" && (
            <p>
              distance = {algorithmResult.value.distance}, path = {algorithmResult.value.path.join(" → ")}
            </p>
          )}
          {algorithmResult.value.kind === "mst" && (
            <p>
              total weight = {algorithmResult.value.totalWeight}, edges ={" "}
              {algorithmResult.value.edges.map((e) => `${e.from}-${e.to}(${e.weight})`).join(", ")}
            </p>
          )}
        </div>
      ) : (
        <p style={{ color: "crimson" }}>{algorithmResult.message}</p>
      )}

      <h3>Structure</h3>
      {analysis.ok ? (
        <ul>
          <li>{analysis.value.hasCycle ? "Has a cycle" : "Acyclic"}</li>
          <li>Connected components: {analysis.value.connectedComponents.length}</li>
          <li>Topological order: {analysis.value.topologicalOrder ? analysis.value.topologicalOrder.join(" → ") : "none (has a cycle)"}</li>
        </ul>
      ) : (
        <p style={{ color: "crimson" }}>{analysis.message}</p>
      )}

      <h3>Adjacency matrix</h3>
      {analysis.ok ? (
        <>
          <canvas ref={heatmapCanvasRef} width={HEATMAP_SIZE} height={HEATMAP_SIZE} style={{ border: "1px solid #ccc", maxWidth: "100%" }} />
          <div style={{ margin: "0.25rem 0" }}>
            <PngExportButton getCanvas={() => heatmapCanvasRef.current} label="graph-theory-adjacency" />
          </div>
        </>
      ) : (
        <p style={{ color: "crimson" }}>{analysis.message}</p>
      )}
    </div>
  );
}
