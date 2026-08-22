import { ComplexNumber } from "@johnhenry/math";
import type { Viewport } from "./viewport.ts";

export type ComplexFn = (z: ComplexNumber) => ComplexNumber;

/**
 * Standard "phase portrait" domain coloring: hue = arg(f(z)) (0 at the
 * positive real axis, sweeping counterclockwise through the color wheel),
 * lightness a smooth log-scaled function of |f(z)| centered on |f(z)|=1 --
 * zeros go black, poles go white, the unit-magnitude contour sits at
 * mid-gray. `Math.atan` handles |f(z)|=0 (log -> -Infinity) and diverging
 * poles (log -> +Infinity) correctly without a special case, since
 * `Math.atan(-Infinity)`/`Math.atan(Infinity)` are exactly `∓Math.PI/2` in
 * JS.
 */
export function domainColor(w: ComplexNumber): [number, number, number] {
  const magnitude = w.magnitude();
  if (Number.isNaN(magnitude)) return [128, 128, 128];
  const hue = (((w.angle() % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) * (180 / Math.PI);
  const lightness = 0.5 + Math.atan(Math.log(magnitude)) / Math.PI;
  return hslToRgb(hue, 1, clamp01(lightness));
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hPrime = h / 60;
  const x = c * (1 - Math.abs((hPrime % 2) - 1));
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;
  if (hPrime < 1) [r1, g1, b1] = [c, x, 0];
  else if (hPrime < 2) [r1, g1, b1] = [x, c, 0];
  else if (hPrime < 3) [r1, g1, b1] = [0, c, x];
  else if (hPrime < 4) [r1, g1, b1] = [0, x, c];
  else if (hPrime < 5) [r1, g1, b1] = [x, 0, c];
  else [r1, g1, b1] = [c, 0, x];
  const m = l - c / 2;
  return [Math.round((r1 + m) * 255), Math.round((g1 + m) * 255), Math.round((b1 + m) * 255)];
}

/**
 * Renders a domain-coloring raster of `f` over `viewport` directly into
 * `ctx` via `ImageData` -- the one place in this codebase where a per-pixel
 * raster fits better than the `render-path.ts` Path2D vector drawers,
 * since a stroke/fill call has no way to express "every pixel gets its own
 * independently-computed color". A point where `f` throws (e.g. a genuine
 * pole where the underlying `ComplexNumber` op is undefined) is left
 * mid-gray rather than aborting the whole raster.
 */
export function renderDomainColoring(ctx: CanvasRenderingContext2D, width: number, height: number, viewport: Viewport, f: ComplexFn): void {
  const image = ctx.createImageData(width, height);
  const { xMin, xMax, yMin, yMax } = viewport;
  for (let py = 0; py < height; py++) {
    const y = yMax - ((py + 0.5) / height) * (yMax - yMin);
    for (let px = 0; px < width; px++) {
      const x = xMin + ((px + 0.5) / width) * (xMax - xMin);
      const idx = (py * width + px) * 4;
      let rgb: [number, number, number] = [128, 128, 128];
      try {
        rgb = domainColor(f(new ComplexNumber(x, y)));
      } catch {
        // leave mid-gray -- f is undefined/singular at this point
      }
      image.data[idx] = rgb[0];
      image.data[idx + 1] = rgb[1];
      image.data[idx + 2] = rgb[2];
      image.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}
