/**
 * NFL week helpers from ESPN's proTeamSchedules_wl (settings.proTeams[].proGamesByScoringPeriod).
 * Ported from the Phase 0 probe (scripts/lib/espn/weeks.ts). A scoring period (NFL week) "owns"
 * the time after the previous week's last kickoff up to its own last kickoff, so an instant between
 * Monday night and Thursday kickoff belongs to the coming week. Pure.
 */

export interface WeekWindow {
  week: number;
  /** Epoch ms of the week's first and last kickoff. */
  firstKickoff: number;
  lastKickoff: number;
}

export interface ProGameLike {
  date: number;
  homeProTeamId: number;
  awayProTeamId: number;
}

export function weekWindows(proTeams: ReadonlyArray<{ proGamesByScoringPeriod?: Readonly<Record<string, ReadonlyArray<ProGameLike>>> | null }>): WeekWindow[] {
  const byWeek = new Map<number, Map<string, number>>();
  for (const t of proTeams) {
    for (const [wk, games] of Object.entries(t.proGamesByScoringPeriod ?? {})) {
      const week = Number(wk);
      if (!Number.isFinite(week)) continue;
      const m = byWeek.get(week) ?? new Map<string, number>();
      for (const g of games) m.set(`${g.homeProTeamId}-${g.awayProTeamId}-${g.date}`, g.date);
      byWeek.set(week, m);
    }
  }
  return [...byWeek]
    .filter(([, games]) => games.size > 0)
    .map(([week, games]) => {
      const dates = [...games.values()];
      return { week, firstKickoff: Math.min(...dates), lastKickoff: Math.max(...dates) };
    })
    .sort((a, b) => a.week - b.week);
}

/** The NFL week whose window contains the instant, or null outside the season / without a schedule. */
export function weekOfInstant(ms: number, windows: readonly WeekWindow[]): number | null {
  for (let i = 0; i < windows.length; i++) {
    const w = windows[i] as WeekWindow;
    const prevLast = i > 0 ? (windows[i - 1] as WeekWindow).lastKickoff : Number.NEGATIVE_INFINITY;
    if (ms > prevLast && ms <= w.lastKickoff) return w.week;
  }
  return null;
}

/**
 * The NFL week of a calendar date such as ESPN's injuryDetails.expectedReturnDate [year, month
 * (1-based, Phase 0 E.injuryReturn), day], read at 17:00 UTC (US midday, before Sunday's kickoffs).
 * A date after the last week's final kickoff → the week after the season (lastWeek + 1: not back
 * this season). undefined for a malformed date or without a schedule.
 */
export function weekOfCalendarDate(date: readonly number[], windows: readonly WeekWindow[]): number | undefined {
  const [y, m, d] = date;
  const last = windows[windows.length - 1];
  if (!last || date.length !== 3 || !Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return undefined;
  if ((m as number) < 1 || (m as number) > 12 || (d as number) < 1 || (d as number) > 31) return undefined;
  const ms = Date.UTC(y as number, (m as number) - 1, d as number, 17);
  return weekOfInstant(ms, windows) ?? (ms > last.lastKickoff ? last.week + 1 : undefined);
}
