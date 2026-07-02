/**
 * Geometry — computational geometry on 2D points (`[x, y]` tuples): convex hull,
 * orientation and intersection predicates, point-in-polygon, distances, polygon
 * area/centroid, and 2D affine transforms via homogeneous matrices. Complements
 * the {@link Polygon} class with lower-level, allocation-free primitives.
 */

export type Point = [number, number];

export class Geometry {
  /** The signed area of the triangle `(a, b, c)` (>0 CCW, <0 CW, 0 collinear). */
  static orientation(a: Point, b: Point, c: Point): number {
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  }

  static distance(a: Point, b: Point): number {
    return Math.hypot(a[0] - b[0], a[1] - b[1]);
  }

  /** Distance from point `p` to the segment `a–b`. */
  static distancePointToSegment(p: Point, a: Point, b: Point): number {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return Geometry.distance(p, a);
    let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return Geometry.distance(p, [a[0] + t * dx, a[1] + t * dy]);
  }

  /** The convex hull (counter-clockwise) via Andrew's monotone chain. */
  static convexHull(points: readonly Point[]): Point[] {
    const pts = [...points].sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    if (pts.length <= 2) return pts;
    const cross = (o: Point, a: Point, b: Point) => Geometry.orientation(o, a, b);

    const lower: Point[] = [];
    for (const p of pts) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
      lower.push(p);
    }
    const upper: Point[] = [];
    for (let i = pts.length - 1; i >= 0; i--) {
      const p = pts[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
      upper.push(p);
    }
    lower.pop();
    upper.pop();
    return lower.concat(upper);
  }

  /** Whether segments `p1–p2` and `p3–p4` intersect (endpoints/collinear included). */
  static segmentsIntersect(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
    const d1 = Geometry.orientation(p3, p4, p1);
    const d2 = Geometry.orientation(p3, p4, p2);
    const d3 = Geometry.orientation(p1, p2, p3);
    const d4 = Geometry.orientation(p1, p2, p4);
    const onSeg = (a: Point, b: Point, p: Point) =>
      Math.min(a[0], b[0]) <= p[0] &&
      p[0] <= Math.max(a[0], b[0]) &&
      Math.min(a[1], b[1]) <= p[1] &&
      p[1] <= Math.max(a[1], b[1]);
    if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
    if (d1 === 0 && onSeg(p3, p4, p1)) return true;
    if (d2 === 0 && onSeg(p3, p4, p2)) return true;
    if (d3 === 0 && onSeg(p1, p2, p3)) return true;
    if (d4 === 0 && onSeg(p1, p2, p4)) return true;
    return false;
  }

  /** The shoelace area of a polygon given by its vertices. */
  static polygonArea(polygon: readonly Point[]): number {
    let sum = 0;
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i];
      const b = polygon[(i + 1) % polygon.length];
      sum += a[0] * b[1] - b[0] * a[1];
    }
    return Math.abs(sum) / 2;
  }

  /** The centroid of a set of points (the simple average). */
  static centroid(points: readonly Point[]): Point {
    const n = points.length || 1;
    let sx = 0;
    let sy = 0;
    for (const [x, y] of points) {
      sx += x;
      sy += y;
    }
    return [sx / n, sy / n];
  }

  /** Point-in-polygon by the even-odd ray-casting rule. */
  static pointInPolygon(point: Point, polygon: readonly Point[]): boolean {
    const [px, py] = point;
    let inside = false;
    const n = polygon.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const [xi, yi] = polygon[i];
      const [xj, yj] = polygon[j];
      if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
}

/**
 * Transform2D — 2D affine transforms as 3×3 homogeneous matrices. Compose them
 * with {@link Transform2D.multiply} and apply them with {@link Transform2D.apply}.
 */
export class Transform2D {
  readonly m: number[][];

  constructor(m: number[][]) {
    this.m = m;
  }

  static identity(): Transform2D {
    return new Transform2D([
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]);
  }

  static translation(tx: number, ty: number): Transform2D {
    return new Transform2D([
      [1, 0, tx],
      [0, 1, ty],
      [0, 0, 1],
    ]);
  }

  static scaling(sx: number, sy: number = sx): Transform2D {
    return new Transform2D([
      [sx, 0, 0],
      [0, sy, 0],
      [0, 0, 1],
    ]);
  }

  static rotation(theta: number): Transform2D {
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    return new Transform2D([
      [c, -s, 0],
      [s, c, 0],
      [0, 0, 1],
    ]);
  }

  /** Matrix product `this · other` (apply `other` first, then `this`). */
  multiply(other: Transform2D): Transform2D {
    const a = this.m;
    const b = other.m;
    const out = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) out[i][j] += a[i][k] * b[k][j];
    return new Transform2D(out);
  }

  /** Apply the transform to a point. */
  apply(p: Point): Point {
    const [x, y] = p;
    const m = this.m;
    return [m[0][0] * x + m[0][1] * y + m[0][2], m[1][0] * x + m[1][1] * y + m[1][2]];
  }
}
