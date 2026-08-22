import {
  Link,
  Outlet,
  createRootRoute,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";

/**
 * Branded 404 (issue #316): unknown routes used to render TanStack's bare
 * default -- an unstyled white "Not Found" with no theme and no way back.
 * This renders inside the root document (so styles.css and the theme
 * tokens apply) with a link home. It can't carry the sidebar -- the shell
 * lives on the /_app layout route, and an unmatched URL never enters that
 * layout -- but a themed page with an escape hatch covers the report.
 */
function NotFoundPage() {
  return (
    <div style={{ display: "grid", placeItems: "center", minHeight: "80vh", textAlign: "center", padding: "2rem" }}>
      <div>
        <p className="page-eyebrow">404</p>
        <h1>There's no page here.</h1>
        <p className="lede" style={{ margin: "0.75rem 0 1.5rem" }}>
          The address may be mistyped, or the page may have moved.
        </p>
        <Link to="/" className="dashboard-card" style={{ display: "inline-block", padding: "0.6rem 1.2rem" }}>
          ← Back to the Dashboard
        </Link>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      // maximum-scale/user-scalable are deliberately left unset -- pinch-zoom
      // stays available; a fixed layout width is what actually needs fixing
      // per-page (canvas/table overflow), not disabling zoom.
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "mallory" },
      { name: "description", content: "An interactive graphing calculator built on @johnhenry/math." },
      // iOS home-screen install (Android reads the manifest below instead).
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-title", content: "mallory" },
      { name: "apple-mobile-web-app-status-bar-style", content: "default" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: "/styles.css",
      },
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      { rel: "manifest", href: "/site.webmanifest" },
    ],
  }),
  component: RootComponent,
  notFoundComponent: NotFoundPage,
});

function RootComponent() {
  return (
    <html lang="en">
      <head>
        <HeadContent />
        {/* Rendered directly (not via head()'s `meta` array) -- TanStack
            Router's head merge dedupes by `name` alone, ignoring `media`, so
            two same-named theme-color entries there collapse to just the
            last one. Mirrors the same tokens the SPA shell's own CSS media
            query uses, so mobile browser chrome / PWA title bar matches
            whichever theme is actually rendering. */}
        <meta name="theme-color" content="#fafbfd" media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content="#0b1220" media="(prefers-color-scheme: dark)" />
      </head>
      <body>
        <Outlet />
        <Scripts />
      </body>
    </html>
  );
}
