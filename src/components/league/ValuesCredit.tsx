/**
 * The "Values: FantasyCalc" link that sits next to trade values (CLAUDE.md §2.9: FantasyCalc's terms
 * want a visible link next to the values, as well as the footer's; §19). Server- and client-safe.
 */
import { cx } from "../ui";

export const FANTASYCALC_URL = "https://fantasycalc.com";

export function ValuesCredit({ tone = "normal", className }: { tone?: "normal" | "onNavy"; className?: string }) {
  return (
    <a
      href={FANTASYCALC_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={cx("font-semibold underline underline-offset-2", tone === "onNavy" ? "text-accent" : "text-brand-strong dark:text-brand", className)}
    >
      Values: FantasyCalc<span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}
