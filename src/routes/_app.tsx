import { createFileRoute, Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { isAgentModeEnabled, setAgentModeEnabled } from "../lib/webmcp-agent-mode.ts";
import { announceWebMcpReady, useModelContextTool } from "../hooks/use-model-context-tool.ts";
import { useSymbolicTools } from "../hooks/use-symbolic-tools.ts";
import { useCellGraphTools } from "../hooks/use-cell-graph-tools.ts";
import { NAV_SECTIONS, SECTION_PATHS } from "../lib/nav-sections.ts";
import { getWorkspaceGraph } from "../lib/workspace-graph.ts";

export const Route = createFileRoute("/_app")({
  component: AppShell,
});

function NavIcon({ path }: { path: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" dangerouslySetInnerHTML={{ __html: path }} />
  );
}

const RELAY_SCRIPT_ID = "webmcp-relay-embed";

function AppShell() {
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);
  const [agentMode, setAgentMode] = useState(false);
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
          <span className="mono">
            <span className="wordmark-accent">{"›"}</span> mallory<span className="wordmark-accent">.</span>
            graph
          </span>
          <button
            type="button"
            className="theme-toggle"
            aria-label="Toggle theme"
            title="Toggle theme"
            onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
          >
            {"◐"}
          </button>
        </div>

        <nav className="primary-nav">
          <div className="nav-eyebrow">Tools</div>
          {NAV_SECTIONS.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="nav-item"
              activeProps={{ className: "nav-item active" }}
              activeOptions={{ exact: item.to === "/" }}
            >
              <NavIcon path={item.icon} />
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="sidebar-footer">
          <button
            type="button"
            className="agent-mode-toggle"
            aria-pressed={agentMode}
            title="Let an MCP-speaking AI agent (Claude Code, Claude Desktop, Cursor, ...) call tools against this page, via the WebMCP local relay running on your own machine."
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
    </div>
  );
}
