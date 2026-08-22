import { useNavigate, useSearch } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { useModelContextTool } from "../hooks/use-model-context-tool.ts";

export interface CategoryTab {
  label: string;
  /** Short slug used by `syncSearchParam` (deep-linking/Gallery reopen) -- required when that prop is set. */
  key?: string;
  render: () => ReactNode;
}

/**
 * A dependency-free tab switcher for grouping a few related, otherwise
 * unmodified panels under one URL (mallory's SPA-shell pass) -- e.g.
 * Calculus's Single-ODE/ODE-System tabs. Mirrors GeometryPanel's own tool
 * selector idiom (a flat radio row driving a `useState`), the closest prior
 * art in this codebase; deliberately not a general ARIA-tablist component,
 * just enough to swap which unmodified panel is mounted.
 *
 * `prefix` names a WebMCP tool (`${prefix}_switch_tab`) so an agent can move
 * between grouped tools too -- only the active tab's panel is mounted, so
 * only its own tools are registered at any moment; switching tabs is what
 * makes the next set appear (mallory's WebMCP pass).
 *
 * `syncSearchParam` (e.g. `"tab"`) makes the active tab a URL search param
 * instead of purely local state -- needed because each tab's own panel
 * privately owns its own CellGraph and URL-hash persistence (organizational
 * gap-fixing pass): a Gallery link to "ODE System" must select that tab
 * *before* the wrong sibling panel mounts and mis-parses the hash. Reads the
 * initial tab from the search param (falling back to tab 0 for an unknown/
 * absent value) and keeps it updated (via `replace`, so tab-switching
 * doesn't spam browser history) as the user clicks between tabs.
 */
export function CategoryTabs({
  prefix,
  tabs,
  syncSearchParam,
}: {
  prefix: string;
  tabs: CategoryTab[];
  syncSearchParam?: string;
}) {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const initialFromSearch = syncSearchParam ? tabs.findIndex((t) => t.key === search[syncSearchParam]) : -1;
  const [active, setActive] = useState(initialFromSearch >= 0 ? initialFromSearch : 0);

  function selectTab(index: number) {
    setActive(index);
    if (syncSearchParam) {
      const key = tabs[index].key;
      navigate({ to: ".", search: (prev: Record<string, unknown>) => ({ ...prev, [syncSearchParam]: key }), replace: true });
    }
  }

  useModelContextTool({
    name: `${prefix}_switch_tab`,
    description: `Switch the active tab on the ${prefix} section. Available tabs: ${tabs.map((t) => t.label).join(", ")}.`,
    inputSchema: {
      type: "object",
      properties: {
        label: { type: "string", description: `One of: ${tabs.map((t) => t.label).join(", ")}` },
      },
      required: ["label"],
    },
    handler: (input: Record<string, unknown>) => {
      const label = String(input.label ?? "");
      const index = tabs.findIndex((t) => t.label === label);
      if (index === -1) {
        throw new Error(`Unknown tab "${label}". Available tabs: ${tabs.map((t) => t.label).join(", ")}.`);
      }
      selectTab(index);
      return { ok: true, label };
    },
  });

  return (
    <div>
      <div className="tab-row" role="tablist">
        {tabs.map((tab, i) => (
          <button
            key={tab.label}
            type="button"
            role="tab"
            aria-selected={i === active}
            className={i === active ? "tab-button active" : "tab-button"}
            onClick={() => selectTab(i)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div role="tabpanel">{tabs[active].render()}</div>
    </div>
  );
}
