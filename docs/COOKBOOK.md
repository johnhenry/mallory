# mallory-graph Cookbook

Runnable examples of the reusable pieces in `src/lib/` that panels are built
on top of -- the reactive `CellGraph` core, the sampler layer, and the
Symbolic-math bridges (graph theory, matrices, natural-language queries,
interval arithmetic).

Every ` ```ts ` block below is executed by `docs/cookbook.test.ts` in CI
(issue #41's docs-as-tests item, mirroring the pattern from
[mallory#17](https://github.com/johnhenry/mallory)). A line ending in
`// => <expression>` additionally asserts that the documented value is
still exactly what the code produces -- so if a signature or a default
changes, this file fails CI instead of quietly going stale.

## Sampling a curve

`sampleExpr` walks a parsed expression over a uniform grid, producing a
`Path2D` (mallory-math's, not the browser's) that the Canvas2D drawers
consume directly.

```ts
import { sampleExpr } from "mallory-graph/sample-function";

const path = sampleExpr("x^2", { min: 0, max: 2 }, 3);
path.commands; // => [{"op":"moveTo","x":0,"y":0},{"op":"lineTo","x":1,"y":1},{"op":"lineTo","x":2,"y":4}]
path.stroke.color; // => 2450411
```

## Adaptive refinement resolves sharp features a uniform grid misses

`sampleExprAdaptive` bisects a base-grid segment further wherever the
midpoint sample deviates from straight-line interpolation -- a narrow
bump that a coarse uniform grid straddles almost entirely gets resolved,
while a gentle curve costs the same as `sampleExpr` (issue #52).

```ts
import { sampleExpr, sampleExprAdaptive } from "mallory-graph/sample-function";

// exp(-100*x^2) is a narrow spike near x=0 -- a 5-point base grid over
// [-1,1] only samples near x=0,±0.5,±1, mostly missing the peak.
const uniform = sampleExpr("exp(-100*x^2)", { min: -1, max: 1 }, 5);
uniform.commands.length; // => 5

const adaptive = sampleExprAdaptive("exp(-100*x^2)", { min: -1, max: 1 }, 5, "x", {}, 0x2563eb, { maxDepth: 6, tolerance: 1e-4 });
adaptive.commands.length; // => 75
```

## The refinement tolerance scales with the visible viewport

`resolveAdaptiveTolerance` (issue #52's "refinement budget" fix): with no
explicit override, the tolerance is `1e-4` of the visible y-span, so a
zoomed-in viewport (small span) refines down to a tighter absolute
deviation than a zoomed-out one.

```ts
import { resolveAdaptiveTolerance } from "mallory-graph/sample-function";

resolveAdaptiveTolerance(undefined, { min: -1000, max: 1000 }); // => 0.2
resolveAdaptiveTolerance(undefined, { min: -1, max: 1 }); // => 0.0002
```

## A reactive computation with CellGraph

`CellGraph` is this app's own dependency-tracking reactive core (see the
README's "A note on 'graph'" table -- distinct from `Graph<T>`, mallory-math's
graph-theory type). A `define`d cell recomputes automatically when a `set`
cell it reads changes.

```ts
import { CellGraph } from "mallory-graph/cell-graph";

const graph = new CellGraph();
graph.set("a", 3);
graph.set("b", 4);
graph.define("sum", () => graph.get("a") + graph.get("b"));
graph.get("sum"); // => 7

graph.set("a", 10);
graph.get("sum"); // => 14
```

## Graph theory: BFS and Dijkstra over a text edge list

`parseEdgeListText` reads the same `"A B <weight>"`-per-line format the
Graph Theory panel's textarea accepts, into a real mallory-math `Graph<T>`.

```ts
import { parseEdgeListText, runBfs, runDijkstra, runShortestPath } from "mallory-graph/graph-ops";

const g = parseEdgeListText("A B 1\nB C 2\nA C 5", false);

runBfs(g, "A").order; // => ["A","B","C"]
runDijkstra(g, "A").distances; // => [{"vertex":"A","distance":0},{"vertex":"B","distance":1},{"vertex":"C","distance":3}]

const sp = runShortestPath(g, "A", "C");
sp.distance; // => 3
sp.path; // => ["A","B","C"]
```

## Matrix determinant

```ts
import { computeDeterminant, parseMatrixText } from "mallory-graph/matrix-ops";

const m = parseMatrixText("2 0\n0 3");
computeDeterminant(m); // => {"value":6}
```

## Natural-language query resolution

The NL query layer turns a plain-English phrase into an expression string
the graphing panels can plot directly.

```ts
import { resolveNaturalLanguageQuery } from "mallory-graph/nl-query";

resolveNaturalLanguageQuery("integral of cos(x)"); // => "sin(x)"
resolveNaturalLanguageQuery("simplify x + 0"); // => "x"
resolveNaturalLanguageQuery("expand (x+1)^2"); // => "x^2 + 2*x + 1"

// Not a recognized pattern -- returns null rather than guessing.
resolveNaturalLanguageQuery("x^2 + 1"); // => null
```

## Turning an equation into an implicit zero-expression

Every equation typed as `lhs = rhs` (e.g. the implicit plotter, or a
system-solver row) is reduced to a single `lhs - rhs` expression before
sampling, so "the curve where this is zero" is one uniform concept.

```ts
import { equationToImplicitZero } from "mallory-graph/equation-to-zero";

equationToImplicitZero("x^2+y^2=4"); // => "(x^2+y^2)-(4)"
```

## Rigorous interval-arithmetic bounds

`evaluateInterval` (issue #21) walks a parsed expression over `Interval`
values instead of floats -- true bounds propagation, not a point sample at
each end.

```ts
import { Interval, Symbolic } from "mallory-math";
import { evaluateInterval } from "mallory-graph/interval-eval";

const expr = Symbolic.parse("x^2");
const result = evaluateInterval(expr, { x: new Interval(1, 2) });
result.lo; // => 1
result.hi; // => 4
```
