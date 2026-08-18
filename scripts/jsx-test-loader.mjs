// A custom Node ESM loader hook (--experimental-loader) that transforms
// .tsx source through esbuild before handing it to Node -- Node's own
// built-in --experimental-strip-types ERASES types but does NOT transform
// JSX (a <div/> compiles to React.createElement(...), which is a real
// transform, not just erasure), so a plain `import("./Component.tsx")`
// under --experimental-strip-types alone throws ERR_UNKNOWN_FILE_EXTENSION.
// esbuild is already a transitive dependency (vite uses it internally) --
// this just uses it directly for the one thing Node's native TS support
// can't do. Every other extension is deferred to the next loader in the
// chain (Node's own --experimental-strip-types handles plain .ts).
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

// vite-tsconfig-paths resolves tsconfig.json's "~/*" -> "./src/*" alias for
// the real Vite build, but the plain Node module resolver used here (issue
// #256) has no concept of it -- a `~`-aliased import (route files under
// src/routes/_app/ use these throughout, e.g. gallery.tsx's `~/lib/
// saved-graphs.ts`) throws ERR_MODULE_NOT_FOUND without this. Mirrors that
// same one mapping, resolved relative to THIS file's own location (scripts/)
// rather than cwd, so it works regardless of which directory `node --test`
// is invoked from.
const SRC_DIR = new URL("../src/", import.meta.url);

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("~/")) {
    return nextResolve(new URL(specifier.slice(2), SRC_DIR).href, context);
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  // A bare `import "some-package/styles.css"` (e.g. TexSpan.tsx's katex
  // stylesheet) is a side-effect-only import a bundler (Vite, in this
  // app's real build) turns into actual injected CSS -- Node's own module
  // resolution has no concept of that and throws ERR_UNKNOWN_FILE_EXTENSION
  // on the bare .css extension. Standing in for what a bundler would do
  // here: treat it as an empty module, matching how Jest/webpack's own
  // css-loader-under-test-runner shims behave (imported for side effects
  // that don't exist outside a real DOM/stylesheet anyway).
  if (url.endsWith(".css")) {
    return { format: "module", source: "export {};", shortCircuit: true };
  }
  if (url.endsWith(".tsx")) {
    const path = fileURLToPath(url);
    const source = await readFile(path, "utf8");
    const { code } = await esbuild.transform(source, {
      loader: "tsx",
      format: "esm",
      target: "node22",
      sourcefile: path,
      // Matches tsconfig.json's "jsx": "react-jsx" (the automatic runtime,
      // auto-importing react/jsx-runtime) -- esbuild's default "transform"
      // mode instead compiles to bare React.createElement(...) calls and
      // expects a React identifier in scope, which this codebase's
      // component files don't import (they only import named hooks).
      jsx: "automatic",
    });
    return { format: "module", source: code, shortCircuit: true };
  }
  return nextLoad(url, context);
}
