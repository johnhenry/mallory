# Mallory → TypeScript port — COMPLETE

Ported `johnhenry/mallory` (ActionScript 3, ~11.4k LOC, 23 classes) to modern,
fully-typed TypeScript with `node:test`. Tests written **before** each module;
bugs fixed rather than carried over.

## Status: all 23 modules ported ✅ — 196 tests passing, typecheck + build clean

| Layer | Modules |
|-------|---------|
| Foundations | Vector, ComplexNumber, Type |
| Leaves | Utilities, Logic, IntUtils, StringVarMath, SpecialOperator, Calculus |
| Linear algebra | VectorUtils |
| Numeric cores | RealMath (98 fns), ComplexMath (126 fns) |
| Combinatorics | IntegerMath, Cycle, Permutation, Polynomial |
| Structures & geometry | Structure, Polygon |
| Expression stack | Environment, Expression, StringEvaluator |
| Graphing | GraphUtils, Graph3DUtils (re-targeted to emit geometry data) |

See README.md for the catalogue of ~40 bugs found and fixed during translation.

## Toolchain
- Node ≥ 22.6 runs the `.ts` test suite directly (native type stripping).
- `tsconfig` uses `rewriteRelativeImportExtensions` so `.ts` imports emit as `.js`.
- `npm test` / `npm run build` / `npm run typecheck`.
