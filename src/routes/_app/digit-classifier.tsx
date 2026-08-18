import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * `/digit-classifier` -- folded into the ML tab's "Digit Classifier" tab
 * (issue #253). This route now only redirects, preserving the old URL
 * rather than breaking it (the issue's own explicit ask), instead of
 * disappearing outright. The loader always throws, so the component below
 * never actually renders -- it exists only to satisfy `createFileRoute`'s
 * type, which expects one (same pattern as the short-link redirect,
 * s.$id.tsx).
 */
export const Route = createFileRoute("/_app/digit-classifier")({
  loader: () => {
    throw redirect({ to: "/ml", search: { tab: "digit-classifier" } });
  },
  component: () => null,
});
