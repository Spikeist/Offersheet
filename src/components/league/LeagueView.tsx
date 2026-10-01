"use client";
/**
 * The League page, ready (CLAUDE.md §14 item 3): the header, the standings with playoff, bye and title
 * odds and my remaining schedule with each week's risk (§8), the team table with needs and trade chips,
 * the positional strength heatmap, best trade partners, every roster (headed by the team's best
 * free-agent move, §7) with rest-of-season points and a week-by-week breakdown (§6 step 7), the best
 * free agents, and "how these numbers work". Every word and number comes from buildLeagueView();
 * this file only arranges it, mobile-first (375 px). Every set of values carries its own
 * "Values: FantasyCalc" link (§2.9): the header, the team table, the rosters and the free agents (the
 * odds and the schedule show no trade values). When my team is certainly out in a redraft league, the
 * page says "Your season's over — no trade helps this year." (§8) right under the header.
 *
 * Refresh stays focusable while it works (aria-disabled, clicks ignored), so keyboard focus never
 * drops to the page; `headingRef` lets the page move focus to the league's name after a Try again.
 */
import Link from "next/link";
import type { Ref } from "react";
import { FREE_AGENT_MOVE_LABEL, type FreeAgentMove, type LeagueView as LeagueViewModel } from "@/lib/leagueView";
import type { RefreshControl } from "../import/ReportView";
import { Badge, Callout, Card, CardTitle, FOCUS_TARGET, Facts, cx } from "../ui";
import { PlayerTable } from "./PlayerTable";
import { RemainingSchedule } from "./RemainingSchedule";
import { StandingsOdds } from "./StandingsOdds";
import { StrengthHeatmap } from "./StrengthHeatmap";
import { TeamTable } from "./TeamTable";
import { TradePartners } from "./TradePartners";
import { ValuesCredit } from "./ValuesCredit";

type ViewProps = { view: LeagueViewModel };

const linkClass = "font-semibold text-brand-strong underline underline-offset-2 dark:text-brand";

export function LeagueView({ view, refresh, headingRef }: ViewProps & { refresh?: RefreshControl | undefined; headingRef?: Ref<HTMLHeadingElement> | undefined }) {
  return (
    <div className="space-y-6">
      <LeagueHeader view={view} refresh={refresh} headingRef={headingRef} />
      {view.myTeam.hint ? (
        <Callout tone="warn" title={view.myTeam.id ? "Is this your team?" : "Which team is yours?"}>
          <p>{view.myTeam.hint}</p>
          <Link href="/import#your-team" className="mt-1 inline-flex min-h-11 items-center font-bold underline underline-offset-2">
            {view.myTeam.id ? "Check your team" : "Pick your team"}
          </Link>
        </Callout>
      ) : null}
      {view.eliminated ? <Callout>{view.eliminated}</Callout> : null}
      {view.over ? <Callout title="The season is over">There are no weeks left to project for this league.</Callout> : null}
      {view.warnings.length ? (
        <Callout tone="warn" title="Some data is missing">
          <ul className="list-disc space-y-0.5 pl-5">
            {view.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Callout>
      ) : null}
      <StandingsOdds view={view} />
      <RemainingSchedule view={view} />
      <TeamTable view={view} />
      <StrengthHeatmap heatmap={view.heatmap} />
      <TradePartners view={view} />
      <Rosters view={view} />
      <FreeAgents view={view} />
      <HowItWorks view={view} />
    </div>
  );
}

function LeagueHeader({ view, refresh, headingRef }: ViewProps & { refresh?: RefreshControl | undefined; headingRef?: Ref<HTMLHeadingElement> | undefined }) {
  const h = view.header;
  const busy = refresh?.refreshing ?? false;
  return (
    <header className="rounded-3xl bg-navy px-5 py-6 text-navy-contrast shadow-lg sm:px-8">
      <p className="text-xs font-bold tracking-widest text-accent uppercase">Your league</p>
      <h1
        ref={headingRef}
        tabIndex={headingRef ? FOCUS_TARGET.tabIndex : undefined}
        className={cx("mt-2 text-2xl leading-tight font-black tracking-tight break-words sm:text-4xl", FOCUS_TARGET.className)}
      >
        {h.name}
      </h1>
      <div className="mt-3 flex flex-wrap gap-2">
        <Badge tone="brand">{h.platformLabel}</Badge>
        <Badge tone="onNavy">{h.season} season</Badge>
      </div>
      <p className="mt-3 text-sm font-semibold">{h.weekLine}</p>
      {h.inProgress ? <p className="mt-1 text-sm text-navy-contrast/80">{h.inProgress}</p> : null}
      {view.myTeam.name ? (
        <p className="mt-1 text-sm break-words">
          Your team: <span className="font-bold text-accent">{view.myTeam.name}</span>
        </p>
      ) : null}
      <p className="mt-1 text-sm leading-relaxed text-navy-contrast/80">
        Projected points: {h.projections} · <ValuesCredit tone="onNavy" />
        {h.valuesFormat ? ` (${h.valuesFormat})` : " (unavailable right now)"}
      </p>
      <p className="mt-1 text-sm text-navy-contrast/80">{h.weeksLeft}</p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {refresh ? (
          // aria-disabled, not disabled: a disabled button drops keyboard focus to the page while it works.
          <button
            type="button"
            onClick={() => {
              if (!busy) refresh.onRefresh();
            }}
            aria-disabled={busy || undefined}
            className="inline-flex min-h-11 items-center rounded-xl border border-white/25 px-4 text-sm font-bold hover:bg-white/10 aria-disabled:cursor-not-allowed aria-disabled:opacity-60 aria-disabled:hover:bg-transparent"
          >
            {busy ? "Refreshing…" : "Refresh"}
          </button>
        ) : null}
        <Link href="/import" className="inline-flex min-h-11 items-center rounded-xl border border-white/25 px-4 text-sm font-bold hover:bg-white/10">
          Import Report
        </Link>
      </div>
      {refresh ? (
        // Always mounted, so the outcome of each Refresh is announced.
        <p role="status" className={refresh.status ? "mt-3 text-sm font-semibold" : undefined}>
          {refresh.status ?? null}
        </p>
      ) : null}
      {refresh?.error ? (
        <p role="alert" className="mt-3 rounded-lg bg-danger-bg px-3 py-2 text-sm font-semibold text-danger-fg">
          {refresh.error}
        </p>
      ) : null}
    </header>
  );
}

function Rosters({ view }: ViewProps) {
  return (
    <section aria-labelledby="rosters-title" className="space-y-3">
      <div>
        <h2 id="rosters-title" className="text-lg leading-tight font-extrabold tracking-tight sm:text-xl">
          Rosters
        </h2>
        <p className="mt-1 text-sm text-muted">
          Rest-of-season (ROS) points count only the games left. Tap a player for his week-by-week points. <ValuesCredit />
        </p>
      </div>
      {view.rosters.map((r) => (
        <details key={r.teamId} open={r.isMine} className="group rounded-2xl border border-line bg-surface shadow-sm">
          <summary className="flex min-h-11 items-center justify-between gap-3 px-4 py-3 sm:px-5">
            <span className="min-w-0">
              <span className="block font-extrabold break-words">
                {r.name} {r.isMine ? <Badge tone="brand">You</Badge> : null}
              </span>
              <span className="block text-xs text-muted">{r.summary}</span>
              {r.waiver ? <FreeAgentMoveLine move={r.waiver} mine={r.isMine} /> : null}
            </span>
            <span aria-hidden className="shrink-0 text-muted transition-transform group-open:rotate-180">
              ▾
            </span>
          </summary>
          <div className="border-t border-line px-4 pb-3 sm:px-5">
            <PlayerTable players={r.players} caption={`${r.name}: players with rest-of-season points`} showLineupCost lineupCostTitle={view.lineupCostTitle} split={view.playoffsLeft} />
          </div>
        </details>
      ))}
    </section>
  );
}

/**
 * A team's best free-agent move (§7), in its roster header: a highlighted box for the user's team,
 * where it's something to act on; a quiet line for the others. It wraps at 375 px: only the gain
 * itself stays on one line, and the playoff-weighting note wraps after it.
 */
function FreeAgentMoveLine({ move, mine }: { move: FreeAgentMove; mine: boolean }) {
  return (
    <span className={mine ? "mt-2 block rounded-lg bg-brand-soft px-2.5 py-1.5 text-sm leading-snug break-words text-brand-strong dark:text-brand" : "mt-1 block text-xs break-words text-muted"}>
      <span className="font-bold">{FREE_AGENT_MOVE_LABEL}:</span> {move.move}: <span className={cx("whitespace-nowrap tabular-nums", mine ? "font-extrabold" : "font-semibold")}>{move.gain}</span>
      {move.weighting ? ` ${move.weighting}` : null}
    </span>
  );
}

function FreeAgents({ view }: ViewProps) {
  return (
    <Card>
      <CardTitle eyebrow="Free agents">Best available</CardTitle>
      {view.freeAgents.length ? (
        <>
          <p className="-mt-1 mb-3 text-sm text-muted">
            The best at each position by rest-of-season points. <ValuesCredit />
          </p>
          <div className="space-y-5">
            {view.freeAgents.map((g) => (
              <div key={g.pos}>
                <h3 className="text-sm font-extrabold tracking-tight">{g.pos}</h3>
                <PlayerTable players={g.players} caption={`Best free agents at ${g.pos} by rest-of-season points`} showLineupCost={false} split={view.playoffsLeft} />
              </div>
            ))}
          </div>
        </>
      ) : (
        <p className="text-sm text-muted">No free agents with projections were loaded.</p>
      )}
    </Card>
  );
}

function HowItWorks({ view }: ViewProps) {
  return (
    <details className="group rounded-2xl border border-line bg-surface shadow-sm">
      <summary className="flex min-h-11 items-center justify-between gap-3 px-4 py-3 font-bold sm:px-5">
        How these numbers work
        <span aria-hidden className="text-muted transition-transform group-open:rotate-180">
          ▾
        </span>
      </summary>
      <div className="space-y-4 border-t border-line px-4 pt-3 pb-4 sm:px-5">
        <dl className="space-y-3">
          {view.explain.map((e) => (
            <div key={e.title}>
              <dt className="text-sm font-extrabold">{e.title}</dt>
              <dd className="mt-0.5 text-sm leading-relaxed text-muted">{e.text}</dd>
            </div>
          ))}
        </dl>
        <div>
          <h3 className="text-sm font-extrabold">Where the numbers came from</h3>
          <Facts items={view.sources.map((s) => ({ label: s.label, value: s.value }))} />
        </div>
        {view.notes.length ? (
          <ul className="space-y-2">
            {view.notes.map((n) => (
              <li key={n} className={cx("rounded-xl bg-surface-muted px-3 py-2 text-sm")}>
                {n}
              </li>
            ))}
          </ul>
        ) : null}
        <p className="text-sm">
          Something look off?{" "}
          <Link href="/import" className={linkClass}>
            Check what we understood about your league
          </Link>
          .
        </p>
      </div>
    </details>
  );
}
