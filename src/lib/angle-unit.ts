/**
 * A tiny global, localStorage-backed preference for how angle VALUES are
 * displayed and typed at the UI boundary -- Geometry's measured-angle
 * labels and rotate-tool input, Complex panel's arg() readout. Internal
 * computation stays radians everywhere (every Math.trig call and every
 * mallory-math evaluation is radians-native); this only affects the two
 * edges where a human reads or types a bare angle number, mirroring
 * theme-colors.ts's "convert only at the boundary" shape but for a
 * value, not a CSS color.
 *
 * Deliberately UI-only: user-typed trig expressions (`sin(45)`) are NOT
 * affected and remain radians, same as always -- trig evaluation is baked
 * into the external mallory-math package, not app code, so making typed
 * expressions unit-aware would mean an app-side AST rewrite layer over
 * every evaluation call site (or patching that dependency) rather than a
 * boundary conversion. Out of scope here.
 *
 * No React context: the app has no existing settings/preferences
 * mechanism to hook into (confirmed nothing comparable exists), and a
 * single shared module-level subscriber set is simpler than introducing
 * one for a single boolean-ish preference. `setAngleUnit` notifies
 * listeners synchronously and unconditionally (not only on an actual
 * change) -- callers already treat re-invocation as idempotent (a
 * `useState` set to its current value is a no-op re-render).
 */
export type AngleUnit = "radians" | "degrees";

const STORAGE_KEY = "mallory-graph:angle-unit";
const listeners = new Set<(unit: AngleUnit) => void>();

export function getAngleUnit(): AngleUnit {
  if (typeof localStorage === "undefined") return "radians";
  return localStorage.getItem(STORAGE_KEY) === "degrees" ? "degrees" : "radians";
}

export function setAngleUnit(unit: AngleUnit): void {
  if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_KEY, unit);
  for (const listener of listeners) listener(unit);
}

/** Returns an unsubscribe function. Fires only on `setAngleUnit` calls from this tab (no cross-tab `storage` event listener) -- each panel that cares reads its own `getAngleUnit()` on mount, so a fresh tab is always correct regardless. */
export function subscribeToAngleUnit(listener: (unit: AngleUnit) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function radiansToUnit(radians: number, unit: AngleUnit): number {
  return unit === "degrees" ? (radians * 180) / Math.PI : radians;
}

export function unitToRadians(value: number, unit: AngleUnit): number {
  return unit === "degrees" ? (value * Math.PI) / 180 : value;
}

/** For the one call site (Geometry's rotate tool) whose underlying storage is degrees-typed specifically, not radians -- avoids composing unitToRadians+radiansToUnit at the call site. */
export function unitToDegrees(value: number, unit: AngleUnit): number {
  return unit === "degrees" ? value : (value * 180) / Math.PI;
}

export function angleUnitSuffix(unit: AngleUnit): string {
  return unit === "degrees" ? "°" : " rad";
}

/** `radians` formatted in `unit`, with its suffix -- e.g. `formatAngle(Math.PI, "degrees")` -> `"180.0°"`. */
export function formatAngle(radians: number, unit: AngleUnit, digits = 1): string {
  return `${radiansToUnit(radians, unit).toFixed(digits)}${angleUnitSuffix(unit)}`;
}
