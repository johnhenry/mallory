/**
 * Combinatorics — exact counting mathematics: factorials, binomial/multinomial
 * coefficients, Catalan/Stirling/Bell numbers, integer partitions, and
 * derangements. The natural counting-math sibling to {@link Permutation},
 * {@link Cycle}, and {@link GroupTheory} — none of those previously had a way
 * to just compute `nCr`.
 *
 * Everything here is `bigint`-based (matching {@link NumberTheory}'s
 * convention) since factorial-scale values exceed `Number.MAX_SAFE_INTEGER`
 * well before n reaches 20.
 */

const big = (x: bigint | number): bigint => (typeof x === "bigint" ? x : BigInt(x));

export class Combinatorics {
  /** `n!` */
  static factorial(n: bigint | number): bigint {
    const num = big(n);
    if (num < 0n) throw new RangeError("factorial is undefined for negative numbers");
    let result = 1n;
    for (let i = 2n; i <= num; i++) result *= i;
    return result;
  }

  /** `nCk` — the number of ways to choose `k` items from `n` (order doesn't matter). */
  static binomial(n: bigint | number, k: bigint | number): bigint {
    const N = big(n);
    const K = big(k);
    if (K < 0n || K > N) return 0n;
    const kk = K > N - K ? N - K : K; // symmetry: nCk = nC(n-k)
    let result = 1n;
    for (let i = 0n; i < kk; i++) result = (result * (N - i)) / (i + 1n);
    return result;
  }

  /** `nPk` — the number of ordered arrangements of `k` items chosen from `n`. */
  static permutationsCount(n: bigint | number, k: bigint | number): bigint {
    const N = big(n);
    const K = big(k);
    if (K < 0n || K > N) return 0n;
    let result = 1n;
    for (let i = 0n; i < K; i++) result *= N - i;
    return result;
  }

  /** `n! / (k1! · k2! · … · km!)`, the number of ways to partition `n` labeled items into groups of the given sizes. */
  static multinomial(n: bigint | number, groupSizes: Array<bigint | number>): bigint {
    const N = big(n);
    const sizes = groupSizes.map(big);
    const sum = sizes.reduce((s, k) => s + k, 0n);
    if (sum !== N) throw new RangeError("multinomial: group sizes must sum to n");
    let result = Combinatorics.factorial(N);
    for (const k of sizes) result /= Combinatorics.factorial(k);
    return result;
  }

  /** The `n`th Catalan number: `C(2n, n) / (n + 1)` — counts balanced parenthesizations, binary trees, etc. */
  static catalan(n: bigint | number): bigint {
    const N = big(n);
    if (N < 0n) throw new RangeError("catalan is undefined for negative numbers");
    return Combinatorics.binomial(2n * N, N) / (N + 1n);
  }

  /** Stirling numbers of the second kind `S(n, k)` — ways to partition an `n`-set into `k` nonempty unlabeled subsets. */
  static stirlingSecond(n: bigint | number, k: bigint | number): bigint {
    const N = Number(big(n));
    const K = Number(big(k));
    if (N < 0 || K < 0) throw new RangeError("stirlingSecond is undefined for negative arguments");
    if (K > N) return 0n;
    // dp[j] holds S(i, j) for the current row i, built bottom-up.
    const dp: bigint[] = new Array(N + 1).fill(0n);
    dp[0] = 1n; // S(0, 0) = 1
    for (let i = 1; i <= N; i++) {
      for (let j = Math.min(i, K); j >= 1; j--) {
        dp[j] = BigInt(j) * dp[j] + dp[j - 1];
      }
      dp[0] = 0n; // S(i, 0) = 0 for i > 0
    }
    return dp[K];
  }

  /** Unsigned Stirling numbers of the first kind `c(n, k)` — permutations of `n` elements with exactly `k` cycles. */
  static stirlingFirstUnsigned(n: bigint | number, k: bigint | number): bigint {
    const N = Number(big(n));
    const K = Number(big(k));
    if (N < 0 || K < 0) throw new RangeError("stirlingFirstUnsigned is undefined for negative arguments");
    if (K > N) return 0n;
    const dp: bigint[] = new Array(N + 1).fill(0n);
    dp[0] = 1n; // c(0, 0) = 1
    for (let i = 1; i <= N; i++) {
      for (let j = Math.min(i, K); j >= 1; j--) {
        dp[j] = BigInt(i - 1) * dp[j] + dp[j - 1];
      }
      dp[0] = 0n; // c(i, 0) = 0 for i > 0
    }
    return dp[K];
  }

  /** The `n`th Bell number — the total number of partitions of an `n`-set (`Σₖ S(n, k)`). */
  static bell(n: bigint | number): bigint {
    const N = Number(big(n));
    if (N < 0) throw new RangeError("bell is undefined for negative numbers");
    let total = 0n;
    for (let k = 0; k <= N; k++) total += Combinatorics.stirlingSecond(N, k);
    return total;
  }

  /** The number of integer partitions of `n` (ways to write `n` as a sum of positive integers, order irrelevant). */
  static partitionCount(n: bigint | number): bigint {
    const N = Number(big(n));
    if (N < 0) throw new RangeError("partitionCount is undefined for negative numbers");
    const dp: bigint[] = new Array(N + 1).fill(0n);
    dp[0] = 1n;
    for (let part = 1; part <= N; part++) {
      for (let total = part; total <= N; total++) dp[total] += dp[total - part];
    }
    return dp[N];
  }

  /** The number of derangements of `n` items (permutations with no fixed point), aka the subfactorial `!n`. */
  static derangements(n: bigint | number): bigint {
    const N = Number(big(n));
    if (N < 0) throw new RangeError("derangements is undefined for negative numbers");
    if (N === 0) return 1n;
    if (N === 1) return 0n;
    let prev2 = 1n; // !0
    let prev1 = 0n; // !1
    for (let i = 2; i <= N; i++) {
      const cur = BigInt(i - 1) * (prev1 + prev2);
      prev2 = prev1;
      prev1 = cur;
    }
    return prev1;
  }
}
