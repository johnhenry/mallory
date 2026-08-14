import type { Path2D } from "mallory-math";
import { useEffect, useRef, useState } from "react";
import { CellGraph } from "../lib/cell-graph.ts";
import { cellIdsTaylor, type CellIdsTaylor } from "../lib/cell-ids.ts";
import { drawPath, type Viewport } from "../lib/render-path.ts";
import { resolveNaturalLanguageQuery } from "../lib/nl-query.ts";
import { computeLimit, computeTaylorApproximation, type LimitDirection } from "../lib/taylor-approx.ts";
import { DEFAULT_TAYLOR_STATE, decodeTaylorState, encodeTaylorState, type TaylorState } from "../lib/taylor-state.ts";
import { useCellGraphTools } from "../hooks/use-cell-graph-tools.ts";
import { useCell } from "../lib/use-cell.ts";
import { CopyableTex } from "./CopyableTex.tsx";

type ApproxResult = { ok: true; fPath: Path2D; taylorPath: Path2D; latex: string } | { ok: false; message: string };
type LimitResult = { ok: true; value: number } | { ok: false; message: string };

const WIDTH = 500;
const HEIGHT = 500;

function seedTaylorState(graph: CellGraph, ids: CellIdsTaylor, state: TaylorState): void {
  graph.set(ids.expr, state.expr);
  graph.set(ids.center, state.center);
  graph.set(ids.order, state.order);
  graph.set(ids.xMin, state.xMin);
  graph.set(ids.xMax, state.xMax);
  graph.set(ids.yMin, state.yMin);
  graph.set(ids.yMax, state.yMax);
  graph.set(ids.limitPoint, state.limitPoint);
  graph.set(ids.limitDirection, state.limitDirection);
}

function getCurrentTaylorState(graph: CellGraph, ids: CellIdsTaylor): TaylorState {
  return {
    v: 1,
    expr: graph.get<string>(ids.expr),
    center: graph.get<string>(ids.center),
    order: graph.get<string>(ids.order),
    xMin: graph.get<string>(ids.xMin),
    xMax: graph.get<string>(ids.xMax),
    yMin: graph.get<string>(ids.yMin),
    yMax: graph.get<string>(ids.yMax),
    limitPoint: graph.get<string>(ids.limitPoint),
    limitDirection: graph.get<LimitDirection>(ids.limitDirection),
  };
}

function useTaylorGraph(cellId: string): CellGraph {
  const ref = useRef<CellGraph | null>(null);
  if (!ref.current) {
    const graph = new CellGraph();
    const ids = cellIdsTaylor(cellId);
    const decoded = typeof window !== "undefined" ? decodeTaylorState(window.location.hash.slice(1)) : null;
    seedTaylorState(graph, ids, decoded ?? DEFAULT_TAYLOR_STATE);

    graph.define(ids.taylorPath, (): ApproxResult => {
      try {
        const expr = graph.get<string>(ids.expr);
        const center = Number(graph.get<string>(ids.center));
        const order = Number(graph.get<string>(ids.order));
        const xMin = Number(graph.get<string>(ids.xMin));
        const xMax = Number(graph.get<string>(ids.xMax));
        const yMin = Number(graph.get<string>(ids.yMin));
        const yMax = Number(graph.get<string>(ids.yMax));
        if ([center, order, xMin, xMax, yMin, yMax].some(Number.isNaN)) throw new Error("Every field must be a number.");
        if (xMin >= xMax) throw new Error("x-min must be less than x-max.");
        if (!Number.isInteger(order) || order < 0) throw new Error("Order must be a non-negative integer.");
        const { fPath, taylorPath, latex } = computeTaylorApproximation(expr, center, order, { min: xMin, max: xMax }, { min: yMin, max: yMax });
        return { ok: true, fPath, taylorPath, latex };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) };
      }
    });

    graph.define(ids.limitResult, (): LimitResult => {
      const expr = graph.get<string>(ids.expr);
      const point = Number(graph.get<string>(ids.limitPoint));
      const direction = graph.get<LimitDirection>(ids.limitDirection);
      if (Number.isNaN(point)) return { ok: false, message: "The limit point must be a number." };
      return computeLimit(expr, point, direction);
    });

    ref.current = graph;
  }
  return ref.current;
}

/** f(x) plus its degree-n Taylor polynomial about a center point (Symbolic.taylor), and a numeric limit readout (Symbolic.limit) at a chosen point/direction. */
export function TaylorPanel({ cellId = "taylor-1" }: { cellId?: string } = {}) {
  const graph = useTaylorGraph(cellId);
  useCellGraphTools(`calculus_taylor_${cellId}`, graph);
  const ids = cellIdsTaylor(cellId);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const expr = useCell<string>(graph, ids.expr);
  const center = useCell<string>(graph, ids.center);
  const order = useCell<string>(graph, ids.order);
  const xMin = useCell<string>(graph, ids.xMin);
  const xMax = useCell<string>(graph, ids.xMax);
  const yMin = useCell<string>(graph, ids.yMin);
  const yMax = useCell<string>(graph, ids.yMax);
  const limitPoint = useCell<string>(graph, ids.limitPoint);
  const limitDirection = useCell<LimitDirection>(graph, ids.limitDirection);
  const approx = useCell<ApproxResult>(graph, ids.taylorPath);
  const limitResult = useCell<LimitResult>(graph, ids.limitResult);

  const [exprInput, setExprInput] = useState(expr);
  useEffect(() => {
    setExprInput(expr);
  }, [expr]);

  useEffect(() => {
    function writeUrl() {
      window.history.replaceState(null, "", `#${encodeTaylorState(getCurrentTaylorState(graph, ids))}`);
    }
    writeUrl();
    return graph.subscribeAll(writeUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);

  const viewport: Viewport = {
    xMin: Number(xMin) || -5,
    xMax: Number(xMax) || 5,
    yMin: Number(yMin) || -5,
    yMax: Number(yMax) || 5,
  };

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    if (approx.ok) {
      drawPath(ctx, approx.fPath, viewport, WIDTH, HEIGHT);
      drawPath(ctx, approx.taylorPath, viewport, WIDTH, HEIGHT);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approx, xMin, xMax, yMin, yMax]);

  function updateExpr(value: string) {
    setExprInput(value);
    graph.set(ids.expr, resolveNaturalLanguageQuery(value) ?? value);
  }

  return (
    <div>
      <div style={{ margin: "0.25rem 0" }}>
        <label>
          f(x) ={" "}
          <input value={exprInput} onChange={(e) => updateExpr(e.target.value)} style={{ font: "inherit", width: "20ch" }} />
        </label>
      </div>
      <div style={{ margin: "0.25rem 0" }}>
        <label>
          center ={" "}
          <input value={center} onChange={(e) => graph.set(ids.center, e.target.value)} style={{ font: "inherit", width: "6ch" }} />
        </label>{" "}
        <label>
          order (n) ={" "}
          <input
            type="number"
            min={0}
            value={order}
            onChange={(e) => graph.set(ids.order, e.target.value)}
            style={{ font: "inherit", width: "6ch" }}
          />
        </label>
      </div>
      <div style={{ margin: "0.25rem 0" }}>
        <label>
          x: [<input value={xMin} onChange={(e) => graph.set(ids.xMin, e.target.value)} style={{ font: "inherit", width: "6ch" }} />
          ,{" "}
          <input value={xMax} onChange={(e) => graph.set(ids.xMax, e.target.value)} style={{ font: "inherit", width: "6ch" }} />]
        </label>{" "}
        <label>
          y: [<input value={yMin} onChange={(e) => graph.set(ids.yMin, e.target.value)} style={{ font: "inherit", width: "6ch" }} />
          ,{" "}
          <input value={yMax} onChange={(e) => graph.set(ids.yMax, e.target.value)} style={{ font: "inherit", width: "6ch" }} />]
        </label>
      </div>
      {approx.ok ? (
        <p style={{ margin: "0.25rem 0" }}>
          Taylor polynomial: <CopyableTex tex={approx.latex} />
        </p>
      ) : (
        <p style={{ color: "crimson" }}>{approx.message}</p>
      )}
      <canvas ref={canvasRef} width={WIDTH} height={HEIGHT} style={{ border: "1px solid var(--border)" }} />
      <h2>Limit</h2>
      <div style={{ margin: "0.25rem 0" }}>
        <label>
          lim (x →{" "}
          <input value={limitPoint} onChange={(e) => graph.set(ids.limitPoint, e.target.value)} style={{ font: "inherit", width: "6ch" }} />
          {limitDirection === "left" ? "⁻" : limitDirection === "right" ? "⁺" : ""}) f(x) ={" "}
          {limitResult.ok ? limitResult.value.toFixed(6) : <span style={{ color: "crimson" }}>{limitResult.message}</span>}
        </label>{" "}
        <select value={limitDirection} onChange={(e) => graph.set(ids.limitDirection, e.target.value as LimitDirection)}>
          <option value="both">both sides</option>
          <option value="left">from the left</option>
          <option value="right">from the right</option>
        </select>
      </div>
    </div>
  );
}
