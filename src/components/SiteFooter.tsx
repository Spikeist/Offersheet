import Link from "next/link";

/** Footer on every page (CLAUDE.md §14: FantasyCalc credit and the no-affiliation line). */
export function SiteFooter() {
  return (
    <footer className="mt-12 border-t border-line bg-surface">
      <div className="mx-auto max-w-5xl space-y-2 px-4 py-6 text-sm text-muted">
        <p>
          Trade values:{" "}
          <a href="https://fantasycalc.com" target="_blank" rel="noopener noreferrer" className="font-semibold text-brand-strong underline underline-offset-2 dark:text-brand">
            FantasyCalc
          </a>
        </p>
        <p>Not affiliated with ESPN, Yahoo, Sleeper, Fleaflicker, MFL or Fantrax.</p>
        <p>
          Offer Sheet is free and read-only: it never sends offers or changes anything in your league.{" "}
          <Link href="/privacy" className="font-semibold underline underline-offset-2">
            Privacy
          </Link>
        </p>
      </div>
    </footer>
  );
}
