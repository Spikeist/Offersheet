"use client";
/**
 * What the pages show when the league store holds no league this tab can read (CLAUDE.md §14; Phase 4c: leagues are
 * saved in this browser, src/lib/leagueStore.ts): "No league imported yet", or, when the league was saved by an
 * earlier version of Offer Sheet (leagueStore.ts CurrentLeagueRead "outdated": an older IMPORT_FORMAT_VERSION), that
 * Offer Sheet was updated and the league needs importing again, rather than suggesting the import was lost (Phase 4c's
 * import format 4 makes every Phase 4b import one: src/lib/importStore.ts). It names the league when it's a saved one,
 * and offers "Import again" (connect/finishImport.ts importAgain) when it knows the league's id; the Settings page's
 * league card offers the same (ImportAgain). Either way, a link to the Connect page.
 *
 * Accessibility: Import again keeps focus while it works (aria-disabled, not disabled: a disabled button drops focus);
 * its outcome is announced by a status line that stays mounted, a failure as an alert. Once the league is imported the
 * page shows it in place of this card.
 */
import Link from "next/link";
import { useState } from "react";
import { OUTDATED_IMPORT_TEXT, OUTDATED_IMPORT_TITLE, type ImportRequestSummary } from "@/lib/importStore";
import { PLATFORM_LABEL } from "@/lib/labels";
import type { CurrentLeagueRead, SavedLeague } from "@/lib/leagueStore";
import { importAgain, importAgainRequest } from "./connect/finishImport";
import { savedLeagueLabel } from "./LeagueSwitcher";
import { Card, Spinner, buttonClass, cx } from "./ui";

export const NO_IMPORT_TITLE = "No league imported yet";

/** The text for a league saved by an earlier version: names it when it's a saved one. */
export function outdatedText(league: Pick<SavedLeague, "name" | "platform" | "season"> | null): string {
  return league ? `Import ${savedLeagueLabel(league)} again to see the new numbers.` : OUTDATED_IMPORT_TEXT;
}

/** The request "Import again" can send for a league saved by an earlier version; null when there's none (the Connect page can). */
export function importAgainFor(read: Exclude<CurrentLeagueRead, { kind: "ok" }>): ImportRequestSummary | null {
  return read.kind === "outdated" && read.request && importAgainRequest(read.request) ? read.request : null;
}

/** `read`: what the store holds for this tab (no league, or one saved by an earlier version); `text`: the page's own words for no league at all. */
export function NoImportCard({ read, text }: { read: Exclude<CurrentLeagueRead, { kind: "ok" }>; text: string }) {
  const outdated = read.kind === "outdated";
  const request = importAgainFor(read);
  return (
    <Card className="mx-auto max-w-xl text-center">
      <h1 className="text-2xl font-black tracking-tight">{outdated ? OUTDATED_IMPORT_TITLE : NO_IMPORT_TITLE}</h1>
      <p className="mt-2 text-muted">{outdated ? outdatedText(read.league) : text}</p>
      {request ? (
        <ImportAgain request={request} />
      ) : (
        <Link href="/connect" className={`${buttonClass("primary")} mt-5`}>
          Connect your league
        </Link>
      )}
    </Card>
  );
}

/**
 * "Import again" for a league saved by an earlier version, and the Connect page for anything else (also on the Settings
 * page's league card, aligned with its text: `align` "start").
 */
export function ImportAgain({ request, align = "center" }: { request: ImportRequestSummary; align?: "center" | "start" }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const out = await importAgain(request);
    // Imported: the store shows the league, so this card goes away.
    setBusy(false);
    if (!out.ok) setError(out.message);
  }

  return (
    <div className={align === "center" ? "mt-5" : "mt-4"}>
      <div className={cx("flex flex-wrap gap-2", align === "center" && "justify-center")}>
        <button
          type="button"
          onClick={() => void run()}
          aria-disabled={busy || undefined}
          className={cx(buttonClass("primary"), "aria-disabled:cursor-not-allowed aria-disabled:opacity-60")}
        >
          {busy ? <Spinner /> : null}
          {busy ? "Importing…" : "Import again"}
        </button>
        <Link href="/connect" className={buttonClass("secondary")}>
          Connect your league
        </Link>
      </div>
      {/* Always mounted, so the import's progress is announced. */}
      <p role="status" className={busy ? "mt-3 text-sm text-muted" : "sr-only"}>
        {busy ? `Importing from ${PLATFORM_LABEL[request.platform]}…` : ""}
      </p>
      {error ? (
        <p role="alert" className="mt-3 text-sm font-semibold text-danger-fg">
          {error}
        </p>
      ) : null}
    </div>
  );
}
