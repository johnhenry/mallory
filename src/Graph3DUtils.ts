import type { Polygon } from "./Polygon.ts";
import type { Vector } from "./Vector.ts";
import { VectorUtils } from "./VectorUtils.ts";

/**
 * Graph3DUtils — helpers for turning functions and points into 3D mesh data.
 *
 * Ported from Mallory's ActionScript `Graph3DUtils`, which produced
 * papervision3d `Mesh3D`/`Vertex3D`/`Face3D` objects. Those Flash libraries do
 * not exist here, so the geometry is emitted as plain, renderer-agnostic data
 * ({@link Mesh} = a coloured list of triangular {@link Face}s). The underlying
 * geometry math is preserved.
 *
 * Bug fixes from the AS3 original:
 *  - `nRangeVector` only worked in one dimension (it returned `null` otherwise)
 *    and mutated its `mins`/`maxes`/`steps` arguments via `shift()`; it now
 *    handles any dimensionality without mutating its inputs.
 *  - `pointMatrixToMesh3D` used `alpha2` for the first material (should be
 *    `alpha1`) and had unreachable dead code after its `return`.
 *
 * NOTE: `create3DCurveSegment`/`create3DPrism` reproduce the original ribbon
 * geometry, but with one fix: the AS3 original computed `phi` by converting
 * an `atan2` result (radians) to degrees, then passed that degrees value
 * straight into `Math.cos`/`Math.sin` (which expect radians) — a unit
 * mismatch, not a deliberate choice. `phi` is now kept in radians throughout.
 * The on-screen appearance still cannot be pixel-verified against the
 * original Flash renderer (papervision3d no longer runs anywhere), so this is
 * a best-effort mathematical correction, not a confirmed visual match.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** A triangular face. */
export type Face = [Vec3, Vec3, Vec3];

export interface Material {
  color: number;
  alpha: number;
  oneSide: boolean;
}

export interface Mesh {
  material: Material;
  faces: Face[];
}

export interface Placement3D {
  x: number;
  y: number;
  z: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
}

const v3 = (x: number, y: number, z = 0): Vec3 => ({ x, y, z });
const asPoint = (p: Vector<number>): Vec3 => ({ x: p.x as number, y: p.y as number, z: p.z as number });

export class Graph3DUtils {
  /** Sample `binaryOperation` over a 2D grid, returning a matrix of results. */
  static dualRangeVector<T>(
    binaryOperation: (x: number, y: number) => T,
    xMin = -10,
    xMax = 10,
    xStep = 1,
    yMin = -10,
    yMax = 10,
    yStep = 1,
  ): Vector<Vector<T>> {
    const xValues = VectorUtils.arithmeticSequence(xMin, xMax, xStep);
    return VectorUtils.transform(xValues, (x) => {
      const yValues = VectorUtils.arithmeticSequence(yMin, yMax, yStep);
      return VectorUtils.transform(yValues, (y) => binaryOperation(x, y));
    });
  }

  /**
   * Sample `nOperation` over an N-dimensional grid (bug fix: the AS3 version
   * only handled N=1 and mutated its arguments). `nOperation` receives the
   * coordinate array for each grid point.
   */
  static nRangeVector<T>(
    nOperation: (coords: number[]) => T,
    mins: readonly number[],
    maxes: readonly number[],
    steps: readonly number[],
  ): Vector<unknown> {
    const recurse = (dim: number, prefix: number[]): unknown => {
      if (dim >= mins.length) return nOperation(prefix);
      const values = VectorUtils.arithmeticSequence(mins[dim] as number, maxes[dim] as number, steps[dim] as number);
      return VectorUtils.transform(values, (v) => recurse(dim + 1, [...prefix, v]));
    };
    return recurse(0, []) as Vector<unknown>;
  }

  /** Placement descriptor for a point in 3D (position + optional uniform scale from `t`). */
  static placement3D(p: Vector<number>, altProperties: string[] | null = null): Placement3D | Record<string, number> {
    if (altProperties) {
      const out: Record<string, number> = {};
      const max = Math.max(p.length, altProperties.length);
      for (let i = 0; i < max; i++) out[altProperties[i] as string] = p[i] as number;
      return out;
    }
    const scale = (p.t as number) !== 0 ? (p.t as number) : 1;
    return { x: p.x as number, y: p.y as number, z: p.z as number, scaleX: scale, scaleY: scale, scaleZ: scale };
  }

  static placement3DBarGraph(p: Vector<number>): Placement3D {
    return { x: p.x as number, y: p.y as number, z: p.z as number, scaleX: 1, scaleY: 1, scaleZ: 1 };
  }

  /** A flat two-triangle ribbon between two points (see the class NOTE). */
  static create3DCurveSegment(
    firstPoint: Vector<number>,
    secondPoint: Vector<number>,
    color = 0x000000,
    alpha = 1,
    planeThickness = 1,
    planeAngle = 0,
  ): Mesh {
    const t = planeThickness / 2;
    const a = asPoint(firstPoint);
    const b = asPoint(secondPoint);
    const phi = Math.PI / 2 - Math.atan2(b.y - a.y, b.x - a.x);
    const a1 = v3(a.x - Math.cos(phi) * t * Math.cos(planeAngle), a.y + Math.sin(phi) * t * Math.sin(planeAngle));
    const a2 = v3(a.x + Math.cos(phi) * t * Math.cos(planeAngle), a.y - Math.sin(phi) * t * Math.sin(planeAngle));
    const b1 = v3(b.x - Math.cos(phi) * t * Math.cos(planeAngle), b.y + Math.sin(phi) * t * Math.sin(planeAngle));
    const b2 = v3(b.x + Math.cos(phi) * t * Math.cos(planeAngle), b.y - Math.sin(phi) * t * Math.sin(planeAngle));
    return {
      material: { color, alpha, oneSide: false },
      faces: [
        [a1, b1, a2],
        [b1, b2, a2],
      ],
    };
  }

  /** A rectangular prism (tube) between two points (see the class NOTE). */
  static create3DPrism(
    firstPoint: Vector<number>,
    secondPoint: Vector<number>,
    color = 0x000000,
    alpha = 1,
    planeThickness = 1,
  ): Mesh {
    const t = planeThickness / 2;
    const a = asPoint(firstPoint);
    const b = asPoint(secondPoint);
    const phi = Math.PI / 2 - Math.atan2(b.y - a.y, b.x - a.x);

    const a1 = v3(a.x - Math.cos(phi), a.y + Math.sin(phi) * t, a.z);
    const a11 = v3(a1.x, a1.y, a1.z + t);
    const a12 = v3(a1.x, a1.y, a1.z - t);
    const a2 = v3(a.x + Math.cos(phi), a.y - Math.sin(phi) * t, a.z);
    const a21 = v3(a2.x, a2.y, a2.z + t);
    const a22 = v3(a2.x, a2.y, a2.z - t);
    const b1 = v3(b.x - Math.cos(phi), b.y + Math.sin(phi) * t, a.z);
    const b11 = v3(b1.x, b1.y, b1.z + t);
    const b12 = v3(b1.x, b1.y, b1.z - t);
    const b2 = v3(b.x + Math.cos(phi), b.y - Math.sin(phi) * t, a.z);
    const b21 = v3(b2.x, b2.y, b2.z + t);
    const b22 = v3(b2.x, b2.y, b2.z - t);

    const faces: Face[] = [
      [a11, a12, a22],
      [a11, a21, a22],
      [b11, b12, b22],
      [b11, b21, b22],
      [a11, a21, b21],
      [a11, b11, b21],
      [a21, b21, b22],
      [a21, a22, b22],
      [a22, b22, b12],
      [a22, a12, b12],
      [a12, a11, b11],
      [a12, b12, b11],
    ];
    return { material: { color, alpha, oneSide: false }, faces };
  }

  /** A tube following a poly-line, as one prism mesh per segment. */
  static vectorTo3DPrism(points: Vector<Vector<number>>, color = 0, alpha = 1, planeThickness = 1): Mesh[] {
    const out: Mesh[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      out.push(
        Graph3DUtils.create3DPrism(
          points[i] as Vector<number>,
          points[i + 1] as Vector<number>,
          color,
          alpha,
          planeThickness,
        ),
      );
    }
    return out;
  }

  /** Alias of {@link vectorTo3DPrism} (the AS3 `VectorTo3DCurve` was identical). */
  static vectorTo3DCurve(points: Vector<Vector<number>>, color = 0, alpha = 1, planeThickness = 1): Mesh[] {
    return Graph3DUtils.vectorTo3DPrism(points, color, alpha, planeThickness);
  }

  /** Triangulate a polygon into a mesh (fan from vertex 0). */
  static polygonToMesh3D(polygon: Polygon, color = 0, alpha = 1): Mesh {
    const faces: Face[] = [];
    const degenerate = polygon.clone();
    while (degenerate.length > 2) {
      faces.push([asPoint(degenerate.vertex(0)), asPoint(degenerate.vertex(1)), asPoint(degenerate.vertex(2))]);
      degenerate.splice(1, 1);
    }
    return { material: { color, alpha, oneSide: false }, faces };
  }

  /**
   * Build a surface mesh from a grid (matrix) of points, as two triangle
   * sweeps with distinct materials (bug fix: the first sweep now uses `alpha1`).
   */
  static pointMatrixToMesh3D(
    vector: Vector<Vector<Vector<number>>>,
    color1 = 0,
    alpha1 = 1,
    color2 = 0xffffff,
    alpha2 = 1,
  ): Mesh[] {
    const width = VectorUtils.width(vector as never);
    const height = VectorUtils.height(vector as never);
    const at = (i: number, j: number): Vector<number> | undefined =>
      (vector[i] as Vector<Vector<number>> | undefined)?.[j];

    const faces1: Face[] = [];
    for (let i = 0; i < width - 1; i++) {
      for (let j = 0; j < height - 1; j++) {
        if (at(i, j) && vector[i + 1] && at(i, j + 1)) {
          faces1.push([
            asPoint(at(i, j) as Vector<number>),
            asPoint(at(i + 1, j) as Vector<number>),
            asPoint(at(i, j + 1) as Vector<number>),
          ]);
        }
      }
    }

    const faces2: Face[] = [];
    for (let i = 1; i < width; i++) {
      for (let j = 1; j < height; j++) {
        if (at(i, j) && vector[i - 1] && at(i, j - 1)) {
          faces2.push([
            asPoint(at(i, j) as Vector<number>),
            asPoint(at(i - 1, j) as Vector<number>),
            asPoint(at(i, j - 1) as Vector<number>),
          ]);
        }
      }
    }

    return [
      { material: { color: color1, alpha: alpha1, oneSide: false }, faces: faces1 },
      { material: { color: color2, alpha: alpha2, oneSide: false }, faces: faces2 },
    ];
  }
}
