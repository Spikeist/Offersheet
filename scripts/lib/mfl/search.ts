/**
 * Test-league discovery for platforms where Parker has no MFL league (CLAUDE.md §17 Phase 0 step 3:
 * "MFL: find one with leagueSearch"). One search, then a few candidate checks; the choice is
 * remembered in fixtures/raw/mfl/test-league.json (git-ignored) so later runs don't search again.
 *
 * Privacy (review F6): the candidates are tried in an order keyed by a random salt that is stored only
 * in that git-ignored file, so the committed code cannot re-derive which stranger's league was used.
 * Reports describe the league generically; the IDs and names of the leagues looked at go to the
 * git-ignored watch list so check:leaks can catch them.
 *
 * MFL's terms forbid harvesting league data, so this checks as few leagues as possible and stops
 * as soon as one qualifies. Nothing about the other candidates is saved beyond the watch list.
 */
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { DAY, TTL, sha256, writeFileAtomic } from "../cache";
import { ROOT } from "../env";
import type { MflClient, MflCall } from "./client";
import { asArray, at, num, text } from "./json";

export const RAW_DIR = path.join(ROOT, "fixtures", "raw", "mfl");
export const TEST_LEAGUE_FILE = path.join(RAW_DIR, "test-league.json");
export const SEARCH_TERM = "dynasty";
/** Raw-fixture key of the search capture (the file name is its sha256; fixtures/raw is git-ignored). */
export const searchRawKey = (year: number) => `leagueSearch:${year}:${SEARCH_TERM}`;
/** Names that suggest a superflex league: exercises the numQbs=2 / SUPER_FLEX paths too. */
export const PREFER_NAME = /\b(sf|superflex|super flex|2qb)\b/i;
export const LIMITS = { leagueChecks: 8, standingsChecks: 3, rosterChecks: 3 } as const;

export interface SearchHit {
  id: string;
  name: string;
  host: string;
}

export interface ChosenLeague {
  id: string;
  host: string;
  chosenAt: string;
  /** Local notes on how it was found (git-ignored; never copied into reports). */
  method: string;
  /** Random salt of the candidate order (git-ignored; absent on choices made before salting). */
  salt?: string;
}

/** homeURL arrives as "https//wwwNN.myfantasyleague.com/2026/home/NNNNN" (no colon), so parse leniently. */
export function hostFromHomeUrl(homeUrl: string | undefined): string | undefined {
  return /^https?:?\/\/([a-z0-9-]+\.myfantasyleague\.com)\//i.exec(homeUrl ?? "")?.[1]?.toLowerCase();
}

export function parseSearch(json: unknown): SearchHit[] {
  return asArray(at(json, "leagues.league") as unknown[]).flatMap((l) => {
    const id = text(at(l, "id"));
    const host = hostFromHomeUrl(text(at(l, "homeURL")));
    return id && host ? [{ id, name: text(at(l, "name")) ?? "", host }] : [];
  });
}

export function newSalt(): string {
  return randomBytes(16).toString("hex");
}

/**
 * Salted pseudo-random order of the superflex-named hits. Ascending IDs would put families of
 * near-identical leagues (same commissioner, same settings) next to each other; the salt keeps the
 * order unreproducible without the git-ignored choice file.
 */
export function candidateOrder(hits: SearchHit[], salt: string): SearchHit[] {
  if (!salt) throw new Error("candidateOrder needs a salt");
  const key = (h: SearchHit) => sha256(`${salt}:${h.id}`);
  return hits.filter((h) => PREFER_NAME.test(h.name)).sort((a, b) => key(a).localeCompare(key(b)));
}

export async function loadChosen(file = TEST_LEAGUE_FILE): Promise<ChosenLeague | undefined> {
  try {
    const c = JSON.parse(await readFile(file, "utf8")) as ChosenLeague;
    return c.id && c.host ? c : undefined;
  } catch {
    return undefined;
  }
}

export async function saveChosen(c: ChosenLeague, file = TEST_LEAGUE_FILE): Promise<void> {
  await writeFileAtomic(file, JSON.stringify(c, null, 2));
}

/** The raw leagueSearch capture saved by an earlier discovery run, with its capture date. */
export async function loadSearchCapture(year: number, dir = RAW_DIR): Promise<{ json: unknown; captured?: string; status?: number; contentType?: string } | undefined> {
  const file = `${sha256(searchRawKey(year))}.json`;
  try {
    const json = JSON.parse(await readFile(path.join(dir, file), "utf8")) as unknown;
    let meta: { captured?: string; status?: number; contentType?: string } = {};
    try {
      const index = JSON.parse(await readFile(path.join(dir, "index.json"), "utf8")) as Record<string, typeof meta>;
      meta = index[file] ?? {};
    } catch {
      // no index
    }
    return { json, ...meta };
  } catch {
    return undefined;
  }
}

/** Games played so far per the standings (h2hw + h2hl + h2ht summed over franchises). */
export function gamesPlayed(standings: unknown): number {
  let n = 0;
  for (const f of asArray(at(standings, "leagueStandings.franchise") as unknown[])) n += (num(at(f, "h2hw")) ?? 0) + (num(at(f, "h2hl")) ?? 0) + (num(at(f, "h2ht")) ?? 0);
  return n;
}

/** Roster status counts, e.g. { ROSTER: 300, INJURED_RESERVE: 4, TAXI_SQUAD: 9 }. */
export function rosterStatusCounts(rosters: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of asArray(at(rosters, "rosters.franchise") as unknown[]))
    for (const pl of asArray(at(f, "player") as unknown[])) {
      const s = text(at(pl, "status")) ?? "(none)";
      out[s] = (out[s] ?? 0) + 1;
    }
  return out;
}

/** Console-only log line per candidate: numbers and a verdict, never an identity. */
export interface CandidateLog {
  n: number;
  franchises?: number;
  irSlots?: number;
  taxiSlots?: number;
  games?: number;
  statuses?: Record<string, number>;
  verdict: string;
}

/**
 * Pick a public, in-season, 10–12 team league with IR and taxi slots, preferring one where players
 * are actually on IR and taxi (so both roster status codes can be seen). At most
 * LIMITS.leagueChecks + standingsChecks + rosterChecks requests, once; the result is saved.
 * `examined` lists every hit whose league data was requested (for the watch list; never print it).
 */
export async function findTestLeague(
  c: MflClient,
  onSearch: (call: MflCall, hits: SearchHit[]) => Promise<void>,
  salt: string = newSalt(),
): Promise<{ chosen?: ChosenLeague; log: CandidateLog[]; searchCount: number; examined: SearchHit[] }> {
  const search = await c.export("leagueSearch", { SEARCH: SEARCH_TERM }, { ttlMs: DAY, namespace: "mfl-search", label: "MFL leagueSearch" });
  const hits = parseSearch(search.rawJson);
  await onSearch(search, hits);
  const log: CandidateLog[] = [];
  const examined: SearchHit[] = [];
  const qualified: Array<{ hit: SearchHit; n: number; statuses: Record<string, number> }> = [];
  let leagueChecks = 0;
  let standingsChecks = 0;
  let rosterChecks = 0;
  const opts = (label: string, h: SearchHit) => ({ host: h.host, ttlMs: TTL.league, namespace: "league-mfl", label });

  for (const h of candidateOrder(hits, salt)) {
    if (leagueChecks >= LIMITS.leagueChecks || rosterChecks >= LIMITS.rosterChecks) break;
    const n = ++leagueChecks;
    examined.push(h);
    const league = await c.export("league", { L: h.id }, opts(`MFL league (candidate ${n})`, h));
    const franchises = num(at(league.json, "league.franchises.count"));
    const irSlots = num(at(league.json, "league.injuredReserve")) ?? 0;
    const taxiSlots = num(at(league.json, "league.taxiSquad")) ?? 0;
    if (league.error || franchises === undefined || franchises < 10 || franchises > 12 || irSlots < 1 || taxiSlots < 1) {
      log.push({ n, franchises, irSlots, taxiSlots, verdict: league.error ? "league export error" : "needs 10–12 teams with IR and taxi slots" });
      continue;
    }
    if (standingsChecks >= LIMITS.standingsChecks) break;
    standingsChecks++;
    const st = await c.export("leagueStandings", { L: h.id }, opts(`MFL leagueStandings (candidate ${n})`, h));
    if (st.error || !st.res.ok) {
      log.push({ n, franchises, irSlots, taxiSlots, verdict: `standings not public (${st.error ? "MFL error" : `HTTP ${st.res.status}`})` });
      continue;
    }
    const games = gamesPlayed(st.json);
    if (games === 0) {
      log.push({ n, franchises, irSlots, taxiSlots, games, verdict: "no games played yet" });
      continue;
    }
    rosterChecks++;
    const ro = await c.export("rosters", { L: h.id }, opts(`MFL rosters (candidate ${n})`, h));
    const statuses = rosterStatusCounts(ro.json);
    const both = Object.keys(statuses).filter((s) => s !== "ROSTER").length >= 2;
    log.push({ n, franchises, irSlots, taxiSlots, games, statuses, verdict: both ? "chosen (IR and taxi both in use)" : "qualifies; IR/taxi not both in use" });
    qualified.push({ hit: h, n, statuses });
    if (both) break;
  }
  const pick = qualified.find((q) => Object.keys(q.statuses).filter((s) => s !== "ROSTER").length >= 2) ?? qualified.sort((a, b) => Object.keys(b.statuses).length - Object.keys(a.statuses).length)[0];
  if (!pick) return { log, searchCount: hits.length, examined };
  // Local notes only (git-ignored file); the probe reports a generic description instead.
  const method = `leagueSearch (${hits.length} hits), salted order, candidate ${pick.n}; ${leagueChecks} league / ${standingsChecks} standings / ${rosterChecks} roster checks`;
  return { chosen: { id: pick.hit.id, host: pick.hit.host, chosenAt: new Date().toISOString(), method, salt }, log, searchCount: hits.length, examined };
}
