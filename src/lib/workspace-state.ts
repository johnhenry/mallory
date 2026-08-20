import { decodeStateFragment, encodeStateFragment } from "./url-fragment.ts";
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
  return encodeStateFragment(state);
}

/** Returns null on any malformed/unrecognized fragment rather than throwing. */
export function decodeWorkspaceState(fragment: string): WorkspaceState | null {
  try {
    const parsed: unknown = decodeStateFragment(fragment);
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

