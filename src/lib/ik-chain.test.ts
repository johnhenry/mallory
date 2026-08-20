import assert from "node:assert/strict";
import { test } from "node:test";
import { deriveIKChain, rotatePoint, solveIKChainCCD } from "./ik-chain.ts";
import type { GeometryOp } from "./geometry-state.ts";

test("rotatePoint: 90 degrees around the origin sends (1,0) to (0,1)", () => {
  const result = rotatePoint({ x: 1, y: 0 }, { x: 0, y: 0 }, 90);
  assert.ok(Math.abs(result.x - 0) < 1e-9);
  assert.ok(Math.abs(result.y - 1) < 1e-9);
});

test("rotatePoint: about a non-origin center", () => {
  // (2,1) rotated 180 degrees around (1,1) -> (0,1)
  const result = rotatePoint({ x: 2, y: 1 }, { x: 1, y: 1 }, 180);
  assert.ok(Math.abs(result.x - 0) < 1e-9);
  assert.ok(Math.abs(result.y - 1) < 1e-9);
});

test("solveIKChainCCD: a single joint solves exactly for a reachable target (the target sits exactly on its pivot-radius circle)", () => {
  // Base at (1,0), one joint pivoting at the origin -- reachable targets
  // are exactly the unit circle. Target (0,1) needs a 90 degree rotation.
  const base = { x: 1, y: 0 };
  const joints = [{ opId: "r1", center: { x: 0, y: 0 }, angleDegrees: 0 }];
  const [angle] = solveIKChainCCD(base, joints, { x: 0, y: 1 });
  const solved = rotatePoint(base, joints[0]!.center, angle as number);
  assert.ok(Math.abs(solved.x - 0) < 1e-6);
  assert.ok(Math.abs(solved.y - 1) < 1e-6);
});

test("solveIKChainCCD: a single joint with an UNreachable target converges to the nearest point on its own reachable circle, not a bogus answer", () => {
  // Same unit-circle joint as above; target (5,5) is nowhere near reachable
  // -- CCD should still land ON the unit circle, as close to (5,5)'s
  // direction as a unit-radius point can get (i.e. along the (1,1) ray).
  const base = { x: 1, y: 0 };
  const joints = [{ opId: "r1", center: { x: 0, y: 0 }, angleDegrees: 0 }];
  const [angle] = solveIKChainCCD(base, joints, { x: 5, y: 5 });
  const solved = rotatePoint(base, joints[0]!.center, angle as number);
  assert.ok(Math.abs(Math.hypot(solved.x, solved.y) - 1) < 1e-6, "still exactly on the unit circle -- a single rotation can't change its own radius");
  assert.ok(solved.x > 0 && solved.y > 0, "converges toward the (1,1) direction the unreachable target sits in");
});

test("solveIKChainCCD: a two-joint chain (a real 'arm') reaches an interior target neither joint alone could", () => {
  // Base at (1,0); joint 1 pivots at origin (bone length 1 to the base,
  // then effectively a 2nd bone of length 1 from joint 2's own pivot,
  // which itself sits wherever joint 1's rotation places it -- but here
  // joint 2's pivot is INDEPENDENTLY fixed at (2,0), not chained to joint
  // 1's own output, matching this app's "any point can be a center" model).
  // Just assert convergence: the solved end-effector should land close to target.
  const base = { x: 1, y: 0 };
  const joints = [
    { opId: "r1", center: { x: 0, y: 0 }, angleDegrees: 0 },
    { opId: "r2", center: { x: 2, y: 0 }, angleDegrees: 0 },
  ];
  const target = { x: 1.5, y: 1 };
  const angles = solveIKChainCCD(base, joints, target, 25);
  const p1 = rotatePoint(base, joints[0]!.center, angles[0] as number);
  const p2 = rotatePoint(p1, joints[1]!.center, angles[1] as number);
  assert.ok(Math.hypot(p2.x - target.x, p2.y - target.y) < 0.05, `expected convergence near target, got (${p2.x}, ${p2.y})`);
});

test("solveIKChainCCD: an empty chain returns an empty angle list without throwing", () => {
  assert.deepEqual(solveIKChainCCD({ x: 0, y: 0 }, [], { x: 1, y: 1 }), []);
});

function rot(id: string, source: string, center: string, angleDegrees = 10): GeometryOp {
  return { tool: "rotation", id, source, center, angleDegrees };
}
function pt(id: string): GeometryOp {
  return { tool: "point", id, x: 0, y: 0 };
}

test("deriveIKChain: a simple 3-joint chain (r1 -> r2 -> r3) derives in the correct order regardless of selection-set insertion order", () => {
  const ops: GeometryOp[] = [pt("base"), rot("r1", "base", "c1"), rot("r2", "r1", "c2"), rot("r3", "r2", "c3")];
  // Insert into the Set out of chain order, to prove order is derived from
  // the graph, not from Set iteration order.
  const selected = new Set(["r3", "r1", "r2"]);
  const result = deriveIKChain(ops, selected);
  assert.deepEqual(result, { ok: true, chain: ["r1", "r2", "r3"] });
});

test("deriveIKChain: a single-joint chain is valid (a degenerate but usable chain)", () => {
  const ops: GeometryOp[] = [pt("base"), rot("r1", "base", "c1")];
  const result = deriveIKChain(ops, new Set(["r1"]));
  assert.deepEqual(result, { ok: true, chain: ["r1"] });
});

test("deriveIKChain: rejects an empty selection", () => {
  const result = deriveIKChain([], new Set());
  assert.equal(result.ok, false);
});

test("deriveIKChain: rejects a selection containing a non-rotation object", () => {
  const ops: GeometryOp[] = [pt("base"), rot("r1", "base", "c1"), { tool: "line", id: "l1", a: "base", b: "c1" }];
  const result = deriveIKChain(ops, new Set(["r1", "l1"]));
  assert.equal(result.ok, false);
  assert.match((result as { ok: false; message: string }).message, /rotation transforms/);
});

test("deriveIKChain: rejects two disconnected chains selected together (2 separate starting points)", () => {
  const ops: GeometryOp[] = [pt("baseA"), pt("baseB"), rot("r1", "baseA", "c1"), rot("r2", "baseB", "c2")];
  const result = deriveIKChain(ops, new Set(["r1", "r2"]));
  assert.equal(result.ok, false);
  assert.match((result as { ok: false; message: string }).message, /2 separate starting points/);
});

test("deriveIKChain: rejects a fork downstream of the base (r2 and r3 both chain onto r1's own output -- two arms, not one chain)", () => {
  const ops: GeometryOp[] = [pt("base"), rot("r1", "base", "c1"), rot("r2", "r1", "c2"), rot("r3", "r1", "c3")];
  const result = deriveIKChain(ops, new Set(["r1", "r2", "r3"]));
  assert.equal(result.ok, false);
  assert.match((result as { ok: false; message: string }).message, /fork/);
});

test("deriveIKChain: rejects a broken chain (r1 -> r3 selected, but r2 -- the link between them -- is not)", () => {
  const ops: GeometryOp[] = [pt("base"), rot("r1", "base", "c1"), rot("r2", "r1", "c2"), rot("r3", "r2", "c3")];
  const result = deriveIKChain(ops, new Set(["r1", "r3"]));
  assert.equal(result.ok, false);
  assert.match((result as { ok: false; message: string }).message, /separate starting points/);
});
