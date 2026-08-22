import { ComplexNumber } from "@johnhenry/math";

export interface ComplexDomain {
  reMin: number;
  reMax: number;
  imMin: number;
  imMax: number;
}

const MAX_ITERATIONS = 50;
const ZERO_CONVERGENCE_TOLERANCE = 1e-9;
const POLE_MAGNITUDE_THRESHOLD = 1e6;
const DEDUP_TOLERANCE = 1e-4;

function validateDomainAndGrid(domain: ComplexDomain, gridSize: number): void {
  if (domain.reMax <= domain.reMin || domain.imMax <= domain.imMin) {
    throw new Error("Domain bounds must have reMax > reMin and imMax > imMin.");
  }
  if (!Number.isInteger(gridSize) || gridSize < 1) throw new Error("Grid size must be a positive integer.");
}

/** Seeds a `gridSize x gridSize` grid over `domain`, runs `solveOne` from each seed, keeps converged results that land back inside `domain`, and merges results within `DEDUP_TOLERANCE` of each other (a smooth grid of seeds routinely converges to the same root/pole from several different starting points). */
function collectFromGrid(domain: ComplexDomain, gridSize: number, solveOne: (start: ComplexNumber) => ComplexNumber | null): ComplexNumber[] {
  const found: ComplexNumber[] = [];
  for (let i = 0; i < gridSize; i++) {
    for (let j = 0; j < gridSize; j++) {
      const re = domain.reMin + ((i + 0.5) / gridSize) * (domain.reMax - domain.reMin);
      const im = domain.imMin + ((j + 0.5) / gridSize) * (domain.imMax - domain.imMin);
      const result = solveOne(new ComplexNumber(re, im));
      if (!result) continue;
      if (result.value < domain.reMin || result.value > domain.reMax || result.iValue < domain.imMin || result.iValue > domain.imMax) continue;
      if (!found.some((r) => r.subtract(result).magnitude() < DEDUP_TOLERANCE)) found.push(result);
    }
  }
  return found;
}

/**
 * Finds zeros of a complex function g(z)=0 within `domain` via Newton's
 * method (z_{n+1} = z_n - g(z)/g'(z)), seeded from a `gridSize x gridSize`
 * grid of starting points spanning the domain -- general root-finding for
 * an arbitrary complex function, unlike ComplexPanel's closed-form
 * roots-of-unity demo. `g`/`gPrime` are plain callbacks (the same
 * `(z) => ComplexNumber` shape complex-raster.ts's `renderDomainColoring`
 * takes) rather than Symbolic `Expr`s directly, so the caller controls how
 * free-variable sliders get bound (via `complexParamEnv`) and this module
 * stays a pure numerical core with no dependency on the expression layer.
 *
 * Non-convergent/divergent seeds (Newton overshoots to a non-finite value,
 * or lands on a stationary point where g'(z)=0) are silently dropped, not
 * thrown -- with 64+ seed points across a grid, most functions have some
 * seeds that don't converge to anything; that's expected, not an error.
 */
export function findComplexZeros(
  g: (z: ComplexNumber) => ComplexNumber,
  gPrime: (z: ComplexNumber) => ComplexNumber,
  domain: ComplexDomain,
  gridSize = 8,
): ComplexNumber[] {
  validateDomainAndGrid(domain, gridSize);
  return collectFromGrid(domain, gridSize, (start) => newtonZero(g, gPrime, start));
}

function newtonZero(g: (z: ComplexNumber) => ComplexNumber, gPrime: (z: ComplexNumber) => ComplexNumber, start: ComplexNumber): ComplexNumber | null {
  let z = start;
  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const gz = g(z);
    if (!Number.isFinite(gz.value) || !Number.isFinite(gz.iValue)) return null;
    if (gz.magnitude() < ZERO_CONVERGENCE_TOLERANCE) return z;
    const gpz = gPrime(z);
    if (gpz.magnitude() === 0) return null;
    z = z.subtract(gz.divide(gpz));
    if (!Number.isFinite(z.value) || !Number.isFinite(z.iValue)) return null;
  }
  const gz = g(z);
  return Number.isFinite(gz.value) && Number.isFinite(gz.iValue) && gz.magnitude() < ZERO_CONVERGENCE_TOLERANCE ? z : null;
}

/**
 * Finds poles of f within `domain` -- points where |f(z)| -> infinity --
 * seeded the same way as {@link findComplexZeros}. A pole of f is exactly
 * a zero of 1/f, and by the quotient rule the Newton step for g=1/f
 * algebraically simplifies to `z_new = z + f(z)/f'(z)` (the sign flips
 * relative to the zero-finding step) -- so this evaluates `f`/`fPrime`
 * DIRECTLY, never constructing or differentiating a reciprocal expression.
 * That matters in practice, not just in theory: an earlier version of this
 * built `1/f` as a Symbolic `Expr` and differentiated *that*, but near an
 * actual pole `f'` blows up too (e.g. `d/dz(1/tan(z))` needs `1/cos(z)^2`
 * with `cos(z)` already near zero), and `mallory-math`'s `ComplexNumber.
 * power()` rounds its result to 10 decimal places -- silently zeroing a
 * genuinely tiny-but-nonzero `cos(z)^2`, which then divides by zero into
 * `Infinity`/`NaN` and corrupts the whole iteration. Evaluating `f`/`f'`
 * directly sidesteps this: near a pole `f(z)` grows large but stays a
 * well-conditioned finite number right up until the iteration converges,
 * so `POLE_MAGNITUDE_THRESHOLD` is checked and returned BEFORE `f'` is
 * ever evaluated at a poisoned point.
 */
export function findComplexPoles(
  f: (z: ComplexNumber) => ComplexNumber,
  fPrime: (z: ComplexNumber) => ComplexNumber,
  domain: ComplexDomain,
  gridSize = 8,
): ComplexNumber[] {
  validateDomainAndGrid(domain, gridSize);
  return collectFromGrid(domain, gridSize, (start) => newtonPole(f, fPrime, start));
}

function newtonPole(f: (z: ComplexNumber) => ComplexNumber, fPrime: (z: ComplexNumber) => ComplexNumber, start: ComplexNumber): ComplexNumber | null {
  let z = start;
  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const fz = f(z);
    const mag = fz.magnitude();
    if (!Number.isFinite(mag) || mag > POLE_MAGNITUDE_THRESHOLD) return z;
    const fpz = fPrime(z);
    if (fpz.magnitude() === 0) return null;
    z = z.add(fz.divide(fpz));
    if (!Number.isFinite(z.value) || !Number.isFinite(z.iValue)) return null;
  }
  return null;
}
