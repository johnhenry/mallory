import { serve } from "srvx/node";
import { serveStatic } from "srvx/static";
import { attachCollabWebSocketServer } from "./collab-server.mjs";
import handler from "./dist/server/server.js";

const port = process.env.PORT || 3000;
const host = process.env.HOST || "0.0.0.0";

// Files copied verbatim from public/ (styles.css, icons, manifest, etc.) keep a
// stable URL across deploys, unlike the content-hashed bundles under /assets/.
// Cloudflare applies its own default edge TTL to any static file with no
// Cache-Control header, so a stable-URL file can serve stale content at the
// edge for a while after a deploy changes it. Force revalidation instead.
const UNHASHED_STATIC = /\.(css|js|mjs|json|txt|xml|svg|png|ico|webmanifest)$/;
const noCacheOnUnhashedStatic = async (req, next) => {
  const res = await next();
  const { pathname } = new URL(req.url);
  if (res && !pathname.startsWith("/assets/") && UNHASHED_STATIC.test(pathname)) {
    res.headers.set("Cache-Control", "no-cache");
  }
  return res;
};

const server = serve({
  port: Number(port),
  hostname: host,
  middleware: [noCacheOnUnhashedStatic, serveStatic({ dir: "./dist/client" })],
  fetch: handler.fetch,
});

// Live collaboration (issue #47): a raw http.Server 'upgrade' handler --
// see collab-server.mjs's own doc comment for why this can't be a normal
// TanStack Start server route. server.node.server is srvx's own escape
// hatch to the underlying Node http.Server it built internally.
if (server.node?.server) attachCollabWebSocketServer(server.node.server);

console.log(`Server running on http://${host}:${port}`);
