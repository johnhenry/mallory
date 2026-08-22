import { Link } from "@tanstack/react-router";

/**
 * A small notice on every legacy single-purpose page (mallory's
 * SPA-shell pass), pointing at the new equivalent section without removing
 * or redirecting the legacy page itself -- these stay reachable for
 * reference at their original URLs.
 */
export function LegacyBanner({ to, label }: { to: string; label: string }) {
  return (
    <p className="legacy-banner">
      This is a legacy demo page — try the new <Link to={to}>{label} →</Link>
    </p>
  );
}
