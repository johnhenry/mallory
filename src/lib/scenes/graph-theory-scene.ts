/**
 * Statically-importable ecmanim scene for GraphTheoryPanel's algorithm-step
 * animation video export (`export-graph-theory-video.ts`) --
 * johnhenry/mallory-graph#337. Only the main graph canvas's step-by-step
 * BFS/DFS/Dijkstra/shortest-path/MST animation is exported -- the
 * condensation/adjacency-heatmap/Frobenius views are static-only (no
 * `TransportControls`), same "only the animated view" scoping as
 * `ca-scene.ts`'s own doc comment.
 *
 * Must be a top-level export and deterministic given `params` -- see
 * `ode-scene.ts`'s doc comment for why (worker_threads re-`import()` by
 * path + export name, segment-cache correctness).
 *
 * Recomputes the graph, algorithm result, and step sequence from scratch
 * via the exact same functions the panel calls (`parseEdgeListText`,
 * `runBfs`/`runDfs`/`runDijkstra`/`runShortestPath`/`runMst`,
 * `traversalSteps`/`bfsLayerSteps`/`dijkstraSteps`/`pathSteps`/`mstSteps`,
 * `computeLayout`) -- see `graph-algorithm-steps.ts`'s own doc comment for
 * why each step order is authentic to what mallory-math itself returned,
 * not a re-derivation.
 *
 * Vertex/edge mobjects are built ONCE (positioned via `computeLayout`,
 * scaled from the panel's own VIEWPORT data-space into scene space) and
 * their color/width toggled per algorithm step via a single group-level
 * updater -- same "build once, toggle style" approach `ca-scene.ts` uses
 * for opacity, just extended to color+strokeWidth here. The full step
 * sequence is spread evenly across whatever `duration` the caller picks
 * (same reparametrize-by-duration approach `ca-scene.ts`/`ode-scene.ts`
 * use), not tied to the panel's own fixed `STEP_SECONDS` playback rate.
 */
import { Circle, Line, Text, VGroup } from "ecmanim/node";
import type { Graph } from "mallory-math";
import { LABEL_COLOR, SQUARE_HALF_SPAN } from "../export-render.ts";
import { computeLayout } from "../graph-editor.ts";
import {
  bfsDistances,
  bfsLayerSteps,
  dijkstraSteps,
  mstSteps,
  pathSteps,
  traversalSteps,
  type AlgorithmStep,
} from "../graph-algorithm-steps.ts";
import { parseEdgeListText, runBfs, runDfs, runDijkstra, runMst, runShortestPath, type LayoutPoint } from "../graph-ops.ts";

type Algorithm = "bfs" | "dfs" | "dijkstra" | "shortest-path" | "mst";

// Matches GraphTheoryPanel.tsx's own WIDTH/VIEWPORT (500px canvas, data
// range [-1.3, 1.3]) -- reused here only as the ratio that scales data-space
// positions/radii into scene space, never for pixel math directly.
const VIEWPORT_HALF_SPAN = 1.3;
const VERTEX_RADIUS_PX = 14;
const CANVAS_HALF_WIDTH_PX = 250;

const SCALE = SQUARE_HALF_SPAN / VIEWPORT_HALF_SPAN;
const VERTEX_RADIUS = SQUARE_HALF_SPAN * (VERTEX_RADIUS_PX / CANVAS_HALF_WIDTH_PX);

const START_COLOR = "#16a34a";
const HIGHLIGHT_COLOR = "#2563eb";
const DEFAULT_VERTEX_COLOR = "#1f2937";
const EDGE_COLOR = "#9ca3af";
const EDGE_HIGHLIGHT_COLOR = "#dc2626";
const EDGE_WIDTH = 2;
const EDGE_WIDTH_HIGHLIGHT = 5;

export interface GraphTheorySceneParams {
  edgeListText: string;
  directed: boolean;
  algorithm: Algorithm;
  startVertex: string;
  endVertex: string;
  vertexPositions: Record<string, LayoutPoint>;
  showEditor: boolean;
  duration: number;
}

/** Mirrors GraphTheoryPanel.tsx's own `ids.algorithmSteps` derivation exactly -- see graph-algorithm-steps.ts's doc comment for why each order is authentic. */
function computeAlgorithmSteps(g: Graph<string>, algorithm: Algorithm, startVertex: string, endVertex: string): AlgorithmStep[] {
  switch (algorithm) {
    case "bfs": {
      const order = runBfs(g, startVertex).order;
      const distances = bfsDistances((v) => g.neighbors(v), startVertex);
      return bfsLayerSteps(order, distances);
    }
    case "dfs":
      return traversalSteps(runDfs(g, startVertex).order);
    case "dijkstra":
      return dijkstraSteps(runDijkstra(g, startVertex).distances);
    case "shortest-path":
      return pathSteps(runShortestPath(g, startVertex, endVertex).path);
    case "mst":
      return mstSteps(runMst(g).edges);
  }
}

export async function construct(scene: any, data: GraphTheorySceneParams): Promise<void> {
  const g = parseEdgeListText(data.edgeListText, data.directed);
  const steps = computeAlgorithmSteps(g, data.algorithm, data.startVertex, data.endVertex);
  const layout = computeLayout(g.vertices(), data.vertexPositions, data.showEditor);
  const scenePoint = (p: LayoutPoint): number[] => [p.x * SCALE, p.y * SCALE, 0];

  const group = new VGroup();

  // Edges first so vertices/labels render on top of them.
  const edgeLines = new Map<string, Line>();
  for (const e of g.edges()) {
    const from = layout.get(e.from);
    const to = layout.get(e.to);
    if (!from || !to) continue;
    const start = scenePoint(from);
    const end = scenePoint(to);
    const line = new Line(start, end, { strokeColor: EDGE_COLOR, strokeWidth: EDGE_WIDTH });
    group.add(line);
    edgeLines.set(`${e.from} ${e.to}`, line);
    const weightLabel = new Text(String(e.weight), { fontSize: VERTEX_RADIUS * 0.8, color: LABEL_COLOR });
    weightLabel.moveTo([(start[0]! + end[0]!) / 2, (start[1]! + end[1]!) / 2, 0]);
    group.add(weightLabel);
  }

  const vertexDots = new Map<string, Circle>();
  for (const v of g.vertices()) {
    const p = layout.get(v);
    if (!p) continue;
    const point = scenePoint(p);
    const dot = new Circle({ radius: VERTEX_RADIUS, fillColor: v === data.startVertex ? START_COLOR : DEFAULT_VERTEX_COLOR, fillOpacity: 1, strokeWidth: 0 });
    dot.moveTo(point);
    const label = new Text(v, { fontSize: VERTEX_RADIUS * 1.1, color: "#ffffff" });
    label.moveTo(point);
    group.add(dot, label);
    vertexDots.set(v, dot);
  }

  scene.add(group);

  let elapsed = 0;
  let lastStep = -2;
  group.addUpdater(
    (_m: unknown, dt: number) => {
      elapsed += dt;
      const stepIndex = steps.length > 0 ? Math.min(steps.length - 1, Math.floor((elapsed / data.duration) * steps.length)) : -1;
      if (stepIndex === lastStep) return;
      lastStep = stepIndex;
      const step = stepIndex >= 0 ? steps[stepIndex] : undefined;
      const visitedVertices = new Set(step?.visitedVertices ?? []);
      const visitedEdges = new Set((step?.visitedEdges ?? []).flatMap((e) => [`${e.from} ${e.to}`, `${e.to} ${e.from}`]));
      for (const [label, dot] of vertexDots) {
        dot.setColor(label === data.startVertex ? START_COLOR : visitedVertices.has(label) ? HIGHLIGHT_COLOR : DEFAULT_VERTEX_COLOR);
      }
      for (const [key, line] of edgeLines) {
        const highlighted = visitedEdges.has(key);
        line.setStroke(highlighted ? EDGE_HIGHLIGHT_COLOR : EDGE_COLOR, highlighted ? EDGE_WIDTH_HIGHLIGHT : EDGE_WIDTH);
      }
    },
    { hashExtra: () => String(elapsed) },
  );

  await scene.wait(data.duration);
}
