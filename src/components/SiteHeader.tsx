/**
 * The site header (CLAUDE.md §14: mobile-first, works at 375 px): the logo home link and the main
 * nav in the order you use the pages (Connect, Import report, League). The page you're on is marked
 * by NavLink.
 *
 * Fitting 375 px: below sm only the mark shows. The "Offer Sheet" wordmark text is visually hidden,
 * but it stays the home link's accessible name, and the three links fit on one row. On narrower
 * screens, or with larger text, the nav drops to a second row instead of pushing the page sideways.
 * The home link and the nav links are 44 px tap targets.
 */
import Link from "next/link";
import { NavLink } from "./NavLink";

export function LogoMark({ className }: { className?: string }) {
  // A football on a gold tile.
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={className}>
      <rect width="32" height="32" rx="8" fill="var(--accent)" />
      <ellipse cx="16" cy="16" rx="11" ry="7" transform="rotate(-35 16 16)" fill="var(--navy)" />
      <path d="M12.5 19.5l7-7" stroke="var(--accent)" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M14 15.4l1.6 1.6M15.7 13.7l1.6 1.6M17.4 12l1.6 1.6" stroke="var(--accent)" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

export function SiteHeader() {
  return (
    <header className="bg-navy text-navy-contrast">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-3 px-4 py-2">
        {/* The negative margin keeps the mark lined up with the page while the padding makes a 44 px target. */}
        <Link href="/" className="-ml-1.5 flex min-h-11 items-center gap-2 rounded-lg px-1.5 font-extrabold tracking-tight">
          <LogoMark className="size-8" />
          <span className="sr-only text-lg sm:not-sr-only">Offer Sheet</span>
        </Link>
        <nav aria-label="Main" className="ml-auto flex flex-wrap items-center gap-1 text-sm font-bold">
          <NavLink href="/connect">Connect</NavLink>
          <NavLink href="/import">Import report</NavLink>
          <NavLink href="/league">League</NavLink>
        </nav>
      </div>
    </header>
  );
}
