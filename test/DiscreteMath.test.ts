import assert from "node:assert/strict";
import { test } from "node:test";
import { ComplexNumber } from "../src/ComplexNumber.ts";
import { FFT } from "../src/FFT.ts";
import { Geometry, type Point, Transform2D } from "../src/Geometry.ts";
import { Graph } from "../src/Graph.ts";

const close = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;

// --- FFT ---

test("fft of a delta is flat; matches dft", () => {
  const x = [1, 0, 0, 0];
  const X = FFT.fft(x);
  assert.ok(X.every((c) => close(c.value, 1) && close(c.iValue, 0)));
  // fft matches the direct dft
  const sig = [1, 2, 3, 4];
  const a = FFT.fft(sig);
  const b = FFT.dft(sig);
  assert.ok(a.every((c, i) => close(c.value, b[i].value, 1e-9) && close(c.iValue, b[i].iValue, 1e-9)));
});

test("ifft inverts fft", () => {
  const x = [1, 2, 3, 4, 5, 6, 7, 8].map((v) => new ComplexNumber(v, 0));
  const round = FFT.ifft(FFT.fft(x));
  assert.ok(round.every((c, i) => close(c.value, x[i].value, 1e-9)));
});

test("fft requires power-of-two length; fftPadded does not", () => {
  assert.throws(() => FFT.fft([1, 2, 3]));
  assert.equal(FFT.fftPadded([1, 2, 3]).length, 4);
});

test("convolution via FFT matches direct convolution", () => {
  const a = [1, 2, 3];
  const b = [4, 5, 6];
  const conv = FFT.convolve(a, b).map((c) => Math.round(c.value));
  // direct: [4, 13, 28, 27, 18]
  assert.deepEqual(conv, [4, 13, 28, 27, 18]);
});

// --- Geometry ---

test("convex hull of a point cloud", () => {
  const pts: Point[] = [
    [0, 0],
    [1, 1],
    [2, 2],
    [2, 0],
    [0, 2],
    [1, 0.5],
  ];
  const hull = Geometry.convexHull(pts);
  // the 4 corners of the square (the interior point and collinear midpoint drop out)
  assert.equal(hull.length, 4);
  assert.ok(close(Geometry.polygonArea(hull), 4));
});

test("orientation, segment intersection, point-in-polygon", () => {
  assert.ok(Geometry.orientation([0, 0], [1, 0], [0, 1]) > 0, "CCW");
  assert.equal(Geometry.segmentsIntersect([0, 0], [2, 2], [0, 2], [2, 0]), true);
  assert.equal(Geometry.segmentsIntersect([0, 0], [1, 1], [2, 2], [3, 3]), false);
  const square: Point[] = [
    [0, 0],
    [4, 0],
    [4, 4],
    [0, 4],
  ];
  assert.equal(Geometry.pointInPolygon([2, 2], square), true);
  assert.equal(Geometry.pointInPolygon([5, 5], square), false);
});

test("distance to segment", () => {
  assert.ok(close(Geometry.distancePointToSegment([1, 1], [0, 0], [2, 0]), 1));
});

test("Transform2D compose and apply", () => {
  const t = Transform2D.translation(1, 2).multiply(Transform2D.rotation(Math.PI / 2));
  const [x, y] = t.apply([1, 0]); // rotate (1,0)->(0,1) then translate -> (1,3)
  assert.ok(close(x, 1) && close(y, 3));
  const s = Transform2D.scaling(2, 3).apply([2, 2]);
  assert.deepEqual(
    s.map((v) => Math.round(v)),
    [4, 6],
  );
});

// --- Graph ---

test("bfs / dfs traversal", () => {
  const g = new Graph<string>();
  g.addEdge("a", "b").addEdge("a", "c").addEdge("b", "d");
  assert.deepEqual(g.bfs("a"), ["a", "b", "c", "d"]);
  assert.equal(g.dfs("a").length, 4);
});

test("dijkstra shortest path", () => {
  const g = new Graph<string>(true);
  g.addEdge("a", "b", 1).addEdge("b", "c", 2).addEdge("a", "c", 10).addEdge("c", "d", 1);
  const { distance, path } = g.shortestPath("a", "d");
  assert.equal(distance, 4);
  assert.deepEqual(path, ["a", "b", "c", "d"]);
});

test("connected components and cycle detection", () => {
  const g = new Graph<number>();
  g.addEdge(1, 2).addEdge(3, 4).addVertex(5);
  assert.equal(g.connectedComponents().length, 3);
  assert.equal(g.hasCycle(), false);
  g.addEdge(1, 3).addEdge(2, 3);
  assert.equal(g.hasCycle(), true);
});

test("topological sort of a DAG (null on cycle)", () => {
  const dag = new Graph<string>(true);
  dag.addEdge("shirt", "tie").addEdge("tie", "jacket").addEdge("shirt", "belt");
  const order = dag.topologicalSort();
  assert.ok(order);
  assert.ok(order.indexOf("shirt") < order.indexOf("tie"));
  const cyclic = new Graph<number>(true);
  cyclic.addEdge(1, 2).addEdge(2, 1);
  assert.equal(cyclic.topologicalSort(), null);
});

test("minimum spanning tree (Kruskal)", () => {
  const g = new Graph<string>();
  g.addEdge("a", "b", 1).addEdge("b", "c", 2).addEdge("a", "c", 3).addEdge("c", "d", 4);
  const mst = g.minimumSpanningTree();
  assert.equal(mst.length, 3);
  assert.equal(
    mst.reduce((s, e) => s + e.weight, 0),
    7,
  );
});

test("Floyd-Warshall all-pairs distances", () => {
  const g = new Graph<string>(true);
  g.addEdge("a", "b", 1).addEdge("b", "c", 2).addEdge("a", "c", 10);
  const { distances, order } = g.floydWarshall();
  const ai = order.indexOf("a");
  const ci = order.indexOf("c");
  assert.equal(distances[ai][ci], 3, "a->b->c shorter than a->c");
});
