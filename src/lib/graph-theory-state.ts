/**
 * URL-state schema for GraphTheoryPanel -- the raw inputs only (see
 * cell-ids.ts's cellIdsGraphTheory); every result cell is purely derived.
 */
export interface GraphTheoryStateV1 {
  v: 1;
  edgeListText: string;
  directed: boolean;
  startVertex: string;
  endVertex: string;
  algorithm: string;
  /**
   * Interactive editor (issue #24's remaining scope, item 1) -- optional,
   * same reasoning as every other panel's incrementally-added field: an old
   * encoded URL hash from before this existed still decodes. Vertex
   * POSITIONS are deliberately NOT part of this schema (ephemeral, see
   * cellIdsGraphTheory's own doc comment) -- only the toggle and the
   * default weight applied to the next drag-created edge.
   */
  showEditor?: boolean;
  edgeWeight?: string;
}

export type GraphTheoryState = GraphTheoryStateV1;

export const DEFAULT_GRAPH_THEORY_STATE: GraphTheoryState = {
  v: 1,
  edgeListText: "A B 4\nA C 2\nC B 1\nB D 5\nC D 8\nC E 10\nD E 2\nD F 6\nE F 3",
  directed: false,
  startVertex: "A",
  endVertex: "F",
  algorithm: "bfs",
  showEditor: false,
  edgeWeight: "1",
};

export function encodeGraphTheoryState(state: GraphTheoryState): string {
  return base64UrlEncode(JSON.stringify(state));
}

/** Returns null on any malformed/unrecognized fragment rather than throwing. */
export function decodeGraphTheoryState(fragment: string): GraphTheoryState | null {
  try {
    const parsed: unknown = JSON.parse(base64UrlDecode(fragment));
    return isGraphTheoryStateV1(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function isGraphTheoryStateV1(value: unknown): value is GraphTheoryStateV1 {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.v !== 1 || typeof v.directed !== "boolean") return false;
  if (v.showEditor !== undefined && typeof v.showEditor !== "boolean") return false;
  if (v.edgeWeight !== undefined && typeof v.edgeWeight !== "string") return false;
  const fields = ["edgeListText", "startVertex", "endVertex", "algorithm"] as const;
  return fields.every((f) => typeof v[f] === "string");
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
