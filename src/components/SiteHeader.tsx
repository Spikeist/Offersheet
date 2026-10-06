/**
 * The site header (CLAUDE.md §14: mobile-first, works at 375 px): the logo home link and the main
 * nav in the order you use the pages (Connect, Import report, League, Waivers: a section of the League
 * page, Trades: the Trade Finder, §14 item 4, from which the Trade Analyzer is one link away: Trades is
 * marked current there too), then Settings (§14 item 6, Phase 4). The page you're on is marked by NavLink.
 *
 * Fitting 375 px: below sm only the mark shows. The "Offer Sheet" wordmark text is visually hidden,
 * but it stays the home link's accessible name. The links don't fit beside the mark on a phone,
 * so the nav drops below it (Phase 4 wave 2 measured five links at about 330–339 px of the 343 px
 * row in headless Chrome; Phase 7b's six take two rows: below). "Import report" reads "Report"
 * below sm (its accessible name follows what's shown) and the links sit closer (NavLink's padding,
 * the nav's gap). The home link and the nav links are 44 px tap targets.
 *
 * Phase 4c (planner reply to Checkpoint 4b, change 11): the league switcher (LeagueSwitcher.tsx) sits next to the
 * logo, and the nav has a row of its own below lg (basis-full: 1024 px fits the logo, the switcher and the links
 * in one row), with or without the switcher, so the header's rows never move when it appears after the store loads.
 * The header's row is the switcher's panel's anchor on phones (relative). A banner under the header says when leagues
 * can't be kept in this browser (StorageNotice).
 *
 * Phase 7b (planner reply to Checkpoint 7a, §6.2: "Waiver upgrades (League page, linked from the nav)"): a sixth link,
 * "Waivers", to the League page's section (/league#waivers, src/lib/waiversLink.ts), after League. Six links don't fit one
 * row at 375 px (five already took about 335 of the 343 px), so below sm the nav is a grid of three columns, two rows of
 * three centered links (Connect, Report, League / Waivers, Trades, Settings): 44 px more header on a phone, and no
 * crowding or wrapping that depends on the font. From sm up the links sit in one row, as before (640 px fits the six).
 * At 375 px the first row is the logo and the switcher (both 44 px tall), then the nav's two rows.
 *
 * Part B (planner reply to Checkpoint 4c, B3: "Home: … add a 'Beta' label"): a "Beta" pill sits next to the logo, a word
 * (not color alone), outside the home link so the link's name stays "Offer Sheet". The logo and the pill stay together
 * (one group that doesn't shrink). Below sm they sit tight (review PG-4) so the switcher keeps the first row down to a
 * 320 px phone (or a bigger one at its largest display size): the home link's 6 px padding is the only space before the
 * pill, the pill's sides are 4 px, and the row's gap 8 px. Measured in headless Chrome on Windows (Segoe UI, the widest
 * of the system fonts the site uses): the group is 82 px, plus the gap and the switcher's 12rem basis 282 px, inside the
 * 288 px a 320 px phone leaves (with sm's spacing, 96 + 12 + 192 = 300 px pushed the switcher to a row of its own, and
 * the header grew 44 px when it appeared). From sm up the spacing is as before. The mark (LogoMark.tsx) is drawn from
 * src/components/logoGeometry.ts, as the app icons and the sharing image are.
 */
import Link from "next/link";
import { WAIVERS_HREF } from "@/lib/waiversLink";
import { LeagueSwitcher, StorageNotice } from "./LeagueSwitcher";
import { LogoMark } from "./LogoMark";
import { NavLink } from "./NavLink";

/** The beta label next to the logo: the word itself, in gold on the navy header. */
export function BetaPill() {
  return <span className="inline-flex items-center rounded-full border border-accent/70 px-1 py-0.5 text-xs font-extrabold tracking-wider text-accent uppercase sm:px-2">Beta</span>;
}

export function SiteHeader() {
  return (
    <>
      <header className="bg-navy text-navy-contrast">
        <div className="relative mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-2 px-4 py-2 sm:gap-x-3">
          <div className="flex shrink-0 items-center sm:gap-1.5">
            {/* The negative margin keeps the mark lined up with the page while the padding makes a 44 px target. */}
            <Link href="/" className="-ml-1.5 flex min-h-11 shrink-0 items-center gap-2 rounded-lg px-1.5 font-extrabold tracking-tight">
              <LogoMark className="size-8" />
              <span className="sr-only text-lg sm:not-sr-only">Offer Sheet</span>
            </Link>
            <BetaPill />
          </div>
          <LeagueSwitcher />
          <nav aria-label="Main" className="ml-auto grid basis-full grid-cols-3 gap-0.5 text-sm font-bold sm:flex sm:flex-wrap sm:items-center sm:justify-end sm:gap-1 lg:basis-auto">
            <NavLink href="/connect">Connect</NavLink>
            <NavLink href="/import">
              <span className="sm:hidden">Report</span>
              <span className="hidden sm:inline">Import report</span>
            </NavLink>
            <NavLink href="/league">League</NavLink>
            <NavLink href={WAIVERS_HREF}>Waivers</NavLink>
            <NavLink href="/trades" alsoOn={["/analyzer"]}>
              Trades
            </NavLink>
            <NavLink href="/settings">Settings</NavLink>
          </nav>
        </div>
      </header>
      <StorageNotice />
    </>
  );
}
