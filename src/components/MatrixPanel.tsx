import type { ComplexNumber, Graph } from "mallory-math";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { CellGraph } from "../lib/cell-graph.ts";
import { cellIdsMatrix, type CellIdsMatrix } from "../lib/cell-ids.ts";
import { circularLayout } from "../lib/graph-ops.ts";
import { matrixToGraph } from "../lib/frobenius.ts";
import { resolveMatrixChatCommand } from "../lib/matrix-chat-commands.ts";
import {
  computeDecompositions,
  computeDeterminant,
  computeInverse,
  parseMatrixText,
  polynomialRootsViaCompanionMatrix,
  tracedRref,
  type DecompositionSet,
  type Mat,
  type TracedRref,
} from "../lib/matrix-ops.ts";
import { DEFAULT_MATRIX_STATE, decodeMatrixState, encodeMatrixState, type MatrixState } from "../lib/matrix-state.ts";
import { drawAxes, drawScatter, type Viewport } from "../lib/render-path.ts";
import { getThemeColors } from "../lib/theme-colors.ts";
import { scatterPointsToSvgDocument } from "../lib/svg-export.ts";
import { useCellGraphTools } from "../hooks/use-cell-graph-tools.ts";
import { useCell } from "../lib/use-cell.ts";
import { toScreenX, toScreenY } from "../lib/viewport.ts";
import { PngExportButton } from "./PngExportButton.tsx";
import { SvgExportButton } from "./SvgExportButton.tsx";

type Result<T> = { ok: true; value: T } | { ok: false; message: string };

function MatrixTable({ m }: { m: Mat }) {
  return (
    <table style={{ borderCollapse: "collapse", margin: "0.25rem 0" }}>
      <tbody>
        {m.map((row, i) => (
          <tr key={i}>
            {row.map((v, j) => (
              <td key={j} style={{ border: "1px solid var(--border)", padding: "2px 8px", textAlign: "right", fontFamily: "monospace" }}>
                {Number.isFinite(v) ? v.toFixed(4) : String(v)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const MATRIX_GRAPH_VIEWPORT: Viewport = { xMin: -1.3, xMax: 1.3, yMin: -1.3, yMax: 1.3 };
const MATRIX_GRAPH_SIZE = 320;

/**
 * Pure re-render of the "matrix as directed graph" view (issue #297 item
 * 5 -- the other half of the duality GraphTheoryPanel's adjacency heatmap
 * already covers). Circular layout (matching GraphTheoryPanel's own
 * `computeLayout` fallback shape, but this view has no drag/edit
 * interaction, so the simpler non-editor `circularLayout` is all it
 * needs). Self-loop edges (a diagonal matrix entry) are drawn as a small
 * circle offset radially outward from the node -- a straight line from a
 * node to itself would be a zero-length, invisible segment.
 */
export function drawMatrixGraph(ctx: CanvasRenderingContext2D, width: number, height: number, matrixGraph: Graph<string> | null): void {
  ctx.clearRect(0, 0, width, height);
  if (!matrixGraph) return;
  const vertices = matrixGraph.vertices();
  const layout = circularLayout(vertices);
  // Theme-aware label ink (issue #314): the weight labels were hardcoded
  // #374151 (dark gray) -- effectively invisible against the dark theme's
  // background, which is how "the matrix-graph view has no weight labels"
  // got reported while the code plainly drew them.
  const theme = getThemeColors();

  ctx.save();
  ctx.font = "10px sans-serif";
  for (const e of matrixGraph.edges()) {
    const from = layout.get(e.from);
    const to = layout.get(e.to);
    if (!from || !to) continue;
    const fromX = toScreenX(from.x, MATRIX_GRAPH_VIEWPORT, width);
    const fromY = toScreenY(from.y, MATRIX_GRAPH_VIEWPORT, height);

    if (e.from === e.to) {
      // Self-loop: a small circle offset radially outward from the node
      // (away from the layout's own origin), so it reads as "attached to
      // this node" without overlapping any other edge.
      const len = Math.hypot(from.x, from.y) || 1;
      const dirX = from.x / len;
      const dirY = from.y / len;
      const loopCx = fromX + dirX * 22;
      const loopCy = fromY + dirY * 22;
      ctx.strokeStyle = "#9ca3af";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(loopCx, loopCy, 10, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = theme.ink;
      ctx.textAlign = "center";
      ctx.fillText(String(e.weight), loopCx, loopCy - 15);
      continue;
    }

    const toX = toScreenX(to.x, MATRIX_GRAPH_VIEWPORT, width);
    const toY = toScreenY(to.y, MATRIX_GRAPH_VIEWPORT, height);
    ctx.strokeStyle = "#9ca3af";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX, toY);
    ctx.stroke();
    // A short arrowhead partway along the line -- rows are OUTGOING
    // edges, so which way each edge points is exactly the fact this view
    // exists to show.
    const t = 0.55;
    const midX = fromX + (toX - fromX) * t;
    const midY = fromY + (toY - fromY) * t;
    const angle = Math.atan2(toY - fromY, toX - fromX);
    const arrowSize = 6;
    ctx.beginPath();
    ctx.moveTo(midX, midY);
    ctx.lineTo(midX - arrowSize * Math.cos(angle - Math.PI / 6), midY - arrowSize * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(midX - arrowSize * Math.cos(angle + Math.PI / 6), midY - arrowSize * Math.sin(angle + Math.PI / 6));
    ctx.closePath();
    ctx.fillStyle = "#9ca3af";
    ctx.fill();
    ctx.fillStyle = theme.ink;
    ctx.textAlign = "center";
    ctx.fillText(String(e.weight), (fromX + toX) / 2, (fromY + toY) / 2 - 6);
  }
  ctx.restore();

  ctx.save();
  ctx.font = "13px sans-serif";
  for (const v of vertices) {
    const p = layout.get(v);
    if (!p) continue;
    const sx = toScreenX(p.x, MATRIX_GRAPH_VIEWPORT, width);
    const sy = toScreenY(p.y, MATRIX_GRAPH_VIEWPORT, height);
    ctx.fillStyle = "#1f2937";
    ctx.beginPath();
    ctx.arc(sx, sy, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(v, sx, sy);
  }
  ctx.restore();
}

/**
 * The matrix's own directed-graph reading (issue #297 item 5): a plain
 * `<canvas>` view, standalone/props-only like `GraphTheoryPanel`'s
 * `CondensationView`. `null` when the entered matrix isn't square (no
 * such reading exists there).
 */
function MatrixGraphView({ matrixGraph }: { matrixGraph: Graph<string> | null }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    drawMatrixGraph(ctx, MATRIX_GRAPH_SIZE, MATRIX_GRAPH_SIZE, matrixGraph);
  }, [matrixGraph]);
  if (!matrixGraph) return <p style={{ color: "var(--muted)", fontSize: "0.85rem" }}>Directed-graph view needs a square matrix.</p>;
  return (
    <div>
      <canvas ref={canvasRef} width={MATRIX_GRAPH_SIZE} height={MATRIX_GRAPH_SIZE} style={{ border: "1px solid var(--border)", maxWidth: "100%" }} />
      <div style={{ margin: "0.25rem 0" }}>
        <PngExportButton
          getCanvas={() => canvasRef.current}
          label="matrix-graph"
          renderAtScale={(ctx, width, height) => drawMatrixGraph(ctx, width, height, matrixGraph)}
          baseWidth={MATRIX_GRAPH_SIZE}
          baseHeight={MATRIX_GRAPH_SIZE}
        />
      </div>
      <p style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
        Node i = row/column i. A loop is a diagonal entry; an edge i → j is row i's entry in column j. Zero entries are omitted (never drawn as a real 0-weight edge).
      </p>
    </div>
  );
}

function seedMatrixState(graph: CellGraph, ids: CellIdsMatrix, state: MatrixState): void {
  graph.set(ids.matrixText, state.matrixText);
  graph.set(ids.polyCoeffs, state.polyCoeffs);
}

function getCurrentMatrixState(graph: CellGraph, ids: CellIdsMatrix): MatrixState {
  return { v: 1, matrixText: graph.get<string>(ids.matrixText), polyCoeffs: graph.get<string>(ids.polyCoeffs) };
}

function useMatrixGraph(cellId: string): CellGraph {
  const ref = useRef<CellGraph | null>(null);
  if (!ref.current) {
    const graph = new CellGraph();
    const ids = cellIdsMatrix(cellId);
    const decoded = typeof window !== "undefined" ? decodeMatrixState(window.location.hash.slice(1)) : null;
    seedMatrixState(graph, ids, decoded ?? DEFAULT_MATRIX_STATE);

    const matrix = (): Mat => parseMatrixText(graph.get<string>(ids.matrixText));

    graph.define(ids.determinant, (): Result<number> => {
      try {
        return { ok: true, value: computeDeterminant(matrix()).value };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
    });

    graph.define(ids.inverse, (): Result<Mat> => {
      try {
        return { ok: true, value: computeInverse(matrix()).matrix };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
    });

    graph.define(ids.rref, (): Result<TracedRref> => {
      try {
        return { ok: true, value: tracedRref(matrix()) };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
    });

    graph.define(ids.decompositions, (): Result<DecompositionSet> => {
      try {
        return { ok: true, value: computeDecompositions(matrix()) };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
    });

    graph.define(ids.polyRoots, (): Result<ComplexNumber[]> => {
      try {
        const coeffs = graph
          .get<string>(ids.polyCoeffs)
          .split(/[\s,]+/)
          .filter(Boolean)
          .map(Number);
        if (coeffs.length === 0 || coeffs.some(Number.isNaN)) throw new Error("Enter comma/space-separated coefficients [a0, a1, ..., a(n-1)].");
        return { ok: true, value: polynomialRootsViaCompanionMatrix(coeffs) };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
    });

    ref.current = graph;
  }
  return ref.current;
}

const ROOT_CANVAS_SIZE = 220;

export interface RootsPlot {
  viewport: Viewport;
  points: Array<{ x: number; y: number }>;
}

/** Shared between the polynomial-roots canvas's draw effect, its SVG export, and its 2x-scale PNG export (issue #45/#278). */
export function rootsPlot(polyRoots: Result<ComplexNumber[]>): RootsPlot | null {
  if (!polyRoots.ok) return null;
  const points = polyRoots.value.map((r) => ({ x: r.value, y: r.iValue }));
  const maxAbs = Math.max(1, ...points.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y))));
  return { viewport: { xMin: -maxAbs * 1.2, xMax: maxAbs * 1.2, yMin: -maxAbs * 1.2, yMax: maxAbs * 1.2 }, points };
}

/**
 * Pure re-render of the polynomial-roots canvas, extracted from the draw
 * effect below so `PngExportButton`'s `renderAtScale` (issue #278) can
 * call it against a fresh offscreen canvas at any size.
 */
export function drawMatrixRootsPanel(ctx: CanvasRenderingContext2D, width: number, height: number, polyRoots: Result<ComplexNumber[]>): void {
  ctx.clearRect(0, 0, width, height);
  const plot = rootsPlot(polyRoots);
  if (plot) {
    drawAxes(ctx, plot.viewport, width, height);
    drawScatter(ctx, plot.points, plot.viewport, width, height, 4, "#dc2626");
  }
}

/** Matrix playground: determinant/inverse, step-through RREF, every MatrixMath decomposition over one entered matrix, and polynomial roots (any degree) via a companion matrix fed to adapter-math's eigGeneral. */
export function MatrixPanel({ cellId = "matrix-1" }: { cellId?: string } = {}) {
  const graph = useMatrixGraph(cellId);
  useCellGraphTools(`data_matrix_${cellId}`, graph);
  const ids = cellIdsMatrix(cellId);
  const rootCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const matrixText = useCell<string>(graph, ids.matrixText);
  // The matrix's own directed-graph reading (issue #297 item 5) -- a
  // presentational derived value, not a graph.define()'d cell, since
  // nothing else reads it and MatrixGraphView already re-renders whenever
  // matrixText itself changes (matrixGraph is a new value every render,
  // same as any other plain computed-from-props value).
  let matrixGraph: ReturnType<typeof matrixToGraph> = null;
  try {
    matrixGraph = matrixToGraph(parseMatrixText(matrixText));
  } catch {
    // Mid-edit invalid text (e.g. a ragged row) -- MatrixGraphView's own
    // `null` handling already covers this the same way it covers a
    // non-square matrix.
  }
  const polyCoeffs = useCell<string>(graph, ids.polyCoeffs);
  const determinant = useCell<Result<number>>(graph, ids.determinant);
  const inverse = useCell<Result<Mat>>(graph, ids.inverse);
  const rref = useCell<Result<TracedRref>>(graph, ids.rref);
  const decompositions = useCell<Result<DecompositionSet>>(graph, ids.decompositions);
  const polyRoots = useCell<Result<ComplexNumber[]>>(graph, ids.polyRoots);

  const [matrixTextInput, setMatrixTextInput] = useState(matrixText);
  useEffect(() => {
    setMatrixTextInput(matrixText);
  }, [matrixText]);
  const [showSteps, setShowSteps] = useState(false);

  useEffect(() => {
    function writeUrl() {
      window.history.replaceState(null, "", `#${encodeMatrixState(getCurrentMatrixState(graph, ids))}`);
    }
    writeUrl();
    return graph.subscribeAll(writeUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);

  useEffect(() => {
    const ctx = rootCanvasRef.current?.getContext("2d");
    if (!ctx) return;
    drawMatrixRootsPanel(ctx, ROOT_CANVAS_SIZE, ROOT_CANVAS_SIZE, polyRoots);
  }, [polyRoots]);

  function updateMatrixText(value: string) {
    setMatrixTextInput(value);
    graph.set(ids.matrixText, value);
  }

  // MatrixPanel's first chat-command surface (issue #46's remaining scope,
  // item 1: contextual commands like "invert this matrix" that read
  // whatever's already entered, rather than the literal-bearing phrasings
  // nl-query-matrix.ts's resolveMatrixNavigationCommand handles from a
  // DIFFERENT panel's chat box). Mirrors GraphCanvas's own chat state/log
  // shape, but resolveMatrixChatCommand only ever reads the graph -- it
  // never mutates it, so there's no ChatCommandContext-style bundle of
  // setters to pass through.
  const [chatInput, setChatInput] = useState("");
  const [chatLog, setChatLog] = useState<Array<{ input: string; ok: boolean; message: string }>>([]);
  function handleChatSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const input = chatInput.trim();
    if (!input) return;
    const result = resolveMatrixChatCommand(input, { graph, ids });
    setChatLog((log) => [
      ...log,
      {
        input,
        ok: result?.ok ?? false,
        message: result?.message ?? `Didn't understand that. Try "invert this matrix", "determinant of this matrix", or "eigenvalues of this matrix".`,
      },
    ]);
    setChatInput("");
  }

  return (
    <div>
      <h2>Matrix</h2>
      <div style={{ margin: "0.25rem 0" }}>
        <textarea
          value={matrixTextInput}
          onChange={(e) => updateMatrixText(e.target.value)}
          rows={4}
          style={{ font: "inherit", fontFamily: "monospace", width: "30ch" }}
        />
      </div>

      <h3>As a directed graph</h3>
      <MatrixGraphView matrixGraph={matrixGraph} />

      <form onSubmit={handleChatSubmit} style={{ margin: "0.5rem 0" }}>
        <label title="A fixed set of command phrasings, not free-text chat -- the placeholder shows the shapes it understands.">
          Commands:{" "}
          <input
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            placeholder='"invert this matrix", "determinant of this matrix"...'
            style={{ font: "inherit", width: "32ch" }}
          />
        </label>{" "}
        <button type="submit">Run</button>
        {chatLog.length > 0 && (
          <ul style={{ fontSize: "0.85rem", listStyle: "none", padding: 0, margin: "0.25rem 0" }}>
            {chatLog.slice(-5).map((entry, i) => (
              <li key={i} style={{ color: entry.ok ? "inherit" : "var(--danger)" }}>
                <strong>{entry.input}</strong> — {entry.message}
              </li>
            ))}
          </ul>
        )}
      </form>
      <div style={{ margin: "0.5rem 0", display: "flex", gap: "2rem", flexWrap: "wrap" }}>
        <div>
          <p style={{ fontWeight: 600, margin: "0.25rem 0" }}>Determinant</p>
          {determinant.ok ? <p>{determinant.value.toFixed(6)}</p> : <p style={{ color: "var(--danger)" }}>{determinant.message}</p>}
        </div>
        <div>
          <p style={{ fontWeight: 600, margin: "0.25rem 0" }}>Inverse</p>
          {inverse.ok ? <MatrixTable m={inverse.value} /> : <p style={{ color: "var(--danger)" }}>{inverse.message}</p>}
        </div>
      </div>

      <h3>Reduced row echelon form</h3>
      {rref.ok ? (
        <div>
          <button type="button" onClick={() => setShowSteps((v) => !v)}>
            {showSteps ? "▾" : "▸"} Show steps ({rref.value.steps.length})
          </button>
          {showSteps && (
            <ol>
              {rref.value.steps.map((step, i) => (
                <li key={i}>
                  {step.description}
                  <MatrixTable m={step.matrix} />
                </li>
              ))}
            </ol>
          )}
          <p style={{ fontWeight: 600, margin: "0.25rem 0" }}>Result</p>
          <MatrixTable m={rref.value.result} />
        </div>
      ) : (
        <p style={{ color: "var(--danger)" }}>{rref.message}</p>
      )}

      <h3>Decompositions</h3>
      {decompositions.ok ? (
        <div style={{ display: "flex", gap: "2rem", flexWrap: "wrap" }}>
          <div>
            <p style={{ fontWeight: 600, margin: "0.25rem 0" }}>LU (P·A = L·U, sign {decompositions.value.lu.sign})</p>
            <MatrixTable m={[...decompositions.value.lu.L].map((r) => [...r])} />
            <MatrixTable m={[...decompositions.value.lu.U].map((r) => [...r])} />
          </div>
          <div>
            <p style={{ fontWeight: 600, margin: "0.25rem 0" }}>QR</p>
            <MatrixTable m={[...decompositions.value.qr.Q].map((r) => [...r])} />
            <MatrixTable m={[...decompositions.value.qr.R].map((r) => [...r])} />
          </div>
          {decompositions.value.eigenSymmetric && (
            <div>
              <p style={{ fontWeight: 600, margin: "0.25rem 0" }}>Eigenvalues (symmetric)</p>
              <p>{[...decompositions.value.eigenSymmetric.values].map((v) => v.toFixed(4)).join(", ")}</p>
            </div>
          )}
          <div>
            <p style={{ fontWeight: 600, margin: "0.25rem 0" }}>Rank / Condition number</p>
            <p>
              rank = {decompositions.value.rank}, κ = {decompositions.value.conditionNumber.toFixed(4)}
            </p>
            {decompositions.value.choleskyError && <p style={{ color: "var(--muted)", fontSize: "0.85rem" }}>Cholesky: {decompositions.value.choleskyError}</p>}
          </div>
          {decompositions.value.nullSpace.some((row) => row.some((v) => v !== 0)) && (
            <div>
              <p style={{ fontWeight: 600, margin: "0.25rem 0" }}>Null space basis</p>
              <MatrixTable m={decompositions.value.nullSpace} />
            </div>
          )}
        </div>
      ) : (
        <p style={{ color: "var(--danger)" }}>{decompositions.message}</p>
      )}

      <h2>Polynomial roots</h2>
      <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: "0.25rem 0" }}>
        Coefficients [a₀, a₁, ..., aₙ₋₁] of the monic polynomial xⁿ + aₙ₋₁xⁿ⁻¹ + ... + a₁x + a₀ (via a companion matrix's eigenvalues).
      </p>
      <div style={{ margin: "0.25rem 0" }}>
        <input
          value={polyCoeffs}
          onChange={(e) => graph.set(ids.polyCoeffs, e.target.value)}
          style={{ font: "inherit", fontFamily: "monospace", width: "30ch" }}
        />
      </div>
      <div style={{ display: "flex", gap: "1rem", alignItems: "flex-start" }}>
        <div>
          <canvas ref={rootCanvasRef} width={ROOT_CANVAS_SIZE} height={ROOT_CANVAS_SIZE} style={{ border: "1px solid var(--border)" }} />
          <div style={{ margin: "0.25rem 0" }}>
            <PngExportButton
              getCanvas={() => rootCanvasRef.current}
              label="matrix-roots"
              renderAtScale={(ctx, width, height) => drawMatrixRootsPanel(ctx, width, height, polyRoots)}
              baseWidth={ROOT_CANVAS_SIZE}
              baseHeight={ROOT_CANVAS_SIZE}
            />
            <SvgExportButton
              getSvg={() => {
                const plot = rootsPlot(polyRoots);
                return plot ? scatterPointsToSvgDocument(plot.points, plot.viewport, ROOT_CANVAS_SIZE, ROOT_CANVAS_SIZE, "#dc2626", 4) : null;
              }}
              label="matrix-roots"
            />
          </div>
        </div>
        {polyRoots.ok ? (
          <ul>
            {polyRoots.value.map((r, i) => (
              <li key={i}>{r.toString()}</li>
            ))}
          </ul>
        ) : (
          <p style={{ color: "var(--danger)" }}>{polyRoots.message}</p>
        )}
      </div>
    </div>
  );
}
