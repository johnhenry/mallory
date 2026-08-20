import { createFileRoute, Link, Outlet, useNavigate } from "@tanstack/react-router";
import { Fragment, useEffect, useState } from "react";
import { isAgentModeEnabled, setAgentModeEnabled } from "../lib/webmcp-agent-mode.ts";
import { announceWebMcpReady, useModelContextTool } from "../hooks/use-model-context-tool.ts";
import { useSymbolicTools } from "../hooks/use-symbolic-tools.ts";
import { useCellGraphTools } from "../hooks/use-cell-graph-tools.ts";
import { NAV_SECTIONS, SECTION_PATHS } from "../lib/nav-sections.ts";
import { getWorkspaceGraph } from "../lib/workspace-graph.ts";
import { CalculatorPanel } from "../components/CalculatorPanel.tsx";

export const Route = createFileRoute("/_app")({
  component: AppShell,
});

function NavIcon({ path }: { path: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" dangerouslySetInnerHTML={{ __html: path }} />
  );
}

const RELAY_SCRIPT_ID = "webmcp-relay-embed";

/**
 * Theme cycle order (issue #248): system -> dark -> light -> system. `null`
 * means "system" (no `data-theme` override, `styles.css`'s
 * `prefers-color-scheme` media query drives it -- see theme-colors.ts).
 */
export function nextTheme(theme: "light" | "dark" | null): "light" | "dark" | null {
  if (theme === null) return "dark";
  if (theme === "dark") return "light";
  return null;
}

/**
 * Icon rotation for the 3-state toggle (issue #248): system = base
 * orientation, dark = 90deg counter-clockwise, light = a further 90deg
 * counter-clockwise (180deg total). CSS `rotate()` is clockwise-positive, so
 * counter-clockwise is expressed as negative degrees here.
 */
export function themeIconRotation(theme: "light" | "dark" | null): number {
  if (theme === "dark") return -90;
  if (theme === "light") return -180;
  return 0;
}

export function themeLabel(theme: "light" | "dark" | null): string {
  return theme ?? "system";
}

function AppShell() {
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);
  const [agentMode, setAgentMode] = useState(false);
  // Floating cross-page calculator (issue #340): collapsed by default,
  // session-only (not persisted to localStorage/URL) -- a page reload is a
  // fresh start, matching the design's own "opt in per session" framing
  // rather than something that follows the user around forever once opened
  // once. Mounted here (a sibling of <Outlet/> below, not inside any
  // individual route) so it survives navigation between routes for free:
  // AppShell itself never remounts on a /_app/* route change, only
  // <Outlet/>'s own content does.
  const [floatingCalcOpen, setFloatingCalcOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (theme) document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
  }, [theme]);

  // Client-only, opt-in: only load the WebMCP runtime (@mcp-b/global, a
  // ~285KB-class dependency) and the relay connector for a browser that has
  // explicitly turned agent mode on -- a random visitor's page load never
  // downloads either, never attempts a localhost connection. See
  // webmcp-agent-mode.ts's own doc comment for why this is opt-in at all.
  useEffect(() => {
    const enabled = isAgentModeEnabled();
    setAgentMode(enabled);
    if (!enabled) return;
    if (document.getElementById(RELAY_SCRIPT_ID)) return;

    import("@mcp-b/global")
      .then(() => announceWebMcpReady())
      .catch((err: unknown) => {
        console.warn("[mallory-graph] Failed to load the WebMCP runtime:", err);
      });

    const script = document.createElement("script");
    script.id = RELAY_SCRIPT_ID;
    // Dynamically-created <script> elements default to async=true per the
    // HTML spec, which leaves `document.currentScript` null while they run
    // -- confirmed live: embed.js's own `resolveWidgetUrl` depends on
    // `document.currentScript.src` to find widget.html *next to itself*,
    // silently falling back to a third-party CDN URL otherwise, exactly the
    // dependency this file is vendored (public/vendor/webmcp-relay/) to
    // avoid. `async = false` makes a dynamically-inserted script behave
    // like a normal parser-inserted one for this purpose.
    script.async = false;
    script.src = "/vendor/webmcp-relay/embed.js";
    document.body.appendChild(script);
  }, []);

  // Always registered (agent mode or not -- it's a harmless no-op when
  // document.modelContext doesn't exist): lets an agent move between
  // sections before that section's own tools become reachable, since a
  // WebMCP tool only exists while its owning component is mounted.
  useModelContextTool({
    name: "app_navigate",
    description: `Navigate to a section of mallory-graph. Valid paths: ${SECTION_PATHS.join(", ")}.`,
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "One of the app's section paths, e.g. /graphing or /calculus." },
      },
      required: ["path"],
    } as const,
    handler: async (input: Record<string, unknown>) => {
      const path = String(input.path ?? "");
      if (!SECTION_PATHS.includes(path)) {
        throw new Error(`Unknown path "${path}". Valid paths: ${SECTION_PATHS.join(", ")}.`);
      }
      await navigate({ to: path });
      return { ok: true, path };
    },
  });

  // General CAS toolbox (issue #40's "tool-name parity" item) -- always
  // registered alongside app_navigate above, for the same "harmless no-op
  // without document.modelContext" reason.
  useSymbolicTools();

  // The global workspace (issue #42): registered at the app shell, not on
  // the /workspace page itself -- an agent (or a human on a completely
  // different panel) needs to read/set a workspace variable without a
  // human also having the inspector page open, since the workspace's whole
  // point is being reachable from anywhere.
  useCellGraphTools("workspace", getWorkspaceGraph());

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="wordmark">
          <Link to="/" className="wordmark-link mono" aria-label="mallory.graph home">
            <span className="wordmark-accent">{"›"}</span> mallory<span className="wordmark-accent">.</span>
            graph
          </Link>
          <button
            type="button"
            className="theme-toggle"
            aria-label={`Theme: ${themeLabel(theme)} (click to switch)`}
            title={`Theme: ${themeLabel(theme)} (click to switch)`}
            onClick={() => setTheme((t) => nextTheme(t))}
          >
            <span
              aria-hidden="true"
              className="theme-toggle-icon"
              style={{ display: "inline-block", transform: `rotate(${themeIconRotation(theme)}deg)` }}
            >
              {"◐"}
            </span>
          </button>
        </div>

        <nav className="primary-nav">
          {NAV_SECTIONS.map((item, i) => (
            <Fragment key={item.to}>
              {item.group !== NAV_SECTIONS[i - 1]?.group && <div className="nav-eyebrow">{item.group}</div>}
              <Link
                to={item.to}
                className="nav-item"
                activeProps={{ className: "nav-item active" }}
                activeOptions={{ exact: item.to === "/" }}
              >
                <NavIcon path={item.icon} />
                {item.label}
              </Link>
            </Fragment>
          ))}
        </nav>

        <div className="sidebar-footer">
          <button
            type="button"
            className="agent-mode-toggle"
            aria-pressed={agentMode}
            title="Let an MCP-speaking AI agent (Claude Code, Claude Desktop, Cursor, ...) call tools against this page, via the WebMCP local relay running on your own machine. When on, an agent can also read/write the shared Workspace variables from any page -- full explanation on the Workspace page."
            onClick={() => setAgentModeEnabled(!agentMode)}
          >
            <span aria-hidden="true">{"\u{1F916}"}</span> Agent access: {agentMode ? "On" : "Off"}
          </button>
          <Link to="/demos" className="legacy-link">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
              <path d="M4 3.5h8M4 8h8M4 12.5h5" strokeLinecap="round" />
            </svg>
            Legacy / all demos
          </Link>
        </div>
      </aside>

      <main className="app-main">
        <Outlet />
      </main>

      {floatingCalcOpen && (
        <div className="floating-calculator-panel" role="dialog" aria-label="Floating calculator">
          <div className="floating-calculator-header">
            <span>Calculator</span>
            <button type="button" onClick={() => setFloatingCalcOpen(false)} aria-label="Close floating calculator" title="Close">
              ✕
            </button>
          </div>
          {/* `instanceId="floating"` (the same scoping mechanism issue #255's
              notebook calculator block already uses) gives this its own
              independent localStorage history and WebMCP tool names,
              distinct from the standalone /calculator route's instance --
              no changes to CalculatorPanel itself needed. */}
          <CalculatorPanel instanceId="floating" />
        </div>
      )}
      <button
        type="button"
        className="floating-calculator-toggle"
        onClick={() => setFloatingCalcOpen((open) => !open)}
        aria-label={floatingCalcOpen ? "Hide floating calculator" : "Show floating calculator"}
        aria-pressed={floatingCalcOpen}
        title="Calculator (available on every page)"
      >
        <span aria-hidden="true">🧮</span>
      </button>
    </div>
  );
}
