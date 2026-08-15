/**
 * URL-state schema for the `/workspace` inspector page (issue #42) -- a
 * bare, variable-length list of named workspace variables. Unlike every
 * other `*-state.ts` file in this codebase (a fixed set of named fields,
 * e.g. `vector-field-3d-state.ts`'s `exprDx`/`exprDy`/...), this file's
 * root shape IS the variable-length array -- the closest existing
 * precedent is a notebook document's `{type:"value", name, value}` blocks
 * (one `{name,value}` pair per block, `NotebookStateV1.blocks` the
 * variable-length container), generalized here to a document with nothing
 * BUT that shape.
 */
export interface WorkspaceStateV1 {
  v: 1;
  variables: Array<{ name: string; value: number }>;
}

export type WorkspaceState = WorkspaceStateV1;

export const DEFAULT_WORKSPACE_STATE: WorkspaceState = { v: 1, variables: [] };

export function encodeWorkspaceState(state: WorkspaceState): string {
  return base64UrlEncode(JSON.stringify(state));
}

/** Returns null on any malformed/unrecognized fragment rather than throwing. */
export function decodeWorkspaceState(fragment: string): WorkspaceState | null {
  try {
    const parsed: unknown = JSON.parse(base64UrlDecode(fragment));
    return isWorkspaceStateV1(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function isWorkspaceStateV1(value: unknown): value is WorkspaceStateV1 {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.v !== 1 || !Array.isArray(v.variables)) return false;
  return v.variables.every((entry) => {
    if (typeof entry !== "object" || entry === null) return false;
    const e = entry as Record<string, unknown>;
    return typeof e.name === "string" && e.name.length > 0 && typeof e.value === "number";
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
