/**
 * Which Fleaflicker league(s) the probe uses (CLAUDE.md §17 Phase 0 step 3):
 *   1. FLEAFLICKER_LEAGUE_ID from .env.local (Parker's league), else
 *   2. the pinned public test league in fixtures/raw/fleaflicker/test-league.json, else — only
 *      with --allow-crawl (CLAUDE.md §0.6: no new crawls of strangers' leagues without asking
 *      Parker first) —
 *   3. candidates in fixtures/raw/fleaflicker/candidates.json, else
 *   4. a public league listing (public membership, full, 10–12 teams).
 * Candidates are screened with FetchLeagueStandings: active this season, games played. Without
 * --allow-crawl a pinned league is never swapped for another (even when it fails its screen) and no
 * candidate or listing is requested; the probe then reports its checks as untested.
 *
 * Privacy (CLAUDE.md §0.6): strangers' leagues must not be re-identifiable from committed text. The
 * order in which candidates are tried is shuffled with a random salt kept only in the git-ignored
 * pin file, how a league was found is recorded only there, and the committed report describes the
 * leagues generically. League ids live only in git-ignored files and are registered with the
 * Redactor (or as transient ids) before any request. `--rediscover` (with --allow-crawl) skips the
 * pin and candidates.
 */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { sha256, writeFileAtomic } from "../cache";
import { ROOT } from "../env";
import type { ProbeContext } from "../probe";
import { enumOr, num, standingsSchema, type FfStandings } from "./api";
import { FfClient, cacheableStatus, type Fetched } from "./client";
import type { FleaIdentities } from "./identities";
import type { WatchList } from "./watchlist";

export const RAW_DIR = path.join(ROOT, "fixtures", "raw", "fleaflicker");
const PIN_FILE = path.join(RAW_DIR, "test-league.json");
const CANDIDATES_FILE = path.join(RAW_DIR, "candidates.json");
export const DIRECTORY_URL = "https://www.fleaflicker.com/nfl/leagues?filter=KEEPER&filter=DRAFTED";

export interface PickedLeague {
  id: string;
  role: "primary" | "oracle";
  label: string;
  access: string;
  /** Generic, placeholder-only text for the committed report (details stay in the pin file). */
  source: string;
}

export interface Screen {
  ok: boolean;
  status: number | undefined;
  teams: number;
  /** Fewest decided games of any team. */
  gamesPlayed: number;
  /** Most decided games of any team. */
  maxGames: number;
  /** Teams with a postseason record (wins/losses/ties). */
  postseasonTeams: number;
  /** `season` in the response. */
  season: number | undefined;
  active: boolean;
  drafted: boolean;
  maxKeepers: number;
  rosterSize: number;
  reason?: string;
}

interface PinFile {
  note?: string;
  /** Random secret mixed into every candidate ordering (never committed). */
  salt?: string;
  primary?: { id: number | string; method?: string };
  oracle?: { id: number | string; method?: string };
  [key: string]: unknown;
}

function readJson<T>(file: string): T | null {
  try {
    return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as T) : null;
  } catch {
    return null;
  }
}

/** The pin file's salt, created (and saved, git-ignored) on first use. */
export async function ensureSalt(file = PIN_FILE): Promise<string> {
  const pin = readJson<PinFile>(file) ?? { note: "Pinned public test leagues for probe-fleaflicker (git-ignored; never commit). To pick again (after asking Parker: a new pick crawls strangers' leagues), run with --rediscover --allow-crawl." };
  if (typeof pin.salt === "string" && pin.salt.length >= 16) return pin.salt;
  pin.salt = randomBytes(16).toString("hex");
  await writeFileAtomic(file, JSON.stringify(pin, null, 2));
  return pin.salt;
}

/** Candidate ids in an order that only the salt holder can reproduce. */
export function saltedOrder(ids: readonly string[], salt: string): string[] {
  return [...new Set(ids)].map((id) => ({ id, k: sha256(`${salt}:${id}`) })).sort((a, b) => a.k.localeCompare(b.k)).map((x) => x.id);
}

/**
 * One FetchLeagueStandings call; aggregates only (identities are not swept or printed). `offline`
 * serves it from the HTTP cache only (a stranger's league that isn't the pinned test league).
 */
export async function screenLeague(p: ProbeContext, ids: FleaIdentities, id: string, season: number, opts: { offline?: boolean } = {}): Promise<{ screen: Screen; fetched: Fetched<FfStandings> }> {
  ids.transientLeagueId(id);
  const f = await new FfClient(p, ids, id, "screen", { offline: opts.offline }).get<FfStandings>("FetchLeagueStandings", { season }, standingsSchema, { sweep: false });
  const empty: Screen = { ok: false, status: f.res?.status, teams: 0, gamesPlayed: 0, maxGames: 0, postseasonTeams: 0, season: undefined, active: false, drafted: false, maxKeepers: 0, rosterSize: 0 };
  if (!f.data) return { screen: { ...empty, reason: f.error ?? "no data" }, fetched: f };
  const teams = (f.data.divisions ?? []).flatMap((d) => d.teams ?? []);
  const games = teams.map((t) => num(t.recordOverall?.wins) + num(t.recordOverall?.losses) + num(t.recordOverall?.ties));
  const lg = f.data.league;
  const s: Screen = {
    ...empty,
    teams: teams.length,
    gamesPlayed: games.length ? Math.min(...games) : 0,
    maxGames: games.length ? Math.max(...games) : 0,
    postseasonTeams: teams.filter((t) => num(t.recordPostseason?.wins) + num(t.recordPostseason?.losses) + num(t.recordPostseason?.ties) > 0).length,
    season: f.data.season,
    active: lg.activeForCurrentSeason === true,
    drafted: enumOr(lg.draftStatus, "DraftStatus") === "POST_DRAFT",
    maxKeepers: num(lg.maxKeepers),
    rosterSize: num(lg.rosterRequirements?.rosterSize),
  };
  if (!s.active) s.reason = "not active for the current season (the API then returns last season's data)";
  else if (s.gamesPlayed < 1) s.reason = "no games played yet";
  else if (s.teams < 8) s.reason = `only ${s.teams} teams`;
  s.ok = !s.reason;
  return { screen: s, fetched: f };
}

/** Parse a public league listing: public, full leagues of 10–12 teams (ids only). */
export function parseDirectory(html: string): string[] {
  const out: string[] = [];
  for (const row of html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) ?? []) {
    const id = /\/nfl\/leagues\/(\d+)/.exec(row)?.[1];
    if (!id) continue;
    const text = row.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    const members = /(\d+)\s*\/\s*(\d+)/.exec(text);
    if (!/\bPublic\b/.test(text) || !members) continue;
    const [have, cap] = [Number(members[1]), Number(members[2])];
    if (have === cap && cap >= 10 && cap <= 12 && !out.includes(id)) out.push(id);
  }
  return out;
}

export interface Resolution {
  primary: PickedLeague | null;
  oracle: PickedLeague | null;
  /** Screens made while choosing (source is generic: pinned / candidate / listing). */
  screened: Array<{ source: string; screen: Screen }>;
  log: string[];
  salt: string;
  /** No usable league without discovering one, which needs --allow-crawl (report as untested). */
  needsCrawl?: boolean;
}

const PINNED_SOURCE = "pinned public test league (how it was found is recorded only in the git-ignored pin file)";

/**
 * Discovery (candidates, the public listing, --rediscover) runs only when `allowCrawl`; otherwise
 * the pinned league is the only candidate and nothing else is requested.
 */
export async function resolveLeagues(p: ProbeContext, ids: FleaIdentities, opts: { season: number; rediscover: boolean; watch: WatchList; allowCrawl: boolean }): Promise<Resolution> {
  const salt = await ensureSalt();
  const out: Resolution = { primary: null, oracle: null, screened: [], log: [], salt };
  const rediscover = opts.rediscover && opts.allowCrawl;
  if (opts.rediscover && !opts.allowCrawl) out.log.push("--rediscover ignored: picking another public league needs --allow-crawl (ask Parker first); the pinned league is used.");
  const pin = rediscover ? null : readJson<PinFile>(PIN_FILE);
  const envId = p.env("FLEAFLICKER_LEAGUE_ID");
  const screenedData: Array<{ id: string; data: FfStandings | null }> = [];

  if (envId) {
    ids.leagueId(envId);
    out.primary = { id: envId, role: "primary", label: "Parker's league", access: "public API, no login", source: ".env.local FLEAFLICKER_LEAGUE_ID" };
    out.log.push("FLEAFLICKER_LEAGUE_ID is set: using Parker's league.");
  } else {
    out.log.push("FLEAFLICKER_LEAGUE_ID is blank: using a public test league.");
    let method = "";
    const tryPick = async (id: string, source: string, how: string): Promise<boolean> => {
      const { screen, fetched } = await screenLeague(p, ids, id, opts.season);
      out.screened.push({ source, screen });
      screenedData.push({ id, data: fetched.data });
      if (!screen.ok) return false;
      ids.leagueId(id); // its data is saved (sanitized), so it joins the redaction map as League 1
      method = how;
      out.primary = { id, role: "primary", label: "public test league", access: "public API, no login", source: source === "pinned" ? PINNED_SOURCE : "public test league chosen this run (selection details only in the git-ignored pin file)" };
      return true;
    };
    if (pin?.primary?.id !== undefined) await tryPick(String(pin.primary.id), "pinned", pin.primary.method ?? "pinned test league");
    if (!out.primary && !opts.allowCrawl) {
      out.needsCrawl = true;
      out.log.push(pin?.primary?.id !== undefined ? "The pinned public test league failed its screen; picking another needs --allow-crawl (ask Parker first)." : "No public test league is pinned; finding one needs --allow-crawl (ask Parker first).");
    }
    if (!out.primary && opts.allowCrawl && !rediscover) {
      const cands = (readJson<{ candidates?: Array<number | string> }>(CANDIDATES_FILE)?.candidates ?? []).map(String);
      for (const c of saltedOrder(cands, salt).slice(0, 12)) {
        if (c === String(pin?.primary?.id) || c === String(pin?.oracle?.id)) continue;
        if (await tryPick(c, "candidate", "candidate list (candidates.json), screened via FetchLeagueStandings")) break;
      }
    }
    if (!out.primary && opts.allowCrawl) {
      const res = await p.request(DIRECTORY_URL, { label: "Fleaflicker public league listing", cache: p.leagueCache(DIRECTORY_URL), cacheIf: cacheableStatus });
      await p.saveRaw("directory:listing", res.text, res, ".html");
      const found = res.ok ? parseDirectory(res.text) : [];
      out.log.push(`Public league listing: HTTP ${res.status}, ${found.length} leagues pass the membership/size filter.`);
      for (const id of saltedOrder(found, salt).slice(0, 6)) if (await tryPick(id, "listing", `public league listing ${DIRECTORY_URL}, salted order, screened via FetchLeagueStandings`)) break;
    }
    if (out.primary && (pin?.primary?.id === undefined || String(pin.primary.id) !== out.primary.id)) {
      const current = readJson<PinFile>(PIN_FILE) ?? {};
      const next: PinFile = {
        ...current,
        note: "Pinned public test leagues for probe-fleaflicker (git-ignored; never commit). To pick again (after asking Parker: a new pick crawls strangers' leagues), run with --rediscover --allow-crawl.",
        salt,
        pickedAt: new Date().toISOString().slice(0, 10),
        primary: { id: out.primary.id, method },
      };
      await writeFileAtomic(PIN_FILE, JSON.stringify(next, null, 2));
      out.log.push("Pinned the chosen test league (git-ignored).");
    }
  }

  if (pin?.oracle?.id !== undefined && String(pin.oracle.id) !== out.primary?.id) {
    ids.leagueId(String(pin.oracle.id));
    out.oracle = { id: String(pin.oracle.id), role: "oracle", label: "second public test league (scoring oracle only)", access: "public API, no login", source: PINNED_SOURCE };
  }
  // Screened leagues we don't use are never sanitized: watch their identities instead.
  for (const s of screenedData) if (s.id !== out.primary?.id && s.id !== out.oracle?.id) opts.watch.addStandings(s.data, s.id);
  return out;
}

/** Other candidate leagues (for scoring-rule coverage only), in salted order. */
export function coverageCandidates(exclude: readonly string[], salt: string): string[] {
  const cands = (readJson<{ candidates?: Array<number | string> }>(CANDIDATES_FILE)?.candidates ?? []).map(String);
  return saltedOrder(cands, salt).filter((c) => !exclude.includes(c));
}

/** Every candidate id we know of (for the watch list). */
export function allCandidateIds(): string[] {
  return (readJson<{ candidates?: Array<number | string> }>(CANDIDATES_FILE)?.candidates ?? []).map(String);
}
