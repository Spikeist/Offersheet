import type { Ref } from "react";
import type { SleeperChooseLeagueResponse } from "@/lib/api";
import { Card, CardTitle } from "../ui";

type Choices = SleeperChooseLeagueResponse["chooseLeague"];

const STATUS_LABEL: Record<string, string> = {
  pre_draft: "Before the draft",
  drafting: "Drafting",
  in_season: "In season",
  complete: "Season over",
};

const LEAGUE_KIND_LABEL: Record<"redraft" | "keeper" | "dynasty", string> = { redraft: "Redraft", keeper: "Keeper", dynasty: "Dynasty" };

/**
 * "Which league?" after a username lookup finds several. A league the MVP can't import (guillotine,
 * §2.3) stays in the list, disabled, with the reason beside the button at full contrast (a disabled
 * button's own text is dimmed).
 */
export function SleeperLeagueChoices({ choices, busy, onPick, headingRef }: { choices: Choices; busy: boolean; onPick: (leagueId: string) => void; headingRef?: Ref<HTMLHeadingElement> }) {
  return (
    <Card>
      <CardTitle eyebrow={`${choices.leagues.length} leagues in ${choices.season}`} headingRef={headingRef}>
        Which league?
      </CardTitle>
      <ul className="space-y-2">
        {choices.leagues.map((l) => {
          const reasonId = `sleeper-league-${l.id}-reason`;
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
              <button
                type="button"
                disabled={!l.supported || busy}
                aria-describedby={l.supported ? undefined : reasonId}
                onClick={() => onPick(l.id)}
                className="flex w-full items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-left hover:border-brand hover:bg-brand-soft disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-line disabled:hover:bg-surface"
              >
                <span className="min-w-0">
                  <span className="block font-extrabold break-words">{l.name}</span>
                  {meta ? <span className="block text-sm text-muted">{meta}</span> : null}
                </span>
                {l.supported ? <span className="shrink-0 text-sm font-bold text-brand-strong dark:text-brand">Import →</span> : null}
              </button>
              {l.supported ? null : (
                <p id={reasonId} className="mt-1 px-4 text-sm font-semibold text-warn-fg">
                  {l.leagueType === "guillotine" ? "Guillotine leagues aren't supported yet." : "This kind of league isn't supported yet."}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
