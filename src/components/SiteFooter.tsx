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
 *   FantasyCalc's attributes (FANTASYCALC_LINK: rel "noopener", referrerPolicy "origin"), in a new tab its name says it
 *   opens (NEW_TAB);
 * - the other sources' credits, exactly the ones production uses: Sleeper and ESPN for projections and stats,
 *   DynastyProcess for the player ID map (its GPL-3.0 data asks for credit), ESPN for the NFL schedule
 *   (src/data/nflSchedule.ts reads ESPN's proTeamSchedules_wl; the app downloads nothing from nflverse, whose games were
 *   only Phase 0's cross-check: review PG-2). Since Checkpoint 7d "DynastyProcess" links to its data repository, where the
 *   map and its license are (planner reply to Checkpoint 7c, "Also": its ID pairs reach the browser, security finding 10,
 *   so the license is credited where users can see it; the terms name it too): DYNASTYPROCESS_LINK, a plain <a> in the
 *   same server-rendered footer, in a new tab its name says it opens (NEW_TAB), rel "noopener" like FantasyCalc's links
 *   (⚠️ ours: not the "noopener noreferrer" of the privacy page's links to other services' policies, since noreferrer adds
 *   nothing here: the site's Referrer-Policy, same-origin, already sends another site no referrer; review of Checkpoint 7d,
 *   PD7D-6: this said "like every outbound link"), no referrerPolicy of its own, inline in its sentence, so it isn't a
 *   44 px target (WCAG 2.5.8's inline exception, which check:browser applies);
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

/** DynastyProcess's data repository: its player ID map and the map's license (planner reply to Checkpoint 7c, "Also"). */
export const DYNASTYPROCESS_URL = "https://github.com/dynastyprocess/data";
/** The footer's link to it, in a new tab like FantasyCalc's (see the header). */
export const DYNASTYPROCESS_LINK = { href: DYNASTYPROCESS_URL, target: "_blank", rel: "noopener" } as const;

/**
 * What a link that opens a new tab adds to its name (review of Checkpoint 7d, PD7D-2): the words ValuesCredit's link reads
 * out to screen readers (src/components/league/ValuesCredit.tsx, in a screen-reader-only span). Here, and on the privacy
 * page's links to other services' policies (src/app/privacy/PrivacyPolicy.tsx PolicyLink), it's the link's aria-label,
 * after the words it shows ("DynastyProcess (opens in a new tab)": its name starts with its visible label, WCAG 2.5.3), so
 * the words themselves stay the link's own: check:browser's DynastyProcess step reads them and wants exactly
 * "DynastyProcess" (scripts/check-browser/contracts.ts dynastyProcessLinkIssues), and the privacy page's word count
 * (src/app/pages.test.ts) reads only what the page shows.
 */
export const NEW_TAB = " (opens in a new tab)";

/** The credits around the linked name: the same words as FOOTER_CREDITS, "DynastyProcess" the link. */
const [CREDITS_BEFORE = "", CREDITS_AFTER = ""] = FOOTER_CREDITS.split("DynastyProcess");

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
          <a {...FANTASYCALC_LINK} className="font-semibold text-brand-strong underline underline-offset-2 dark:text-brand" aria-label={`FantasyCalc${NEW_TAB}`}>
            FantasyCalc
          </a>
        </p>
        <p>
          {CREDITS_BEFORE}
          <a {...DYNASTYPROCESS_LINK} className="font-semibold text-brand-strong underline underline-offset-2 dark:text-brand" aria-label={`DynastyProcess${NEW_TAB}`}>
            DynastyProcess
          </a>
          {CREDITS_AFTER}
        </p>
        <p>{FOOTER_INDEPENDENT}</p>
        <p>© 2026 Offer Sheet</p>
      </div>
    </footer>
  );
}
