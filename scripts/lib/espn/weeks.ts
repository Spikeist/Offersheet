/**
 * NFL week helpers built from ESPN's proTeamSchedules_wl (settings.proTeams[].proGamesByScoringPeriod).
 * A scoring period (NFL week) "owns" the time after the previous week's last game up to its own
 * last game, so an instant between Monday night and Thursday kickoff belongs to the coming week.
 */

export interface WeekWindow {
  week: number;
  /** Epoch ms of the first and last kickoff in that week. */
  firstKickoff: number;
  lastKickoff: number;
  games: number;
}

export interface ProGame {
  date: number;
  homeProTeamId: number;
  awayProTeamId: number;
}

export function weekWindows(proTeams: ReadonlyArray<{ id: number; proGamesByScoringPeriod?: Record<string, ReadonlyArray<ProGame>> }>): WeekWindow[] {
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
    .map(([week, games]) => {
      const dates = [...games.values()];
      return { week, firstKickoff: Math.min(...dates), lastKickoff: Math.max(...dates), games: games.size };
    })
    .sort((a, b) => a.week - b.week);
}

export interface WeekOfInstant {
  week: number | null;
  /** "before-kickoff": the week's games haven't started yet; "during": between first and last kickoff. */
  phase: "before-kickoff" | "during" | "after-season" | "unknown";
}

export function weekOfInstant(ms: number, windows: readonly WeekWindow[]): WeekOfInstant {
  for (let i = 0; i < windows.length; i++) {
    const w = windows[i] as WeekWindow;
    const prevLast = i > 0 ? (windows[i - 1] as WeekWindow).lastKickoff : -Infinity;
    if (ms > prevLast && ms <= w.lastKickoff) return { week: w.week, phase: ms < w.firstKickoff ? "before-kickoff" : "during" };
  }
  return windows.length && ms > (windows[windows.length - 1] as WeekWindow).lastKickoff ? { week: null, phase: "after-season" } : { week: null, phase: "unknown" };
}

export interface SeasonShape {
  latestScoringPeriod: number;
  finalScoringPeriod?: number;
  matchupPeriodCount: number;
  /** Matchup period → NFL weeks (settings.scheduleSettings.matchupPeriods). */
  matchupPeriods: Record<string, readonly number[]>;
}

/**
 * Future weeks the probe samples for projections: next week (the CLAUDE.md §6 fallback week for
 * players on bye or out now), the last regular-season week and the last fantasy playoff week.
 */
export function futureSampleWeeks(s: SeasonShape): Array<{ week: number; why: string }> {
  const cur = s.latestScoringPeriod;
  const final = s.finalScoringPeriod ?? 17;
  const periods = Object.entries(s.matchupPeriods).map(([mp, weeks]) => ({ mp: Number(mp), weeks }));
  const regular = periods.filter((x) => x.mp <= s.matchupPeriodCount).flatMap((x) => x.weeks);
  const playoff = periods.filter((x) => x.mp > s.matchupPeriodCount).flatMap((x) => x.weeks);
  const candidates = [
    { week: cur + 1, why: "next week (the §6 fallback week for players on bye or out now)" },
    { week: Math.max(...regular), why: "last regular-season week" },
    { week: Math.max(...playoff), why: "last fantasy playoff week (end of the projection horizon)" },
  ];
  const out: Array<{ week: number; why: string }> = [];
  for (const c of candidates) if (Number.isFinite(c.week) && c.week > cur && c.week <= final && !out.some((o) => o.week === c.week)) out.push(c);
  return out;
}

/** Byes derived from the schedule: weeks (within 1..lastWeek) in which a team has no game. */
export function byeWeeksFromGames(proGamesByScoringPeriod: Record<string, ReadonlyArray<ProGame>> | undefined, lastWeek: number): number[] {
  const played = new Set(Object.entries(proGamesByScoringPeriod ?? {}).filter(([, g]) => g.length > 0).map(([w]) => Number(w)));
  const out: number[] = [];
  for (let w = 1; w <= lastWeek; w++) if (!played.has(w)) out.push(w);
  return out;
}
