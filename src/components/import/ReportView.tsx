"use client";
/**
 * "Here's what we understood" (CLAUDE.md §14 item 2): lays out the view model. Every word and
 * number comes from buildImportReport(); this file only arranges it for phones (375 px) and up.
 * The FantasyCalc format sits in "Where this came from" with the "Values: FantasyCalc" link (§2.9).
 * Every button and button-like link is a 44 px target (the small ones too: review of Phase 4 measured
 * "Refresh league data" and "Import another league" at 36 px on a phone).
 */
import Link from "next/link";
import { useEffect, useRef } from "react";
import type { UnknownSetting } from "@/engine/model";
import { fmtSigned, plural } from "@/lib/format";
import type { ImportReportView } from "@/lib/importReport";
import { ValuesCredit } from "../league/ValuesCredit";
import { Badge, Callout, Card, CardTitle, FOCUS_TARGET, Facts, buttonClass, cx, inputClass } from "../ui";

type ViewProps = { view: ImportReportView };

/** The Refresh button's state (ImportReport.tsx owns the request). */
export interface RefreshControl {
  onRefresh: () => void;
  refreshing: boolean;
  error: string | null;
  /** What the last Refresh achieved ("Refreshed: …" / "Already up to date …"), for the status line. */
  status?: string | null;
}

/** "Forget my ESPN cookies" (ImportReport.tsx owns the request). */
export interface ForgetControl {
  onForget: () => void;
  forgetting: boolean;
  /** The cookies are gone: the button goes away and focus moves to the note. */
  done: boolean;
  note: string | null;
}

/** Warn tone for a fact whose setting the platform doesn't expose. */
const toneFor = (view: ImportReportView, setting: UnknownSetting) => (view.unknown.includes(setting) ? ("warn" as const) : ("normal" as const));

export function ReportView({
  view,
  onPickTeam,
  pickError,
  refresh,
  forget,
}: ViewProps & {
  onPickTeam: (teamId: string) => void;
  /** Why the last team pick wasn't kept (the browser refused it), or null. */
  pickError?: string | null | undefined;
  refresh?: RefreshControl | undefined;
  forget?: ForgetControl | undefined;
}) {
  return (
    <div className="space-y-6">
      <ReportHeader view={view} />
      <Glance view={view} />
      <YourTeam view={view} onPickTeam={onPickTeam} pickError={pickError} />
      <ScoringCard view={view} />
      <div className="grid gap-6 lg:grid-cols-2">
        <LineupCard view={view} />
        <SeasonCard view={view} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <TradesCard view={view} />
        <PlayersCard view={view} />
      </div>
      <TeamsCard view={view} />
      <WarningsCard view={view} />
      <DataCard view={view} refresh={refresh} forget={forget} />
      <Callout tone="info" title="Something doesn't match your league?">
        Then trade ideas would be off too. Check your league&apos;s settings page on {view.league.platformLabel}, then import again. A way to report problems from this page is
        coming.
      </Callout>
    </div>
  );
}

function ReportHeader({ view }: ViewProps) {
  const l = view.league;
  return (
    <header className="rounded-3xl bg-navy px-5 py-6 text-navy-contrast shadow-lg sm:px-8">
      <p className="text-xs font-bold tracking-widest text-accent uppercase">Here&apos;s what we understood</p>
      <h1 className="mt-2 text-2xl leading-tight font-black tracking-tight break-words sm:text-4xl">{l.name}</h1>
      <div className="mt-3 flex flex-wrap gap-2">
        <Badge tone="brand">{l.platformLabel}</Badge>
        <Badge tone="onNavy">{l.season} season</Badge>
        <Badge tone="onNavy">Week {l.currentWeek}</Badge>
        <Badge tone="onNavy">{l.leagueTypeLabel}</Badge>
        {l.bestBall ? <Badge tone="accent">Best ball</Badge> : null}
      </div>
      <p className="mt-4 max-w-2xl text-sm leading-relaxed text-navy-contrast/80">
        Check that this matches your league. Everything Offer Sheet suggests is built on these settings, trade ideas on the{" "}
        <Link href="/trades" className="font-semibold text-accent underline underline-offset-2">
          Trade Finder
        </Link>{" "}
        included.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link href="/league" className="inline-flex min-h-11 items-center rounded-xl bg-accent px-4 text-sm font-bold text-navy hover:brightness-95">
          See your league&apos;s needs and projections{"\u00a0"}→
        </Link>
        <Link href="/connect" className="inline-flex min-h-11 items-center rounded-xl border border-white/25 px-4 text-sm font-bold hover:bg-white/10">
          Import another league
        </Link>
      </div>
    </header>
  );
}

function Glance({ view }: ViewProps) {
  return (
    <section aria-labelledby="glance-title">
      <h2 id="glance-title" className="sr-only">
        At a glance
      </h2>
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {view.glance.map((t) => {
          const inner = (
            <>
              <p className={cx("text-xs font-bold tracking-wide uppercase", t.tone === "warn" ? "text-warn-fg" : "text-muted")}>{t.label}</p>
              <p className="mt-1 text-base leading-snug font-extrabold break-words">{t.value}</p>
              {t.detail ? <p className={cx("mt-1 text-xs leading-snug", t.tone === "warn" ? "text-warn-fg" : "text-muted")}>{t.detail}</p> : null}
            </>
          );
          const cls = cx("block h-full rounded-2xl border p-3 shadow-sm", t.tone === "warn" ? "border-warn-line bg-warn-bg" : "border-line bg-surface");
          const target = t.id === "warnings" ? "#warnings" : t.id === "myTeam" ? "#your-team" : undefined;
          return (
            <li key={t.id}>
              {target ? (
                <a href={target} className={cx(cls, "hover:border-brand")}>
                  {inner}
                </a>
              ) : (
                <div className={cls}>{inner}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function YourTeam({ view, onPickTeam, pickError }: ViewProps & { onPickTeam: (teamId: string) => void; pickError?: string | null | undefined }) {
  const t = view.teams;
  return (
    <Card id="your-team" tone={t.myTeamSource === "none" || t.myTeamSource === "link" ? "warn" : "normal"}>
      <CardTitle eyebrow="Your team">Which team is yours?</CardTitle>
      <p id="my-team-explain" className="text-sm text-muted">
        {t.explain}
      </p>
      <label htmlFor="my-team" className="sr-only">
        Your team
      </label>
      <select
        id="my-team"
        aria-describedby="my-team-explain"
        className={cx(inputClass, "mt-3 font-semibold sm:max-w-md")}
        value={t.myTeamId ?? ""}
        onChange={(e) => onPickTeam(e.target.value)}
      >
        {t.myTeamId ? null : <option value="">Pick your team…</option>}
        {t.options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
            {o.note ? ` (${o.note})` : ""}
          </option>
        ))}
      </select>
      {t.myTeamSource === "link" && t.myTeamId ? (
        // Picking the team already shown fires no change, so confirming a link's team needs its own button.
        <button type="button" onClick={() => onPickTeam(t.myTeamId ?? "")} className={cx(buttonClass("secondary", "sm"), "mt-2 min-h-11")}>
          Yes, that&apos;s my team
        </button>
      ) : null}
      {pickError ? (
        <p role="alert" className="mt-2 text-sm font-semibold text-danger-fg">
          {pickError}
        </p>
      ) : null}
      {view.schedule.thisWeek ? <p className="mt-3 text-sm font-semibold">{view.schedule.thisWeek}</p> : null}
    </Card>
  );
}

function ScoringCard({ view }: ViewProps) {
  const s = view.scoring;
  return (
    <Card>
      <CardTitle eyebrow="Scoring">How players score</CardTitle>
      <div className="flex flex-wrap gap-2">
        <Badge tone="brand">{s.formatLabel}</Badge>
        <Badge tone={s.tePremium ? "brand" : "muted"}>{s.tePremium ? `TE premium +${s.tePremium}` : "No TE premium"}</Badge>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 text-center" aria-label="Points per catch">
        {s.receptions.map((r) => (
          <div key={r.pos} className="rounded-xl bg-surface-muted px-2 py-2">
            <p className="text-xs font-bold text-muted">{r.pos} catch</p>
            <p className="text-lg font-extrabold tabular-nums">{r.text}</p>
          </div>
        ))}
      </div>

      <div className="mt-4">
        <Facts items={s.highlights.map((h) => ({ label: h.label, value: h.value }))} />
      </div>

      {s.defenseSummary || s.defenseBuckets.length ? (
        <div className="mt-5">
          <h3 className="text-sm font-extrabold tracking-tight">Team defense</h3>
          {s.defenseSummary ? <p className="mt-1 text-sm text-muted">{s.defenseSummary}</p> : null}
          {s.defenseBuckets.map((g) => (
            <div key={g.title} className="mt-3">
              <p className="text-xs font-bold text-muted uppercase">{g.title}</p>
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                {g.lines.map((b) => (
                  <li key={b.range} className="rounded-lg border border-line bg-surface-muted px-2 py-1 text-sm tabular-nums">
                    <span className="font-semibold">{b.range}</span>
                    <span className={cx("ml-1.5 font-extrabold", b.points < 0 ? "text-danger-fg" : "text-brand-strong dark:text-brand")}>{fmtSigned(b.points)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}

      <div className="mt-5">
        <h3 className="text-sm font-extrabold tracking-tight">Bonuses and special rules</h3>
        {s.bonuses.length ? (
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm">
            {s.bonuses.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-sm text-muted">None</p>
        )}
      </div>

      {s.unmapped.length ? (
        <div className="mt-5">
          <Callout tone="warn" title={`Rules we couldn't map (${s.unmapped.length})`}>
            <p>These count in your league, but we can&apos;t score them yet, so projections leave them out.</p>
            <ul className="mt-1.5 list-disc space-y-0.5 pl-5">
              {s.unmapped.map((u) => (
                <li key={u.platformKey}>{u.text}</li>
              ))}
            </ul>
          </Callout>
        </div>
      ) : null}

      <details className="group mt-5 rounded-xl border border-line">
        <summary className="flex items-center justify-between px-4 py-3 text-sm font-bold">
          All scoring rules ({s.allRules.length})
          <span aria-hidden className="transition-transform group-open:rotate-180">
            ▾
          </span>
        </summary>
        <div className="border-t border-line px-4 pb-3">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="py-2 font-bold">Stat</th>
                <th className="py-2 text-right font-bold">Points each</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {s.allRules.map((r) => (
                <tr key={r.key}>
                  <td className="py-1.5 pr-3">{r.label}</td>
                  <td className="py-1.5 text-right font-semibold tabular-nums">{r.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </Card>
  );
}

function LineupCard({ view }: ViewProps) {
  const l = view.lineup;
  return (
    <Card>
      <CardTitle eyebrow="Lineup">Starters and roster</CardTitle>
      <ul className="flex flex-wrap gap-1.5" aria-label="Starting slots">
        {l.starters.map((s, i) => (
          <li key={`${s.slot}-${i}`} className="rounded-lg bg-navy px-2.5 py-1 text-sm font-bold text-navy-contrast">
            {s.count > 1 ? `${s.count} × ` : ""}
            {s.slot}
            {s.eligible !== s.slot ? <span className="ml-1 font-medium text-navy-contrast/70">({s.eligible})</span> : null}
          </li>
        ))}
      </ul>
      <div className="mt-4">
        <Facts
          items={[
            { label: "Bench", value: l.bench },
            { label: "IR", value: l.ir },
            { label: "Taxi squad", value: l.taxi || "None" },
            { label: "Active roster spots", value: l.maxRosterSize },
            ...l.limits.map((x) => ({ label: x.label, value: x.value })),
          ]}
        />
      </div>
      {l.bestBall ? (
        <div className="mt-4">
          <Callout tone="info" title="Best ball">
            Lineups are set automatically each week: your best scorers start. Offer Sheet&apos;s projections use the best lineup too.
          </Callout>
        </div>
      ) : null}
    </Card>
  );
}

function SeasonCard({ view }: ViewProps) {
  const s = view.season;
  const playoffsTone = toneFor(view, "playoffs");
  return (
    <Card>
      <CardTitle eyebrow="Season">Schedule and playoffs</CardTitle>
      <Facts
        items={[
          { label: "Current week", value: `Week ${s.currentWeek}` },
          { label: "Regular season", value: s.regularSeason },
          { label: "Playoffs", value: s.playoffs, tone: playoffsTone },
          { label: "Playoff teams", value: s.playoffTeamsText, tone: playoffsTone },
          { label: "Byes", value: s.byes, tone: playoffsTone },
          ...(s.rounds ? [{ label: "Round lengths", value: s.rounds }] : []),
          { label: "Seeding", value: s.seeding, tone: toneFor(view, "playoffSeeding") },
          { label: "Ties in the standings", value: s.tiebreaker, tone: toneFor(view, "seedingTiebreaker") },
          { label: "Game vs the league median", value: s.medianGame ? "Yes, an extra win or loss each week" : "No" },
          { label: "Points-only league", value: s.pointsOnly ? "Yes (no head-to-head)" : "No, head-to-head" },
          ...(s.divisions.length
            ? [
                {
                  label: "Divisions",
                  value: (
                    <ul className="space-y-1">
                      {s.divisions.map((d) => (
                        <li key={d.name}>
                          <span className="font-bold">{d.name}:</span> {d.teams.join(", ")}
                        </li>
                      ))}
                    </ul>
                  ),
                },
              ]
            : []),
          { label: "Matchups loaded", value: `${view.schedule.matchups} (${view.schedule.weeks})` },
          { label: "Final scores", value: view.schedule.results },
        ]}
      />
      {view.schedule.missingRegularWeeks.length ? (
        <div className="mt-3">
          <Callout tone="warn">No matchups found for week {view.schedule.missingRegularWeeks.join(", ")}.</Callout>
        </div>
      ) : null}
    </Card>
  );
}

function TradesCard({ view }: ViewProps) {
  const t = view.trades;
  const a = view.activity;
  return (
    <Card>
      <CardTitle eyebrow="Trades">Trade rules</CardTitle>
      <Facts
        items={[
          { label: "Trade deadline", value: t.deadline, tone: toneFor(view, "tradeDeadline") },
          { label: "Review", value: t.review, tone: toneFor(view, "tradeReview") },
          { label: "FAAB", value: t.faab },
          // Phase 4c (planner reply to Checkpoint 4b, change 5): the order free agents go out in, one team each (§7).
          { label: "Waiver order used", value: t.waiverOrder },
          // Phase 7a (planner reply to Checkpoint 4c, A4): teams assumed to make no free-agent pickups.
          {
            label: "Inactive teams",
            value: t.inactive.lines.length ? (
              <>
                <ul className="space-y-1">
                  {t.inactive.lines.map((line, i) => (
                    <li key={`${i}:${line}`}>{line}</li>
                  ))}
                </ul>
                <p className="mt-1 text-xs font-normal text-muted">{t.inactive.note}</p>
              </>
            ) : (
              t.inactive.note
            ),
          },
          { label: "This season so far", value: `${plural(a.trades, "trade")} · ${plural(a.adds, "player")} added (${plural(a.waivers, "waiver claim")}) · ${a.drops} dropped` },
          ...(a.tradedPicks !== undefined ? [{ label: "Traded draft picks", value: a.tradedPicks }] : []),
        ]}
      />
    </Card>
  );
}

function PlayersCard({ view }: ViewProps) {
  const p = view.players;
  return (
    <Card>
      <CardTitle eyebrow="Players">Rosters</CardTitle>
      <Facts
        items={[
          { label: "Players on rosters", value: p.rostered },
          { label: "On IR / taxi", value: `${p.onIr} / ${p.onTaxi}` },
          { label: "Free agents loaded", value: p.freeAgents },
          { label: "Matched to the player database", value: `${p.rostered - p.unmatched.length - p.missingDetails} of ${p.rostered}` },
        ]}
      />
      {p.unmatched.length ? (
        <div className="mt-3">
          <Callout tone="warn" title={`Not matched to the player database (${p.unmatched.length})`}>
            <p>We&apos;ll still use them, but without projections or trade values from other sources.</p>
            <ul className="mt-1.5 list-disc space-y-0.5 pl-5">
              {p.unmatched.map((u) => (
                <li key={`${u.name}-${u.pos}-${u.team}`}>
                  {u.name} ({u.pos}, {u.team})
                </li>
              ))}
            </ul>
          </Callout>
        </div>
      ) : null}
      {p.missingDetails ? (
        <div className="mt-3">
          <Callout tone="warn">
            {p.missingDetails} rostered player{p.missingDetails === 1 ? "" : "s"} came without any player details.
          </Callout>
        </div>
      ) : null}
    </Card>
  );
}

function TeamsCard({ view }: ViewProps) {
  return (
    <Card>
      <CardTitle eyebrow="Teams">Teams and owners</CardTitle>
      <div className="-mx-4 overflow-x-auto sm:mx-0">
        <table className="w-full min-w-[20rem] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted">
              <th className="px-4 py-2 font-bold sm:pl-0">#</th>
              <th className="py-2 pr-3 font-bold">Team</th>
              <th className="py-2 pr-3 text-right font-bold">Record</th>
              <th className="py-2 pr-4 text-right font-bold sm:pr-3">PF</th>
              <th className="hidden py-2 pr-3 text-right font-bold sm:table-cell">PA</th>
              <th className="hidden py-2 text-right font-bold sm:table-cell">Roster</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {view.teams.rows.map((r) => (
              <tr key={r.id} className={r.isMine ? "bg-brand-soft" : undefined}>
                <td className="px-4 py-2 font-bold text-muted tabular-nums sm:pl-0">{r.rank}</td>
                <td className="py-2 pr-3">
                  <p className="font-bold break-words">
                    {r.name} {r.isMine ? <Badge tone="brand">You</Badge> : null}
                  </p>
                  <p className="text-xs text-muted">
                    {r.owner}
                    {r.division ? ` · ${r.division}` : ""}
                  </p>
                </td>
                <td className="py-2 pr-3 text-right font-semibold whitespace-nowrap tabular-nums">{r.record}</td>
                <td className="py-2 pr-4 text-right tabular-nums sm:pr-3">{r.pointsFor}</td>
                <td className="hidden py-2 pr-3 text-right tabular-nums sm:table-cell">{r.pointsAgainst}</td>
                <td className="hidden py-2 text-right tabular-nums sm:table-cell">
                  {r.rosterCount}
                  {r.irCount ? ` + ${r.irCount} IR` : ""}
                  {r.taxiCount ? ` + ${r.taxiCount} taxi` : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted">Sorted by record, then points for (PF).</p>
    </Card>
  );
}

function WarningsCard({ view }: ViewProps) {
  // The platform's notes, then the trade-value format notes (§14) and the League page's (projection source).
  const notes = [...new Set([...view.notes, ...view.valueNotes, ...view.modelNotes])];
  const none = !view.warnings.length && !notes.length;
  return (
    <Card id="warnings">
      <CardTitle eyebrow="Warnings and notes">Anything we weren&apos;t sure about</CardTitle>
      {none ? <Callout tone="ok">No warnings. Everything we read mapped cleanly.</Callout> : null}
      {notes.length ? (
        <ul className="mb-3 space-y-2">
          {notes.map((n) => (
            <li key={n} className="rounded-xl bg-surface-muted px-3 py-2 text-sm">
              {n}
            </li>
          ))}
        </ul>
      ) : null}
      {view.warnings.length ? (
        <ul className="space-y-2">
          {view.warnings.map((w, i) => (
            <li key={`${w.code}-${i}`} className="rounded-xl border border-warn-line bg-warn-bg px-3 py-2 text-sm text-warn-fg">
              <p className="font-semibold">{w.message}</p>
              <p className="mt-0.5 font-mono text-xs break-all opacity-80">
                {w.code}
                {w.platformPath ? ` · ${w.platformPath}` : ""}
              </p>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

function DataCard({ view, refresh, forget }: ViewProps & { refresh?: RefreshControl | undefined; forget?: ForgetControl | undefined }) {
  const forgetNoteRef = useRef<HTMLParagraphElement>(null);
  const forgetDone = forget?.done ?? false;
  // The Forget button goes away with the cookies; keep keyboard focus on what replaced it.
  useEffect(() => {
    if (forgetDone) forgetNoteRef.current?.focus({ preventScroll: true });
  }, [forgetDone]);

  return (
    <Card>
      <CardTitle eyebrow="Data">Where this came from</CardTitle>
      <Facts
        items={[
          ...view.timestamps.map((t) => ({ label: t.label, value: t.value })),
          {
            label: "Trade values",
            value: (
              <>
                {view.values.text} · <ValuesCredit />
              </>
            ),
          },
        ]}
      />
      {view.league.cookieNote || forget ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          {view.league.cookieNote ? <p className="text-sm text-muted">{view.league.cookieNote}</p> : null}
          {forget && !forget.done ? (
            <button type="button" onClick={forget.onForget} disabled={forget.forgetting} className={cx(buttonClass("danger", "sm"), "min-h-11")}>
              {forget.forgetting ? "Forgetting…" : "Forget my ESPN cookies"}
            </button>
          ) : null}
        </div>
      ) : null}
      {forget ? (
        // Always mounted while the control exists, so the confirmation is announced.
        <p ref={forgetNoteRef} role="status" tabIndex={FOCUS_TARGET.tabIndex} className={cx(FOCUS_TARGET.className, forget.note && "mt-2 text-sm font-semibold")}>
          {forget.note}
        </p>
      ) : null}
      <p className="mt-3 text-sm text-muted">
        Our server keeps a copy of league data for about 10 minutes, to go easy on {view.league.platformLabel}.{" "}
        {refresh ? "Refresh fetches it again (at most once a minute)." : "To refresh, import again."}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {refresh ? (
          // aria-disabled, not disabled: a disabled button drops keyboard focus to the page while it works (review UI-9).
          <button
            type="button"
            onClick={() => {
              if (!refresh.refreshing) refresh.onRefresh();
            }}
            aria-disabled={refresh.refreshing || undefined}
            className={cx(buttonClass("secondary", "sm"), "min-h-11 aria-disabled:cursor-not-allowed aria-disabled:opacity-60")}
          >
            {refresh.refreshing ? "Refreshing…" : "Refresh league data"}
          </button>
        ) : null}
        <Link href="/connect" className={cx(buttonClass("secondary", "sm"), "min-h-11")}>
          Import another league
        </Link>
      </div>
      {/* Always mounted, so the outcome of each Refresh is announced. */}
      <p role="status" className={refresh?.status ? "mt-3 text-sm font-semibold" : undefined}>
        {refresh?.status ?? null}
      </p>
      {refresh?.error ? (
        <p role="alert" className="mt-3 text-sm font-semibold text-danger-fg">
          {refresh.error}
        </p>
      ) : null}
    </Card>
  );
}
