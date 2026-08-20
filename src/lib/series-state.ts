import { decodeStateFragment, encodeStateFragment } from "./url-fragment.ts";
/**
 * URL-state schema for SeriesPanel -- a flat dump of its free string cells
 * (see cell-ids.ts's cellIdsSeries). Same shape/convention as
 * taylor-state.ts. `toN` accepts the literal string "Infinity" --
 * `Number("Infinity")` is exactly `Infinity` in JS, matching
 * `Symbolic.sumSeries`'s own `to: number` parameter for an infinite series.
 */
export interface SeriesStateV1 {
  v: 1;
  exprText: string;
  variable: string;
  fromN: string;
  toN: string;
  plotCount: string;
}

/** One series row (issue #251, unlimited expressions) -- the exact shape of a v1 state, plus color/visibility. The viewport (unlike Taylor/Ode2's xMin/xMax/yMin/yMax) was never part of this schema -- it's an auto-fit, purely-auxiliary cell (see SeriesPanel.tsx's own doc comment), so v2 doesn't add a shared-viewport field either. */
export interface SeriesRowState {
  exprText: string;
  variable: string;
  fromN: string;
  toN: string;
  plotCount: string;
  color: number;
  visible: boolean;
}

/** v2 (issue #251): unlimited series, same "flat single state -> ordered rows" upgrade graph-state.ts's own v2->v3 migration used. */
export interface SeriesStateV2 {
  v: 2;
  rows: SeriesRowState[];
}

export type SeriesState = SeriesStateV2;

const DEFAULT_ROW: SeriesRowState = {
  exprText: "1/n^2",
  variable: "n",
  fromN: "1",
  toN: "Infinity",
  plotCount: "30",
  color: 0x2563eb,
  visible: true,
};

export const DEFAULT_SERIES_STATE: SeriesState = {
  v: 2,
  rows: [DEFAULT_ROW],
};

function upgradeV1ToV2(v1: SeriesStateV1): SeriesStateV2 {
  return {
    v: 2,
    rows: [
      {
        exprText: v1.exprText,
        variable: v1.variable,
        fromN: v1.fromN,
        toN: v1.toN,
        plotCount: v1.plotCount,
        color: 0x2563eb,
        visible: true,
      },
    ],
  };
}

export function encodeSeriesState(state: SeriesState): string {
  return encodeStateFragment(state);
}

/** Returns null on any malformed/unrecognized fragment rather than throwing. */
export function decodeSeriesState(fragment: string): SeriesState | null {
  try {
    const parsed: unknown = decodeStateFragment(fragment);
    if (isSeriesStateV2(parsed)) return parsed;
    if (isSeriesStateV1(parsed)) return upgradeV1ToV2(parsed);
    return null;
  } catch {
    return null;
  }
}

export function isSeriesStateV1(value: unknown): value is SeriesStateV1 {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.v !== 1) return false;
  const fields = ["exprText", "variable", "fromN", "toN", "plotCount"] as const;
  return fields.every((f) => typeof v[f] === "string");
}

export function isSeriesStateV2(value: unknown): value is SeriesStateV2 {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.v !== 2 || !Array.isArray(v.rows)) return false;
  const fields = ["exprText", "variable", "fromN", "toN", "plotCount"] as const;
  return v.rows.every((row) => {
    if (typeof row !== "object" || row === null) return false;
    const r = row as Record<string, unknown>;
    return fields.every((f) => typeof r[f] === "string") && typeof r.color === "number" && typeof r.visible === "boolean";
  });
}

