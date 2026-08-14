import { useState } from "react";
import { downloadCanvasPng, pngExportFilename } from "../lib/canvas-export.ts";

/** A "Download PNG" button for any panel's canvas -- see canvas-export.ts's own doc comment for the export mechanism and its current v1 limits. */
export function PngExportButton({ getCanvas, label }: { getCanvas: () => HTMLCanvasElement | null; label: string }) {
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setError(null);
    const canvas = getCanvas();
    if (!canvas) {
      setError("Nothing to export yet.");
      return;
    }
    try {
      await downloadCanvasPng(canvas, pngExportFilename(label));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <span>
      <button type="button" onClick={handleClick}>
        Download PNG
      </button>
      {error && <span style={{ color: "crimson", marginLeft: "0.5rem" }}>{error}</span>}
    </span>
  );
}
