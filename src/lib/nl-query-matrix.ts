import { DEFAULT_MATRIX_STATE, encodeMatrixState, type MatrixState } from "./matrix-state.ts";

/**
 * State-prefilled navigation for matrix-literal chat phrasings (issue #46's
 * own remaining-scope item: "eigenvalues of [[1,2],[3,4]]" / "invert ..."
 * -> linear algebra panel, needing its own parser/pattern table since the
 * input is a matrix literal, not an expression string -- `nl-query.ts`'s
 * `PATTERNS` contract doesn't fit). Separate module from `nav-sections.ts`
 * for the same reason: `resolveNavigationCommand` there only ever
 * produces a bare path (issue #46's "State-prefilled navigation" was
 * explicitly unstarted), while this resolver's whole point is producing a
 * path *plus* a URL hash MatrixPanel's own `decodeMatrixState` will read
 * on mount -- a `{to, search, hash}` object matching what TanStack
 * Router's `navigate()` accepts directly, not a bare string.
 *
 * MatrixPanel always computes determinant, inverse, RREF, and every
 * decomposition (including eigenvalues) together for whatever matrix is
 * entered -- see MatrixPanel.tsx -- so there's no separate "mode" to
 * select; every verb below lands on the same tab with the parsed matrix
 * prefilled, and the panel shows all of them at once.
 *
 * Scope note: only literal-bearing phrasings ("eigenvalues of [[...]]")
 * are handled. The issue's own second example, "invert this matrix" (no
 * literal, implicitly referring to whatever's already entered somewhere),
 * needs a notion of "the current matrix in view" this stateless resolver
 * has no access to -- left as further remaining scope, not attempted here.
 */
export interface MatrixNavigationCommand {
  to: string;
  search: { tab: string };
  hash: string;
}

const VERB_PATTERN = /^(?:eigenvalues?\s+of|invert|inverse\s+of|determinant\s+of|det\s+of)\s+(\[.+\])\s*$/i;

export function resolveMatrixNavigationCommand(input: string): MatrixNavigationCommand | null {
  const match = input.trim().match(VERB_PATTERN);
  if (!match) return null;
  const matrixText = parseMatrixLiteral(match[1] as string);
  if (matrixText === null) return null;
  const state: MatrixState = { ...DEFAULT_MATRIX_STATE, matrixText };
  return { to: "/data", search: { tab: "matrix" }, hash: encodeMatrixState(state) };
}

/**
 * Parses a "[[1,2],[3,4]]" bracket literal into MatrixPanel's own
 * comma-and-newline `matrixText` format ("1, 2\n3, 4") -- the exact
 * textarea shape `parseMatrixText` (MatrixPanel.tsx) already reads.
 * Returns null on anything that isn't valid JSON, isn't a non-empty
 * rectangular array of arrays, or contains a non-finite entry, rather
 * than producing a malformed matrixText MatrixPanel would then fail to
 * parse a second time.
 */
function parseMatrixLiteral(literal: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(literal);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return null;
  const width = Array.isArray(parsed[0]) ? parsed[0].length : -1;
  if (width <= 0) return null;
  const rows: number[][] = [];
  for (const row of parsed) {
    if (!Array.isArray(row) || row.length !== width) return null;
    const numericRow: number[] = [];
    for (const cell of row) {
      // No finiteness check needed: JSON.parse can never produce Infinity/NaN
      // (neither is valid JSON syntax), so every `number`-typed cell here is
      // already finite by construction.
      if (typeof cell !== "number") return null;
      numericRow.push(cell);
    }
    rows.push(numericRow);
  }
  return rows.map((r) => r.join(", ")).join("\n");
}
