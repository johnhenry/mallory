import { useEffect, useRef } from "react";

/**
 * A minimal, hand-rolled replacement for `@mcp-b/react-webmcp`'s `useWebMCP`
 * hook (mallory-graph's WebMCP pass). Written directly against the
 * `document.modelContext.registerTool(tool, { signal })` API (confirmed via
 * direct source reading of docs.mcp-b.ai / WebMCP-org/npm-packages, not
 * assumed) rather than depending on the library, because `@mcp-b/react-webmcp`
 * lists `@mcp-b/global` as one of ITS OWN dependencies -- a static
 * `import { useWebMCP } from "@mcp-b/react-webmcp"` at the top of a
 * component transitively bundles a big chunk of the WebMCP runtime into
 * that component's chunk *unconditionally*, even for a visitor who never
 * turns agent mode on. Confirmed directly: `_app.tsx`'s built chunk jumped
 * from ~4.5KB to 324KB when this file first imported the library. Since
 * `@mcp-b/global` itself is already dynamically `import()`ed only when
 * agent mode is enabled (see webmcp-agent-mode.ts / _app.tsx), this hook
 * has to avoid statically importing anything from the `@mcp-b` scope at
 * all to keep that deferral meaningful.
 *
 * Handles the one real race this creates: a panel can mount before
 * `@mcp-b/global`'s dynamic import (triggered once, in `_app.tsx`) has
 * resolved. Rather than polling, `_app.tsx` dispatches `webmcpReadyEvent()`
 * once the import resolves; this hook retries registration on that event
 * in addition to trying immediately on mount.
 */

interface ToolContent {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

interface RegisterableModelContext {
  registerTool(
    tool: {
      name: string;
      description: string;
      inputSchema: object;
      execute: (args: Record<string, unknown>) => Promise<ToolContent>;
    },
    options: { signal: AbortSignal },
  ): void;
}

const READY_EVENT = "mallory:webmcp-ready";

function getModelContext(): RegisterableModelContext | undefined {
  return (document as unknown as { modelContext?: RegisterableModelContext }).modelContext;
}

/** Call once, after `@mcp-b/global`'s dynamic import resolves, so already-mounted panels retry registration. */
export function announceWebMcpReady(): void {
  window.dispatchEvent(new Event(READY_EVENT));
}

export interface ModelContextToolDef {
  name: string;
  description: string;
  /** Plain JSON Schema object (`as const` for literal typing at the call site isn't required -- inputs are read defensively at runtime regardless). */
  inputSchema: object;
  /** Return any JSON-serializable value, or throw to report a tool-execution error. */
  handler: (input: Record<string, unknown>) => Promise<unknown> | unknown;
}

/**
 * Registers one WebMCP tool for as long as the calling component is
 * mounted. Safe to call unconditionally -- if `document.modelContext`
 * doesn't exist (agent mode off, or `@mcp-b/global` hasn't finished loading
 * yet), this just skips registration (retrying once on the ready event)
 * rather than throwing.
 */
export function useModelContextTool(tool: ModelContextToolDef): void {
  const toolRef = useRef(tool);
  toolRef.current = tool;

  useEffect(() => {
    const ac = new AbortController();
    let registered = false;

    function register() {
      if (registered || ac.signal.aborted) return;
      const mc = getModelContext();
      if (!mc) return;
      try {
        mc.registerTool(
          {
            name: toolRef.current.name,
            description: toolRef.current.description,
            inputSchema: toolRef.current.inputSchema,
            async execute(args) {
              try {
                const result = await toolRef.current.handler(args);
                return { content: [{ type: "text", text: JSON.stringify(result ?? null) }] };
              } catch (e) {
                return {
                  content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }],
                  isError: true,
                };
              }
            },
          },
          { signal: ac.signal },
        );
        registered = true;
      } catch (e) {
        console.warn(`[mallory] Failed to register WebMCP tool "${toolRef.current.name}":`, e);
      }
    }

    register();
    window.addEventListener(READY_EVENT, register);
    return () => {
      ac.abort();
      window.removeEventListener(READY_EVENT, register);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tool identity (name/schema) is expected to stay stable per mount; toolRef always has the latest handler.
  }, [tool.name]);
}
