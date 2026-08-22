/**
 * Agent-access opt-in toggle (mallory's WebMCP pass). Off by default:
 * mallory is publicly deployed, and the WebMCP local relay's own docs
 * warn its default config lets *any* open browser tab register tools with
 * it -- so this must be a deliberate, visible per-browser choice, not
 * something that silently runs for every visitor.
 *
 * A toggle here triggers a full page reload rather than trying to hot-swap
 * `@mcp-b/global`'s init state mid-session: agent mode is a rare, deliberate
 * flip, not a live preference, so reloading keeps every already-mounted
 * panel's tool-registration hooks trivially correct (they just see a fresh
 * `document.modelContext` -- or lack of one -- from a clean mount) instead
 * of needing bespoke "the runtime just appeared/disappeared" handling.
 */
const STORAGE_KEY = "mallory:agent-mode";

export function isAgentModeEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setAgentModeEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (enabled) window.localStorage.setItem(STORAGE_KEY, "1");
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage unavailable (private browsing, quota) -- the toggle just won't persist.
  }
  window.location.reload();
}
