import { createFileRoute, Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { isAgentModeEnabled, setAgentModeEnabled } from "../lib/webmcp-agent-mode.ts";
import { announceWebMcpReady, useModelContextTool } from "../hooks/use-model-context-tool.ts";
import { useSymbolicTools } from "../hooks/use-symbolic-tools.ts";

export const Route = createFileRoute("/_app")({
  component: AppShell,
});

const NAV_ITEMS: Array<{ to: string; label: string; icon: string }> = [
  {
    to: "/",
    label: "Dashboard",
    icon: '<rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/>',
  },
  {
    to: "/calculator",
    label: "Calculator",
    icon: '<rect x="3" y="1.5" width="10" height="13" rx="1.3"/><rect x="4.7" y="3.3" width="6.6" height="2.6" rx="0.5" stroke-width="1.2"/><circle cx="5.4" cy="9" r="0.75" fill="currentColor" stroke="none"/><circle cx="8" cy="9" r="0.75" fill="currentColor" stroke="none"/><circle cx="10.6" cy="9" r="0.75" fill="currentColor" stroke="none"/><circle cx="5.4" cy="11.8" r="0.75" fill="currentColor" stroke="none"/><circle cx="8" cy="11.8" r="0.75" fill="currentColor" stroke="none"/><circle cx="10.6" cy="11.8" r="0.75" fill="currentColor" stroke="none"/>',
  },
  {
    to: "/graphing",
    label: "Graphing",
    icon: '<path d="M1.5 8.5C3 5 4 12 5.5 8.5S8 3 9.5 8.5s2.5 3.5 5-1" stroke-linecap="round"/>',
  },
  {
    to: "/3d",
    label: "3D & Surfaces",
    icon: '<path d="M8 1.5 14 4.5v7L8 14.5 2 11.5v-7L8 1.5Z" stroke-linejoin="round"/><path d="M2 4.5 8 7.5m0 0 6-3M8 7.5v7" stroke-linejoin="round"/>',
  },
  {
    to: "/geo",
    label: "Geometry",
    icon: '<path d="M8 2.2 3 13h10L8 2.2Z" stroke-linejoin="round"/><circle cx="8" cy="6.3" r="0.9" fill="currentColor" stroke="none"/>',
  },
  {
    to: "/calculus",
    label: "Calculus",
    icon: '<path d="M6.4 2.3c-1.6 0-2 1.3-2 2.6v6c0 1.3-.4 2.6-2 2.6M6.9 6.4h3.6" stroke-linecap="round"/><path d="M11 10.5c.6.8 1.2.8 1.6 0" stroke-linecap="round"/>',
  },
  {
    to: "/data",
    label: "Data & Algebra",
    icon: '<path d="M2.5 13.5v-4M6.5 13.5v-8M10.5 13.5v-6M14 13.5V4" stroke-linecap="round"/>',
  },
  {
    to: "/signal",
    label: "Signal",
    icon: '<path d="M1.5 8h2.5l1.5-4.5 2.5 9 1.8-6.5 1.4 2h2.8" stroke-linecap="round" stroke-linejoin="round"/>',
  },
  {
    to: "/image",
    label: "Image",
    icon: '<rect x="1.8" y="2.5" width="12.4" height="11" rx="1.2"/><circle cx="6" cy="6" r="1.3" fill="currentColor" stroke="none"/><path d="M2.5 12 6.5 8l2.5 2.5 2-2 2.5 2.5" stroke-linecap="round" stroke-linejoin="round"/>',
  },
  {
    to: "/ml",
    label: "ML",
    icon: '<circle cx="3" cy="8" r="1.4"/><circle cx="8" cy="3.5" r="1.4"/><circle cx="8" cy="12.5" r="1.4"/><circle cx="13" cy="8" r="1.4"/><path d="M4.3 7.3 6.8 4.6M4.3 8.7l2.5 2.9M9.2 4.4 11.8 7M9.2 11.6l2.6-2.7" stroke-linecap="round"/>',
  },
  {
    to: "/practice",
    label: "Practice",
    icon: '<path d="M8 1.5 9.6 4.9l3.7.5-2.7 2.6.6 3.7L8 10.1l-3.2 1.6.6-3.7-2.7-2.6 3.7-.5L8 1.5Z" stroke-linejoin="round"/><path d="M6 13.5h4" stroke-linecap="round"/>',
  },
  {
    to: "/notes",
    label: "Notebook",
    icon: '<rect x="2.5" y="1.8" width="11" height="12.4" rx="1.2"/><path d="M5 5.2h6M5 8h6M5 10.8h3.6" stroke-linecap="round"/>',
  },
  {
    to: "/gallery",
    label: "Gallery",
    icon: '<path d="M8 2.2 9.6 5.6l3.7.5-2.7 2.6.6 3.7L8 10.6l-3.2 1.8.6-3.7-2.7-2.6 3.7-.5L8 2.2Z" stroke-linejoin="round"/>',
  },
];

function NavIcon({ path }: { path: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" dangerouslySetInnerHTML={{ __html: path }} />
  );
}

const RELAY_SCRIPT_ID = "webmcp-relay-embed";
const SECTION_PATHS = NAV_ITEMS.map((item) => item.to).concat(["/demos"]);

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
          {NAV_ITEMS.map((item) => (
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
