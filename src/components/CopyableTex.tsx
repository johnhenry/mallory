import { useState } from "react";
import { TexSpan } from "./TexSpan.tsx";

/**
 * TexSpan plus a small "copy the raw LaTeX source" button -- for a final,
 * useful-to-paste-elsewhere result (a derivative, a closed-form ODE
 * solution), not every intermediate step of a multi-step trace, where a
 * button per line would be visual clutter rather than a utility.
 * Copies `tex` itself (the LaTeX source), not the rendered HTML/plain text,
 * since that's what's actually useful to paste into another LaTeX document.
 */
export function CopyableTex({ tex, className }: { tex: string; className?: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(tex);
      setStatus("copied");
    } catch {
      setStatus("error");
    }
    setTimeout(() => setStatus("idle"), 1500);
  }

  return (
    <span className={className}>
      <TexSpan tex={tex} />{" "}
      <button
        type="button"
        onClick={handleCopy}
        title="Copy LaTeX source"
        aria-label="Copy LaTeX source"
        style={{
          font: "inherit",
          fontSize: "0.72rem",
          padding: "0 0.3rem",
          border: "1px solid #d7dfef",
          borderRadius: "3px",
          background: "transparent",
          color: "var(--muted)",
          cursor: "pointer",
          verticalAlign: "middle",
        }}
      >
        {status === "copied" ? "Copied!" : status === "error" ? "Couldn't copy" : "Copy"}
      </button>
    </span>
  );
}
