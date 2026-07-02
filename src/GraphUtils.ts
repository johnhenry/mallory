import type { Polygon } from "./Polygon.ts";
import type { Vector } from "./Vector.ts";
import { VectorUtils } from "./VectorUtils.ts";

/**
 * GraphUtils — helpers for turning functions and points into 2D drawing data.
 *
 * Ported from Mallory's ActionScript `GraphUtils`, which mutated Flash
 * `DisplayObject`s and drew into a `Graphics` context. Since neither exists
 * outside Flash, the drawing operations are re-targeted to emit renderer-
 * agnostic data — placement descriptors and vector paths — which the original
 * comments themselves noted would be a cleaner separation. `if(point.x)`-style
 * truthiness checks (which dropped legitimate zero coordinates) are fixed.
 */

export interface Placement2D {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
}

export interface BarPlacement2D {
  x: number;
  y: number;
  width: number;
  height: number;
  scaleY: number;
}

export interface StrokeStyle {
  thickness: number;
  color: number;
  alpha: number;
  pixelHinting: boolean;
  scaleMode: string;
  caps: string | null;
  joints: string | null;
  miterLimit: number;
}

export interface FillStyle {
  color: number;
  alpha: number;
}

export interface PathCommand {
  op: "moveTo" | "lineTo";
  x: number;
  y: number;
}

export interface Path2D {
  stroke: StrokeStyle;
  fill?: FillStyle;
  commands: PathCommand[];
}

const point = (p: Vector<number>) => ({ x: p.x as number, y: p.y as number, z: p.z as number, t: p.t as number });

export class GraphUtils {
  /** Sample `unaryOperation` across `[xMin, xMax]` in `xStep` increments. */
  static singleRangeVector<T>(unaryOperation: (x: number) => T, xMin = -10, xMax = 10, xStep = 1): Vector<T> {
    const xValues = VectorUtils.arithmeticSequence(xMin, xMax, xStep);
    return VectorUtils.transform(xValues, unaryOperation);
  }

  /**
   * Placement descriptor for a point. With `altProperties`, maps each component
   * to a named property; otherwise x/y position and (from z) a uniform scale.
   */
  static placement(p: Vector<number>, altProperties: string[] | null = null): Placement2D | Record<string, number> {
    if (altProperties) {
      const out: Record<string, number> = {};
      const max = Math.max(p.length, altProperties.length);
      for (let i = 0; i < max; i++) out[altProperties[i] as string] = p[i] as number;
      return out;
    }
    const { x, y, z } = point(p);
    const scale = z !== 0 ? Math.abs(z) : 1;
    return { x, y, scaleX: scale, scaleY: scale };
  }

  /** Placement descriptor for a bar in a bar graph. */
  static barPlacement(p: Vector<number>, barWidth = 40): BarPlacement2D {
    const { x, y } = point(p);
    return { x, y: 0, width: barWidth, height: y, scaleY: y < 0 ? -1 : 1 };
  }

  static placements(
    points: Vector<Vector<number>>,
    altProperties: string[] | null = null,
  ): Array<Placement2D | Record<string, number>> {
    return [...points].map((p) => GraphUtils.placement(p, altProperties));
  }

  static barPlacements(points: Vector<Vector<number>>, barWidth = 40): BarPlacement2D[] {
    return [...points].map((p) => GraphUtils.barPlacement(p, barWidth));
  }

  /** A poly-line path through the given points. */
  static vectorToCurve(
    points: Vector<Vector<number>>,
    thickness = 0,
    color = 0,
    alpha = 1,
    pixelHinting = false,
    scaleMode = "normal",
    caps: string | null = null,
    joints: string | null = null,
    miterLimit = 3,
  ): Path2D {
    const stroke: StrokeStyle = { thickness, color, alpha, pixelHinting, scaleMode, caps, joints, miterLimit };
    const commands: PathCommand[] = [];
    if (points.length > 0) {
      const first = point(points[0] as Vector<number>);
      commands.push({ op: "moveTo", x: first.x, y: first.y });
      for (let i = 1; i < points.length; i++) {
        const pt = point(points[i] as Vector<number>);
        commands.push({ op: "lineTo", x: pt.x, y: pt.y });
      }
    }
    return { stroke, commands };
  }

  /** A filled, closed path tracing a polygon's edges. */
  static polygonToCurve(
    polygon: Polygon,
    strokeThickness = 0,
    strokeColor = 0,
    strokeAlpha = 1,
    fillColor = 0xffffff,
    fillAlpha = 1,
    pixelHinting = false,
    scaleMode = "normal",
    caps: string | null = null,
    joints: string | null = null,
    miterLimit = 3,
  ): Path2D {
    const stroke: StrokeStyle = {
      thickness: strokeThickness,
      color: strokeColor,
      alpha: strokeAlpha,
      pixelHinting,
      scaleMode,
      caps,
      joints,
      miterLimit,
    };
    const commands: PathCommand[] = [];
    const start = point(polygon.vertex(0));
    commands.push({ op: "moveTo", x: start.x, y: start.y });
    for (let i = 1; i <= polygon.edgeCount; i++) {
      const pt = point(polygon.vertex(i));
      commands.push({ op: "lineTo", x: pt.x, y: pt.y });
    }
    return { stroke, fill: { color: fillColor, alpha: fillAlpha }, commands };
  }
}
