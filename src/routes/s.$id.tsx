import { createFileRoute, redirect } from "@tanstack/react-router";
import { resolveShortLink } from "../lib/short-links.ts";

/**
 * `/s/:id` -- a short link created by the Gallery's "Copy short link"
 * button (issue #44 item 2). The loader always throws a redirect (to the
 * real panel URL on success, back to `/gallery` on an unknown/expired
 * id), so the component below never actually renders -- it exists only
 * to satisfy `createFileRoute`'s type, which expects one.
 */
export const Route = createFileRoute("/s/$id")({
  loader: async ({ params }) => {
    const target = await resolveShortLink({ data: { id: params.id } });
    if (target === null) throw redirect({ to: "/gallery" });
    throw redirect({ href: target });
  },
  component: () => null,
});
