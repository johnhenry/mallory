import { useState } from "react";
import { downloadCanvasPng, downloadCanvasPngAtScale, pngExportFilename } from "../lib/canvas-export.ts";

export interface PngExportButtonProps {
  getCanvas: () => HTMLCanvasElement | null;
  label: string;
  /**
   * A pure `(ctx, width, height)` re-render of this panel's own canvas
   * content (issue #45's remaining scope, item 2: "2x-scale crisp PNG").
   * When provided, a second "Download PNG (2x)" button renders it against
   * a fresh `baseWidth*2 x baseHeight*2` offscreen canvas instead of
   * upscaling the on-screen raster -- see `downloadCanvasPngAtScale`'s own
   * doc comment. Optional and backward-compatible: every existing caller
   * that doesn't pass this keeps its single "Download PNG" button exactly
   * as before.
   */
  renderAtScale?: (ctx: CanvasRenderingContext2D, width: number, height: number) => void;
  baseWidth?: number;
  baseHeight?: number;
}

/** A "Download PNG" button for any panel's canvas -- see canvas-export.ts's own doc comment for the export mechanism and its current v1 limits. */
export function PngExportButton({ getCanvas, label, renderAtScale, baseWidth, baseHeight }: PngExportButtonProps) {
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

  async function handle2xClick() {
    setError(null);
    if (!renderAtScale || !baseWidth || !baseHeight) return;
    try {
      await downloadCanvasPngAtScale(baseWidth, baseHeight, 2, renderAtScale, pngExportFilename(`${label}-2x`));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <span>
      <button type="button" onClick={handleClick}>
        Download PNG
      </button>
      {renderAtScale && baseWidth && baseHeight && (
        <button type="button" onClick={handle2xClick} style={{ marginLeft: "0.5rem" }}>
          Download PNG (2x)
        </button>
      )}
      {error && <span style={{ color: "var(--danger)", marginLeft: "0.5rem" }}>{error}</span>}
    </span>
  );
}
