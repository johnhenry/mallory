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

// srvx's static server doesn't map .wasm, so the ONNX Runtime binaries
// (dist/client/ort/*.wasm, ~26MB) went out as text/plain -- which makes the
// browser REFUSE WebAssembly.instantiateStreaming (it requires
// application/wasm) and fall back to buffering the whole file before
// compiling. That's mallory#312's "Loading model... for 35+ seconds":
// no streaming compilation, on the app's largest asset. Verified live
// before this fix: `curl -sI .../ort/ort-wasm-simd-threaded.jsep.wasm` ->
// `content-type: text/plain; charset=UTF-8`.
const wasmContentType = async (req, next) => {
  const res = await next();
  if (res && new URL(req.url).pathname.endsWith(".wasm")) {
    res.headers.set("Content-Type", "application/wasm");
  }
  return res;
};

const server = serve({
  port: Number(port),
  hostname: host,
  middleware: [noCacheOnUnhashedStatic, wasmContentType, serveStatic({ dir: "./dist/client" })],
  fetch: handler.fetch,
});

// Live collaboration (issue #47): a raw http.Server 'upgrade' handler --
// see collab-server.mjs's own doc comment for why this can't be a normal
// TanStack Start server route. server.node.server is srvx's own escape
// hatch to the underlying Node http.Server it built internally.
if (server.node?.server) attachCollabWebSocketServer(server.node.server);

console.log(`Server running on http://${host}:${port}`);
