/**
 * URL-state schema for GraphCanvasMulti, parallel to graph-state.ts's
 * single-pane schema (not layered onto its V1-V4 lineage, since the shape
 * is genuinely different -- a row here has no structureModulus/point-mode,
 * and gains color/visible instead). Same base64url-in-the-hash convention:
 * no server round-trip, Desmos-style.
 */
export interface MultiGraphAnnotation {
  id: string;
  x: number;
  y: number;
  label: string;
}

export interface MultiGraphStateV1 {
  v: 1;
  rows: Array<{ source: string; color: number; visible: boolean; params: Record<string, number> }>;
  viewport: { xMin: number; xMax: number; yMin: number; yMax: number };
  /** Optional so a fragment encoded before annotations existed still decodes -- treated as []. */
  annotations?: MultiGraphAnnotation[];
  /** Optional so a fragment encoded before exact-mode existed still decodes -- treated as "float" (issue #51). */
  mode?: "float" | "exact";
}

export type MultiGraphState = MultiGraphStateV1;

export const DEFAULT_MULTI_GRAPH_STATE: MultiGraphState = {
  v: 1,
  rows: [
    { source: "sin(x)", color: 0x2563eb, visible: true, params: {} },
    { source: "cos(x)", color: 0xdc2626, visible: true, params: {} },
  ],
  viewport: { xMin: -10, xMax: 10, yMin: -10, yMax: 10 },
  annotations: [],
  mode: "float",
};

export function encodeMultiGraphState(state: MultiGraphState): string {
  return base64UrlEncode(JSON.stringify(state));
}

/** Returns null on any malformed/unrecognized fragment rather than throwing. */
export function decodeMultiGraphState(fragment: string): MultiGraphState | null {
  try {
    const parsed: unknown = JSON.parse(base64UrlDecode(fragment));
    return isMultiGraphStateV1(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isMultiGraphStateV1(value: unknown): value is MultiGraphStateV1 {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.v !== 1 || typeof v.viewport !== "object" || v.viewport === null || !Array.isArray(v.rows)) return false;
  if (v.annotations !== undefined && !Array.isArray(v.annotations)) return false;
  if (v.mode !== undefined && v.mode !== "float" && v.mode !== "exact") return false;
  const annotationsValid = (v.annotations as unknown[] | undefined ?? []).every((a) => {
    if (typeof a !== "object" || a === null) return false;
    const note = a as Record<string, unknown>;
    return (
      typeof note.id === "string" && typeof note.x === "number" && typeof note.y === "number" && typeof note.label === "string"
    );
  });
  if (!annotationsValid) return false;
  return v.rows.every((r) => {
    if (typeof r !== "object" || r === null) return false;
    const row = r as Record<string, unknown>;
    return (
      typeof row.source === "string" &&
      typeof row.color === "number" &&
      typeof row.visible === "boolean" &&
      typeof row.params === "object" &&
      row.params !== null
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
