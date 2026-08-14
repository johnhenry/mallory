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

export async function load(url, context, nextLoad) {
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
