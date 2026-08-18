import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { CARDS } from "./index.tsx";
import { NAV_SECTIONS } from "../../lib/nav-sections.ts";

// Regression coverage for issue #249: the dashboard grid went stale
// relative to the sidebar/route list (missing Tiles, Streaming, Digit
// Classifier, Cellular Automata) and its headline hardcoded a tool count
// ("Twelve tools") that drifted out of date as panels were added. These
// tests fail the moment the grid (or the headline's count) next falls out
// of sync, without anyone having to notice by eye.

test("dashboard CARDS has exactly one entry per NAV_SECTIONS panel (excluding the dashboard's own '/' entry)", () => {
  const expectedPaths = NAV_SECTIONS.filter((section) => section.to !== "/").map((section) => section.to);
  assert.deepEqual(
    CARDS.map((card) => card.to),
    expectedPaths,
  );
});

// Issue #253: "/digit-classifier" is a route file that ONLY redirects (to
// "/ml?tab=digit-classifier", folded into the ML tab strip) -- it's no
// longer a standalone panel with its own dashboard card, so it's excluded
// from the "every route file has a card" invariant below rather than
// requiring a card that would just duplicate the "/ml" one.
const REDIRECT_ONLY_ROUTES = new Set(["/digit-classifier"]);

test("dashboard CARDS covers every route file under src/routes/_app/ (except index.tsx, the shell, and redirect-only routes)", () => {
  const routesDir = dirname(fileURLToPath(import.meta.url));
  const routeToPaths = readdirSync(routesDir)
    .filter((name) => name.endsWith(".tsx") && name !== "index.tsx")
    .map((name) => `/${name.replace(/\.tsx$/, "")}`)
    .filter((path) => !REDIRECT_ONLY_ROUTES.has(path));

  const cardPaths = new Set(CARDS.map((card) => card.to));
  for (const routePath of routeToPaths) {
    assert.ok(cardPaths.has(routePath), `Expected a dashboard card for route "${routePath}", but none was found.`);
  }
});

test("dashboard CARDS specifically includes recently-added panels (Tiles, Streaming, Cellular Automata)", () => {
  const cardPaths = CARDS.map((card) => card.to);
  assert.ok(cardPaths.includes("/tiles"), "Tiles panel missing from dashboard grid");
  assert.ok(cardPaths.includes("/streaming-dataset"), "Streaming panel missing from dashboard grid");
  assert.ok(cardPaths.includes("/cellular-automata"), "Cellular Automata panel missing from dashboard grid");
});

test("dashboard CARDS deliberately excludes /digit-classifier -- folded into the /ml card's own tab strip (issue #253), not a separate destination", () => {
  const cardPaths = CARDS.map((card) => card.to);
  assert.ok(!cardPaths.includes("/digit-classifier"));
  assert.ok(cardPaths.includes("/ml"));
});

test("every dashboard card has a non-empty title and description", () => {
  for (const card of CARDS) {
    assert.ok(card.title.length > 0, `Card for "${card.to}" has an empty title`);
    assert.ok(card.description.length > 0, `Card for "${card.to}" has an empty description`);
  }
});
