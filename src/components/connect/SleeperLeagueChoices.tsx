"use client";
import { useId, useState, type Ref } from "react";
import type { SleeperChooseLeagueResponse } from "@/lib/api";
import { Badge, Card, CardTitle, Spinner, buttonClass, cx } from "../ui";

type Choices = SleeperChooseLeagueResponse["chooseLeague"];

/** One picked league's import in a batch (SleeperConnect runs it). */
export type LeagueImportState = { kind: "waiting" } | { kind: "importing" } | { kind: "done" } | { kind: "failed"; message: string };

const STATUS_LABEL: Record<string, string> = {
  pre_draft: "Before the draft",
  drafting: "Drafting",
  in_season: "In season",
  complete: "Season over",
};

const LEAGUE_KIND_LABEL: Record<"redraft" | "keeper" | "dynasty", string> = { redraft: "Redraft", keeper: "Keeper", dynasty: "Dynasty" };

/** What a league's import in the batch says under it (pure; nothing before the batch). */
export function importStateText(state: LeagueImportState | undefined): string | null {
  if (!state) return null;
  switch (state.kind) {
    case "waiting":
      return "Waiting…";
    case "importing":
      return "Importing…";
    case "done":
      return "Imported and saved.";
    case "failed":
      return `Didn't import: ${state.message}`;
  }
}

/** The import button's words for how many leagues are picked (pure). */
export function importButtonText(count: number, busy: boolean): string {
  if (busy) return "Importing…";
  return count ? `Import ${count} league${count === 1 ? "" : "s"}` : "Import leagues";
}

/**
 * "Which leagues?" after a username lookup finds several (CLAUDE.md §14 item 1; planner reply to Checkpoint 4b, change
 * 11: pick several at once): a native checkbox per league (44 px rows), then Import, which SleeperConnect runs one
 * league after another, saying under each one how it went. A league already saved in this browser is marked "Saved"
 * (importing it again updates it). A league the MVP can't import (guillotine, §2.3) stays in the list, its checkbox
 * disabled, with the reason beside it at full contrast. The picks are kept here; the import button keeps focus while
 * the batch runs (aria-disabled, not disabled).
 */
export function SleeperLeagueChoices({
  choices,
  busy,
  saved,
  results,
  onImport,
  headingRef,
}: {
  choices: Choices;
  busy: boolean;
  /** The leagues (their Sleeper ids) already saved in this browser. */
  saved: ReadonlySet<string>;
  /** Each picked league's import in the batch under way or just done, by Sleeper id. */
  results: Readonly<Record<string, LeagueImportState>>;
  onImport: (leagueIds: string[]) => void;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  const hintId = useId();
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());
  const pickable = choices.leagues.filter((l) => l.supported);
  // In the list's order, so the first one imported (the one shown next) is the first one listed.
  const pickedIds = pickable.filter((l) => picked.has(l.id)).map((l) => l.id);
  const toggle = (id: string, on: boolean) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  return (
    <Card>
      <CardTitle eyebrow={`${choices.leagues.length} leagues in ${choices.season}`} headingRef={headingRef}>
        Which leagues?
      </CardTitle>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy && pickedIds.length) onImport(pickedIds);
        }}
      >
        <fieldset aria-describedby={hintId}>
          <legend className="sr-only">Leagues to import</legend>
          <p id={hintId} className="text-sm text-muted">
            Pick one or more. They&apos;re imported one after another and saved in this browser, and the first one shows when they&apos;re done. Switch between them at
            the top of any page.
          </p>
          <ul className="mt-3 space-y-2">
            {choices.leagues.map((l) => {
              const reasonId = `sleeper-league-${l.id}-reason`;
              const resultText = importStateText(results[l.id]);
              const meta = [
                l.leagueType && l.leagueType !== "guillotine" ? LEAGUE_KIND_LABEL[l.leagueType] : null,
                l.bestBall ? "best ball" : null,
                l.teams ? `${l.teams} teams` : null,
                l.status ? (STATUS_LABEL[l.status] ?? l.status) : null,
              ]
                .filter(Boolean)
                .join(" · ");
              return (
                <li key={l.id}>
                  <label
                    className={cx(
                      "flex min-h-11 items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3",
                      l.supported ? "cursor-pointer hover:border-brand hover:bg-brand-soft" : "cursor-not-allowed opacity-60",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={picked.has(l.id)}
                      disabled={!l.supported}
                      aria-describedby={l.supported ? undefined : reasonId}
                      onChange={(e) => {
                        if (!busy) toggle(l.id, e.target.checked);
                      }}
                      className="size-5 shrink-0 accent-brand"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block font-extrabold break-words">{l.name}</span>
                      {meta ? <span className="block text-sm text-muted">{meta}</span> : null}
                    </span>
                    {saved.has(l.id) ? <Badge tone="brand">Saved</Badge> : null}
                  </label>
                  {l.supported ? null : (
                    <p id={reasonId} className="mt-1 px-4 text-sm font-semibold text-warn-fg">
                      {l.leagueType === "guillotine" ? "Guillotine leagues aren't supported yet." : "This kind of league isn't supported yet."}
                    </p>
                  )}
                  {resultText ? (
                    <p className={cx("mt-1 px-4 text-sm font-semibold", results[l.id]?.kind === "failed" ? "text-danger-fg" : results[l.id]?.kind === "done" ? "text-ok-fg" : "text-muted")}>
                      {resultText}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </fieldset>
        <button
          type="submit"
          aria-disabled={busy || !pickedIds.length || undefined}
          className={cx(buttonClass("primary"), "mt-4 aria-disabled:cursor-not-allowed aria-disabled:opacity-60")}
        >
          {busy ? <Spinner /> : null}
          {importButtonText(pickedIds.length, busy)}
        </button>
      </form>
    </Card>
  );
}
