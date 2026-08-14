import { ComplexNumber, Symbolic, type Expr } from "mallory-math";
import { useEffect, useRef, useState } from "react";
import { CellGraph } from "../lib/cell-graph.ts";
import { cellIdsComplex, type CellIdsComplex } from "../lib/cell-ids.ts";
import { DEFAULT_COMPLEX_STATE, decodeComplexState, encodeComplexState, type ComplexState } from "../lib/complex-state.ts";
import { evaluateComplex } from "../lib/complex-eval.ts";
import { resolveNaturalLanguageQuery } from "../lib/nl-query.ts";
import { renderDomainColoring } from "../lib/complex-raster.ts";
import { nthRootsOfUnity } from "../lib/roots-of-unity.ts";
import { PngExportButton } from "./PngExportButton.tsx";
import { drawScatter } from "../lib/render-path.ts";
import { useCellGraphTools } from "../hooks/use-cell-graph-tools.ts";
import { useCell } from "../lib/use-cell.ts";
import type { Viewport } from "../lib/viewport.ts";

type Result<T> = { ok: true; value: T } | { ok: false; message: string };

const WIDTH = 480;
const HEIGHT = 480;
const VIEWPORT: Viewport = { xMin: -3, xMax: 3, yMin: -3, yMax: 3 };

function seedComplexState(graph: CellGraph, ids: CellIdsComplex, state: ComplexState): void {
  graph.set(ids.exprText, state.exprText);
  graph.set(ids.probeRe, state.probeRe);
  graph.set(ids.probeIm, state.probeIm);
  graph.set(ids.showRootsOfUnity, state.showRootsOfUnity);
  graph.set(ids.rootsN, state.rootsN);
}

function getCurrentComplexState(graph: CellGraph, ids: CellIdsComplex): ComplexState {
  return {
    v: 1,
    exprText: graph.get<string>(ids.exprText),
    probeRe: graph.get<string>(ids.probeRe),
    probeIm: graph.get<string>(ids.probeIm),
    showRootsOfUnity: graph.get<boolean>(ids.showRootsOfUnity),
    rootsN: graph.get<string>(ids.rootsN),
  };
}

interface ProbeReading {
  re: number;
  im: number;
  magnitude: number;
  angle: number;
}

/**
 * Sets up the complex-plane panel's reactive cells on its own private
 * CellGraph -- a function-of-z domain plus a probe point and a roots-of-
 * unity demo, none of which fit `cellIds`/GraphCanvas's real-axis-only
 * expression shape (see complex-eval.ts's doc comment for why `Symbolic`'s
 * own evaluators can't be reused here either).
 */
function useComplexGraph(cellId: string): CellGraph {
  const ref = useRef<CellGraph | null>(null);
  if (!ref.current) {
    const graph = new CellGraph();
    const ids = cellIdsComplex(cellId);
    const decoded = typeof window !== "undefined" ? decodeComplexState(window.location.hash.slice(1)) : null;
    seedComplexState(graph, ids, decoded ?? DEFAULT_COMPLEX_STATE);

    graph.define(ids.parseResult, (): Result<Expr> => {
      try {
        return { ok: true, value: Symbolic.parse(graph.get<string>(ids.exprText)) };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
    });

    graph.define(ids.probeResult, (): Result<ProbeReading> => {
      try {
        const parsed = graph.get<Result<Expr>>(ids.parseResult);
        if (!parsed.ok) throw new Error(parsed.message);
        const re = Number(graph.get<string>(ids.probeRe));
        const im = Number(graph.get<string>(ids.probeIm));
        if (Number.isNaN(re) || Number.isNaN(im)) throw new Error("Probe re/im must both be numbers.");
        const w = evaluateComplex(parsed.value, { z: new ComplexNumber(re, im) });
        return { ok: true, value: { re: w.value, im: w.iValue, magnitude: w.magnitude(), angle: w.angle() } };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
    });

    graph.define(ids.rootsResult, (): Result<ComplexNumber[]> => {
      try {
        const n = Number(graph.get<string>(ids.rootsN));
        return { ok: true, value: nthRootsOfUnity(n) };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
    });

    ref.current = graph;
  }
  return ref.current;
}

/**
 * v1 of the complex-plane panel (part of #20): domain coloring of f(z) as a
 * per-pixel raster, a probe-point evaluator, and an n-th-roots-of-unity
 * overlay demo. The interactive conformal grid mapping and general zero/
 * pole finding described in the full ticket are deferred -- domain coloring
 * over an arbitrary elementary f(z) is the CAS-correctness-heavy core.
 */
export function ComplexPanel({ cellId = "complex-1" }: { cellId?: string } = {}) {
  const graph = useComplexGraph(cellId);
  useCellGraphTools(`graphing_complex_${cellId}`, graph);
  const ids = cellIdsComplex(cellId);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const exprText = useCell<string>(graph, ids.exprText);
  const parseResult = useCell<Result<Expr>>(graph, ids.parseResult);
  const probeRe = useCell<string>(graph, ids.probeRe);
  const probeIm = useCell<string>(graph, ids.probeIm);
  const probeResult = useCell<Result<ProbeReading>>(graph, ids.probeResult);
  const showRootsOfUnity = useCell<boolean>(graph, ids.showRootsOfUnity);
  const rootsN = useCell<string>(graph, ids.rootsN);
  const rootsResult = useCell<Result<ComplexNumber[]>>(graph, ids.rootsResult);

  const [exprInput, setExprInput] = useState(exprText);
  // Keeps the input box in sync when exprText changes for a reason other
  // than typing in this box -- e.g. URL-hash hydration -- mirrors
  // GraphCanvas/TaylorPanel's identically-reasoned effect.
  useEffect(() => {
    setExprInput(exprText);
  }, [exprText]);

  function updateExprText(value: string) {
    setExprInput(value);
    graph.set(ids.exprText, resolveNaturalLanguageQuery(value, "z") ?? value);
  }

  useEffect(() => {
    function writeUrl() {
      window.history.replaceState(null, "", `#${encodeComplexState(getCurrentComplexState(graph, ids))}`);
    }
    writeUrl();
    return graph.subscribeAll(writeUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    if (!parseResult.ok) return;
    const expr = parseResult.value;
    renderDomainColoring(ctx, WIDTH, HEIGHT, VIEWPORT, (z) => evaluateComplex(expr, { z }));
    if (showRootsOfUnity && rootsResult.ok) {
      const points = rootsResult.value.map((r) => ({ x: r.value, y: r.iValue }));
      drawScatter(ctx, points, VIEWPORT, WIDTH, HEIGHT, 6, "#111827");
    }
  }, [parseResult, showRootsOfUnity, rootsResult]);

  return (
    <div>
      <h2>Domain coloring of f(z)</h2>
      <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: "0.25rem 0" }}>
        Hue = arg(f(z)), lightness = log-scaled |f(z)| (black at zeros, white at poles, mid-gray at |f(z)|=1).
      </p>
      <div style={{ margin: "0.25rem 0" }}>
        <label>
          f(z) ={" "}
          <input value={exprInput} onChange={(e) => updateExprText(e.target.value)} style={{ font: "inherit", width: "20ch" }} />
        </label>
      </div>
      {!parseResult.ok && <p style={{ color: "var(--danger)" }}>{parseResult.message}</p>}

      <div style={{ margin: "0.25rem 0", display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
        <label>
          <input
            type="checkbox"
            checked={showRootsOfUnity}
            onChange={(e) => graph.set(ids.showRootsOfUnity, e.target.checked)}
          />{" "}
          show n-th roots of unity
        </label>
        <label>
          n:{" "}
          <input
            type="number"
            min={1}
            value={rootsN}
            onChange={(e) => graph.set(ids.rootsN, e.target.value)}
            style={{ font: "inherit", width: "6ch" }}
            disabled={!showRootsOfUnity}
          />
        </label>
      </div>
      {showRootsOfUnity && !rootsResult.ok && <p style={{ color: "var(--danger)" }}>{rootsResult.message}</p>}

      <canvas ref={canvasRef} width={WIDTH} height={HEIGHT} style={{ border: "1px solid var(--border)", maxWidth: "100%" }} />
      <div style={{ margin: "0.25rem 0" }}>
        <PngExportButton getCanvas={() => canvasRef.current} label="complex-plane" />
      </div>

      <h3>Probe a point</h3>
      <div style={{ margin: "0.25rem 0", display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
        <label>
          re(z): <input value={probeRe} onChange={(e) => graph.set(ids.probeRe, e.target.value)} style={{ font: "inherit", width: "8ch" }} />
        </label>
        <label>
          im(z): <input value={probeIm} onChange={(e) => graph.set(ids.probeIm, e.target.value)} style={{ font: "inherit", width: "8ch" }} />
        </label>
      </div>
      {probeResult.ok ? (
        <p>
          f({probeRe}{Number(probeIm) >= 0 ? "+" : ""}{probeIm}i) = {probeResult.value.re.toFixed(4)}
          {probeResult.value.im >= 0 ? "+" : ""}
          {probeResult.value.im.toFixed(4)}i (|f(z)| = {probeResult.value.magnitude.toFixed(4)}, arg = {probeResult.value.angle.toFixed(4)})
        </p>
      ) : (
        <p style={{ color: "var(--danger)" }}>{probeResult.message}</p>
      )}
    </div>
  );
}
