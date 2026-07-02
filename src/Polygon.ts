import { NumberTheory } from "./NumberTheory.ts";
import { distanceVector } from "./RealMath.ts";
import { Vector } from "./Vector.ts";

/** A 2D point stored as a {@link Vector} `[x, y]`. */
type Point = Vector<number>;

/**
 * Polygon — an ordered list of vertex points ({@link Vector} subclass). Ported
 * from Mallory's ActionScript `Polygon`.
 *
 * Bug fixes from the AS3 original:
 *  - `perimeter` accumulated into a `uint`, truncating the fractional length.
 *  - `area` only summed two triangles, so it was wrong for pentagons and up; it
 *    now uses the shoelace formula, correct for any simple polygon.
 *  - `angle` was stubbed to `return 0` (with dead code calling classes that do
 *    not exist); it now computes the interior angle via the law of cosines it
 *    documented.
 */
export class Polygon extends Vector<Point> {
  /** The vertex at `index`, wrapping around the polygon. */
  vertex(index: number): Point {
    return this[Number(NumberTheory.mod(index, this.length))] as Point;
  }

  get vertexCount(): number {
    return this.length;
  }

  get edgeCount(): number {
    if (this.vertexCount < 3) return this.length - 1;
    return this.vertexCount;
  }

  /** The edge starting at `index` as a two-vertex polygon. */
  edge(index: number): Polygon {
    return new Polygon(this.vertex(index), this.vertex(index + 1));
  }

  /** Total perimeter length (bug fix: no longer truncated to an integer). */
  perimeter(): number {
    let per = 0;
    for (let i = 0; i < this.edgeCount; i++) {
      per += distanceVector(this.vertex(i), this.vertex(i + 1));
    }
    return per;
  }

  /** Heron's-formula area of the triangle on the first three vertices. */
  private triArea(): number {
    const a = distanceVector(this.vertex(0), this.vertex(1));
    const b = distanceVector(this.vertex(1), this.vertex(2));
    const c = distanceVector(this.vertex(2), this.vertex(0));
    const s = (a + b + c) / 2;
    return Math.sqrt(s * (s - a) * (s - b) * (s - c));
  }

  /**
   * Area of the polygon via the shoelace formula (bug fix: the AS3 version only
   * summed two triangles and was wrong for polygons with more than four sides).
   */
  area(): number {
    if (this.vertexCount < 3) return 0;
    if (this.vertexCount === 3) return this.triArea();
    let sum = 0;
    for (let i = 0; i < this.vertexCount; i++) {
      const current = this.vertex(i);
      const next = this.vertex(i + 1);
      sum += (current.x as number) * (next.y as number) - (next.x as number) * (current.y as number);
    }
    return Math.abs(sum) / 2;
  }

  /**
   * The area centroid (center of mass) as an `[x, y]` point. Complements
   * {@link perimeter} and {@link area}. Falls back to the vertex average for a
   * degenerate (zero-area) polygon.
   */
  centroid(): Point {
    let signedArea = 0;
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < this.vertexCount; i++) {
      const cur = this.vertex(i);
      const next = this.vertex(i + 1);
      const cross = (cur.x as number) * (next.y as number) - (next.x as number) * (cur.y as number);
      signedArea += cross;
      cx += ((cur.x as number) + (next.x as number)) * cross;
      cy += ((cur.y as number) + (next.y as number)) * cross;
    }
    if (signedArea === 0) {
      // Degenerate: average the vertices.
      let sx = 0;
      let sy = 0;
      for (let i = 0; i < this.vertexCount; i++) {
        sx += this.vertex(i).x as number;
        sy += this.vertex(i).y as number;
      }
      const n = this.vertexCount || 1;
      return Vector.fromArray([sx / n, sy / n]);
    }
    return Vector.fromArray([cx / (3 * signedArea), cy / (3 * signedArea)]);
  }

  /**
   * Interior angle (radians) at vertex `i`, via the law of cosines
   * (bug fix: the AS3 method always returned 0).
   */
  angle(i: number): number {
    const ab = distanceVector(this.vertex(i), this.vertex(i + 1));
    const bc = distanceVector(this.vertex(i), this.vertex(i - 1));
    const ac = distanceVector(this.vertex(i + 1), this.vertex(i - 1));
    return Math.acos((ab * ab + bc * bc - ac * ac) / (2 * ab * bc));
  }

  /** True when `point` lies inside the polygon (even-odd ray-casting rule). */
  contains(point: Point): boolean {
    const px = point.x as number;
    const py = point.y as number;
    let inside = false;
    const n = this.vertexCount;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const vi = this.vertex(i);
      const vj = this.vertex(j);
      const xi = vi.x as number;
      const yi = vi.y as number;
      const xj = vj.x as number;
      const yj = vj.y as number;
      if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  /** True when the polygon is convex (all turns share the same orientation). */
  isConvex(): boolean {
    const n = this.vertexCount;
    if (n < 3) return false;
    let sign = 0;
    for (let i = 0; i < n; i++) {
      const a = this.vertex(i);
      const b = this.vertex(i + 1);
      const c = this.vertex(i + 2);
      const cross =
        ((b.x as number) - (a.x as number)) * ((c.y as number) - (b.y as number)) -
        ((b.y as number) - (a.y as number)) * ((c.x as number) - (b.x as number));
      if (cross !== 0) {
        const s = Math.sign(cross);
        if (sign === 0) sign = s;
        else if (s !== sign) return false;
      }
    }
    return true;
  }

  /** True when no two non-adjacent edges cross (the polygon is simple). */
  isSimple(): boolean {
    const n = this.vertexCount;
    if (n < 3) return false;
    for (let i = 0; i < n; i++) {
      const a1 = this.vertex(i);
      const a2 = this.vertex(i + 1);
      for (let j = i + 1; j < n; j++) {
        // Skip edges that share a vertex (adjacent, or the wrap-around pair).
        if (j === i || j === i + 1 || (i === 0 && j === n - 1)) continue;
        const b1 = this.vertex(j);
        const b2 = this.vertex(j + 1);
        if (Polygon.segmentsIntersect(a1, a2, b1, b2)) return false;
      }
    }
    return true;
  }

  private static orient(a: Point, b: Point, c: Point): number {
    return (
      ((b.x as number) - (a.x as number)) * ((c.y as number) - (a.y as number)) -
      ((b.y as number) - (a.y as number)) * ((c.x as number) - (a.x as number))
    );
  }

  private static onSegment(a: Point, b: Point, p: Point): boolean {
    return (
      Math.min(a.x as number, b.x as number) <= (p.x as number) &&
      (p.x as number) <= Math.max(a.x as number, b.x as number) &&
      Math.min(a.y as number, b.y as number) <= (p.y as number) &&
      (p.y as number) <= Math.max(a.y as number, b.y as number)
    );
  }

  private static segmentsIntersect(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
    const d1 = Polygon.orient(p3, p4, p1);
    const d2 = Polygon.orient(p3, p4, p2);
    const d3 = Polygon.orient(p1, p2, p3);
    const d4 = Polygon.orient(p1, p2, p4);
    if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
    if (d1 === 0 && Polygon.onSegment(p3, p4, p1)) return true;
    if (d2 === 0 && Polygon.onSegment(p3, p4, p2)) return true;
    if (d3 === 0 && Polygon.onSegment(p1, p2, p3)) return true;
    if (d4 === 0 && Polygon.onSegment(p1, p2, p4)) return true;
    return false;
  }

  /** A clone of the polygon (deep-clones nested vertex vectors by default). */
  override clone(deep = true): Polygon {
    const out = new Polygon(this.length);
    for (let i = 0; i < out.length; i++) {
      const el = this[i];
      out[i] = deep && el instanceof Vector ? (el.clone() as Point) : (el as Point);
    }
    return out;
  }
}
