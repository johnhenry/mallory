export interface Point2D {
  x: number;
  y: number;
}

/**
 * Interior angle at `vertex` between rays to `a` and `c`, in radians,
 * always in [0, PI] (the non-reflex angle) -- the standard "angle ABC"
 * convention where B is the vertex.
 */
export function interiorAngleRadians(a: Point2D, vertex: Point2D, c: Point2D): number {
  const v1 = Math.atan2(a.y - vertex.y, a.x - vertex.x);
  const v2 = Math.atan2(c.y - vertex.y, c.x - vertex.x);
  let diff = Math.abs(v2 - v1);
  if (diff > Math.PI) diff = 2 * Math.PI - diff;
  return diff;
}

/** Shoelace formula: area of a simple (non-self-intersecting) polygon given its vertices in order. */
export function shoelaceArea(points: Point2D[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const p1 = points[i] as Point2D;
    const p2 = points[(i + 1) % points.length] as Point2D;
    sum += p1.x * p2.y - p2.x * p1.y;
  }
  return Math.abs(sum) / 2;
}

// Orientation of the ordered triplet (p, q, r): 0 = collinear, 1 = clockwise,
// 2 = counterclockwise -- the standard cross-product sign test used by the
// canonical segment-intersection algorithm below.
function orientation(p: Point2D, q: Point2D, r: Point2D): 0 | 1 | 2 {
  const val = (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y);
  if (Math.abs(val) < 1e-12) return 0;
  return val > 0 ? 1 : 2;
}

/** Whether `q` (known collinear with segment `p`-`r`) lies within that segment's bounding box. */
function onSegment(p: Point2D, q: Point2D, r: Point2D): boolean {
  return (
    q.x <= Math.max(p.x, r.x) && q.x >= Math.min(p.x, r.x) && q.y <= Math.max(p.y, r.y) && q.y >= Math.min(p.y, r.y)
  );
}

/** Whether closed segments p1-p2 and p3-p4 intersect (the canonical orientation-based test, including collinear-overlap cases). */
function segmentsIntersect(p1: Point2D, p2: Point2D, p3: Point2D, p4: Point2D): boolean {
  const o1 = orientation(p1, p2, p3);
  const o2 = orientation(p1, p2, p4);
  const o3 = orientation(p3, p4, p1);
  const o4 = orientation(p3, p4, p2);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(p1, p3, p2)) return true;
  if (o2 === 0 && onSegment(p1, p4, p2)) return true;
  if (o3 === 0 && onSegment(p3, p1, p4)) return true;
  if (o4 === 0 && onSegment(p3, p2, p4)) return true;
  return false;
}

/**
 * Whether the closed polygon through `points` (in order, wrapping back to
 * the first) self-intersects: any two NON-adjacent edges cross. Adjacent
 * edges (consecutive, or the wrap-around last edge with the first) share an
 * endpoint by construction and are excluded -- that shared vertex is normal,
 * not an intersection. O(n^2) over edge pairs, entirely fine at the scale a
 * hand-constructed polygon reaches. A triangle (or fewer vertices) has no
 * non-adjacent edge pairs at all, so it's never self-intersecting.
 */
export function isSelfIntersecting(points: Point2D[]): boolean {
  const n = points.length;
  if (n < 4) return false;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      // Edge i is (points[i], points[(i+1)%n]); edges are adjacent when
      // consecutive (j === i+1) or when i=0 pairs with the wrap-around
      // closing edge j = n-1 (they share the first vertex).
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      const a1 = points[i] as Point2D;
      const a2 = points[(i + 1) % n] as Point2D;
      const b1 = points[j] as Point2D;
      const b2 = points[(j + 1) % n] as Point2D;
      if (segmentsIntersect(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

/**
 * Centroid (center of mass) of a simple polygon via the standard
 * signed-area-weighted formula -- NOT the plain vertex average, which is
 * only correct for special cases like regular polygons:
 *
 *   Cx = (1/6A) * SUM (x_i + x_{i+1}) * (x_i*y_{i+1} - x_{i+1}*y_i)
 *   Cy = (1/6A) * SUM (y_i + y_{i+1}) * (x_i*y_{i+1} - x_{i+1}*y_i)
 *
 * where A is the SIGNED shoelace area (winding-order dependent -- the sign
 * cancels between numerator and denominator, so either winding works).
 * Degenerate case: a near-zero signed area (collinear/collapsed polygon)
 * would divide by ~0, so fall back to the plain vertex average there --
 * for a collapsed polygon that's as good a "center" as any.
 */
export function polygonCentroid(points: Point2D[]): Point2D {
  let signedAreaTwice = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < points.length; i++) {
    const p1 = points[i] as Point2D;
    const p2 = points[(i + 1) % points.length] as Point2D;
    const cross = p1.x * p2.y - p2.x * p1.y;
    signedAreaTwice += cross;
    cx += (p1.x + p2.x) * cross;
    cy += (p1.y + p2.y) * cross;
  }
  if (Math.abs(signedAreaTwice) < 1e-12) {
    const n = Math.max(1, points.length);
    return {
      x: points.reduce((s, p) => s + p.x, 0) / n,
      y: points.reduce((s, p) => s + p.y, 0) / n,
    };
  }
  return { x: cx / (3 * signedAreaTwice), y: cy / (3 * signedAreaTwice) };
}

/**
 * Perpendicular distance from `p` to segment `ab`, clamped to the segment
 * itself (not the infinite line through it) -- the standard "closest point
 * on a line segment" projection, used by GeometryPanel's select-tool
 * hit-testing to let a click "near" a line (not just exactly on its
 * infinite extension) select it (#336 item 1).
 */
export function pointToSegmentDistance(p: Point2D, a: Point2D, b: Point2D): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lengthSq = abx * abx + aby * aby;
  if (lengthSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / lengthSq));
  return Math.hypot(p.x - (a.x + t * abx), p.y - (a.y + t * aby));
}

/**
 * Standard ray-casting point-in-polygon test (even-odd rule) -- lets a
 * click anywhere INSIDE a polygon select it (#336 item 1), not just exactly
 * on its boundary. Meaningful membership for a simple polygon; best-effort
 * (even-odd still gives a definite answer, just not necessarily the
 * "obviously correct" one for every self-crossing case) for a
 * self-intersecting one.
 */
export function pointInPolygon(p: Point2D, points: Point2D[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const pi = points[i] as Point2D;
    const pj = points[j] as Point2D;
    const crosses = pi.y > p.y !== pj.y > p.y && p.x < ((pj.x - pi.x) * (p.y - pi.y)) / (pj.y - pi.y) + pi.x;
    if (crosses) inside = !inside;
  }
  return inside;
}
