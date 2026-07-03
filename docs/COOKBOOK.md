# Cookbook

Task-oriented recipes across every domain mallory covers. Each snippet is
self-contained, runnable, and pulled directly from the test suite (or verified
against it) — see the linked test file if you want the full context.

All examples assume:

```ts
import { /* ... */ } from "mallory-math";
```

## Complex numbers & Euler's identity

```ts
import { ComplexNumber } from "mallory-math";

const eulers = ComplexNumber.E.power(new ComplexNumber(0, Math.PI));
// eulers ≈ -1 + 0i
```

See [`test/ComplexNumber.test.ts`](../test/ComplexNumber.test.ts).

## Descriptive statistics

```ts
import { Statistics, Vector } from "mallory-math";

const sample = Vector.fromArray([2, 4, 4, 4, 5, 5, 7, 9]);
Statistics.mean(sample); // 5
Statistics.variance(sample); // sample variance (n-1 denominator)
Statistics.populationVariance(sample); // population variance (n denominator) = 4
```

## Numeric linear algebra basics

For small dense matrices with a single number type, `Structure.realField()`
(or `complexField()`) provides direct matrix operations — the same generic
API used for arbitrary fields below:

```ts
import { Structure, Vector } from "mallory-math";

const A = Vector.fromArray([Vector.fromArray([4, 3]), Vector.fromArray([6, 3])]);
const real = Structure.realField();
real.determinant(A); // -6
const inv = real.invertMatrix(A); // partial pivoting, no divide-by-zero
real.multiplyMatrix(A, inv); // ≈ identity
```

## Linear algebra over an arbitrary algebraic structure

`Structure` generalizes the same matrix operations over any field/ring —
finite fields, rationals, quaternions, dual numbers — via one generic API:

```ts
import { Structure, Vector } from "mallory-math";

const gf7 = Structure.integersModulo(7); // GF(7), a finite field
gf7.reciprocal(3); // 5  (3 * 5 = 15 ≡ 1 mod 7)

const a = Vector.fromArray([Vector.fromArray([2, 3]), Vector.fromArray([1, 4])]);
const inv = gf7.invertMatrix(a); // Gauss-Jordan over GF(7)
gf7.multiplyMatrix(a, inv); // identity matrix, entries mod 7
```

Swap in `Structure.rationalField()` for exact fraction arithmetic, or
`Structure.quaternionRing()`/`Structure.dualNumbers()` to do linear algebra
over those number types with no extra wiring. See
[`test/Structure.test.ts`](../test/Structure.test.ts) and
[`test/NumberTypes.test.ts`](../test/NumberTypes.test.ts).

## Numerical linear algebra (decompositions, least squares)

`MatrixMath` accepts either a `Matrix<number>` or a plain `number[][]`:

```ts
import { MatrixMath } from "mallory-math";

const A = [
  [4, 3, 2],
  [6, 3, 4],
  [1, 2, 5],
];
MatrixMath.solve(A, [1, 2, 3]); // LU with partial pivoting

const sym = [
  [2, 1],
  [1, 2],
];
MatrixMath.eigenSymmetric(sym); // { values, vectors }, descending order

MatrixMath.leastSquares(A, [1, 2, 3]); // normal-equations fit
MatrixMath.svd(A); // { U, singularValues, V }
MatrixMath.conditionNumber(A); // spectral norm ratio
```

See [`test/MatrixMath.test.ts`](../test/MatrixMath.test.ts).

## Evaluating math expression strings

```ts
import { StringEvaluator } from "mallory-math";

const env = StringEvaluator.mathEnvironment(); // pi, e, sin, cos, sqrt, ...
StringEvaluator.evaluate("sin(pi/2) + 2^3", env); // ComplexNumber ≈ 9
```

Custom variables can be added via `new Environment("x", 3)` (see
[`src/Environment.ts`](../src/Environment.ts)) and passed instead of/merged
with `mathEnvironment()`.

## Polynomials

Real-number polynomials are `PolynomialRing(Structure.realField())`, plus two
real-only helpers for the `"3*x^2-2*x+1"` string notation:

```ts
import { PolynomialRing, Structure, parsePolynomial, polynomialToString } from "mallory-math";

const R = new PolynomialRing(Structure.realField());
const p = parsePolynomial("x^2 + 2x + 1"); // parses polynomialToString's own format
R.evaluate(p, 3); // 16
R.evaluate(R.derivative(p), 3); // 8
R.divmod(p, parsePolynomial("x + 1")); // long division: { quotient, remainder }
polynomialToString(p); // "1*x^2+2*x+1"
```

## Counting mathematics (combinatorics)

```ts
import { Combinatorics } from "mallory-math";

Combinatorics.factorial(5); // 120n
Combinatorics.binomial(10, 3); // 120n  (nCk, symmetric: nCk = nC(n-k))
Combinatorics.permutationsCount(5, 3); // 60n  (nPk)
Combinatorics.multinomial(10, [2, 3, 5]); // 2520n

Combinatorics.catalan(5); // 42n  (balanced parenthesizations, binary trees, ...)
Combinatorics.stirlingSecond(4, 2); // 7n  (partitions of a 4-set into 2 unlabeled subsets)
Combinatorics.bell(4); // 15n  (total partitions of a 4-set)
Combinatorics.partitionCount(5); // 7n  (integer partitions of 5)
Combinatorics.derangements(4); // 9n  (permutations of 4 with no fixed point)
```

Everything is `bigint`-based (matching `NumberTheory`'s convention), since
factorial-scale values exceed `Number.MAX_SAFE_INTEGER` well before `n`
reaches 20. See
[`test/CombinatoricsCounting.test.ts`](../test/CombinatoricsCounting.test.ts).

## Arbitrary-precision decimals

```ts
import { Decimal, Structure } from "mallory-math";

// Exact decimal arithmetic — no float drift:
Decimal.from("0.1").add(Decimal.from("0.2")).toString(); // "0.3" (0.1 + 0.2 !== 0.3 in plain JS)

// Division is inherently approximate; precision (significant digits) is configurable:
Decimal.from(1).divide(Decimal.from(3), 10).toString(); // "0.3333333333"

// Also a Structure preset, for linear algebra over exact decimals:
const decimals = Structure.decimalField();
decimals.multiply(Decimal.from("1.5"), Decimal.from("2.5")).toString(); // "3.75"
```

See [`test/Decimal.test.ts`](../test/Decimal.test.ts).

## Polynomials over arbitrary algebraic structures

`PolynomialRing` works over any `Structure` — finite fields, the rationals,
real numbers (as in the recipe above), and so on — mirroring `GroupTheory`'s
idiom of taking the algebra as a constructor parameter:

```ts
import { PolynomialRing, Structure } from "mallory-math";

const gf7 = Structure.integersModulo(7); // GF(7), a finite field
const R = new PolynomialRing(gf7);

const p1 = [2, 4, 1]; // (x-1)(x-2) mod 7
const p2 = [3, 3, 1]; // (x-1)(x-3) mod 7
R.gcd(p1, p2); // [6, 1] -- monic (x - 1), the shared root at x=1

R.toString(p1); // "1*x^2+4*x+2"
R.evaluate(p1, 5); // Horner's method, using gf7's field operations
```

Swap in `Structure.rationalField()` for exact polynomial division over the
rationals. See
[`test/PolynomialRing.test.ts`](../test/PolynomialRing.test.ts).

## Symbolic calculus

```ts
import { Symbolic } from "mallory-math";

Symbolic.toString(Symbolic.differentiate("x^3")); // "3*x^2"
Symbolic.toString(Symbolic.integrate("cos(x)")); // "sin(x)"
Symbolic.toString(Symbolic.integrate("x*sin(x)")); // "sin(x) - x*cos(x)" — integration by parts
Symbolic.toString(Symbolic.taylor("exp(x)", "x", 0, 4)); // Taylor series about 0
Symbolic.evaluate("x^2 + 1", { x: 3 }); // 10

// Algebraic simplification collects like terms, not just identities:
Symbolic.toString(Symbolic.simplify("a*b + b*a")); // "2*(a*b)"
Symbolic.toString(Symbolic.expand("(x+1)^2")); // "x^2 + 2*x + 1"
Symbolic.toString(Symbolic.substitute("x^2 + 1", "x", "y+1")); // in terms of y

// Polynomial solving/factoring (degree <= 6; real roots only):
Symbolic.solve("x^2 - 5*x + 6").map(Symbolic.toString); // ["3", "2"]
Symbolic.toString(Symbolic.factor("x^2 - 1")); // "(x - 1)*(x + 1)"

Symbolic.limit("sin(x)/x", "x", 0); // 1 — via L'Hopital's rule
Symbolic.toLatex("x^2/2"); // "\\frac{x^{2}}{2}"

// fromLatex is the reverse of toLatex, for LaTeX-emitting math-field input:
Symbolic.toString(Symbolic.fromLatex("\\frac{x^{2}}{2}")); // "x^2/2"
Symbolic.toString(Symbolic.fromLatex("\\sqrt[3]{x}")); // "cbrt(x)" — not a fractional power,
// since Math.cbrt(-8) = -2 but (-8)^(1/3) is NaN under JS's `**`.
Symbolic.toString(Symbolic.fromLatex("\\sqrt[5]{x}")); // "x^(1/5)" — any other root stays a fractional power

// arcsin/arccos/arctan/arcsinh/arccosh/arctanh are accepted as aliases for
// asin/acos/atan/asinh/acosh/atanh — both spellings parse identically:
Symbolic.toString(Symbolic.parse("arctan(x)")); // "atan(x)"
Symbolic.toString(Symbolic.parse("logistic(x)")); // "sigmoid(x)" — logistic is an alias for sigmoid

// |x| bar notation and \lfloor/\lceil round-trip too:
Symbolic.toLatex("abs(x)"); // "\\left|x\\right|"
Symbolic.toString(Symbolic.fromLatex("\\left\\lfloor x\\right\\rfloor")); // "floor(x)"
Symbolic.evaluate(Symbolic.fromLatex("\\log_{2}(x)"), { x: 8 }); // 3 — \log defaults to base 10, or reads a subscript

// Functions with no standard bare LaTeX command (sech, csch, arcsinh, arccosh,
// arctanh, and the newer inverse-reciprocal/programmatic functions below)
// round-trip through \operatorname{...}, matching KaTeX/MathJax:
Symbolic.toLatex("sech(x)"); // "\\operatorname{sech}\\left(x\\right)"
Symbolic.toString(Symbolic.fromLatex("\\operatorname{sech}(x)")); // "sech(x)"

// N-ary functions (atan2/hypot/min/max/gcd/lcm) fold pairwise into nested
// binary call2 nodes, so N >= 2 arguments all work:
Symbolic.evaluate("hypot(3,4)", {}); // 5
Symbolic.evaluate("min(3,7,-2,5)", {}); // -2
Symbolic.evaluate("atan2(1,1)", {}); // 0.7853981633974483

// log(base, x) and clamp(x, lo, hi) desugar into existing constructs at parse
// time — they're not their own Expr node type:
Symbolic.evaluate("log(2,8)", {}); // 3 — desugars to ln(x)/ln(base)
Symbolic.evaluate("clamp(15,0,10)", {}); // 10 — desugars to min(max(x,lo),hi)

// min/max/gcd round-trip through standard LaTeX commands; atan2/hypot/lcm
// (no standard command) use \operatorname{...}, same as sech/csch above:
Symbolic.toLatex("min(x,y)"); // "\\min\\left(x, y\\right)"
Symbolic.toLatex("atan2(y,x)"); // "\\operatorname{atan2}\\left(y, x\\right)"
```

`Symbolic.parse` recognizes 41 unary elementary functions:

- `sin/cos/tan`, `asin/acos/atan` (+ `arcsin/arccos/arctan` aliases)
- `sinh/cosh/tanh`, `asinh/acosh/atanh` (+ `arcsinh/arccosh/arctanh` aliases)
- reciprocal-trig `cot/sec/csc` and reciprocal-hyperbolic `coth/sech/csch`
- inverse-reciprocal-trig `acot/asec/acsc` (+ `arccot/arcsec/arccsc` aliases)
  and inverse-reciprocal-hyperbolic `acoth/asech/acsch` (+ `arccoth/arcsech/arccsch` aliases)
- `exp/ln/sqrt/cbrt/log10/log2`
- `abs` (also via `|x|` bar syntax), `floor/ceil/round/trunc/sign` (+ `sgn` alias)
- `expm1/log1p` (precision-preserving `e^x - 1` / `ln(1+x)`) and
  `sigmoid` (+ `logistic` alias), `erf`, `relu` — common in numerical/ML code

Plus six N-ary `BinaryFuncName`s (user-facing arity N >= 2, pairwise-folded
into nested binary `call2` nodes at parse time; `atan2` alone requires exactly
2 arguments) and two functions that desugar entirely into existing constructs:

- `atan2(y, x)`, `hypot(x1, x2, ...)` — differentiate via the multivariate
  chain rule
- `min(a, b, ...)`, `max(a, b, ...)` — differentiate via a `sign`-based
  formula, correct on both sides of the kink
- `gcd(a, b, ...)`, `lcm(a, b, ...)` — integer-valued, derivative is `0`
  (same convention as `floor`/`ceil`/`round`/`sign`/`trunc`)
- `log(base, x)` desugars to `ln(x)/ln(base)`; `clamp(x, lo, hi)` desugars to
  `min(max(x, lo), hi)` — neither is its own `Expr` node type

`FUNCTION_NAMES` (exported alongside `Symbolic`) lists every recognized name —
canonical and alias — for consumers that need to know what counts as a known
function identifier without hand-duplicating this list (e.g. a UI's
implicit-multiplication preprocessor deciding whether `arctan` is one
identifier or four). Every one of these differentiates, evaluates, compiles,
and round-trips through `toLatex`/`fromLatex`.

Integration covers the elementary rules (power rule, `1/x`, linear-substitution
`sin`/`cos`/`exp`, integration by parts for a polynomial times `sin`/`cos`/`exp`,
and arctan/arcsin forms); anything outside that set throws `NotIntegrableError`
rather than returning a wrong answer — e.g. `Symbolic.integrate("sin(x^2)")`.

## Multivariable calculus

```ts
import { DualNumber, VectorCalculus } from "mallory-math";

// f(x, y) = x^2*y + y^3
const f = (xs: DualNumber[]) => xs[0].pow(2).multiply(xs[1]).add(xs[1].pow(3));

VectorCalculus.gradient(f, [1, 2]); // [4, 13] — exact, via DualNumber autodiff
VectorCalculus.directionalDerivative(f, [1, 2], [3, 4]); // 12.8 — direction need not be a unit vector
VectorCalculus.hessian(f, [1, 2]); // [[4, 2], [2, 12]] — central differences of the exact gradient

// F: R^2 -> R^2
const F = (xs: DualNumber[]) => [xs[0].pow(2).multiply(xs[1]), xs[0].add(xs[1].pow(2))];
VectorCalculus.jacobian(F, [1, 2]); // [[4, 1], [1, 4]]

// a rotational field F(x,y,z) = (-y, x, 0)
const rot = (xs: DualNumber[]) => [xs[1].negate(), xs[0], DualNumber.constant(0)];
VectorCalculus.curl3D(rot, [0, 0, 0]); // [0, 0, 2]

// exact multivariable partials from a string expression, via Symbolic:
VectorCalculus.symbolicGradient("x^2*y + y^3", ["x", "y"], { x: 1, y: 2 }); // [4, 13]
```

`gradient`/`jacobian`/`divergence`/`curl3D` are exact (forward-mode autodiff);
`hessian` is the one approximate method — central differences of the *exact*
gradient, not of `f` itself. See
[`test/VectorCalculus.test.ts`](../test/VectorCalculus.test.ts).

## Exact and specialized number types

```ts
import { Rational, Quaternion, DualNumber, Interval } from "mallory-math";

// Exact fractions (no floating-point drift)
Rational.from(1).divide(new Rational(3n)).add(Rational.from(1).divide(new Rational(6n))); // 1/2 exactly

// 3D rotation via quaternions (no gimbal lock)
const q = Quaternion.fromAxisAngle([0, 0, 1], Math.PI / 2);
q.rotateVector([1, 0, 0]); // ≈ [0, 1, 0]

// Forward-mode automatic differentiation — exact derivatives, no finite differences
DualNumber.derivative((x) => DualNumber.sin(x.multiply(x)), 1); // d/dx sin(x²) at x=1

// Rigorous numeric bounds
Interval.of(-2, 3).pow(2); // [0, 9] — correctly handles the range straddling zero
```

See [`test/NumberTypes.test.ts`](../test/NumberTypes.test.ts).

## Number theory

```ts
import { NumberTheory } from "mallory-math";

NumberTheory.isProbablePrime(2n ** 61n - 1n); // true (Mersenne prime)
NumberTheory.isProbablePrime(561n); // false (Carmichael number — not a false positive)
NumberTheory.factorize(360n); // [[2n,3],[3n,2],[5n,1]]
NumberTheory.crt([2n, 3n, 2n], [3n, 5n, 7n]); // { x: 23n, modulus: 105n }
```

Everything here is `bigint`-based, so it's exact for arbitrarily large inputs
(no `Number.MAX_SAFE_INTEGER` ceiling).

## Group theory

```ts
import { Structure, GroupTheory } from "mallory-math";

// GroupTheory composes with any Structure preset:
const gf7 = Structure.integersModulo(7);
const units = [1, 2, 3, 4, 5, 6];
GroupTheory.isGroup(units, gf7.multiply, gf7.equality); // true — GF(7)'s multiplicative group

const { op, identity } = GroupTheory.cyclicGroup(4);
GroupTheory.elementOrder(1, op, (a, b) => a === b, identity); // 4

GroupTheory.symmetricGroup(3); // all 6 permutations of {0,1,2} as a group
```

See [`test/NumberTheory.test.ts`](../test/NumberTheory.test.ts) for the S₃
non-abelian example and the Lagrange's-theorem cosets/index check.

## Root-finding, quadrature, and ODEs

```ts
import { Numerical } from "mallory-math";

Numerical.newton((x) => x * x - 2, 1); // √2, quadratic convergence
Numerical.brent((x) => x * x - 2, 0, 2); // hybrid bisection/secant/inverse-quadratic

Numerical.simpson(Math.sin, 0, Math.PI); // ∫ sin = 2
Numerical.gaussLegendre((x) => x ** 4, 0, 1); // exact for low-degree polynomials

Numerical.rk4((_t, y) => [y[0]], [1], 0, 1, 0.01); // y' = y, y(0)=1 -> y(1) ≈ e
```

## Special functions & probability

```ts
import { SpecialFunctions, Distributions, HypothesisTests } from "mallory-math";

SpecialFunctions.gamma(5); // 24  (4!)
SpecialFunctions.regularizedIncompleteBeta(0.5, 2, 3);

const normal = Distributions.normal(0, 1);
normal.cdf(0); // 0.5
normal.sample(); // draw from N(0,1)

HypothesisTests.tTestOneSample([5.1, 4.9, 5.0, 5.2, 4.8], 5); // { statistic, pValue, ... }
```

Every distribution exposes the same shape: `pdf`/`pmf`, `cdf`, `mean`,
`variance`, `sample` — backed by `SpecialFunctions`' exact closed forms
rather than numeric integration.

## FFT and convolution

```ts
import { FFT } from "mallory-math";

FFT.fft([1, 0, 0, 0]); // flat spectrum (power-of-two length required)
FFT.fftPadded([1, 2, 3]); // zero-pads to the next power of two
FFT.convolve([1, 2, 3], [4, 5, 6]); // [4, 13, 28, 27, 18], via FFT
```

## Computational geometry

```ts
import { Geometry, Transform2D, type Point } from "mallory-math";

const cloud: Point[] = [[0,0],[1,1],[2,2],[2,0],[0,2],[1,0.5]];
Geometry.convexHull(cloud); // the 4 outer corners; interior/collinear points drop out

const square: Point[] = [[0,0],[4,0],[4,4],[0,4]];
Geometry.pointInPolygon([2, 2], square); // true

const t = Transform2D.translation(1, 2).multiply(Transform2D.rotation(Math.PI / 2));
t.apply([1, 0]); // rotate then translate -> [1, 3]
```

## Graph algorithms

```ts
import { Graph } from "mallory-math";

const g = new Graph<string>(true); // directed
g.addEdge("a", "b", 1).addEdge("b", "c", 2).addEdge("a", "c", 10);

g.shortestPath("a", "c"); // { distance: 3, path: ["a","b","c"] } — Dijkstra
g.minimumSpanningTree(); // Kruskal, on an undirected Graph
g.topologicalSort(); // null if the graph has a cycle
g.floydWarshall(); // { distances, order } — all-pairs shortest paths
```

## Permutations and cycles

```ts
import { Permutation, Cycle } from "mallory-math";

const sigma = new Permutation([0, 1, 2], [1, 2, 0]); // 0->1, 1->2, 2->0
Permutation.compose(sigma, sigma); // apply sigma twice
```

`Cycle` and `GroupTheory.symmetricGroup` build on `Permutation` for
cycle-notation and full symmetric-group enumeration respectively.
