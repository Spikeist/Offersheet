/**
 * The "Values: FantasyCalc" link next to numbers worked out from FantasyCalc's trade values (CLAUDE.md §2.9, §19), and
 * the attributes every link to FantasyCalc carries (FANTASYCALC_LINK, the footer's too). Server- and client-safe.
 *
 * FantasyCalc's conditions (planner reply to Checkpoint 7a, 5.4; reports/fantasycalc-permission.md): rel "noopener" (no
 * noreferrer, no nofollow) and referrerPolicy "origin", so FantasyCalc can see that a visit came from Offer Sheet (the
 * site's origin) but not from which page. The attribute beats the site's own Referrer-Policy (same-origin, which would
 * send nothing to another site) for that one link. React writes it as referrerPolicy="origin"; HTML attribute names aren't
 * case-sensitive. The privacy page says so ("Other sources").
 */
import { cx } from "../ui";

export const FANTASYCALC_URL = "https://fantasycalc.com";

/** Every link to FantasyCalc: a new tab with no hold on this page (noopener), sending only Offer Sheet's origin. */
export const FANTASYCALC_LINK = { href: FANTASYCALC_URL, target: "_blank", rel: "noopener", referrerPolicy: "origin" } as const;

export function ValuesCredit({ tone = "normal", className }: { tone?: "normal" | "onNavy"; className?: string }) {
  return (
    <a {...FANTASYCALC_LINK} className={cx("font-semibold underline underline-offset-2", tone === "onNavy" ? "text-accent" : "text-brand-strong dark:text-brand", className)}>
      Values: FantasyCalc<span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}
