import { Symbolic } from "mallory-math";

/**
 * Desmos paste-import (issue #54, deliberately scoped down to "import
 * only" per the issue's own explicit "start with import only" guidance --
 * export and GeoGebra's construction-XML format are out of scope here).
 *
 * Desmos's own copy-paste LaTeX for a graphed expression is either a bare
 * function ("y=\sin\left(x\right)") or a named-function definition
 * ("f\left(x\right)=x^{2}+1"). `Symbolic.fromLatex` parses the WHOLE
 * string as one equation `Expr` (a `cmp`/`eq` node with `left`/`right`
 * children) when given either form as-is, and `Symbolic.toString` on that
 * node doesn't produce plottable source -- this app's expression rows
 * hold only the right-hand side (the implicit "y = " is the row's own
 * label, not part of the stored source). `LEADING_ASSIGNMENT` strips a
 * recognized "y=" / "f(x)=" prefix before parsing, matching what Desmos
 * itself emits; a line that isn't one of those two shapes is parsed as-is
 * (a bare expression with no "=" at all is already exactly what a row
 * needs).
 */
const LEADING_ASSIGNMENT = /^\s*[a-zA-Z]\w*(?:\\left\(.*?\\right\))?\s*=\s*(.+)$/;

export interface DesmosImportRow {
  /** The original pasted line, trimmed -- shown back to the user so a failure is traceable to what they actually typed. */
  line: string;
  /** Plain-syntax expression source (e.g. "sin(x)"), present on success. */
  source?: string;
  /** Parse error message, present on failure. */
  error?: string;
}

/**
 * Parses one line of pasted Desmos LaTeX into this app's plain expression
 * syntax. Never throws -- a parse failure (e.g. `Symbolic.fromLatex`
 * doesn't support implicit multiplication without `\cdot`/explicit
 * adjacency the way Desmos's own renderer does for some inputs) reports
 * as `{ error }`, matching the issue's own "measure how far fromLatex
 * gets" framing rather than requiring 100% coverage.
 */
export function parseDesmosLine(line: string): { source: string } | { error: string } {
  const trimmed = line.trim();
  if (!trimmed) return { error: "Empty line." };
  const match = trimmed.match(LEADING_ASSIGNMENT);
  const rhs = match ? (match[1] as string).trim() : trimmed;
  try {
    return { source: Symbolic.toString(Symbolic.fromLatex(rhs)) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/** Parses a multi-line paste, one `DesmosImportRow` per non-blank input line (blank lines are silently skipped, not reported as errors). */
export function parseDesmosExpressionList(text: string): DesmosImportRow[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const result = parseDesmosLine(line);
      return "source" in result ? { line, source: result.source } : { line, error: result.error };
    });
}
