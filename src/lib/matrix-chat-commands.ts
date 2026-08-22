/**
 * Contextual chat commands for MatrixPanel (issue #46's remaining scope,
 * item 1: "invert this matrix" -- no literal, referring to whatever's
 * already entered). `nl-query-matrix.ts`'s `resolveMatrixNavigationCommand`
 * handles the LITERAL-bearing phrasing ("eigenvalues of [[1,2],[3,4]]",
 * checked from a different panel's chat box, navigating here with the
 * matrix prefilled); this module is MatrixPanel's own first chat-command
 * surface (chat-commands.ts's conversational co-editing layer is tightly
 * coupled to GraphCanvas's `CellIds`/keyframe shape and has no notion of
 * "the matrix currently in this panel" at all), so it's a small,
 * panel-local pattern table in the same spirit rather than a forced
 * extension of that unrelated contract.
 *
 * Since every decomposition is already computed together and always
 * visible on the page (MatrixPanel's own established "no separate mode
 * needed" design), a contextual command's only job is to surface an
 * already-computed value back through the chat log -- useful when the
 * result the user's asking about is scrolled out of view.
 */
import type { CellGraph } from "@johnhenry/math";
import type { CellIdsMatrix } from "./cell-ids.ts";
import type { DecompositionSet, Mat } from "./matrix-ops.ts";

export interface MatrixChatCommandContext {
  graph: CellGraph;
  ids: CellIdsMatrix;
}

export interface MatrixChatCommandResult {
  ok: boolean;
  message: string;
}

type Result<T> = { ok: true; value: T } | { ok: false; message: string };

function formatMatrix(m: Mat): string {
  return m.map((row) => `[${row.map((v) => (Number.isFinite(v) ? v.toFixed(4) : String(v))).join(", ")}]`).join(" ");
}

interface CommandPattern {
  regex: RegExp;
  handle: (ctx: MatrixChatCommandContext) => MatrixChatCommandResult;
}

const PATTERNS: CommandPattern[] = [
  {
    regex: /^\s*(?:invert|inverse of)\s+(?:this|the)\s+matrix\s*$/i,
    handle: (ctx) => {
      const inverse = ctx.graph.get<Result<Mat>>(ctx.ids.inverse);
      return inverse.ok ? { ok: true, message: `Inverse: ${formatMatrix(inverse.value)}` } : { ok: false, message: inverse.message };
    },
  },
  {
    regex: /^\s*determinant of\s+(?:this|the)\s+matrix\s*$/i,
    handle: (ctx) => {
      const det = ctx.graph.get<Result<number>>(ctx.ids.determinant);
      return det.ok ? { ok: true, message: `Determinant: ${det.value.toFixed(4)}` } : { ok: false, message: det.message };
    },
  },
  {
    regex: /^\s*eigenvalues?\s+of\s+(?:this|the)\s+matrix\s*$/i,
    handle: (ctx) => {
      const decompositions = ctx.graph.get<Result<DecompositionSet>>(ctx.ids.decompositions);
      if (!decompositions.ok) return { ok: false, message: decompositions.message };
      const eig = decompositions.value.eigenSymmetric;
      if (!eig) return { ok: false, message: "Eigenvalues are only computed for a symmetric matrix -- this one isn't symmetric." };
      return { ok: true, message: `Eigenvalues: ${[...eig.values].map((v) => v.toFixed(4)).join(", ")}` };
    },
  },
];

/** Resolves a chat message to a MatrixPanel query, or null if `input` doesn't match any known contextual phrasing. */
export function resolveMatrixChatCommand(input: string, ctx: MatrixChatCommandContext): MatrixChatCommandResult | null {
  for (const { regex, handle } of PATTERNS) {
    if (!regex.test(input)) continue;
    try {
      return handle(ctx);
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  }
  return null;
}
