/**
 * Small pure derivations the MFL probe (and later the adapter) needs, because MFL leaves them implicit:
 * transaction weeks (only unix timestamps are given), trade sides and add/drop strings, injury return
 * weeks (exp_return is a date like "Oct 4, 2026"), and ages (birthdate is a unix timestamp).
 */

/** Week → kickoff unix seconds of every game that week (from TYPE=nflSchedule W=ALL). */
export type Kickoffs = Map<number, number[]>;

const GAME_WINDOW_S = 5 * 3600; // a game is over ~5 h after kickoff

/**
 * NFL week a moment belongs to: the first week whose last game hasn't finished yet. Moves made after
 * week 3's Monday game (e.g. on Tuesday) count toward week 4, the week they can first affect.
 */
export function weekOf(unixSeconds: number, kickoffs: Kickoffs): number | undefined {
  const weeks = [...kickoffs.keys()].sort((a, b) => a - b);
  for (const w of weeks) {
    const ks = kickoffs.get(w) ?? [];
    if (!ks.length) continue;
    if (unixSeconds < Math.max(...ks) + GAME_WINDOW_S) return w;
  }
  return undefined;
}

/** Unix seconds of the season's first kickoff (undefined without a schedule). */
export function seasonStart(kickoffs: Kickoffs): number | undefined {
  let first = Infinity;
  for (const ks of kickoffs.values()) for (const k of ks) if (k > 0 && k < first) first = k;
  return Number.isFinite(first) ? first : undefined;
}

/**
 * The next week to kick off after a moment: the first week whose FIRST kickoff is later. This is how
 * MFL's own TYPE=transactions&W=n filter files moves (made after week n−1's first kickoff and before
 * week n's); the probe's G.week check compares it with MFL's W= list on every run.
 */
export function nextKickoffWeek(unixSeconds: number, kickoffs: Kickoffs): number | undefined {
  const weeks = [...kickoffs.keys()].sort((a, b) => a - b);
  for (const w of weeks) {
    const ks = kickoffs.get(w) ?? [];
    if (ks.length && unixSeconds < Math.min(...ks)) return w;
  }
  return undefined;
}

/**
 * Week a transaction belongs to, for activity counts: MFL's week (nextKickoffWeek), except that moves
 * before the season's first kickoff are 0 = preseason (MFL files them under week 1, which would count
 * draft-time and roster-loading moves as in-season activity).
 */
export function txWeek(unixSeconds: number, kickoffs: Kickoffs): number | undefined {
  const start = seasonStart(kickoffs);
  if (start !== undefined && unixSeconds < start) return 0;
  return nextKickoffWeek(unixSeconds, kickoffs);
}

export interface TradeSide {
  players: string[];
  /** FP_<originalFranchise>_<year>_<round> (round is the actual round). */
  futurePicks: Array<{ originalFranchise: string; year: number; round: number }>;
  /** DP_<round-1>_<pick-1> (current-year picks are zero-based in MFL). */
  currentPicks: Array<{ round: number; pick: number }>;
  /** BB_<dollars>: blind-bid (FAAB) dollars. */
  blindBid: number;
  unknown: string[];
}

/** Parse "12345,FP_0005_2027_2,DP_02_05,BB_10," (MFL docs, tradeBait INCLUDE_DRAFT_PICKS). */
export function parseTradeSide(s: string | undefined): TradeSide {
  const out: TradeSide = { players: [], futurePicks: [], currentPicks: [], blindBid: 0, unknown: [] };
  for (const tok of (s ?? "").split(",").map((t) => t.trim()).filter(Boolean)) {
    let m: RegExpExecArray | null;
    if (/^\d{4,5}$/.test(tok)) out.players.push(tok);
    else if ((m = /^FP_(\d{4})_(\d{4})_(\d+)$/.exec(tok))) out.futurePicks.push({ originalFranchise: m[1] as string, year: Number(m[2]), round: Number(m[3]) });
    else if ((m = /^DP_(\d+)_(\d+)$/.exec(tok))) out.currentPicks.push({ round: Number(m[1]) + 1, pick: Number(m[2]) + 1 });
    else if ((m = /^BB_(\d+(?:\.\d+)?)$/.exec(tok))) out.blindBid += Number(m[1]);
    else out.unknown.push(tok);
  }
  return out;
}

/** FREE_AGENT / BBID_WAIVER "transaction" strings: "added,|dropped," or "added,|bid|dropped,". */
export function parseAddDrop(s: string | undefined): { added: string[]; dropped: string[]; bid?: number } {
  const parts = (s ?? "").split("|");
  const ids = (x: string | undefined) => (x ?? "").split(",").map((t) => t.trim()).filter((t) => /^\d{4,5}$/.test(t));
  if (parts.length >= 3) return { added: ids(parts[0]), bid: Number(parts[1]) || 0, dropped: ids(parts[2]) };
  return { added: ids(parts[0]), dropped: ids(parts[1]) };
}

/** Comma list of player ids ("12345,23456,"). */
export function idList(s: string | undefined): string[] {
  return (s ?? "").split(",").map((t) => t.trim()).filter((t) => /^\d{4,5}$/.test(t));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Oct 4, 2026" → unix seconds at 12:00 UTC that day (undefined if unparsable). */
export function parseMflDate(s: string | undefined): number | undefined {
  const m = /^([A-Z][a-z]{2})\s+(\d{1,2}),\s*(\d{4})$/.exec((s ?? "").trim());
  if (!m) return undefined;
  const month = MONTHS.indexOf(m[1] as string);
  if (month < 0) return undefined;
  return Date.UTC(Number(m[3]), month, Number(m[2]), 12) / 1000;
}

/** Injury exp_return → the first NFL week the player can play (undefined past the season). */
export function returnWeek(expReturn: string | undefined, kickoffs: Kickoffs): number | undefined {
  const t = parseMflDate(expReturn);
  return t === undefined ? undefined : weekOf(t, kickoffs);
}

/** Age in whole years at `nowSeconds` from an MFL birthdate (unix seconds). */
export function ageAt(birthdate: string | undefined, nowSeconds: number): number | undefined {
  const b = Number(birthdate);
  if (!birthdate || !Number.isFinite(b) || b === 0) return undefined;
  const born = new Date(b * 1000);
  const now = new Date(nowSeconds * 1000);
  let age = now.getUTCFullYear() - born.getUTCFullYear();
  if (now.getUTCMonth() < born.getUTCMonth() || (now.getUTCMonth() === born.getUTCMonth() && now.getUTCDate() < born.getUTCDate())) age--;
  return age;
}

/**
 * Compare MFL's own TYPE=transactions&W=n list with our timestamp-derived week n (multisets keyed by
 * the canonical JSON of each transaction). `weekOfTx` maps a transaction to our derived week.
 */
export function compareWeekList<T>(all: T[], mflWeekList: T[], week: number, weekOfTx: (t: T) => number | undefined): { mfl: number; ours: number; both: number; onlyMflByOurWeek: Record<string, number>; onlyOurs: number } {
  const key = (t: T) => JSON.stringify(t);
  const ours = new Map<string, number>();
  for (const t of all) if (weekOfTx(t) === week) ours.set(key(t), (ours.get(key(t)) ?? 0) + 1);
  const oursTotal = [...ours.values()].reduce((s, n) => s + n, 0);
  const left = new Map(ours);
  const weekByKey = new Map(all.map((t) => [key(t), weekOfTx(t)] as const));
  let both = 0;
  const onlyMflByOurWeek: Record<string, number> = {};
  for (const t of mflWeekList) {
    const k = key(t);
    const n = left.get(k) ?? 0;
    if (n > 0) {
      both++;
      left.set(k, n - 1);
    } else {
      const w = weekByKey.has(k) ? String(weekByKey.get(k) ?? "unknown") : "not in the full list";
      onlyMflByOurWeek[w] = (onlyMflByOurWeek[w] ?? 0) + 1;
    }
  }
  return { mfl: mflWeekList.length, ours: oursTotal, both, onlyMflByOurWeek, onlyOurs: oursTotal - both };
}
