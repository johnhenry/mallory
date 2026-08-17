import katex from "katex";
import "katex/dist/katex.min.css";
import { useMemo } from "react";

/** Renders a LaTeX string via KaTeX. `tex` is app-generated (see expr-to-latex.ts), never raw user input. */
export function TexSpan({ tex, className }: { tex: string; className?: string }) {
  // KaTeX's own parse+layout pass is real work (issue #236) -- memoized on
  // `tex` alone so a re-render caused by an unrelated prop/state change
  // elsewhere in the tree (e.g. a sibling's className, or a parent
  // re-rendering for its own reasons) doesn't re-run it when the LaTeX
  // source itself hasn't changed.
  const html = useMemo(() => katex.renderToString(tex, { throwOnError: false }), [tex]);
  // eslint-disable-next-line react/no-danger
  return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}
