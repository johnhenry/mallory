/**
 * NumberTheory — fast, big-integer number theory: modular exponentiation and
 * inverse, the Chinese Remainder Theorem, Miller-Rabin primality, Pollard-rho
 * factorisation, GCD/LCM, and the Legendre/Jacobi symbols. Everything is
 * `bigint`-based, so it does not overflow for large inputs.
 */

const big = (x: bigint | number): bigint => (typeof x === "bigint" ? x : BigInt(x));
const babs = (x: bigint): bigint => (x < 0n ? -x : x);

function bgcd(a: bigint, b: bigint): bigint {
  let x = babs(a);
  let y = babs(b);
  while (y) [x, y] = [y, x % y];
  return x;
}

// Deterministic Miller-Rabin witnesses (valid for all n < 3.3·10^24).
const MR_WITNESSES = [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n];

export class NumberTheory {
  /** `base^exp mod modulus`, computed by square-and-multiply. */
  static modPow(base: bigint | number, exp: bigint | number, modulus: bigint | number): bigint {
    const m = big(modulus);
    if (m === 1n) return 0n;
    let b = ((big(base) % m) + m) % m;
    let e = big(exp);
    let result = 1n;
    while (e > 0n) {
      if (e & 1n) result = (result * b) % m;
      b = (b * b) % m;
      e >>= 1n;
    }
    return result;
  }

  /** Extended Euclid: returns `{ g, x, y }` with `a·x + b·y = g = gcd(a, b)`. */
  static extendedGcd(a: bigint | number, b: bigint | number): { g: bigint; x: bigint; y: bigint } {
    let [oldR, r] = [big(a), big(b)];
    let [oldS, s] = [1n, 0n];
    let [oldT, t] = [0n, 1n];
    while (r !== 0n) {
      const q = oldR / r;
      [oldR, r] = [r, oldR - q * r];
      [oldS, s] = [s, oldS - q * s];
      [oldT, t] = [t, oldT - q * t];
    }
    // Negative inputs can leave oldR negative even though a*x + b*y = oldR still
    // holds; flip all three signs so g matches gcd()'s non-negative convention.
    if (oldR < 0n) return { g: -oldR, x: -oldS, y: -oldT };
    return { g: oldR, x: oldS, y: oldT };
  }

  /** Modular inverse of `a` mod `m`, or `null` when `gcd(a, m) ≠ 1`. */
  static modInverse(a: bigint | number, m: bigint | number): bigint | null {
    const mod = big(m);
    const { g, x } = NumberTheory.extendedGcd(((big(a) % mod) + mod) % mod, mod);
    if (g !== 1n) return null;
    return ((x % mod) + mod) % mod;
  }

  /** Euclidean remainder, always in `[0, m)` for `m > 0`. Throws for `m === 0`. */
  static mod(a: bigint | number, m: bigint | number): bigint {
    const modulus = big(m);
    if (modulus === 0n) throw new RangeError("NumberTheory.mod: modulus must be non-zero");
    return ((big(a) % modulus) + modulus) % modulus;
  }

  /** `gcd(a, b)` (non-negative, `gcd(0, 0) === 0`). */
  static gcd(a: bigint | number, b: bigint | number): bigint {
    return bgcd(big(a), big(b));
  }

  /** `lcm(a, b) = |a·b| / gcd(a, b)`, or `0` if either operand is `0`. */
  static lcm(a: bigint | number, b: bigint | number): bigint {
    const A = big(a);
    const B = big(b);
    if (A === 0n || B === 0n) return 0n;
    return babs(A * B) / bgcd(A, B);
  }

  /** LCM of a list of values (`1` for an empty list). */
  static lcmList(values: Array<bigint | number>): bigint {
    return values.reduce((acc: bigint, v) => NumberTheory.lcm(acc, big(v)), 1n);
  }

  /**
   * Solve a system of congruences `x ≡ remainders[i] (mod moduli[i])` for
   * pairwise-coprime moduli. Returns `{ x, modulus }` or `null` if inconsistent.
   */
  static crt(
    remainders: Array<bigint | number>,
    moduli: Array<bigint | number>,
  ): { x: bigint; modulus: bigint } | null {
    let x = 0n;
    let mod = 1n;
    for (let i = 0; i < remainders.length; i++) {
      const ri = ((big(remainders[i]) % big(moduli[i])) + big(moduli[i])) % big(moduli[i]);
      const mi = big(moduli[i]);
      const inv = NumberTheory.modInverse(mod, mi);
      if (inv === null) return null;
      const diff = ((((ri - x) * inv) % mi) + mi) % mi;
      x += mod * diff;
      mod *= mi;
      x = ((x % mod) + mod) % mod;
    }
    return { x, modulus: mod };
  }

  /** Miller-Rabin primality test (deterministic for n < 3.3·10²⁴). */
  static isProbablePrime(n: bigint | number): boolean {
    const num = big(n);
    if (num < 2n) return false;
    for (const p of [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n]) {
      if (num === p) return true;
      if (num % p === 0n) return false;
    }
    let d = num - 1n;
    let r = 0n;
    while ((d & 1n) === 0n) {
      d >>= 1n;
      r++;
    }
    witness: for (const a of MR_WITNESSES) {
      if (a >= num) continue;
      let x = NumberTheory.modPow(a, d, num);
      if (x === 1n || x === num - 1n) continue;
      for (let i = 0n; i < r - 1n; i++) {
        x = (x * x) % num;
        if (x === num - 1n) continue witness;
      }
      return false;
    }
    return true;
  }

  /** The next prime strictly greater than `n`. */
  static nextPrime(n: bigint | number): bigint {
    let candidate = big(n) + 1n;
    while (!NumberTheory.isProbablePrime(candidate)) candidate++;
    return candidate;
  }

  /** A single non-trivial factor of composite `n` via Pollard's rho (Brent). */
  static pollardRho(n: bigint | number): bigint {
    const num = big(n);
    if (num % 2n === 0n) return 2n;
    for (let c = 1n; ; c++) {
      let x = 2n;
      let y = 2n;
      let d = 1n;
      const f = (v: bigint) => (v * v + c) % num;
      while (d === 1n) {
        x = f(x);
        y = f(f(y));
        d = bgcd(babs(x - y), num);
      }
      if (d !== num) return d;
    }
  }

  /** Full prime factorisation as sorted `[prime, exponent]` pairs. */
  static factorize(n: bigint | number): Array<[bigint, number]> {
    let num = babs(big(n));
    const counts = new Map<bigint, number>();
    const add = (p: bigint) => counts.set(p, (counts.get(p) ?? 0) + 1);

    for (const p of [2n, 3n, 5n, 7n, 11n, 13n]) {
      while (num % p === 0n) {
        add(p);
        num /= p;
      }
    }
    const stack = num > 1n ? [num] : [];
    while (stack.length) {
      const m = stack.pop() as bigint;
      if (m === 1n) continue;
      if (NumberTheory.isProbablePrime(m)) {
        add(m);
        continue;
      }
      const factor = NumberTheory.pollardRho(m);
      stack.push(factor, m / factor);
    }
    return [...counts.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  }

  /** Euler's totient φ(n) via factorisation (big-integer safe). */
  static eulerPhi(n: bigint | number): bigint {
    let result = babs(big(n));
    for (const [p] of NumberTheory.factorize(n)) result = (result / p) * (p - 1n);
    return result;
  }

  /** The Legendre symbol `(a/p)` for an odd prime `p` (−1, 0, or 1). */
  static legendreSymbol(a: bigint | number, p: bigint | number): number {
    const P = big(p);
    const ls = NumberTheory.modPow(a, (P - 1n) / 2n, P);
    return ls === P - 1n ? -1 : Number(ls);
  }

  /** The Jacobi symbol `(a/n)` for odd `n > 0` (−1, 0, or 1). */
  static jacobiSymbol(a: bigint | number, n: bigint | number): number {
    let A = ((big(a) % big(n)) + big(n)) % big(n);
    let N = big(n);
    let result = 1;
    while (A !== 0n) {
      while (A % 2n === 0n) {
        A /= 2n;
        const r = N % 8n;
        if (r === 3n || r === 5n) result = -result;
      }
      [A, N] = [N, A];
      if (A % 4n === 3n && N % 4n === 3n) result = -result;
      A %= N;
    }
    return N === 1n ? result : 0;
  }
}
