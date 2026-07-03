# mallory

**Advanced college-level mathematics for TypeScript** — a modern, fully-typed,
test-covered port of the Mallory ActionScript 3 library (a project worked on,
on and off, since 2004), published to npm as `mallory-math`.

Complex numbers, linear algebra over arbitrary algebraic structures,
combinatorics and number theory, an expression evaluator, and renderer-agnostic
graphing geometry — all rewritten in modern TypeScript with `node:test`
(example-based and, for algebraic laws, property-based via `fast-check`).

```ts
import { ComplexNumber, Structure, Vector, StringEvaluator } from "mallory-math";

ComplexNumber.E.power(new ComplexNumber(0, Math.PI)); // ≈ -1  (Euler)
Structure.realField().determinant(/* 3×3 matrix, as Vector<Vector<number>> */);
StringEvaluator.evaluate("sin(pi/2) + 2^3", StringEvaluator.mathEnvironment()); // 9
```

## Install & use

Requires Node.js ≥ 22.6 (the test suite runs `.ts` directly via Node's built-in
type stripping).

```bash
npm install
npm test           # run the node:test suite (against src/)
npm run typecheck  # tsc --noEmit
npm run check      # Biome lint + format check
npm run check:fix  # apply Biome fixes
npm run build      # emit ./dist (ESM + .d.ts)
npm run test:build # build, then smoke-test the emitted package
npm run docs       # generate the API reference into docs/api (TypeDoc)
```

Continuous integration (`.github/workflows/ci.yml`) runs typecheck → lint →
tests → build → dist smoke test → docs build on Node 22 and 24.

**Documentation:**

- **[Cookbook](docs/COOKBOOK.md)** — task-oriented recipes across every
  domain (linear algebra, symbolic calculus, number theory, group theory,
  FFT, geometry, graphs, and more), each one verified against the test suite.
- **API reference** — generated with [TypeDoc](https://typedoc.org) from
  the source JSDoc; run `npm run docs` and open `docs/api/index.html`.

## Modules

| Area | Modules |
|------|---------|
| Foundations | `Vector`, `ComplexNumber` (arithmetic, trig, logs as fluent instance methods), `Type` |
| Real & complex analysis | `RealMath` (plain scalar functions, not a class), `ComplexMath` (complex vectors + probability helpers), `Statistics` (descriptive stats on `number[]`) |
| Linear algebra | `VectorUtils`, generic linear algebra in `Structure`, numerical decompositions in `MatrixMath` |
| Algebraic structures | `Structure` — groups/rings/fields; do linear algebra over e.g. GF(7) |
| Number theory & combinatorics | `Permutation`, `Cycle` |
| Geometry | `Polygon`, `GraphUtils`, `Graph3DUtils` (emit paths/meshes as plain data) |
| Expressions | `Environment`, `Expression`, `StringEvaluator` |
| Misc | `Utilities`, `Logic`, `IntUtils`, `SpecialOperator` |

## About the port

This is a faithful port that **fixes bugs rather than carrying them over**, and
takes advantage of modern JavaScript/TypeScript: ES classes, generics, iterators,
`Array` subclassing, tagged unions, and `.ts`-native execution. Every module was
translated **test-first**.

A sampling of the ~40 bugs found and fixed while translating:

- **`RealMath.subtract` returned `a * b`.** (Yes, really.)
- **Order statistics were broken:** `sort` used the default *lexicographic* sort,
  so `minimum`/`maximum`/`median` were wrong for numbers.
- **`ComplexMath.divide`** compared `alpha.ivalue` (lowercase `v`, always
  `undefined`), so all eight directed-infinity results were dead code.
- **`ComplexMath.normalDistribution`** reciprocated the whole expression, putting
  the exponential in the denominator (wrong sign) — the normal PDF was inverted.
- **`solveN`** wasn't Newton's method — it assumed a derivative of 1 and diverged;
  now a real numeric Newton–Raphson.
- **`integrateN`** sampled at `2·x + interval`; **`differentiateN`** was a forward
  difference despite claiming to be symmetric.
- **`invertMatrix`** had no pivoting (divide-by-zero on a zero pivot); now uses
  partial pivoting (and a zero-pivot row swap in `Structure`, for finite fields).
- **`crossProduct`** read index 3 for the z-component and used truthiness tests
  that dropped zero components; **`powerMatrix`** never actually multiplied.
- **`Vector.setElement`** infinitely recursed on a falsy slot.
- **`ComplexNumber` string parsing** crashed on non-matches and couldn't
  round-trip negative imaginary parts; it also swallowed every `*`, so `"4*2"`
  parsed as `42`.
- **`StringEvaluator`** was uniformly right-associative (`10-2-3 → 11`); now
  left-associative for `+ - * / %` and right-associative for `^`.
- **`Polynomial.multiply`** referenced a non-existent `dimension.value`;
  **`Polynomial.antiderivative`** dropped its highest-degree term.
- **`IntegerMath.modulus`** recursed one step at a time (stack overflow);
  `primeFactors` infinite-looped on `0` and negatives.
- **`Structure`**'s matrix section was non-functional (static/instance confusion,
  undefined references) and is reconstructed as working generic linear algebra.
- `IntUtils` spelled "forty" and "ninety" as "fourty" and "ninty".

Where the original genuinely had *no* verifiable intended behavior — the Flash
3D ribbon geometry in `Graph3DUtils` — the math is ported verbatim with an
explicit note rather than "fixed" by guesswork. The Flash rendering utilities
(`GraphUtils`/`Graph3DUtils`) now return renderer-agnostic geometry (2D paths,
3D meshes) instead of Flash display objects.

## Beyond the original

A completeness pass added the missing counterparts and a few natural supplements
the AS3 library never had:

- **`ComplexNumber`**: `fromPolar`, `fromVector`, `fromXML` (inverses of
  `magnitude`/`angle`, `toVector`, `toXML`).
- **`Vector`**: `fromXML`, `fromString` (best-effort inverses of `toXML`/`toString`).
- **`PolynomialRing`**: `evaluate` (Horner), `add`/`subtract`, `divide`/`mod`/`divmod`
  (long division), `derivative`/`antiderivative` (generalized to any `Structure`,
  not just reals), and the real-number-only `parsePolynomial`/`polynomialToString`
  helpers (inverses of each other).
- **`Polygon`**: `centroid`, `contains` (point-in-polygon), `isConvex`, `isSimple`.
- **`Statistics`**: `populationVariance` / `populationStandardDeviation`
  alongside the sample versions.
- **`Structure` presets**: `Structure.realField()`, `complexField()`,
  `integersModulo(n)` (a field when `n` is prime), and `booleanRing()` — so you
  can do linear algebra over these without wiring up operations by hand:

  ```ts
  const gf7 = Structure.integersModulo(7);
  gf7.invertMatrix(/* a matrix over GF(7) */); // Gauss-Jordan over the finite field
  ```

## Expanded mathematics

Well beyond the original ActionScript scope, the library now spans:

| Area | Module(s) | Highlights |
|------|-----------|------------|
| Numerical linear algebra | `MatrixMath` | LU, QR, Cholesky, symmetric eigen (Jacobi), SVD; `solve`, RREF, rank, null space, least squares, pseudo-inverse, norms, condition number |
| Symbolic calculus | `Symbolic` | expression parser (41 unary elementary functions incl. inverse-trig, reciprocal-trig, hyperbolic/inverse-hyperbolic, `abs`/`log10`/`log2`/`cbrt`/`floor`/`ceil`/`round`/`sign`/`trunc`, and `expm1`/`log1p`/`sigmoid`/`erf`/`relu`, with `arcsin`/`logistic`-style aliases and `\|x\|` bar syntax, plus N-ary `atan2`/`hypot`/`min`/`max`/`gcd`/`lcm`, `log(base, x)`/`clamp(x, lo, hi)`, and `piecewise(cond, expr, ..., otherwise)` with `<`/`<=`/`>`/`>=`/`==`/`!=` comparisons), symbolic differentiation (incl. the multivariate chain rule for the N-ary functions and branch-wise piecewise differentiation) with a u-substitution fallback for `integrate`, algebraic simplification with like-term collection and constant-folding, elementary integration (incl. by-parts, arctan/arcsin forms, and u-substitution), `integrateDefinite` (closed-form first, adaptive-quadrature fallback), `sumSeries` (finite/infinite, closed-form geometric recognition + numeric fallback), Taylor series, `expand`/`substitute`, polynomial `solve`/`factor`, linear `solveSystem`, L'Hopital `limit` (incl. limits at infinity), LaTeX round-trip (`toLatex`/`fromLatex`, incl. `\operatorname{...}`, bracket notation for `abs`/`floor`/`ceil`/`cbrt`, and `\begin{cases}` for piecewise), `evaluateExact` (exact `Rational` evaluation), and `evaluateOverStructure` (folds an `Expr` through an arbitrary `Structure`'s own algebra, e.g. for plotting over Z/7Z) |
| Number types | `Rational`, `Quaternion`, `DualNumber`, `Interval` | exact bigint rationals, 3D-rotation quaternions, forward-mode autodiff, rigorous interval arithmetic — each also a `Structure` preset |
| Number theory | `NumberTheory` | `bigint` modPow, extended GCD, CRT, Miller–Rabin, Pollard-rho factorization, Legendre/Jacobi |
| Group theory | `GroupTheory` | Cayley tables, axiom checks, element order, generated subgroups, cosets, Lagrange, orbits, Sₙ/Zₙ |
| Numerical methods | `Numerical` | bisection/secant/Newton/Brent; Simpson, adaptive Simpson, Gauss–Legendre; Euler & RK4 ODE solvers |
| Probability & special functions | `SpecialFunctions`, `Distributions` | gamma/beta/erf, incomplete gamma/beta; normal/exponential/uniform/gamma/χ²/t/binomial/Poisson; t-tests, χ² GoF, CIs |
| Signal processing | `FFT` | radix-2 FFT/IFFT, DFT, FFT convolution |
| Computational geometry | `Geometry`, `Transform2D` | convex hull, predicates, point-in-polygon, 2D affine transforms |
| Graph theory | `Graph` | BFS/DFS, Dijkstra, Kruskal MST, topological sort, components, Floyd–Warshall |
| Counting mathematics | `Combinatorics` | `bigint` factorials, nCk/nPk, multinomial coefficients, Catalan/Stirling/Bell numbers, integer partitions, derangements |
| Arbitrary precision | `Decimal` | `bigint`-backed decimal arithmetic — exact add/subtract/multiply, configurable-precision division; also a `Structure` preset |
| Abstract algebra | `PolynomialRing` | polynomials over any `Structure` (finite fields, rationals, ...) — long division, monic GCD, Horner evaluation, derivative/antiderivative |
| Multivariable calculus | `VectorCalculus` | gradient, directional derivative, Jacobian, divergence, curl, Hessian (via `DualNumber` autodiff), plus an exact symbolic gradient |

Many of these interlock: `GroupTheory` runs over any `Structure` (including
`integersModulo`); `Graph.floydWarshall` emits matrices for `MatrixMath`;
`DualNumber` gives exact derivatives, which both `Structure.dualNumbers()` and
`VectorCalculus` build on; `PolynomialRing` composes with any `Structure`
preset (including the new `Decimal`-backed `decimalField()`); and
`SpecialFunctions` gives the `Distributions` CDFs exact closed forms.

## License

MIT
