/**
 * FantasyCalc market values (CLAUDE.md §2.9). Terms: non-commercial, at most one fetch per day per
 * format (enforced by the 24h cache + cross-process lock), documented endpoints only, and a visible
 * link to FantasyCalc.com wherever values are shown.
 *
 * Verified in Phase 0 (reports/probe-output/shared.md): the docs list only GET /values/current and
 * GET /players (other endpoints risk an IP ban); the terms want attribution close to the values;
 * numTeams outside 8/10/12/14 silently returns 12-team values, so pick the nearest supported size;
 * tep is "te+" / "te++" and must be percent-encoded (URLSearchParams does this).
 */
import { TTL } from "./cache";
import { getJson, type HttpResult } from "./http";

export interface FcFormat {
  isDynasty: boolean;
  numQbs: 1 | 2;
  numTeams: number;
  ppr: 0 | 0.5 | 1;
  /** TE premium. Omit when the league has none (the API default is none). */
  tep?: "te+" | "te++";
  /** Extra query parameters under test. */
  extra?: Record<string, string>;
}

export interface FcPlayer {
  id: number;
  name: string;
  position: string;
  sleeperId?: string | null;
  espnId?: string | number | null;
  mflId?: string | number | null;
  fleaflickerId?: string | number | null;
  [key: string]: unknown;
}

export interface FcEntry {
  player: FcPlayer;
  value: number;
  redraftValue?: number;
  [key: string]: unknown;
}

/** numTeams values the planner saw supported; use the nearest. */
export const FC_TEAM_SIZES = [8, 10, 12, 14] as const;

export function nearest<T extends number>(values: readonly T[], x: number): T {
  let best = values[0] as T;
  for (const v of values) if (Math.abs(v - x) < Math.abs(best - x)) best = v;
  return best;
}

export function fantasyCalcUrl(f: FcFormat): string {
  const q = new URLSearchParams({ isDynasty: String(f.isDynasty), numQbs: String(f.numQbs), numTeams: String(f.numTeams), ppr: String(f.ppr) });
  if (f.tep) q.set("tep", f.tep);
  for (const [k, v] of Object.entries(f.extra ?? {})) q.set(k, v);
  return `https://api.fantasycalc.com/values/current?${q.toString()}`;
}

export async function getFantasyCalc(f: FcFormat): Promise<{ data: FcEntry[]; res: HttpResult }> {
  const url = fantasyCalcUrl(f);
  return getJson<FcEntry[]>(url, { cache: { key: `fantasycalc:${url}`, ttlMs: TTL.fantasyCalc, namespace: "fantasycalc" }, label: `FantasyCalc ${url.split("?")[1]}` });
}

export type FcIdField = "sleeperId" | "espnId" | "mflId" | "fleaflickerId";

export interface RosteredPlayer {
  id: string;
  name: string;
  pos: string;
}

export interface MatchResult {
  eligible: number;
  matched: number;
  rate: number;
  misses: RosteredPlayer[];
}

/** Share of rostered QB/RB/WR/TE whose platform ID appears in FantasyCalc (check M, target ≥ 98%). */
export function matchRate(rostered: RosteredPlayer[], fc: FcEntry[], idField: FcIdField): MatchResult {
  // Dynasty pick rows carry pick keys ("FP_2027_1") in the id fields; "UNK" means unknown.
  const ids = new Set(
    fc
      .map((e) => e.player[idField])
      .filter((v) => v !== null && v !== undefined && v !== "" && v !== "UNK" && !String(v).startsWith("FP_"))
      .map(String),
  );
  const eligible = rostered.filter((p) => ["QB", "RB", "WR", "TE"].includes(p.pos));
  const misses = eligible.filter((p) => !ids.has(String(p.id)));
  const matched = eligible.length - misses.length;
  return { eligible: eligible.length, matched, rate: eligible.length ? matched / eligible.length : 0, misses };
}
