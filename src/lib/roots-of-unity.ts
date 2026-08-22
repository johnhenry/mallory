import { ComplexNumber } from "@johnhenry/math";

/** The n-th roots of unity: `e^(2*pi*i*k/n)` for `k = 0..n-1`, via `ComplexNumber.fromPolar`. */
export function nthRootsOfUnity(n: number): ComplexNumber[] {
  if (!Number.isInteger(n) || n < 1) throw new Error(`n must be a positive integer -- got ${n}.`);
  const roots: ComplexNumber[] = [];
  for (let k = 0; k < n; k++) {
    roots.push(ComplexNumber.fromPolar(1, (2 * Math.PI * k) / n));
  }
  return roots;
}
