/**
 * Docs-as-tests (issue #41's remaining-scope item 1, pattern from
 * mallory#17 -- see that repo's packages/math/test/Cookbook.test.ts,
 * itself citing Woxi's scrut-run documentation): every fenced ```ts block
 * in docs/COOKBOOK.md is EXECUTED by this suite, so a documented example
 * that stops compiling or starts throwing fails CI instead of silently
 * rotting.
 *
 * Two levels of checking:
 *
 * 1. Every block must run to completion. `from "mallory-graph/<name>"` is
 *    a docs-only convention (mallory-graph isn't a published package with
 *    that subpath layout) rewritten here to the real absolute path of
 *    `src/lib/<name>.ts` -- mirroring how mallory's own Cookbook.test.ts
 *    rewrites the bare "mallory-math" specifier to its real src/index.ts.
 *    Blocks that import the genuine npm dependency "mallory-math" directly
 *    (e.g. `Interval`, `Symbolic`) need no rewrite; that specifier already
 *    resolves normally.
 *
 * 2. Lines ending in `// => <expression>` additionally assert the value:
 *    tolerant deep equality (numbers to 1e-9 relative, everything else
 *    exact), same rule as mallory's own version.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

const HERE = new URL(".", import.meta.url).pathname;
const REPO_ROOT = join(HERE, "../..");
const COOKBOOK = join(HERE, "../../docs/COOKBOOK.md");
const LIB_DIR = HERE;

interface DocBlock {
  heading: string;
  fenceLine: number;
  code: string;
  skipped: boolean;
}

function extractBlocks(markdown: string): DocBlock[] {
  const lines = markdown.split("\n");
  const blocks: DocBlock[] = [];
  let heading = "(preamble)";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    const h = line.match(/^#+\s+(.*)$/);
    if (h) heading = h[1] as string;
    if (line.trim() === "```ts") {
      const skipped = (lines[i - 1] ?? "").includes("<!-- cookbook: skip -->");
      const start = i + 1;
      let end = start;
      while (end < lines.length && (lines[end] as string).trim() !== "```") end++;
      blocks.push({ heading, fenceLine: i + 1, code: lines.slice(start, end).join("\n"), skipped });
      i = end;
    }
  }
  return blocks;
}

/** Tolerant deep equality: numbers to 1e-9 relative (docs quote rounded values sometimes; float noise must not fail a doc), everything else exact shape/value. */
function docEqual(actual: unknown, expected: unknown): boolean {
  if (typeof expected === "number" && typeof actual === "number") {
    if (Number.isNaN(expected)) return Number.isNaN(actual);
    return Math.abs(actual - expected) <= 1e-9 * Math.max(1, Math.abs(expected));
  }
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && actual.length === expected.length && expected.every((e, i) => docEqual(actual[i], e));
  }
  if (expected !== null && typeof expected === "object") {
    if (actual === null || typeof actual !== "object") return false;
    const ek = Object.keys(expected as object);
    const ak = Object.keys(actual as object);
    return ek.length === ak.length && ek.every((k) => docEqual((actual as Record<string, unknown>)[k], (expected as Record<string, unknown>)[k]));
  }
  return Object.is(actual, expected) || actual === expected;
}

const CHECK_RE = /^(\s*)([^/].*?);\s*\/\/\s*=>\s*(.+?)\s*$/;
const MALLORY_GRAPH_IMPORT_RE = /from\s+"mallory-graph\/([\w-]+)"/g;

/** Rewrites one doc block into an executable module: mallory-graph/<name> imports resolved to real src/lib/<name>.ts file URLs, `EXPR; // => V` lines turned into __docCheck calls. */
function materialize(block: DocBlock): string {
  const out: string[] = [
    `const __docEqual = ${docEqual.toString()};`,
    `function __docCheck(actualFn, expectedFn, where) {`,
    `  const actual = actualFn();`,
    `  const expected = expectedFn();`,
    `  if (!__docEqual(actual, expected)) {`,
    `    throw new Error("documented value is wrong at " + where + ": documented " + __show(expected) + " but got " + __show(actual));`,
    `  }`,
    `}`,
    `function __show(v) { return typeof v === "bigint" ? v + "n" : JSON.stringify(v); }`,
  ];
  const lines = block.code.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] as string).replace(MALLORY_GRAPH_IMPORT_RE, (_m, name: string) => `from ${JSON.stringify(pathToFileURL(join(LIB_DIR, `${name}.ts`)).href)}`);
    const m = line.match(CHECK_RE);
    const stmt = m?.[2] ?? "";
    const isCheckable = m && !/^(const|let|var|import|type|function|class|return)\b/.test(stmt.trim()) && !stmt.includes("//");
    if (m && isCheckable) {
      out.push(`${m[1]}__docCheck(() => (${stmt}), () => (${m[3]}), ${JSON.stringify(`COOKBOOK.md "${block.heading}" block line ${i + 1}`)});`);
    } else {
      out.push(line);
    }
  }
  return out.join("\n");
}

test("every docs/COOKBOOK.md ```ts block runs, and every `// =>` documented value matches", async (t) => {
  const blocks = extractBlocks(readFileSync(COOKBOOK, "utf8"));
  assert.ok(blocks.length >= 8, `expected a substantial cookbook, found only ${blocks.length} ts blocks`);
  const checkCount = blocks.reduce((n, b) => n + b.code.split("\n").filter((l) => CHECK_RE.test(l)).length, 0);
  assert.ok(checkCount >= 18, `expected >= 18 checked (// =>) doc values, found ${checkCount} -- conversions have regressed`);

  // Materialized under the repo root (gitignored), not the system tmpdir --
  // a real npm dependency like "mallory-math" (unlike the mallory-graph/<name>
  // docs-only convention above) resolves through normal node_modules lookup,
  // which only finds anything by walking UP from the importing file; the
  // system tmpdir has no node_modules ancestor to find.
  const dir = mkdtempSync(join(REPO_ROOT, ".cookbook-tmp-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  for (const [i, block] of blocks.entries()) {
    await t.test(`${block.heading} (fence at COOKBOOK.md:${block.fenceLine})`, async () => {
      if (block.skipped) return; // explicit, grep-able opt-out only
      const file = join(dir, `block-${i}.ts`);
      writeFileSync(file, materialize(block));
      await import(pathToFileURL(file).href); // throws -> the doc is wrong
    });
  }
});
