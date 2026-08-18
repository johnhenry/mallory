/**
 * URL-state schema for TaylorPanel -- a flat dump of its 8 free string
 * cells (see cell-ids.ts's cellIdsTaylor). Same shape/convention as
 * ode2-state.ts.
 */
export interface TaylorStateV1 {
  v: 1;
  expr: string;
  center: string;
  order: string;
  xMin: string;
  xMax: string;
  yMin: string;
  yMax: string;
  limitPoint: string;
  limitDirection: "left" | "right" | "both";
}

/** One function row (issue #251, unlimited expressions) -- the expr/center/order/limit half of a v1 state, plus color/visibility. The x/y domain is shared across every row (v2's own `viewport`), same "shared viewport, per-row shape" split cellIdsImplicit's doc comment describes. */
export interface TaylorRowState {
  expr: string;
  center: string;
  order: string;
  limitPoint: string;
  limitDirection: "left" | "right" | "both";
  color: number;
  visible: boolean;
}

/** v2 (issue #251): unlimited functions sharing one x/y viewport, same "flat single state -> ordered rows" upgrade graph-state.ts's own v2->v3 migration used. */
export interface TaylorStateV2 {
  v: 2;
  xMin: string;
  xMax: string;
  yMin: string;
  yMax: string;
  rows: TaylorRowState[];
}

export type TaylorState = TaylorStateV2;

const DEFAULT_ROW: TaylorRowState = {
  expr: "sin(x)",
  center: "0",
  order: "3",
  limitPoint: "0",
  limitDirection: "both",
  color: 0x2563eb,
  visible: true,
};

export const DEFAULT_TAYLOR_STATE: TaylorState = {
  v: 2,
  xMin: "-6",
  xMax: "6",
  yMin: "-2",
  yMax: "2",
  rows: [DEFAULT_ROW],
};

function upgradeV1ToV2(v1: TaylorStateV1): TaylorStateV2 {
  return {
    v: 2,
    xMin: v1.xMin,
    xMax: v1.xMax,
    yMin: v1.yMin,
    yMax: v1.yMax,
    rows: [
      {
        expr: v1.expr,
        center: v1.center,
        order: v1.order,
        limitPoint: v1.limitPoint,
        limitDirection: v1.limitDirection,
        color: 0x2563eb,
        visible: true,
      },
    ],
  };
}

export function encodeTaylorState(state: TaylorState): string {
  return base64UrlEncode(JSON.stringify(state));
}

/** Returns null on any malformed/unrecognized fragment rather than throwing. */
export function decodeTaylorState(fragment: string): TaylorState | null {
  try {
    const parsed: unknown = JSON.parse(base64UrlDecode(fragment));
    if (isTaylorStateV2(parsed)) return parsed;
    if (isTaylorStateV1(parsed)) return upgradeV1ToV2(parsed);
    return null;
  } catch {
    return null;
  }
}

const LIMIT_DIRECTIONS = ["left", "right", "both"];

export function isTaylorStateV1(value: unknown): value is TaylorStateV1 {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.v !== 1 || !LIMIT_DIRECTIONS.includes(v.limitDirection as string)) return false;
  const fields = ["expr", "center", "order", "xMin", "xMax", "yMin", "yMax", "limitPoint"] as const;
  return fields.every((f) => typeof v[f] === "string");
}

export function isTaylorStateV2(value: unknown): value is TaylorStateV2 {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.v !== 2 || !Array.isArray(v.rows)) return false;
  if (typeof v.xMin !== "string" || typeof v.xMax !== "string" || typeof v.yMin !== "string" || typeof v.yMax !== "string") return false;
  const fields = ["expr", "center", "order", "limitPoint"] as const;
  return v.rows.every((row) => {
    if (typeof row !== "object" || row === null) return false;
    const r = row as Record<string, unknown>;
    return (
      fields.every((f) => typeof r[f] === "string") &&
      LIMIT_DIRECTIONS.includes(r.limitDirection as string) &&
      typeof r.color === "number" &&
      typeof r.visible === "boolean"
    );
  });
}

function base64UrlEncode(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(input: string): string {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
