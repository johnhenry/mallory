import { useState } from "react";
import { downloadSvg, svgExportFilename } from "../lib/svg-export.ts";

/** A "Download SVG" button, parallel to `PngExportButton` -- see svg-export.ts's own doc comment for what's included in v1. `getSvg` returns null when there's nothing exportable yet (e.g. a mode with no `Path2D` output). */
export function SvgExportButton({ getSvg, label }: { getSvg: () => string | null; label: string }) {
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    const svg = getSvg();
    if (!svg) {
      setError("Nothing to export yet.");
      return;
    }
    try {
      downloadSvg(svg, svgExportFilename(label));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <span>
      <button type="button" onClick={handleClick}>
        Download SVG
      </button>
      {error && <span style={{ color: "var(--danger)", marginLeft: "0.5rem" }}>{error}</span>}
    </span>
  );
}
