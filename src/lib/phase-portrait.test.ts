import assert from "node:assert/strict";
import { test } from "node:test";
import { ComplexNumber } from "mallory-math";
import { classifyFixedPoint, classifyFromEigenvalues, findFixedPoints } from "./phase-portrait.ts";
import type { OdeSystemSpec } from "./sample-ode.ts";

const DOMAIN = { min: -3, max: 3 };

test("classifyFromEigenvalues: real opposite signs -> saddle", () => {
  assert.equal(classifyFromEigenvalues([new ComplexNumber(2, 0), new ComplexNumber(-1, 0)]), "saddle");
});

test("classifyFromEigenvalues: real both negative -> stable node", () => {
  assert.equal(classifyFromEigenvalues([new ComplexNumber(-1, 0), new ComplexNumber(-2, 0)]), "stable-node");
});

test("classifyFromEigenvalues: real both positive -> unstable node", () => {
  assert.equal(classifyFromEigenvalues([new ComplexNumber(1, 0), new ComplexNumber(3, 0)]), "unstable-node");
});

test("classifyFromEigenvalues: complex pair with negative real part -> stable spiral", () => {
  assert.equal(classifyFromEigenvalues([new ComplexNumber(-0.5, 2), new ComplexNumber(-0.5, -2)]), "stable-spiral");
});

test("classifyFromEigenvalues: complex pair with positive real part -> unstable spiral", () => {
  assert.equal(classifyFromEigenvalues([new ComplexNumber(0.5, 2), new ComplexNumber(0.5, -2)]), "unstable-spiral");
});

test("classifyFromEigenvalues: purely imaginary pair -> center", () => {
  assert.equal(classifyFromEigenvalues([new ComplexNumber(0, 3), new ComplexNumber(0, -3)]), "center");
});

test("classifyFixedPoint: dx/dt=x, dy/dt=-y at the origin is a saddle", () => {
  const spec: OdeSystemSpec = { stateVars: ["x", "y"], independentVar: "t", derivatives: ["x", "-y"] };
  const result = classifyFixedPoint(spec, { x: 0, y: 0 }, 0);
  assert.equal(result.kind, "saddle");
});

test("classifyFixedPoint: dx/dt=-x, dy/dt=-2y at the origin is a stable node", () => {
  const spec: OdeSystemSpec = { stateVars: ["x", "y"], independentVar: "t", derivatives: ["-x", "-2*y"] };
  const result = classifyFixedPoint(spec, { x: 0, y: 0 }, 0);
  assert.equal(result.kind, "stable-node");
});

test("classifyFixedPoint: dx/dt=-y, dy/dt=x at the origin is a center", () => {
  const spec: OdeSystemSpec = { stateVars: ["x", "y"], independentVar: "t", derivatives: ["-y", "x"] };
  const result = classifyFixedPoint(spec, { x: 0, y: 0 }, 0);
  assert.equal(result.kind, "center");
  assert.ok(Math.abs(result.eigenvalues[0].iValue) > 0.9); // +-i
});

test("classifyFixedPoint: dx/dt=0.1*x-y, dy/dt=x+0.1*y at the origin is an unstable spiral", () => {
  const spec: OdeSystemSpec = { stateVars: ["x", "y"], independentVar: "t", derivatives: ["0.1*x-y", "x+0.1*y"] };
  const result = classifyFixedPoint(spec, { x: 0, y: 0 }, 0);
  assert.equal(result.kind, "unstable-spiral");
});

test("findFixedPoints: a linear system with a single fixed point at the origin is found without duplicates despite a dense seed grid", () => {
  const spec: OdeSystemSpec = { stateVars: ["x", "y"], independentVar: "t", derivatives: ["x - y", "x + y"] };
  const points = findFixedPoints(spec, DOMAIN, DOMAIN, 0, 9);
  assert.equal(points.length, 1);
  assert.ok(Math.abs((points[0] as { x: number }).x) < 1e-6);
  assert.ok(Math.abs((points[0] as { y: number }).y) < 1e-6);
});

test("findFixedPoints: a system with two distinct fixed points finds both", () => {
  // dx/dt = x(1-x) has roots x=0 and x=1; dy/dt = -y has root y=0.
  const spec: OdeSystemSpec = { stateVars: ["x", "y"], independentVar: "t", derivatives: ["x*(1-x)", "-y"] };
  const points = findFixedPoints(spec, { min: -1, max: 2 }, { min: -1, max: 1 }, 0, 7);
  assert.equal(points.length, 2);
  const xs = points.map((p) => (p as { x: number }).x).sort((a, b) => a - b);
  assert.ok(Math.abs((xs[0] as number) - 0) < 1e-4);
  assert.ok(Math.abs((xs[1] as number) - 1) < 1e-4);
});

test("findFixedPoints: a system with no fixed point in range returns an empty list rather than throwing", () => {
  const spec: OdeSystemSpec = { stateVars: ["x", "y"], independentVar: "t", derivatives: ["1", "1"] }; // dx/dt=1, dy/dt=1 never zero
  const points = findFixedPoints(spec, DOMAIN, DOMAIN, 0, 5);
  assert.equal(points.length, 0);
});
