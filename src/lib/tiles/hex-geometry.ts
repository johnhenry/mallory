/**
 * Pixel geometry for rendering hex-tile-model.ts's axial-coordinate grid
 * on a canvas -- separate from the combinatorial model (mallory-math's own
 * "kept purely combinatorial... independent of any pixel geometry" framing
 * for Lattice.ts applies here too). Standard pointy-top hex-grid formulas
 * (Red Blob Games' well-known reference derivation), chosen because
 * mallory-math's own `HEX_AXIAL_DIRECTIONS` offsets are exactly the
 * pointy-top convention -- verified before writing this: direction 0 (E)
 * is pure +x, 3 (W) is pure -x, and 1/2/4/5 (NE/NW/SW/SE) each have both a
 * nonzero x and y component, with the correct sign for their compass name,
 * under this exact center formula.
 */
export interface Point {
  x: number;
  y: number;
}

/** Pixel center of the hex cell at axial `(q, r)`, for a hex of circumradius `size`. */
export function hexCenter(q: number, r: number, size: number): Point {
  return {
    x: size * (Math.sqrt(3) * q + (Math.sqrt(3) / 2) * r),
    y: size * 1.5 * r,
  };
}

/** The 6 corner points of a regular hexagon centered at `(cx, cy)` with circumradius `size`, pointy-top orientation (a vertex at the top, not a flat edge). */
export function hexCorners(cx: number, cy: number, size: number): Point[] {
  const corners: Point[] = [];
  for (let i = 0; i < 6; i++) {
    const angleDeg = 60 * i - 30;
    const angleRad = (Math.PI / 180) * angleDeg;
    corners.push({ x: cx + size * Math.cos(angleRad), y: cy + size * Math.sin(angleRad) });
  }
  return corners;
}
