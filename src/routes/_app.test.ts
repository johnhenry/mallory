import assert from "node:assert/strict";
import { test } from "node:test";
import { nextTheme, themeIconRotation, themeLabel } from "./_app.tsx";

// Issue #248: the theme toggle must cycle through all 3 states (system,
// represented as `null` -- no `data-theme` override, see theme-colors.ts --
// then dark, then light) rather than just flipping between dark and light,
// and the icon should rotate to reflect which state is active.

test("nextTheme: cycles system -> dark -> light -> system", () => {
  assert.equal(nextTheme(null), "dark");
  assert.equal(nextTheme("dark"), "light");
  assert.equal(nextTheme("light"), null);
});

test("themeIconRotation: system = no rotation, dark = 90deg CCW, light = a further 90deg CCW (180deg total)", () => {
  assert.equal(themeIconRotation(null), 0);
  assert.equal(themeIconRotation("dark"), -90);
  assert.equal(themeIconRotation("light"), -180);
});

test("themeLabel: null reads as \"system\", otherwise the theme name itself", () => {
  assert.equal(themeLabel(null), "system");
  assert.equal(themeLabel("dark"), "dark");
  assert.equal(themeLabel("light"), "light");
});
