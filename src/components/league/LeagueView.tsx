"use client";
/**
 * The League page, ready (CLAUDE.md §14 item 3): the header, the standings with playoff, bye and title
 * odds and my remaining schedule with each week's risk (§8), the team table with needs and trade chips,
 * the positional strength heatmap, best trade partners, "Streaming picks this week" (§7 streaming
 * positions), every roster (headed by what its team streams and how many free-agent pickups would help it, which
 * its body lists, §7, and on mine after them whom the odds assume I release at each IR return, with why when the
 * near-tie rule decided it: Checkpoint 7f; above them, how free agents are shared out, one team each: Phase 4b) with
 * rest-of-season points and a week-by-week breakdown (§6 step 7), the best free agents, and
 * "how these numbers work". Every word and number comes from buildLeagueView();
 * this file only arranges it, mobile-first (375 px). Every set of values carries its own
 * "Values: FantasyCalc" link (§2.9): the header, the team table, the rosters and the free agents (the
 * odds and the schedule show no trade values). When my team is certainly out in a redraft league, the
 * page says "Your season's over — no trade helps this year." (§8) right under the header.
 *
 * Phase 4c (planner reply to Checkpoint 4b, changes 5 and 12): the header's values line says when a saved FantasyCalc
 * list stands in, or that every value is our own estimate, with a banner under the header then (FantasyCalc's curve
 * fallback: words, never color alone); the line above the rosters names the waiver order used, as the Import Report's
 * row does.
 *
 * Checkpoint 7h (planner reply to Checkpoint 7g, §1: "cut each long explanation paragraph to one line"): the rosters' intro is
 * one line (ROSTERS_LINE, with the FantasyCalc credit), the rest behind "Why?" (WhyNote.tsx): tapping a player, the lock, and how
 * free agents are shared out with the waiver order used. "Best available" shows the best config.leaguePage.freeAgentsShown a
 * position, the rest behind one 44 px "Show all" (the lead's step 3: aria-expanded; "Show fewer" folds them again).
 * Then, toward "about 8 screens" (the integration's track "league"): the positional-strength heatmap and "Best available" are
 * closed by default, each heading the 44 px control that opens it (DisclosureCard.tsx), and my roster card is closed like the
 * others (its summary line shows my points a week, ROS points and pickups; the "Returns from IR" block, the locks and the
 * Expected back selects are inside it). Waiver upgrades' untouchables line still offers the locks without opening it. Then
 * (the lead's call, those steps leaving 8.6–9.5 screens): the team table ("Projected strength", TeamTable.tsx) is closed by
 * default too, which brings Parker's four dumps to 7.3–8.3 screens; the standings table stays open (the page's core).
 *
 * Refresh stays focusable while it works (aria-disabled, clicks ignored), so keyboard focus never
 * drops to the page; `headingRef` lets the page move focus to the league's name after a Try again.
 */
import Link from "next/link";
import { useState, type Ref } from "react";
import { config } from "@/engine/config";
import { FREE_AGENT_PICKUPS_LABEL, RETURNS_FROM_IR_LABEL, ROSTERS_LINE, WAIVER_ORDER_LABEL, type FreeAgentPickups, type LeagueView as LeagueViewModel } from "@/lib/leagueView";
import { NOTICES_TITLE } from "@/lib/notices";
import type { RefreshControl } from "../import/ReportView";
import { Badge, Callout, FOCUS_TARGET, Facts, buttonClass, cx } from "../ui";
import { DisclosureCard } from "./DisclosureCard";
import { PlayerTable } from "./PlayerTable";
import { RemainingSchedule } from "./RemainingSchedule";
import { StandingsOdds } from "./StandingsOdds";
import { StreamingPicks } from "./StreamingPicks";
import { StrengthHeatmap } from "./StrengthHeatmap";
import { TeamTable } from "./TeamTable";
import { TradePartners } from "./TradePartners";
import { LockHelp } from "./UntouchableLock";
import { ValuesCredit } from "./ValuesCredit";
import { WaiverUpgrades } from "./WaiverUpgrades";
import { WhyNote } from "./WhyNote";

type ViewProps = { view: LeagueViewModel };

const linkClass = "font-semibold text-brand-strong underline underline-offset-2 dark:text-brand";

export function LeagueView({ view, refresh, headingRef }: ViewProps & { refresh?: RefreshControl | undefined; headingRef?: Ref<HTMLHeadingElement> | undefined }) {
  return (
    <div className="space-y-6">
      <LeagueHeader view={view} refresh={refresh} headingRef={headingRef} />
      {view.valuesBanner ? (
        <Callout tone="warn" title={view.valuesBanner.title}>
          <p>{view.valuesBanner.text}</p>
        </Callout>
      ) : null}
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
      {/* The yellow banner shows notices only (src/lib/notices.ts, §5.1): the rest is in the Import Report's technical details. */}
      {view.notices.length ? (
        <Callout tone="warn" title={NOTICES_TITLE}>
          <ul className="list-disc space-y-0.5 pl-5">
            {view.notices.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </Callout>
      ) : null}
      <StandingsOdds view={view} />
      <RemainingSchedule view={view} />
      <TeamTable view={view} />
      <StrengthHeatmap heatmap={view.heatmap} />
      <TradePartners view={view} />
      <WaiverUpgrades />
      <StreamingPicks view={view} />
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
        {h.valuesNote ? <span className="block font-semibold text-navy-contrast">{h.valuesNote}</span> : null}
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
        <WhyNote
          line={
            <>
              {ROSTERS_LINE} <ValuesCredit />
            </>
          }
          topic="the rosters"
          className="mt-1"
        >
          <p>Tap a player for his week-by-week points.</p>
          {/* What the lock on my players' rows does (the final review of Checkpoint 7e, UI-F-3): only where the locks are. */}
          {view.rosters.some((r) => r.isMine) ? <LockHelp /> : null}
          {view.pickupsNote ? (
            <>
              <p className="break-words">{view.pickupsNote.text}</p>
              {view.pickupsNote.waiverOrder ? (
                <p className="break-words">
                  <span className="font-semibold">{WAIVER_ORDER_LABEL}:</span> {view.pickupsNote.waiverOrder}
                </p>
              ) : null}
            </>
          ) : null}
        </WhyNote>
      </div>
      {view.rosters.map((r) => (
        <details key={r.teamId} className="group rounded-2xl border border-line bg-surface shadow-sm">
          <summary className="flex min-h-11 items-center justify-between gap-3 px-4 py-3 sm:px-5">
            <span className="min-w-0">
              <span className="block font-extrabold break-words">
                {r.name} {r.isMine ? <Badge tone="brand">You</Badge> : null}
              </span>
              <span className="block text-xs text-muted">{r.summary}</span>
              {r.streams ? <span className="block text-xs break-words text-muted">{r.streams}</span> : null}
              {r.pickups ? <PickupsSummary pickups={r.pickups} mine={r.isMine} /> : null}
              {r.inactive ? <span className="mt-1 block text-xs break-words text-muted">{r.inactive}</span> : null}
            </span>
            <span aria-hidden className="shrink-0 text-muted transition-transform group-open:rotate-180">
              ▾
            </span>
          </summary>
          <div className="border-t border-line px-4 pb-3 sm:px-5">
            {r.pickups ? <PickupsList pickups={r.pickups} teamName={r.name} /> : null}
            {r.returns ? <ReturnsList lines={r.returns} teamName={r.name} /> : null}
            <PlayerTable players={r.players} caption={`${r.name}: players with rest-of-season points`} showLineupCost lineupCostTitle={view.lineupCostTitle} split={view.playoffsLeft} />
          </div>
        </details>
      ))}
    </section>
  );
}

/**
 * A team's free-agent pickups (§7 V*) in its roster header, so they show while it's collapsed: how many and what they
 * add together; a highlighted box for the user's team, where they're something to act on, a quiet line for the
 * others. It wraps at 375 px: only the total itself stays on one line. The gains count each week once (planner reply to
 * Checkpoint 7b, Q6: Waiver upgrades' number), so no playoff-weighting note follows them any more.
 */
function PickupsSummary({ pickups, mine }: { pickups: FreeAgentPickups; mine: boolean }) {
  return (
    <span title={pickups.text} className={mine ? "mt-2 block rounded-lg bg-brand-soft px-2.5 py-1.5 text-sm leading-snug break-words text-brand-strong dark:text-brand" : "mt-1 block text-xs break-words text-muted"}>
      <span className="font-bold">{FREE_AGENT_PICKUPS_LABEL}:</span> <span className={cx("whitespace-nowrap tabular-nums", mine ? "font-extrabold" : "font-semibold")}>{pickups.summary}</span>
    </span>
  );
}

/**
 * The pickups themselves, in the order the team would make them, at the top of the roster's body (a real list: a summary
 * can't hold one). Each gain's title says which lineups it's from (and, while lineup cost weights the playoff weeks, that
 * it counts each week once; on a later pickup, that it's counted after the ones above it: review of Q6).
 */
function PickupsList({ pickups, teamName }: { pickups: FreeAgentPickups; teamName: string }) {
  return (
    <div className="mt-3">
      <h3 className="text-sm font-extrabold">
        {FREE_AGENT_PICKUPS_LABEL}
        <span className="sr-only">{` for ${teamName}`}</span>
      </h3>
      <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-sm leading-snug">
        {pickups.items.map((item) => (
          <li key={item.move} title={item.title} className="break-words">
            {item.move}: <span className="whitespace-nowrap font-semibold tabular-nums">{item.gain}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * My IR players' returns as the odds assume them (Checkpoint 7f; planner reply to Checkpoint 7e, answer 4; RosterCard.returns),
 * after the pickups on my roster card, one line each in a trade card's words: whom I release, and why when the near-tie rule
 * decided it. Its "Lock … to keep him instead." points at the lock on this same card. The list carries `data-roster-moves`
 * ("returns"), as a trade card's roster moves do, so `npm run check:browser` reads its lines alone (review of Checkpoint 7f,
 * PIERCE-1).
 */
function ReturnsList({ lines, teamName }: { lines: readonly string[]; teamName: string }) {
  return (
    <div className="mt-3">
      <h3 className="text-sm font-extrabold">
        {RETURNS_FROM_IR_LABEL}
        <span className="sr-only">{` for ${teamName}`}</span>
      </h3>
      <ul data-roster-moves="returns" className="mt-1 list-disc space-y-0.5 pl-5 text-sm leading-snug">
        {lines.map((line) => (
          <li key={line} className="break-words">
            {line}
          </li>
        ))}
      </ul>
    </div>
  );
}

function FreeAgents({ view }: ViewProps) {
  // Closed by default; inside, the best few a position, the rest behind "Show all" (Checkpoint 7h: the file header).
  const [all, setAll] = useState(false);
  const shown = Math.max(1, config.leaguePage.freeAgentsShown);
  const total = view.freeAgents.reduce((n, g) => n + g.players.length, 0);
  const more = view.freeAgents.some((g) => g.players.length > shown);
  return (
    <DisclosureCard eyebrow="Free agents" title="Best available" dataKey="free-agents">
      {view.freeAgents.length ? (
        <>
          <p className="mb-3 text-sm text-muted">
            The best at each position by rest-of-season points. <ValuesCredit />
          </p>
          <div className="space-y-5">
            {view.freeAgents.map((g) => (
              <div key={g.pos}>
                <h3 className="text-sm font-extrabold tracking-tight">{g.pos}</h3>
                <PlayerTable players={all ? g.players : g.players.slice(0, shown)} caption={`Best free agents at ${g.pos} by rest-of-season points`} showLineupCost={false} split={view.playoffsLeft} />
              </div>
            ))}
          </div>
          {more ? (
            <button type="button" aria-expanded={all} data-free-agents-all="" onClick={() => setAll((a) => !a)} className={cx(buttonClass("secondary", "sm"), "mt-3 min-h-11")}>
              {all ? "Show fewer" : `Show all ${total}`}
              <span className="sr-only"> free agents</span>
            </button>
          ) : null}
        </>
      ) : (
        <p className="text-sm text-muted">No free agents with projections were loaded.</p>
      )}
    </DisclosureCard>
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
