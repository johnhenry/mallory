import assert from "node:assert/strict";
import { test } from "node:test";
import {
  angleSweepRadians,
  interiorAngleRadians,
  isSelfIntersecting,
  pointInPolygon,
  pointToSegmentDistance,
  polygonCentroid,
  projectFractionOntoSegment,
  shoelaceArea,
} from "./geometry.ts";

test("interiorAngleRadians reports 90 degrees for a right angle", () => {
  const a = { x: 1, y: 0 };
  const vertex = { x: 0, y: 0 };
  const c = { x: 0, y: 1 };
  assert.ok(Math.abs(interiorAngleRadians(a, vertex, c) - Math.PI / 2) < 1e-9);
});

test("interiorAngleRadians reports 180 degrees for a straight line", () => {
  const a = { x: -1, y: 0 };
  const vertex = { x: 0, y: 0 };
  const c = { x: 1, y: 0 };
  assert.ok(Math.abs(interiorAngleRadians(a, vertex, c) - Math.PI) < 1e-9);
});

test("interiorAngleRadians always reports the non-reflex angle", () => {
  // a at 10 degrees, c at 350 degrees -- the short way around is 20 degrees, not 340.
  const vertex = { x: 0, y: 0 };
  const a = { x: Math.cos((10 * Math.PI) / 180), y: Math.sin((10 * Math.PI) / 180) };
  const c = { x: Math.cos((350 * Math.PI) / 180), y: Math.sin((350 * Math.PI) / 180) };
  const angle = interiorAngleRadians(a, vertex, c);
  assert.ok(angle < Math.PI);
  assert.ok(Math.abs(angle - (20 * Math.PI) / 180) < 1e-6);
});

function deg(radians: number): number {
  return (radians * 180) / Math.PI;
}

test("angleSweepRadians: shorter/clickOrder/reflex on a=10deg, c=350deg (VA to VC the short way is -20deg, i.e. clockwise)", () => {
  const theta1 = (10 * Math.PI) / 180;
  const theta2 = (350 * Math.PI) / 180;
  assert.ok(Math.abs(deg(angleSweepRadians(theta1, theta2, "shorter")) - -20) < 1e-6, "shorter: -20 (20deg the short/clockwise way)");
  assert.ok(Math.abs(deg(angleSweepRadians(theta1, theta2, "clickOrder")) - 340) < 1e-6, "clickOrder: 340 (raw CCW sweep from a to c)");
  assert.ok(Math.abs(deg(angleSweepRadians(theta1, theta2, "reflex")) - 340) < 1e-6, "reflex: the complement of the 20deg shorter angle is 340");
});

test("angleSweepRadians: swapping a and c flips clickOrder's sweep but not shorter's or reflex's magnitude", () => {
  const theta1 = (10 * Math.PI) / 180;
  const theta2 = (350 * Math.PI) / 180;
  const forward = angleSweepRadians(theta1, theta2, "clickOrder");
  const backward = angleSweepRadians(theta2, theta1, "clickOrder");
  assert.ok(Math.abs(deg(forward) - 340) < 1e-6);
  assert.ok(Math.abs(deg(backward) - 20) < 1e-6, "swapping a/c gives the OTHER candidate (360 - 340 = 20)");
  // shorter/reflex don't care about argument order -- same magnitude either way.
  assert.ok(Math.abs(Math.abs(angleSweepRadians(theta1, theta2, "shorter")) - Math.abs(angleSweepRadians(theta2, theta1, "shorter"))) < 1e-9);
  assert.ok(Math.abs(Math.abs(angleSweepRadians(theta1, theta2, "reflex")) - Math.abs(angleSweepRadians(theta2, theta1, "reflex"))) < 1e-9);
});

test("interiorAngleRadians: mode='reflex' reports the complement of the default shorter angle for a 90deg right angle", () => {
  const a = { x: 1, y: 0 };
  const vertex = { x: 0, y: 0 };
  const c = { x: 0, y: 1 };
  assert.ok(Math.abs(interiorAngleRadians(a, vertex, c, "reflex") - (3 * Math.PI) / 2) < 1e-9, "360 - 90 = 270 degrees");
});

test("interiorAngleRadians: mode='clickOrder' is directional -- swapping a/c changes the result for a non-180deg angle", () => {
  const a = { x: 1, y: 0 };
  const vertex = { x: 0, y: 0 };
  const c = { x: 0, y: 1 };
  const forward = interiorAngleRadians(a, vertex, c, "clickOrder");
  const backward = interiorAngleRadians(c, vertex, a, "clickOrder");
  assert.ok(Math.abs(forward - Math.PI / 2) < 1e-9, "VA(0deg) to VC(90deg) CCW is 90deg");
  assert.ok(Math.abs(backward - (3 * Math.PI) / 2) < 1e-9, "VC(90deg) to VA(0deg) CCW is 270deg");
});

test("shoelaceArea computes a unit square's area as 1", () => {
  const square = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];
  assert.ok(Math.abs(shoelaceArea(square) - 1) < 1e-9);
});

test("shoelaceArea computes a right triangle's area correctly", () => {
  const triangle = [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 0, y: 3 },
  ];
  assert.ok(Math.abs(shoelaceArea(triangle) - 6) < 1e-9);
});

test("shoelaceArea is winding-order independent (abs value)", () => {
  const clockwise = [
    { x: 0, y: 0 },
    { x: 0, y: 1 },
    { x: 1, y: 1 },
    { x: 1, y: 0 },
  ];
  assert.ok(Math.abs(shoelaceArea(clockwise) - 1) < 1e-9);
});

test("isSelfIntersecting is false for a simple square", () => {
  const square = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];
  assert.equal(isSelfIntersecting(square), false);
});

test("isSelfIntersecting is true for a bowtie ordering of the same square's corners", () => {
  // Perimeter order would be BL, BR, TR, TL -- this crossed order (BL, BR,
  // TL, TR) makes edges BR->TL and TR->BL cross in the middle.
  const bowtie = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: 1, y: 1 },
  ];
  assert.equal(isSelfIntersecting(bowtie), true);
});

test("isSelfIntersecting is false for a triangle (no non-adjacent edge pairs exist)", () => {
  const triangle = [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 0, y: 3 },
  ];
  assert.equal(isSelfIntersecting(triangle), false);
});

test("isSelfIntersecting is true for a pentagram (5 points on a circle visited in star order)", () => {
  // Visiting every second point of a regular pentagon traces the classic
  // five-pointed star, which self-intersects by construction.
  const star = [0, 2, 4, 1, 3].map((k) => ({
    x: Math.cos((2 * Math.PI * k) / 5),
    y: Math.sin((2 * Math.PI * k) / 5),
  }));
  assert.equal(isSelfIntersecting(star), true);
});

test("polygonCentroid of the unit square is exactly (0.5, 0.5)", () => {
  const square = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];
  const c = polygonCentroid(square);
  assert.ok(Math.abs(c.x - 0.5) < 1e-12);
  assert.ok(Math.abs(c.y - 0.5) < 1e-12);
});

test("polygonCentroid of an L-shape is area-weighted, not the vertex average", () => {
  // A 2x1 rectangle (area 2, centroid (1, 0.5)) plus a 1x1 square on top of
  // its left half (area 1, centroid (0.5, 1.5)): true centroid is
  // (2*1 + 1*0.5)/3 = (2*0.5 + 1*1.5)/3 = 2.5/3. The naive vertex average
  // of these 6 corners is (1, 1) -- measurably different.
  const lShape = [
    { x: 0, y: 0 },
    { x: 2, y: 0 },
    { x: 2, y: 1 },
    { x: 1, y: 1 },
    { x: 1, y: 2 },
    { x: 0, y: 2 },
  ];
  const c = polygonCentroid(lShape);
  assert.ok(Math.abs(c.x - 2.5 / 3) < 1e-12);
  assert.ok(Math.abs(c.y - 2.5 / 3) < 1e-12);
  assert.ok(Math.abs(c.x - 1) > 0.1); // and it is NOT the vertex average
});

test("polygonCentroid falls back to the vertex average for a degenerate (collinear) polygon", () => {
  const collinear = [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
    { x: 2, y: 2 },
  ];
  const c = polygonCentroid(collinear);
  assert.ok(Math.abs(c.x - 1) < 1e-12);
  assert.ok(Math.abs(c.y - 1) < 1e-12);
});

test("pointToSegmentDistance: zero for a point ON the segment", () => {
  assert.ok(Math.abs(pointToSegmentDistance({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 2, y: 0 })) < 1e-12);
});

test("pointToSegmentDistance: perpendicular distance for a point off to the side", () => {
  assert.ok(Math.abs(pointToSegmentDistance({ x: 1, y: 3 }, { x: 0, y: 0 }, { x: 2, y: 0 }) - 3) < 1e-12);
});

test("pointToSegmentDistance: clamps to the nearest ENDPOINT, not the infinite line, past either end", () => {
  // Directly "below" (0,0) on the infinite line's extension -- distance to
  // the endpoint (0,0) is 4, not the (smaller) perpendicular-to-line distance.
  assert.ok(Math.abs(pointToSegmentDistance({ x: -4, y: 0 }, { x: 0, y: 0 }, { x: 2, y: 0 }) - 4) < 1e-12);
});

test("pointToSegmentDistance: degenerate segment (a === b) falls back to plain point distance", () => {
  assert.ok(Math.abs(pointToSegmentDistance({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 }) - 5) < 1e-12);
});

test("pointInPolygon: true for a point inside a simple square, false for one clearly outside", () => {
  const square = [
    { x: 0, y: 0 },
    { x: 2, y: 0 },
    { x: 2, y: 2 },
    { x: 0, y: 2 },
  ];
  assert.equal(pointInPolygon({ x: 1, y: 1 }, square), true);
  assert.equal(pointInPolygon({ x: 5, y: 5 }, square), false);
});

test("pointInPolygon: false for a point outside a triangle", () => {
  const triangle = [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 0, y: 4 },
  ];
  assert.equal(pointInPolygon({ x: 3, y: 3 }, triangle), false); // outside the hypotenuse
  assert.equal(pointInPolygon({ x: 1, y: 1 }, triangle), true);
});

test("projectFractionOntoSegment: 0 at a, 1 at b, 0.5 at the midpoint", () => {
  const a = { x: 0, y: 0 };
  const b = { x: 10, y: 0 };
  assert.equal(projectFractionOntoSegment(a, a, b), 0);
  assert.equal(projectFractionOntoSegment(b, a, b), 1);
  assert.equal(projectFractionOntoSegment({ x: 5, y: 3 }, a, b), 0.5); // off-line, but projects to the midpoint
});

test("projectFractionOntoSegment: clamps to [0, 1] past either endpoint, unlike pointToSegmentDistance's internal unclamped projection", () => {
  const a = { x: 0, y: 0 };
  const b = { x: 10, y: 0 };
  assert.equal(projectFractionOntoSegment({ x: -5, y: 0 }, a, b), 0);
  assert.equal(projectFractionOntoSegment({ x: 15, y: 0 }, a, b), 1);
});

test("projectFractionOntoSegment: a degenerate segment (a === b) doesn't divide by zero", () => {
  const a = { x: 3, y: 3 };
  assert.equal(projectFractionOntoSegment({ x: 9, y: 9 }, a, a), 0);
});
