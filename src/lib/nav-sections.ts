/**
 * The app's sidebar sections -- moved here (from `_app.tsx`'s own former
 * `NAV_ITEMS`) so the same path/label list is the single source of truth for
 * both the sidebar nav AND `resolveNavigationCommand` below (issue #46's
 * "routing layer" item), rather than two lists that could silently drift.
 */
export interface NavSection {
  to: string;
  label: string;
  icon: string;
}

export const NAV_SECTIONS: NavSection[] = [
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
  {
    to: "/workspace",
    label: "Workspace",
    icon: '<rect x="2" y="3" width="12" height="10" rx="1.2"/><path d="M2 6.2h12" stroke-linecap="round"/><circle cx="4.3" cy="4.6" r="0.5" fill="currentColor" stroke="none"/>',
  },
  {
    to: "/tiles",
    label: "Tiles",
    icon: '<rect x="1.8" y="1.8" width="5.4" height="5.4" rx="0.6"/><rect x="8.8" y="1.8" width="5.4" height="5.4" rx="0.6"/><rect x="1.8" y="8.8" width="5.4" height="5.4" rx="0.6"/><rect x="8.8" y="8.8" width="5.4" height="5.4" rx="0.6"/>',
  },
  {
    to: "/streaming-dataset",
    label: "Streaming",
    icon: '<circle cx="3" cy="8" r="1.4"/><circle cx="8" cy="4.5" r="1.4"/><circle cx="8" cy="11.5" r="1.4"/><circle cx="13" cy="8" r="1.4"/><path d="M4.2 7.3 6.8 5.2M4.2 8.7 6.8 10.8M9.2 5.2 11.8 7.3M9.2 10.8 11.8 8.7" stroke-linecap="round"/>',
  },
  // "/digit-classifier" deliberately has no entry here anymore (issue #253:
  // folded into "/ml" as its own "Digit Classifier" tab, alongside the
  // playground) -- its old URL still works (see the route file, which now
  // only redirects to /ml?tab=digit-classifier), it just isn't a separate
  // sidebar destination/dashboard card any longer.
  {
    to: "/cellular-automata",
    label: "Cellular automata",
    icon: '<rect x="1.8" y="1.8" width="3.4" height="3.4"/><rect x="6.3" y="1.8" width="3.4" height="3.4"/><rect x="10.8" y="1.8" width="3.4" height="3.4"/><rect x="6.3" y="6.3" width="3.4" height="3.4"/><rect x="1.8" y="10.8" width="3.4" height="3.4"/><rect x="10.8" y="10.8" width="3.4" height="3.4"/>',
  },
];

export const SECTION_PATHS = NAV_SECTIONS.map((item) => item.to).concat(["/demos"]);

/**
 * Resolves a typed phrase like "go to statistics" or "open the 3D view" to a
 * section path, for a chat/command input to act on directly (issue #46's
 * "routing layer" remaining scope) -- distinct from `nl-query.ts`'s
 * expression-resolution patterns, since navigating is a router action, not
 * an expression string. Falls through to null on anything that doesn't
 * clearly name one section (an ambiguous or unmatched phrase should NOT
 * silently navigate somewhere unexpected).
 *
 * Matching is deliberately loose (a verb phrase, optional "the"/"me", then
 * a substring of the section's label) rather than an exact-match list, so
 * "3d", "3D & Surfaces", and "3d and surfaces" (typed without the "&") all
 * resolve to the same path -- `&` is stripped from the label before
 * comparison for this last case.
 */
export function resolveNavigationCommand(input: string): string | null {
  const match = input.trim().match(/^(?:go\s+to|open|show\s+me|navigate\s+to|take\s+me\s+to)\s+(?:the\s+)?(.+?)\s*$/i);
  if (!match) return null;
  const target = normalizeLabel(match[1] as string);
  if (!target) return null;
  const section = NAV_SECTIONS.find((s) => normalizeLabel(s.label).includes(target) || target.includes(normalizeLabel(s.label)));
  return section?.to ?? null;
}

function normalizeLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
