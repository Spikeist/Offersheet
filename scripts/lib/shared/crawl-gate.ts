/**
 * Shared wording for the crawl gate (CLAUDE.md §0.6: no new crawls of strangers' leagues without
 * asking Parker first). crawlAllowed() in scripts/lib/probe.ts is the switch: without --allow-crawl
 * (or ALLOW_STRANGER_CRAWL=1) a probe requests no stranger's league except its one pinned test
 * league, reads other strangers' leagues from the HTTP cache only (http.ts `offline`), and never
 * discovers a new league. A check that then lacks data is reported n/a with this wording, which the
 * data-access matrix renders as "⏸ untested" (scripts/lib/matrix.ts UNTESTED).
 */

export const NEEDS_CRAWL = "untested: needs --allow-crawl (ask Parker first)";

/** One line for a probe's meta: what this run may request. */
export function crawlGateNote(allowCrawl: boolean): string {
  return allowCrawl
    ? "--allow-crawl: strangers' leagues beyond the pinned test league may be requested live (Parker agreed first)"
    : "no --allow-crawl: only the pinned test league is requested live; other strangers' leagues come from the HTTP cache, and no new league is discovered";
}
