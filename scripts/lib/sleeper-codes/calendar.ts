/**
 * NFL week windows for dating Sleeper transactions (CLAUDE.md §2.9: nflverse games.csv). NFL week w
 * runs from the Wednesday (00:00 US Eastern) on or before its first game until the next week
 * starts, so a Monday-night game and the following Tuesday still belong to week w.
 *
 * Pure: the probe passes in the CSV text; no clock, no I/O.
 */
import { parse } from "csv-parse/sync";

const DAY_MS = 86_400_000;

/** YYYY-MM-DD → whole days since 1970-01-01 (calendar arithmetic, no time zone involved). */
export function dayNumber(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Math.round(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1) / DAY_MS);
}

export function dateOfDay(n: number): string {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(date: string): number {
  return new Date(dayNumber(date) * DAY_MS).getUTCDay();
}

export function wednesdayOnOrBefore(date: string): string {
  return dateOfDay(dayNumber(date) - ((weekdayOf(date) - 3 + 7) % 7));
}

const EASTERN = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });

/** Calendar date and hour in US Eastern time (daylight saving handled by Intl). */
export function easternParts(ts: number): { date: string; hour: number } {
  const p = Object.fromEntries(EASTERN.formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24 };
}

export interface NflCalendar {
  seasons: number[];
  /** US Eastern date (YYYY-MM-DD, a Wednesday) on which NFL week `week` of `season` starts. */
  weekStart(season: number, week: number): string | undefined;
  /** NFL week (1–18 regular season, 19+ playoffs) containing the moment; undefined outside the season. */
  weekOf(season: number, ts: number): number | undefined;
}

/** Build week windows from nflverse games.csv (columns season, week, gameday). */
export function nflCalendar(csv: string): NflCalendar {
  const rows = parse(csv, { columns: true, skip_empty_lines: true, bom: true, relax_column_count: true }) as Array<Record<string, string>>;
  const firstGame = new Map<number, Map<number, string>>();
  for (const r of rows) {
    const season = Number(r.season);
    const week = Number(r.week);
    const day = r.gameday ?? "";
    if (!Number.isInteger(season) || !Number.isInteger(week) || !/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    const m = firstGame.get(season) ?? new Map<number, string>();
    const cur = m.get(week);
    if (cur === undefined || day < cur) m.set(week, day);
    firstGame.set(season, m);
  }
  const starts = new Map<number, Array<[number, string]>>();
  for (const [season, m] of firstGame) starts.set(season, [...m].sort((a, b) => a[0] - b[0]).map(([w, d]) => [w, wednesdayOnOrBefore(d)]));
  return {
    seasons: [...starts.keys()].sort((a, b) => a - b),
    weekStart: (season, week) => starts.get(season)?.find(([w]) => w === week)?.[1],
    weekOf: (season, ts) => {
      const list = starts.get(season);
      if (!list?.length) return undefined;
      const { date } = easternParts(ts);
      let week: number | undefined;
      for (const [w, start] of list) if (start <= date) week = w;
      const last = list[list.length - 1];
      if (last && week === last[0] && dayNumber(date) - dayNumber(last[1]) >= 7) return undefined;
      return week;
    },
  };
}

export const TIMING_BUCKETS = [
  "before NFL week D",
  "Wed–Sat of NFL week D",
  "Sunday of week D before 1 pm ET",
  "Sunday 1 pm ET – Monday of week D",
  "Tuesday after week D",
  "Wednesday after week D or later",
] as const;
export type Timing = (typeof TIMING_BUCKETS)[number];

/** When a moment falls relative to NFL week `week` of `season` (US Eastern time). */
export function timingInWeek(cal: NflCalendar, season: number, week: number, ts: number): Timing | undefined {
  const start = cal.weekStart(season, week);
  if (!start) return undefined;
  const { date, hour } = easternParts(ts);
  const day = dayNumber(date) - dayNumber(start); // 0 = the Wednesday that starts week D
  if (day < 0) return "before NFL week D";
  if (day <= 3) return "Wed–Sat of NFL week D";
  if (day === 4) return hour < 13 ? "Sunday of week D before 1 pm ET" : "Sunday 1 pm ET – Monday of week D";
  if (day === 5) return "Sunday 1 pm ET – Monday of week D";
  if (day === 6) return "Tuesday after week D";
  return "Wednesday after week D or later";
}
