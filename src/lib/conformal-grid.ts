import { ComplexNumber } from "mallory-math";
import type { Viewport } from "./viewport.ts";

export type ComplexFn = (z: ComplexNumber) => ComplexNumber;

const SAMPLES_PER_LINE = 60;

/**
 * A rectangular grid of z-plane lines (constant-Re verticals, constant-Im
 * horizontals) spanning `viewport` at `spacing` intervals -- the standard
 * grid a conformal map's image is judged against.
 */
export function rectangularGridLines(viewport: Viewport, spacing: number): ComplexNumber[][] {
  if (spacing <= 0) throw new Error(`spacing must be positive -- got ${spacing}.`);
  const lines: ComplexNumber[][] = [];
  const { xMin, xMax, yMin, yMax } = viewport;
  for (let x = Math.ceil(xMin / spacing) * spacing; x <= xMax + 1e-9; x += spacing) {
    const line: ComplexNumber[] = [];
    for (let i = 0; i <= SAMPLES_PER_LINE; i++) {
      const y = yMin + (i / SAMPLES_PER_LINE) * (yMax - yMin);
      line.push(new ComplexNumber(x, y));
    }
    lines.push(line);
  }
  for (let y = Math.ceil(yMin / spacing) * spacing; y <= yMax + 1e-9; y += spacing) {
    const line: ComplexNumber[] = [];
    for (let i = 0; i <= SAMPLES_PER_LINE; i++) {
      const x = xMin + (i / SAMPLES_PER_LINE) * (xMax - xMin);
      line.push(new ComplexNumber(x, y));
    }
    lines.push(line);
  }
  return lines;
}

/**
 * A polar grid: circles of constant |z| and rays of constant arg(z) -- the
 * natural grid for functions like z^n or 1/z, whose behavior reads most
 * clearly in polar form.
 */
export function polarGridLines(maxRadius: number, radialSpacing: number, angularCount: number): ComplexNumber[][] {
  if (maxRadius <= 0) throw new Error(`maxRadius must be positive -- got ${maxRadius}.`);
  if (radialSpacing <= 0) throw new Error(`radialSpacing must be positive -- got ${radialSpacing}.`);
  if (!Number.isInteger(angularCount) || angularCount < 1) throw new Error(`angularCount must be a positive integer -- got ${angularCount}.`);
  const lines: ComplexNumber[][] = [];
  for (let r = radialSpacing; r <= maxRadius + 1e-9; r += radialSpacing) {
    const line: ComplexNumber[] = [];
    for (let i = 0; i <= SAMPLES_PER_LINE; i++) {
      const theta = (i / SAMPLES_PER_LINE) * 2 * Math.PI;
      line.push(ComplexNumber.fromPolar(r, theta));
    }
    lines.push(line);
  }
  for (let k = 0; k < angularCount; k++) {
    const theta = (k / angularCount) * 2 * Math.PI;
    const line: ComplexNumber[] = [];
    for (let i = 0; i <= SAMPLES_PER_LINE; i++) {
      const r = (i / SAMPLES_PER_LINE) * maxRadius;
      line.push(ComplexNumber.fromPolar(r, theta));
    }
    lines.push(line);
  }
  return lines;
}

export type MappedLine = Array<{ x: number; y: number }>;

/**
 * Maps each grid line through `f`, breaking a line into separate polylines
 * at any point where `f` throws or produces a non-finite value -- the same
 * gap-tolerant approach as `sampleExpr`'s real-valued sampling, since a
 * conformal map can have genuine poles inside an otherwise-plottable grid.
 * A run of fewer than 2 points can't be drawn as a line and is dropped.
 */
export function mapGridLines(lines: ComplexNumber[][], f: ComplexFn): MappedLine[] {
  const mapped: MappedLine[] = [];
  for (const line of lines) {
    let current: MappedLine = [];
    for (const z of line) {
      let w: ComplexNumber | null = null;
      try {
        w = f(z);
      } catch {
        w = null;
      }
      if (!w || !Number.isFinite(w.value) || !Number.isFinite(w.iValue)) {
        if (current.length > 1) mapped.push(current);
        current = [];
        continue;
      }
      current.push({ x: w.value, y: w.iValue });
    }
    if (current.length > 1) mapped.push(current);
  }
  return mapped;
}

/**
 * A square viewport tightly bounding `lines`' points plus `paddingFraction`
 * of slack on each side -- a conformal map can scale the grid by an
 * arbitrary, expression-dependent factor (z^3 on a small grid can map well
 * outside it), so the w-plane view needs its own auto-fit window rather than
 * reusing the z-plane's fixed viewport. Falls back to `fallback` when there
 * are no finite points to fit (every line was empty or entirely singular).
 */
export function autoFitViewport(lines: MappedLine[], fallback: Viewport, paddingFraction = 0.1): Viewport {
  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const line of lines) {
    for (const p of line) {
      if (p.x < xMin) xMin = p.x;
      if (p.x > xMax) xMax = p.x;
      if (p.y < yMin) yMin = p.y;
      if (p.y > yMax) yMax = p.y;
    }
  }
  if (!Number.isFinite(xMin) || !Number.isFinite(xMax) || !Number.isFinite(yMin) || !Number.isFinite(yMax)) return fallback;
  // A square window centered on the data's own center, sized to the larger
  // of the two spans -- keeps the w-plane's aspect ratio undistorted rather
  // than stretching x and y independently.
  const cx = (xMin + xMax) / 2;
  const cy = (yMin + yMax) / 2;
  const halfSpan = Math.max(xMax - xMin, yMax - yMin, 1e-6) / 2;
  const padded = halfSpan * (1 + paddingFraction);
  return { xMin: cx - padded, xMax: cx + padded, yMin: cy - padded, yMax: cy + padded };
}
