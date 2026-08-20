import type { GeometryOp } from "./geometry-state.ts";

export interface Point2D {
  x: number;
  y: number;
}

/**
 * Cyclic Coordinate Descent for a chain of rotation joints (#336 item 6's
 * scoped v1, per the design comment on that issue): the classic robot-arm
 * "drag the hand, the arm bends" solve. Each joint rotates everything
 * downstream of it about its own fixed pivot -- unlike a textbook
 * connected-bone arm, a joint's pivot doesn't need to BE the previous
 * joint's position (this app's rotation tool lets a user pick any existing
 * point as a center), but CCD doesn't actually require that relationship
 * either: it only needs, per joint, "this fixed pivot" and "everything
 * downstream of it," which every one of this app's rotation chains already
 * has by construction.
 */
export interface IKJointSpec {
  /** The rotation op's own id -- carried through so the caller can map a solved angle back to the op that should be edited. */
  opId: string;
  center: Point2D;
  angleDegrees: number;
}

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Rotates `p` about `center` by `angleDegrees` -- the exact formula `addRotation`'s own `graph.define` closure uses, duplicated here (not imported) since GeometryPanel.tsx's version is private to that module and this file has no CellGraph dependency by design (keeps the solver plainly unit-testable). */
export function rotatePoint(p: Point2D, center: Point2D, angleDegrees: number): Point2D {
  const theta = toRadians(angleDegrees);
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  return {
    x: center.x + dx * Math.cos(theta) - dy * Math.sin(theta),
    y: center.y + dx * Math.sin(theta) + dy * Math.cos(theta),
  };
}

/** Every joint's resulting point, base-to-end-effector order, applying `angles[i]` (falling back to each joint's own `angleDegrees` when `angles` is shorter) in turn starting from `basePoint`. */
function forwardChain(basePoint: Point2D, joints: readonly IKJointSpec[], angles: readonly number[]): Point2D[] {
  const points: Point2D[] = [];
  let current = basePoint;
  for (let i = 0; i < joints.length; i++) {
    current = rotatePoint(current, (joints[i] as IKJointSpec).center, angles[i] ?? (joints[i] as IKJointSpec).angleDegrees);
    points.push(current);
  }
  return points;
}

/**
 * Solves for each joint's angle so the chain's end effector lands as close
 * to `target` as possible, via standard 2D CCD: sweep joints from the END
 * of the chain backward to the base, each time rotating just that joint so
 * the (freshly recomputed) current end-effector position points at
 * `target` from that joint's own fixed pivot, then repeat for
 * `iterations` full sweeps. Returns the solved angles in the same
 * base-to-end-effector order as `joints` -- never mutates `joints` itself.
 *
 * DOF notes (stated plainly, not hidden): a 1-joint chain solves exactly
 * only when `target` is actually reachable (on that joint's own fixed-
 * radius circle around its pivot) -- otherwise CCD converges to the
 * nearest reachable point on that circle, which is the correct "best
 * effort" behavior, not a bug. A chain with more than 2 joints is
 * redundant (more than one solution reaches most targets); CCD just finds
 * *a* solution, not necessarily the most "natural-looking" one -- a known,
 * accepted CCD characteristic, not something this solver tries to fix.
 */
export function solveIKChainCCD(basePoint: Point2D, joints: readonly IKJointSpec[], target: Point2D, iterations = 10): number[] {
  const angles = joints.map((j) => j.angleDegrees);
  if (joints.length === 0) return angles;
  for (let iter = 0; iter < iterations; iter++) {
    for (let i = joints.length - 1; i >= 0; i--) {
      const points = forwardChain(basePoint, joints, angles);
      const endEffector = points[points.length - 1] as Point2D;
      const pivot = (joints[i] as IKJointSpec).center;
      const toEnd = Math.atan2(endEffector.y - pivot.y, endEffector.x - pivot.x);
      const toTarget = Math.atan2(target.y - pivot.y, target.x - pivot.x);
      const deltaDegrees = ((toTarget - toEnd) * 180) / Math.PI;
      angles[i] = (angles[i] as number) + deltaDegrees;
    }
  }
  return angles;
}

export type IKChainResult = { ok: true; chain: string[] } | { ok: false; message: string };

/**
 * Derives an ordered base-to-end-effector chain from an UNORDERED set of
 * selected op ids (#336 item 1's selection model has no inherent order --
 * relying on `Set` iteration/click order would be a fragile UX contract,
 * so this recovers order from the construction graph itself instead):
 * every selected op must be a rotation, exactly one of them must be the
 * "base" (its `source` is NOT another selected rotation's own id -- i.e.
 * it's rotating something outside the selection), and each subsequent
 * joint must chain onto exactly the previous one (no branching: two
 * selected rotations both sourced from the same upstream point isn't a
 * chain, it's two separate arms).
 */
export function deriveIKChain(ops: readonly GeometryOp[], selectedIds: ReadonlySet<string>): IKChainResult {
  if (selectedIds.size === 0) return { ok: false, message: "Select one or more rotation transforms to form a chain." };

  const selectedRotations = ops.filter((op) => selectedIds.has(op.id));
  if (selectedRotations.length !== selectedIds.size) {
    return { ok: false, message: "Every selected object must be a rotation transform to form an IK chain." };
  }
  if (!selectedRotations.every((op) => op.tool === "rotation")) {
    return { ok: false, message: "An IK chain can only be made of rotation transforms -- deselect any non-rotation object." };
  }
  const rotations = selectedRotations as Array<Extract<GeometryOp, { tool: "rotation" }>>;

  // A rotation's own `id` doubles as its RESULT point's cell id (see
  // addRotation's `graph.define(pointCellId(id), ...)`), so "is op.source
  // another selected rotation's own id" is exactly "does op chain onto
  // another selected rotation's output" -- the base is whichever selected
  // rotation does NOT chain onto another one (its source is some point
  // outside the selection, e.g. a free point).
  const byRotationId = new Map(rotations.map((op) => [op.id, op] as const));
  const bases = rotations.filter((op) => !byRotationId.has(op.source));
  if (bases.length !== 1) {
    return {
      ok: false,
      message:
        bases.length === 0
          ? "This selection has no clear starting point -- every selected rotation's source is itself another selected rotation, which can't happen in a valid chain."
          : `This selection has ${bases.length} separate starting points, not one chain -- select a single connected sequence of rotations.`,
    };
  }

  // Branching check: no two selected rotations may share the same source
  // (that would be two separate arms forking from one point, not a chain).
  const sourceCounts = new Map<string, number>();
  for (const op of rotations) sourceCounts.set(op.source, (sourceCounts.get(op.source) ?? 0) + 1);
  const forkedSource = [...sourceCounts.entries()].find(([, count]) => count > 1);
  if (forkedSource) {
    return { ok: false, message: "Two selected rotations share the same source point -- that's a fork, not a chain. Select a single sequence instead." };
  }

  // Walk forward from the base, one hop at a time -- `byId.get(cursor)`
  // finds "the selected rotation whose source is the current chain tip."
  const bySourcePointId = new Map(rotations.map((op) => [op.source, op] as const));
  const chain: string[] = [];
  let cursor: string = (bases[0] as (typeof rotations)[number]).id;
  chain.push(cursor);
  while (chain.length < rotations.length) {
    const next = bySourcePointId.get(cursor);
    if (!next) return { ok: false, message: "This selection doesn't form one unbroken chain -- select a single connected sequence of rotations." };
    chain.push(next.id);
    cursor = next.id;
  }

  return { ok: true, chain };
}
