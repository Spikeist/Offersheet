/**
 * Which Sleeper league the probe uses (re-read from .env.local on every run):
 *   1. SLEEPER_LEAGUE_ID → that league (my team needs SLEEPER_USERNAME too)
 *   2. SLEEPER_USERNAME  → /user/{username} → /user/{user_id}/leagues/nfl/{season} → pick one
 *   3. neither: the PINNED public test league from the git-ignored choice file
 *      (fixtures/raw/sleeper/fallback-league.json). Refreshing it is not a crawl, so its requests stay
 *      live; it is never swapped for another league automatically, even when it stops qualifying.
 *   4. neither, and nothing pinned: a fallback public test league, found by a salted random walk
 *      over public member lists — ONLY with --allow-crawl (CLAUDE.md §0.6: no new crawls of
 *      strangers' leagues without asking Parker first; see crawlAllowed() in probe.ts). The walk is
 *      seeded from the example IDs in Sleeper's API docs: their members → a salted sample of those
 *      users' leagues → a salted sample of those leagues' members → their leagues → the qualifying
 *      candidates in salted order. The salt is random and stored only in the choice file, so neither
 *      this code nor the committed fixtures can reproduce the choice, and the choice is pinned so
 *      reruns use the same league. No league or user ID is hardcoded in source.
 *
 * Every ID seen while choosing is registered with `disc` (a separate, ID-only Redactor that also
 * scrubs the console), and every identity seen (IDs, usernames, display names, league/team names)
 * goes to the git-ignored watch list that `npm run check:leaks` loads. Nothing about the walk
 * (counts, filters met, dates) is written to committed reports; the details stay in the choice file.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { writeFileAtomic } from "../cache";
import { RAW_DIR } from "../fixtures";
import type { ProbeContext } from "../probe";
import type { Redactor } from "../sanitize";
import { NEEDS_CRAWL } from "../shared/crawl-gate";
import { DOCS_URL, endpoints, fetchJson, type Fetched } from "./api";
import { registerDiscoveryId, registerLeagueListIdentities, registerUserIdentity } from "./identities";
import { newSalt, saltedOrder } from "./salt";
import type { SleeperLeague, SleeperRoster, SleeperTransaction, SleeperUser } from "./types";
import type { Watchlist } from "./watchlist";

export type SelectionMode = "env-league" | "env-username" | "fallback";

export interface LeagueChoice {
  mode: SelectionMode;
  leagueId: string;
  /** The user whose team is "mine": Parker's user_id, or the fallback's member who led to the league. Null when unknown. */
  userId: string | null;
  /** That user's leagues this season (env-username mode only; never fetched for the fallback). */
  userLeagues?: Fetched<SleeperLeague[]>;
  /** /user/{username} (env-username) or /user/{user_id} (fallback), for the fixture. */
  userLookup?: Fetched<SleeperUser>;
  /** Placeholder-only, qualifier-free notes about how the league was chosen (safe for reports). */
  notes: string[];
  /** Placeholder-only reason selection failed (reported as ❌ by the probe, or as untested with needsCrawl). */
  failure?: string;
  /** Choosing a league would need a walk over strangers' leagues, which this run may not do (no --allow-crawl). */
  needsCrawl?: boolean;
  /** Why the pinned test league no longer meets the fallback criteria (kept anyway: it is pinned). */
  pinnedStale?: string;
}

export const FALLBACK_FILE = path.join(RAW_DIR, "sleeper", "fallback-league.json");

/** Git-ignored: the only place the salt and the walk's details are kept. */
interface SavedFallback {
  leagueId: string;
  userId: string;
  chosenAt: string;
  why: string;
  salt?: string;
  method?: string;
}

const METHOD = "salted-walk-v2";
/**
 * Walk sizes: users with current-season leagues to collect per hop (many example users are old,
 * inactive accounts, so a hop keeps listing users until it has these), the cap on league-list
 * requests per hop, hop-1 leagues whose members are read, and candidates checked.
 */
const HOP1_USERS_WITH_LEAGUES = 6;
const HOP2_USERS_WITH_LEAGUES = 8;
const MAX_LISTS_PER_HOP = 30;
const HOP2_LEAGUES = 6;
const CANDIDATES_CHECKED = 8;

const STATUS_RANK: Record<string, number> = { in_season: 0, drafting: 1, pre_draft: 2, complete: 3 };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Entries of a league list that have the fields ranking and selection read (malformed ones are skipped). */
export function validLeagues(list: unknown): SleeperLeague[] {
  if (!Array.isArray(list)) return [];
  return list.filter((l): l is SleeperLeague => isRecord(l) && typeof l.league_id === "string" && isRecord(l.settings) && typeof l.total_rosters === "number");
}

/** Order a user's leagues: in-season first, best-ball last, then closest to 12 teams, then by ID for stability. */
export function rankUserLeagues(leagues: readonly unknown[]): SleeperLeague[] {
  const bestBall = (l: SleeperLeague) => (Number(l.settings.best_ball ?? 0) === 1 ? 1 : 0);
  return validLeagues(leagues).sort(
    (a, b) =>
      (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9) ||
      bestBall(a) - bestBall(b) ||
      Math.abs(12 - a.total_rosters) - Math.abs(12 - b.total_rosters) ||
      a.league_id.localeCompare(b.league_id),
  );
}

/** A stand-in for Parker's league: in season, 10–12 teams, not best ball or guillotine, full season, 3+ scored weeks. */
export function isFallbackCandidate(l: SleeperLeague, season: number): boolean {
  const s = l.settings ?? {};
  const lastScored = Number(s.last_scored_leg ?? 99);
  return (
    (l.sport ?? "nfl") === "nfl" &&
    l.season === String(season) &&
    l.status === "in_season" &&
    (l.season_type ?? "regular") === "regular" &&
    l.total_rosters >= 10 &&
    l.total_rosters <= 12 &&
    Number(s.best_ball ?? 0) !== 1 &&
    Number(s.type ?? 0) !== 3 &&
    Number(s.start_week ?? 1) <= 1 &&
    lastScored >= 3
  );
}

/** Short, ID-free description of a failed call. */
function why(f: Fetched<unknown>): string {
  return f.ok ? "empty (null) body" : f.status ? `HTTP ${f.status}${f.error && !f.error.startsWith("HTTP") ? `, ${f.error}` : ""}` : "network error";
}

export async function chooseLeague(p: ProbeContext, disc: Redactor, watch: Watchlist, season: number, currentWeek: number, opts: { allowCrawl: boolean }): Promise<LeagueChoice> {
  const envLeague = p.env("SLEEPER_LEAGUE_ID");
  const envUser = p.env("SLEEPER_USERNAME");

  let userId: string | null = null;
  let userLookup: Fetched<SleeperUser> | undefined;
  let userLeagues: Fetched<SleeperLeague[]> | undefined;
  const notes: string[] = [];

  if (envUser) {
    userLookup = await fetchJson<SleeperUser>(p, endpoints.userByName(envUser));
    if (userLookup.ok && userLookup.data?.user_id) {
      userId = userLookup.data.user_id;
      registerUserIdentity(disc, userLookup.data);
      userLeagues = await fetchJson<SleeperLeague[]>(p, endpoints.userLeagues(userId, season));
      if (userLeagues.ok && Array.isArray(userLeagues.data)) registerLeagueListIdentities(disc, validLeagues(userLeagues.data));
    } else {
      notes.push(`SLEEPER_USERNAME lookup failed (${why(userLookup)})`);
    }
  }

  if (envLeague) {
    notes.push(userId ? "league from SLEEPER_LEAGUE_ID; my team from SLEEPER_USERNAME" : "league from SLEEPER_LEAGUE_ID; SLEEPER_USERNAME blank or not found, so my team can't be detected");
    return { mode: "env-league", leagueId: envLeague, userId, userLookup, userLeagues, notes };
  }

  if (envUser) {
    if (!userId) return { mode: "env-username", leagueId: "", userId: null, userLookup, notes, failure: notes.join("; ") };
    const raw: unknown[] = userLeagues?.ok && Array.isArray(userLeagues.data) ? userLeagues.data : [];
    const ranked = rankUserLeagues(raw.filter((l) => isRecord(l) && (l.sport ?? "nfl") === "nfl"));
    const skipped = raw.length - validLeagues(raw).length;
    const pick = ranked[0];
    if (!pick) return { mode: "env-username", leagueId: "", userId, userLookup, userLeagues, notes, failure: `no ${season} NFL leagues for SLEEPER_USERNAME (${userLeagues ? why(userLeagues) : "not fetched"}, ${raw.length} listed${skipped ? `, ${skipped} malformed` : ""})` };
    notes.push(`SLEEPER_USERNAME has ${ranked.length} ${season} NFL league(s)${skipped ? ` (+${skipped} malformed list entries skipped)` : ""}; used the first by (in season, not best ball, closest to 12 teams)`);
    return { mode: "env-username", leagueId: pick.league_id, userId, userLookup, userLeagues, notes };
  }

  return chooseFallback(p, disc, watch, season, currentWeek, opts.allowCrawl);
}

/** Why the pinned league can't be used as is, or null when it still qualifies (pure; for the report). */
export function pinnedLeagueProblem(league: SleeperLeague, season: number): string | null {
  return isFallbackCandidate(league, season) ? null : "the pinned public test league no longer meets the fallback criteria (in season, 10–12 teams, not best ball or guillotine, full season, 3+ scored weeks)";
}

async function chooseFallback(p: ProbeContext, disc: Redactor, watch: Watchlist, season: number, currentWeek: number, allowCrawl: boolean): Promise<LeagueChoice> {
  const saved = readSaved();
  const reselect = `delete the git-ignored choice file fixtures/raw/sleeper/fallback-league.json and re-run with --allow-crawl (ask Parker first)`;
  if (saved) {
    registerDiscoveryId(disc, saved.leagueId, "league");
    registerDiscoveryId(disc, saved.userId, "user");
    watch.add(saved.leagueId, "league-id");
    watch.add(saved.userId, "user-id");
    // The pinned test league (CLAUDE.md §0.6: refreshing it is not a crawl). A pin is never replaced
    // automatically: a new pick would be a new walk over strangers' leagues.
    const league = await fetchJson<SleeperLeague>(p, endpoints.league(saved.leagueId));
    if (league.ok && league.data) {
      const notes = ["reused the pinned fallback league"];
      if (!saved.salt || saved.method !== METHOD) notes.push("it was pinned before salted walks were used");
      const problem = pinnedLeagueProblem(league.data, season);
      const userLookup = await lookupUser(p, disc, watch, saved.userId);
      return { mode: "fallback", leagueId: saved.leagueId, userId: saved.userId, userLookup, notes, pinnedStale: problem ? `${problem}; it is kept because it is pinned — to pick another, ${reselect}` : undefined };
    }
    if (league.ok) return { mode: "fallback", leagueId: "", userId: null, notes: [], needsCrawl: true, failure: `${NEEDS_CRAWL}: the pinned public test league no longer exists (HTTP 200 with a null body); to pick another, ${reselect}` };
    return { mode: "fallback", leagueId: "", userId: null, notes: [], failure: `the pinned public test league couldn't be read (${why(league)})` };
  }
  if (!allowCrawl) {
    return { mode: "fallback", leagueId: "", userId: null, notes: [], needsCrawl: true, failure: `${NEEDS_CRAWL}: SLEEPER_USERNAME and SLEEPER_LEAGUE_ID are blank and no public test league is pinned; picking one walks strangers' public leagues` };
  }

  const salt = newSalt();
  const listLeagues = async (uid: string): Promise<SleeperLeague[]> => {
    const f = await fetchJson<SleeperLeague[]>(p, endpoints.userLeagues(uid, season));
    const list = f.ok ? validLeagues(f.data) : [];
    registerLeagueListIdentities(disc, list);
    for (const l of list) watch.addLeague(l);
    return list;
  };
  const members = async (leagueId: string): Promise<string[]> => {
    const f = await fetchJson<SleeperUser[]>(p, endpoints.users(leagueId));
    if (!f.ok || !Array.isArray(f.data)) return [];
    const out: string[] = [];
    for (const u of f.data) {
      if (!isRecord(u) || typeof u.user_id !== "string") continue;
      registerDiscoveryId(disc, u.user_id, "user");
      watch.addUser(u);
      out.push(u.user_id);
    }
    return out;
  };

  // Seeds: example IDs printed in Sleeper's public API docs (syntax-highlighted: strip tags first).
  const docs = await p.request(DOCS_URL, { cache: { key: `sleeper:${DOCS_URL}`, ttlMs: 7 * 24 * 3600 * 1000, namespace: "sleeper-docs" }, label: "Sleeper API docs" });
  const text = docs.ok ? docs.text.replace(/<[^>]+>/g, "").replace(/&quot;/g, '"') : "";
  const seedLeagues = uniqueMatches(text, /league_id"\s*:\s*"(\d{15,20})"/g);
  const seedUsers = uniqueMatches(text, /(?:owner_id|user_id)"\s*:\s*"(\d{15,20})"/g);
  for (const l of seedLeagues) {
    registerDiscoveryId(disc, l, "league");
    watch.add(l, "league-id");
  }
  for (const u of seedUsers) {
    registerDiscoveryId(disc, u, "user");
    watch.add(u, "user-id");
  }

  /** List users' leagues in salted order until `want` of them have current-season leagues (at most MAX_LISTS_PER_HOP lists). */
  const collect = async (users: string[], tag: string, want: number, skip: ReadonlyMap<string, unknown>) => {
    const found = new Map<string, { league: SleeperLeague; userId: string }>();
    let withLeagues = 0;
    let lists = 0;
    for (const uid of saltedOrder(users, (x) => x, salt, tag)) {
      if (withLeagues >= want || lists >= MAX_LISTS_PER_HOP) break;
      const list = (await listLeagues(uid)).filter((l) => l.season === String(season));
      lists++;
      if (list.length) withLeagues++;
      for (const l of list) if (!skip.has(l.league_id) && !found.has(l.league_id)) found.set(l.league_id, { league: l, userId: uid });
    }
    return found;
  };

  // Hop 1: the example leagues' members (plus example users) → their current leagues.
  const hop1Users = new Set<string>(seedUsers);
  for (const lid of seedLeagues) for (const u of await members(lid)) hop1Users.add(u);
  const hop1Leagues = await collect([...hop1Users], "hop1-users", HOP1_USERS_WITH_LEAGUES, new Map());

  // Hop 2: members of a salted sample of those leagues → their current leagues.
  const hop2Users = new Set<string>();
  for (const { league } of saltedOrder([...hop1Leagues.values()], (x) => x.league.league_id, salt, "hop2-leagues").slice(0, HOP2_LEAGUES)) {
    for (const u of await members(league.league_id)) if (!hop1Users.has(u)) hop2Users.add(u);
  }
  const hop2Leagues = await collect([...hop2Users], "hop2-users", HOP2_USERS_WITH_LEAGUES, hop1Leagues);

  // Candidates: qualifying hop-2 leagues (hop-1 ones only if hop 2 found none), in salted order.
  const qualify = (m: Map<string, { league: SleeperLeague; userId: string }>) => [...m.values()].filter((c) => isFallbackCandidate(c.league, season));
  const pool = qualify(hop2Leagues).length ? qualify(hop2Leagues) : qualify(hop1Leagues);
  const candidates = saltedOrder(pool, (c) => c.league.league_id, salt, "candidates");
  if (!candidates.length) return { mode: "fallback", leagueId: "", userId: null, notes: [], failure: "no in-season 10–12 team public league found by the discovery walk" };

  // Prefer a league that exercises trades, IR, K and DEF slots and has no orphan teams (rosters + transactions).
  let best: { c: (typeof candidates)[number]; score: number; why: string } | null = null;
  let checked = 0;
  for (const c of candidates.slice(0, CANDIDATES_CHECKED)) {
    const id = c.league.league_id;
    const rosters = await fetchJson<SleeperRoster[]>(p, endpoints.rosters(id));
    if (!rosters.ok || !Array.isArray(rosters.data)) continue;
    checked++;
    for (const r of rosters.data) watch.addRoster(r);
    const ir = rosters.data.some((r) => (r.reserve?.length ?? 0) > 0);
    const orphans = rosters.data.filter((r) => !r.owner_id).length;
    let trades = 0;
    for (let w = 1; w <= currentWeek; w++) {
      const tx = await fetchJson<SleeperTransaction[]>(p, endpoints.transactions(id, w));
      if (tx.ok && Array.isArray(tx.data)) trades += tx.data.filter((t) => t.type === "trade" && t.status === "complete").length;
    }
    const kDef = c.league.roster_positions.includes("K") && c.league.roster_positions.includes("DEF");
    const score = (trades > 0 ? 4 : 0) + (ir ? 2 : 0) + (orphans === 0 ? 2 : 0) + (kDef ? 2 : 0) + (c.league.total_rosters === 12 ? 1 : 0);
    const desc = `${c.league.total_rosters} teams, ${trades} completed trade(s) in weeks 1–${currentWeek}, IR ${ir ? "used" : "unused"}, K+DEF slots ${kDef ? "yes" : "no"}, ${orphans} orphan roster(s); candidate ${checked} of ${candidates.length}`;
    if (!best || score > best.score) best = { c, score, why: desc };
    if (trades > 0 && ir && orphans === 0 && kDef) break;
  }
  if (!best) return { mode: "fallback", leagueId: "", userId: null, notes: [], failure: "could not read rosters of any candidate league" };

  const choice: SavedFallback = { leagueId: best.c.league.league_id, userId: best.c.userId, chosenAt: new Date().toISOString(), why: best.why, salt, method: METHOD };
  await writeFileAtomic(FALLBACK_FILE, JSON.stringify(choice, null, 2));
  const userLookup = await lookupUser(p, disc, watch, choice.userId);
  return { mode: "fallback", leagueId: choice.leagueId, userId: choice.userId, userLookup, notes: ["chosen by a salted random walk over public league member lists (salt kept only in the git-ignored choice file)"] };
}

/** The fallback "me" user's object: a fixture for the Phase 1 user lookup. */
async function lookupUser(p: ProbeContext, disc: Redactor, watch: Watchlist, userId: string): Promise<Fetched<SleeperUser>> {
  const userLookup = await fetchJson<SleeperUser>(p, endpoints.userById(userId));
  if (userLookup.ok && userLookup.data?.user_id) {
    registerUserIdentity(disc, userLookup.data);
    watch.addUser(userLookup.data);
  }
  return userLookup;
}

function readSaved(): SavedFallback | null {
  if (!existsSync(FALLBACK_FILE)) return null;
  try {
    const s = JSON.parse(readFileSync(FALLBACK_FILE, "utf8")) as Partial<SavedFallback>;
    return s.leagueId && s.userId ? { leagueId: s.leagueId, userId: s.userId, chosenAt: s.chosenAt ?? "", why: s.why ?? "", salt: s.salt, method: s.method } : null;
  } catch {
    return null;
  }
}

function uniqueMatches(text: string, re: RegExp): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(re)) if (m[1] && !out.includes(m[1])) out.push(m[1]);
  return out;
}
