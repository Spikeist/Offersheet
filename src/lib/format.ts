/**
 * Display formatting shared by the pages (pure, client-safe). Numbers use a real minus sign (U+2212)
 * and trim trailing zeros, so 0.50 shows as "0.5" and −2.00 as "−2".
 */

const MINUS = "−";

/** A number with at most `maxDecimals` decimals and no trailing zeros ("0.5", "−2", "0.04"). */
export function fmtNum(n: number, maxDecimals = 2): string {
  if (!Number.isFinite(n)) return String(n);
  const factor = 10 ** maxDecimals;
  const rounded = Math.round(Math.abs(n) * factor) / factor;
  const text = rounded.toFixed(maxDecimals).replace(/\.?0+$/, "");
  return n < 0 && rounded !== 0 ? `${MINUS}${text}` : text;
}

/** A signed number for bonuses and penalties: "+2", "−1.5", "0". */
export function fmtSigned(n: number, maxDecimals = 2): string {
  const text = fmtNum(n, maxDecimals);
  return n > 0 && text !== "0" ? `+${text}` : text;
}

/** "1 pt", "2 pts", "0.5 pts", "−2 pts". */
export function fmtPoints(n: number, maxDecimals = 2): string {
  const text = fmtNum(n, maxDecimals);
  return `${text} ${text === "1" ? "pt" : "pts"}`;
}

/** "1 team" / "3 teams". */
export function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : pluralForm}`;
}

/** Contiguous runs of sorted unique weeks: [1,2,3,5] → [[1,3],[5,5]]. */
export function weekRuns(weeks: readonly number[]): Array<[number, number]> {
  const sorted = [...new Set(weeks)].filter(Number.isFinite).sort((a, b) => a - b);
  const runs: Array<[number, number]> = [];
  for (const w of sorted) {
    const last = runs[runs.length - 1];
    if (last && w === last[1] + 1) last[1] = w;
    else runs.push([w, w]);
  }
  return runs;
}

/** "Week 3", "Weeks 1–14", "Weeks 1–2, 4", or "None". */
export function weeksText(weeks: readonly number[]): string {
  const runs = weekRuns(weeks);
  if (!runs.length) return "None";
  const single = runs.length === 1 && runs[0]?.[0] === runs[0]?.[1];
  const parts = runs.map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`));
  return `${single ? "Week" : "Weeks"} ${parts.join(", ")}`;
}

/** A readable date and time in the given IANA time zone, e.g. "Wed, Dec 2, 2026, 12:00 PM EST". */
export function formatDateTime(iso: string, timeZone: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(d);
  } catch {
    return d.toISOString();
  }
}

/** A readable date in the given IANA time zone, e.g. "Wed, Dec 2, 2026". */
export function formatDate(iso: string, timeZone: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/** A readable time of day in the given IANA time zone, e.g. "9:08 PM". */
export function formatTime(iso: string, timeZone: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(d);
  } catch {
    return d.toISOString().slice(11, 16);
  }
}

/** A win–loss(–tie) record: "3–1" or "2–1–1". */
export function recordText(r: { w: number; l: number; t: number }): string {
  return r.t ? `${r.w}–${r.l}–${r.t}` : `${r.w}–${r.l}`;
}
