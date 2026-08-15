import { Symbolic } from "mallory-math";
import { exprToLatex } from "./expr-to-latex.ts";
import { preprocessImplicitMultiplication } from "./implicit-mult.ts";
import type { NotebookState } from "./notebook-state.ts";

/** PNG data URIs for "graph" blocks, keyed by the block's index in `state.blocks` -- absent for a graph block whose canvas couldn't be captured (e.g. not yet mounted), which falls back to a text-only row list. */
export type NotebookGraphImages = Map<number, string>;

const UNSUPPORTED_BLOCK_LABELS: Record<string, string> = {
  surface3d: "3D surface",
  ode: "ODE",
  "ode-system": "ODE system",
  regression: "regression",
  statistics: "statistics",
  systems: "linear system",
  geometry: "geometry",
  tensor: "tensor",
};

/**
 * Renders a notebook document to a single self-contained Markdown string
 * (issue #45 item 4): text blocks pass through verbatim, value blocks
 * become inline math, graph blocks embed their PNG still as a base64 data
 * URI (no separate asset files to manage -- matches this app's own
 * Desmos-style "everything in one URL" convention elsewhere) plus a
 * caption listing each row's expression. Block types outside the issue's
 * stated scope (surface3d/ode/regression/etc.) render as an explicit
 * placeholder rather than silently vanishing -- see UNSUPPORTED_BLOCK_LABELS.
 */
export function notebookToMarkdown(state: NotebookState, images: NotebookGraphImages): string {
  return state.blocks
    .map((block, i) => {
      if (block.type === "text") return block.content;
      if (block.type === "value") return `$${block.name} = ${block.value}$`;
      if (block.type === "graph") {
        const image = images.get(i);
        const rows = block.rows.map((r) => `- $y = ${r.source}$`).join("\n");
        return image ? `![graph block ${i}](${image})\n\n${rows}` : rows;
      }
      return `_[${UNSUPPORTED_BLOCK_LABELS[block.type] ?? block.type} block omitted -- not yet supported by notebook export]_`;
    })
    .join("\n\n");
}

/**
 * Renders a notebook document to a LaTeX fragment (issue #45 item 4, the
 * ".tex flavor"). Raster image embedding has no data-URI equivalent in
 * plain LaTeX (`\includegraphics` needs a real file on disk), so graph
 * blocks render as `\[ y = ... \]` display-math lines per row instead of an
 * image -- genuinely useful on its own (nicely typeset equations), a
 * deliberately different tradeoff from the Markdown flavor rather than a
 * lesser one.
 */
export function notebookToLatex(state: NotebookState): string {
  return state.blocks
    .map((block) => {
      if (block.type === "text") return block.content;
      if (block.type === "value") return `\\[ ${block.name} = ${block.value} \\]`;
      if (block.type === "graph") {
        return block.rows.map((r) => `\\[ y = ${exprToLatexSource(r.source)} \\]`).join("\n");
      }
      return `% [${UNSUPPORTED_BLOCK_LABELS[block.type] ?? block.type} block omitted -- not yet supported by notebook export]`;
    })
    .join("\n\n");
}

/** Best-effort expr-source -> LaTeX; falls back to the raw source (still valid inside `\[ \]`, just not prettified) on a mid-typing parse error. */
function exprToLatexSource(source: string): string {
  try {
    return exprToLatex(Symbolic.parse(preprocessImplicitMultiplication(source)));
  } catch {
    return source;
  }
}
