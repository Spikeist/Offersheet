import Link from "next/link";
import { FANTASYCALC_LINK } from "@/components/league/ValuesCredit";

/**
 * The footer on every page (CLAUDE.md §14 "Footer and layout"; planner reply to Checkpoint 4c, B3: "Footer: a feedback
 * link, the attributions (FantasyCalc wherever values show), and 'Not affiliated with ESPN or Sleeper…'"):
 * - Feedback · Privacy · Terms, each a 44 px tap target (on phones too: check:browser measures links that aren't inside
 *   a sentence);
 * - "Trade values: FantasyCalc", the link back FantasyCalc asks for on every page that shows anything derived from its
 *   values (planner reply to Checkpoint 7a, 5.4): a plain <a> in a server component the root layout (src/app/layout.tsx,
 *   the only layout) renders around every page, so it's in every page's server HTML, not added by JavaScript; with
 *   FantasyCalc's attributes (FANTASYCALC_LINK: rel "noopener", referrerPolicy "origin");
 * - the other sources' credits, exactly the ones production uses: Sleeper and ESPN for projections and stats,
 *   DynastyProcess for the player ID map (its GPL-3.0 data asks for credit), ESPN for the NFL schedule
 *   (src/data/nflSchedule.ts reads ESPN's proTeamSchedules_wl; the app downloads nothing from nflverse, whose games were
 *   only Phase 0's cross-check: review PG-2);
 * - that Offer Sheet is free, independent and a beta, and is affiliated with none of the services it reads or names;
 * - the copyright line the landing page had, in Offer Sheet's name (no person's name: planner reply to Checkpoint 7a, 3).
 * Yahoo's attribution ("Fantasy data provided by Yahoo Fantasy", CLAUDE.md §2.4) joins it only where Yahoo data shows,
 * once Yahoo approves Offer Sheet (Phase 5).
 */

export const FOOTER_LINKS = [
  { href: "/feedback", label: "Feedback" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
] as const;

export const FOOTER_CREDITS = "Projections and stats: Sleeper and ESPN · Player IDs: DynastyProcess · NFL schedule: ESPN";

export const FOOTER_INDEPENDENT =
  "Offer Sheet is a free, independent beta. It is not affiliated with or endorsed by ESPN, Sleeper, Yahoo, Fleaflicker, MyFantasyLeague, Fantrax, FantasyCalc, DynastyProcess or the NFL.";

export function SiteFooter() {
  return (
    <footer className="mt-12 border-t border-line bg-surface">
      <div className="mx-auto max-w-5xl space-y-2 px-4 pt-3 pb-6 text-sm text-muted">
        <nav aria-label="About Offer Sheet">
          <ul className="-ml-2 flex flex-wrap items-center">
            {FOOTER_LINKS.map((l, i) => (
              <li key={l.href} className="flex items-center">
                {i > 0 ? (
                  <span aria-hidden className="px-0.5">
                    ·
                  </span>
                ) : null}
                <Link href={l.href} className="inline-flex min-h-11 items-center rounded-lg px-2 font-semibold text-foreground underline-offset-2 hover:underline">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <p>
          Trade values:{" "}
          <a {...FANTASYCALC_LINK} className="font-semibold text-brand-strong underline underline-offset-2 dark:text-brand">
            FantasyCalc
          </a>
        </p>
        <p>{FOOTER_CREDITS}</p>
        <p>{FOOTER_INDEPENDENT}</p>
        <p>© 2026 Offer Sheet</p>
      </div>
    </footer>
  );
}
