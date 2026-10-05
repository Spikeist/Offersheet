/**
 * The shared cache's numbers, offline (planner reply to Checkpoint 4c, Part B, B1: "Shared server cache … single-flight
 * fetches, hashed keys"; track CA; the free-tier table of Checkpoint 7a):
 *
 *   npm run measure:cache
 *
 * Reads this computer's .cache/app (the file cache, read only: nothing is written there or to data-local/) and the
 * newest saved dump of Parker's league (data-local/parker-league-*: only its league id and season, to find the cached
 * ESPN bodies), and runs the app's own code through an in-memory Redis (src/server/redis.ts FakeRedis, which counts
 * commands and bytes):
 *
 * 1. Proof on every cached full-size body: each fetch-time reducer's consumers read exactly the same from the reduced
 *    form as from the raw body (src/data/reduce.ts; the loaders, the pre-game archive, the Sleeper import, the
 *    crosswalk's sources), compared with node's isDeepStrictEqual, plus the sizes and the reducer's own time.
 * 2. Bytes per entry type: as the file cache stores it, as RedisCache stores it (gzip + base64) raw, and reduced.
 * 3. Sessions through the shared cache (TieredCache: memory, then FakeRedis; the cross-instance lock): one ESPN session
 *    (Parker's league: the Connect import, then the League page's model build) and one Sleeper session (the public test
 *    league, sanitized, in data-local/), each "before" (no reducers) and "after": Redis commands and bytes, live fetches
 *    and CPU, for a cold Redis (the day's first visitor), a new instance (Redis warm, memory empty), a warm instance
 *    (the same league within its 10 minutes) and a warm instance with a new league (review CA-3: its league data gone
 *    from memory and Redis, the league-independent data still warm).
 * 4. Keeping league-independent data fresh (review CA-3): per league shape (each position set's projections and stats,
 *    each FantasyCalc format) and for what every league shares, the refreshes a day the entries' own TTLs allow at most
 *    (if someone asks all day), with the Redis commands and bytes each costs.
 * 5. CPU of a model build, and of the crosswalk's cold build, from cached raw bodies vs reduced ones.
 *
 * Bytes are what each Redis command carries: with src/server/redis.ts's plain JSON answers (review CA-2) that is the
 * wire's size too, give or take a few bytes of JSON per command (stored values are base64 or JSON text, which JSON
 * carries unescaped). Every body is read from .cache/app once, before anything is timed (review CA-11), so the CPU
 * columns hold the app's work only (a live fetch's answer is a string already in memory).
 *
 * Offline by construction: every client it builds gets a fetch that serves .cache/app's copies (and the test league's
 * sanitized bodies), the global fetch is replaced by one that refuses, and it never asks for a real Redis (no --live, no
 * Upstash, no environment variables read). It prints counts, sizes and timings only: never an id, a name, a key, a URL
 * or a body.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { isDeepStrictEqual } from "node:util";
import { gzipSync } from "node:zlib";
import { importEspnLeague, importEspnLeagueForModel } from "@/adapters/espn";
import { importSleeperLeague, normalizeSleeperLeague, sleeperUrls } from "@/adapters/sleeper";
import type { HttpClient, HttpRequestOptions, HttpResponse } from "@/adapters/types";
import { loadPlayerIdResolver, resolverFromData } from "@/data";
import { DYNASTYPROCESS_IDS_URL, DYNASTYPROCESS_REDUCER, parseDynastyProcessCsv } from "@/data/dynastyProcess";
import { FANTASYCALC_PLAYERS_URL, fantasyCalcPlayersSchema, reduceFantasyCalcPlayers } from "@/data/fantasyCalcPlayers";
import { fantasyCalcValuesUrl } from "@/data/fantasyCalcValues";
import { nflScheduleCacheKey } from "@/data/nflSchedule";
import { IMPORT_PROJECTIONS_REDUCER, MODEL_PROJECTIONS_REDUCER, REDUCER_ID, SEASON_PROJECTIONS_REDUCER, STATS_REDUCER, type BodyReducer } from "@/data/reduce";
import { fetchSleeperPlayers, SLEEPER_PLAYER_POSITIONS, SLEEPER_PLAYERS_REDUCER, sleeperPlayersUrl } from "@/data/sleeperPlayers";
import { loadSleeperSeasonProjections, loadSleeperStats, loadSleeperWeeklyProjections, sleeperGate, sleeperSeasonProjectionsUrl, sleeperStatsUrl } from "@/data/sleeperProjections";
import type { Pos } from "@/engine/model";
import { DAY, encodeSharedEntry, MemoryCache, MemoryLruCache, RedisCache, RedisCacheLock, TieredCache, type Cache, type CacheEntry, type MemoryTier } from "@/server/cache";
import { cacheStoreKey, createHttpClient, quoteBigInts } from "@/server/http";
import { buildModelInputs } from "@/server/modelInputs";
import { archivedGroups, lastModifiedById } from "@/server/projectionArchive";
import { FakeRedis } from "@/server/redis";
import { ROOT } from "./lib/env";
import { isMainModule, listDumps, newestDump } from "./lib/runMode";

const APP_DIR = path.join(ROOT, ".cache", "app");
const SLEEPER_FIXTURES = path.join(ROOT, "data-local", "fixtures-sanitized", "sleeper");
const SEASON = 2026;
/** A made-up secret for FakeRedis's hidden keys (never a real one; nothing leaves this process). */
const SHARED_ENV = { SESSION_SECRET: "measure-cache: a made-up secret, never a real one", VERCEL_ENV: "preview" } as const;
const POS6: Pos[] = ["QB", "RB", "WR", "TE", "K", "DEF"];
const POS_SETS: Pos[][] = [POS6, [...POS6, "DL", "LB", "DB"], ["QB", "RB", "WR", "TE"], ["QB", "RB", "WR", "TE", "K"], ["QB", "RB", "WR", "TE", "DEF"]];
/** A reduced body's key suffix (src/data/reduce.ts reducedKey, reducerId). */
const REDUCED_SUFFIX = new RegExp(`#${REDUCER_ID.source.replace(/^\^/, "")}`);
const NOW = new Date();
/**
 * Upstash's free plan (Checkpoint 7a's research): 500K commands and 10 GB of bandwidth a month, over 30 days. ⚠️ The
 * research reads the bandwidth as reads and writes together; Upstash's pages don't say which.
 */
const FREE_COMMANDS_PER_DAY = 500_000 / 30;
const FREE_BYTES_PER_DAY = 10e9 / 30;

// ---------------------------------------------------------------------------------------------
// Reading .cache/app (the file cache: <sha256(key)>.json holding { storedAt, expiresAt, value })

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

interface AppEntry {
  text: string;
  contentType: string;
  fileBytes: number;
  storedAt: number;
  expiresAt: number;
}

function readAppFile(file: string): AppEntry | undefined {
  try {
    const env = JSON.parse(readFileSync(file, "utf8")) as { storedAt?: unknown; expiresAt?: unknown; value?: { text?: unknown; contentType?: unknown } };
    const v = env.value;
    if (!v || typeof v.text !== "string") return undefined;
    return {
      text: v.text,
      contentType: typeof v.contentType === "string" ? v.contentType : "",
      fileBytes: statSync(file).size,
      storedAt: typeof env.storedAt === "number" ? env.storedAt : 0,
      expiresAt: typeof env.expiresAt === "number" ? env.expiresAt : 0,
    };
  } catch {
    return undefined;
  }
}

/** .cache/app's entries by file name (sha256 of the key, less ".json"), read once before anything is timed (review CA-11). */
let appIndex: Map<string, AppEntry> | undefined;

function loadAppIndex(): Map<string, AppEntry> {
  if (appIndex) return appIndex;
  appIndex = new Map();
  for (const name of existsSync(APP_DIR) ? readdirSync(APP_DIR) : []) {
    if (!name.endsWith(".json")) continue;
    const e = readAppFile(path.join(APP_DIR, name));
    if (e) appIndex.set(name.slice(0, -".json".length), e);
  }
  return appIndex;
}

/** The cached copy under a format-1 key (the request's own key), whatever its age: a lookup in memory. */
function readApp(key: string): AppEntry | undefined {
  return loadAppIndex().get(sha256(key));
}

const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
const mb = (n: number) => `${(n / 1024 / 1024).toFixed(2)} MB`;
const gz = (s: string) => gzipSync(Buffer.from(s, "utf8"), { level: 6 }).length;
const ms = (n: number) => `${n.toFixed(0)} ms`;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s[Math.floor(s.length / 2)] as number) : Number.NaN;
}

/** CPU (user + system) and wall time of `fn`, in ms. */
async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; cpuMs: number; wallMs: number }> {
  const c0 = process.cpuUsage();
  const t0 = performance.now();
  const value = await fn();
  const c = process.cpuUsage(c0);
  return { value, cpuMs: (c.user + c.system) / 1000, wallMs: performance.now() - t0 };
}

/** An HttpClient that answers every request with one body (a consumer's view of a cached copy), as the real client parses it. */
function oneBody(text: string, bigInts: boolean): HttpClient {
  return {
    async get(): Promise<HttpResponse> {
      return { status: 200, ok: true, isHtml: false, json: JSON.parse(bigInts ? quoteBigInts(text) : text), text, fromCache: false };
    },
  };
}

/** An HttpClient that serves bodies by URL (404 otherwise), parsed as the real client would. */
function bodiesByUrl(bodies: ReadonlyMap<string, string>, bigInts: boolean): HttpClient {
  return {
    async get(url: string): Promise<HttpResponse> {
      const text = bodies.get(url);
      if (text === undefined) return { status: 404, ok: false, isHtml: false, json: null, text: "", fromCache: false };
      return { status: 200, ok: true, isHtml: false, json: JSON.parse(bigInts ? quoteBigInts(text) : text), text, fromCache: false };
    },
  };
}

// ---------------------------------------------------------------------------------------------
// The public test league (Sleeper), sanitized, in data-local/ (git-ignored): label → body

function sleeperFixture(): Map<string, unknown> | null {
  const index = path.join(SLEEPER_FIXTURES, "index.json");
  if (!existsSync(index)) return null;
  const out = new Map<string, unknown>();
  for (const [file, meta] of Object.entries(JSON.parse(readFileSync(index, "utf8")) as Record<string, { label: string }>)) {
    try {
      out.set(meta.label, JSON.parse(readFileSync(path.join(SLEEPER_FIXTURES, file), "utf8")));
    } catch {
      // a file that doesn't read is left out
    }
  }
  return out;
}

const FIXTURE_LEAGUE_ID = "1000000000000000001";
const SLEEPER_STATE = path.join(ROOT, "fixtures", "sanitized", "sleeper");

/** The committed Sleeper state (week 4 of 2026), as the import reads it. */
function sleeperStateText(): string | undefined {
  const index = path.join(SLEEPER_STATE, "index.json");
  if (!existsSync(index)) return undefined;
  for (const [file, meta] of Object.entries(JSON.parse(readFileSync(index, "utf8")) as Record<string, { label: string }>)) {
    if (meta.label === "state/nfl") return readFileSync(path.join(SLEEPER_STATE, file), "utf8");
  }
  return undefined;
}

/** The test league's body for a Sleeper URL (league data, by its path), or undefined. */
function leagueBodyFor(fixture: Map<string, unknown> | null, url: string): string | undefined {
  const u = new URL(url);
  if (u.pathname === "/v1/state/nfl") return sleeperStateText();
  const m = /^\/v1\/league\/[^/]+(\/.*)?$/.exec(u.pathname);
  if (!m || !fixture) return undefined;
  const body = fixture.get(`public-test-league/league/{leagueId}${m[1] ?? ""}`);
  return body === undefined ? undefined : JSON.stringify(body);
}

// ---------------------------------------------------------------------------------------------
// 1. Proof on every cached full-size body

interface Proof {
  type: string;
  bodies: number;
  equal: number;
  rawBytes: number;
  rawGzip: number;
  reducedBytes: number;
  reducedGzip: number;
  reduceMs: number;
}

function proof(type: string): Proof {
  return { type, bodies: 0, equal: 0, rawBytes: 0, rawGzip: 0, reducedBytes: 0, reducedGzip: 0, reduceMs: 0 };
}

function reduceTimed(reducer: BodyReducer, raw: string, p: Proof): string {
  const t0 = performance.now();
  const reduced = reducer.reduce(raw);
  p.reduceMs += performance.now() - t0;
  p.bodies++;
  p.rawBytes += Buffer.byteLength(raw);
  p.rawGzip += gz(raw);
  p.reducedBytes += Buffer.byteLength(reduced);
  p.reducedGzip += gz(reduced);
  return reduced;
}

/** One model build's read of a week: the loader's result and what the pre-game archive files from it. */
async function modelRead(text: string, week: number, positions: Pos[]) {
  const archived: unknown[] = [];
  const load = await loadSleeperWeeklyProjections(sleeperGate(oneBody(text, true), NOW), SEASON, [week], positions, {
    currentWeek: 4,
    onWeek: (w) => archived.push(archivedGroups(w.rows, w.positions, lastModifiedById(w.res.json))),
  });
  return { load, archived };
}

interface CachedWeek {
  week: number;
  positions: Pos[];
  text: string;
}

function cachedWeeks(): CachedWeek[] {
  const out: CachedWeek[] = [];
  for (const positions of POS_SETS)
    for (let week = 1; week <= 18; week++) {
      const e = readApp(`sleeper:${sleeperUrls.projections(SEASON, week, positions)}`);
      if (e) out.push({ week, positions, text: e.text });
    }
  return out;
}

async function proofs(): Promise<{ results: Proof[]; resolver: ReturnType<typeof resolverFromData> | null }> {
  const results: Proof[] = [];
  const weeks = cachedWeeks();

  // Weekly projections, the model's form: the loader and the pre-game archive.
  const model = proof("Sleeper weekly projections, model form (loader + pre-game archive)");
  for (const w of weeks) {
    const reduced = reduceTimed(MODEL_PROJECTIONS_REDUCER, w.text, model);
    if (isDeepStrictEqual(await modelRead(reduced, w.week, w.positions), await modelRead(w.text, w.week, w.positions))) model.equal++;
  }
  results.push(model);

  // The crosswalk's sources (also the resolver the import proof uses).
  const players = proof("Sleeper players lists (fetchSleeperPlayers → the crosswalk)");
  const rawLists = new Map<string, string>();
  const reducedLists = new Map<string, string>();
  for (const position of SLEEPER_PLAYER_POSITIONS) {
    const e = readApp(`sleeper:${sleeperPlayersUrl(position)}`);
    if (!e) continue;
    rawLists.set(sleeperPlayersUrl(position), e.text);
    reducedLists.set(sleeperPlayersUrl(position), reduceTimed(SLEEPER_PLAYERS_REDUCER, e.text, players));
  }
  let resolver: ReturnType<typeof resolverFromData> | null = null;
  if (rawLists.size) {
    const [a, b] = [await fetchSleeperPlayers(bodiesByUrl(rawLists, false)), await fetchSleeperPlayers(bodiesByUrl(reducedLists, false))];
    if (isDeepStrictEqual(a, b)) players.equal = players.bodies;
    const dp = readApp(`dynastyprocess:${DYNASTYPROCESS_IDS_URL}`);
    const fc = readApp(`fantasycalc:${FANTASYCALC_PLAYERS_URL}`);
    resolver = resolverFromData({
      sleeperPlayers: a.players,
      sleeperCompletePositions: a.complete,
      dynastyRows: dp ? parseDynastyProcessCsv(dp.text) : null,
      fantasyCalcPlayers: fc ? reduceFantasyCalcPlayers(fantasyCalcPlayersSchema.parse(JSON.parse(fc.text))) : null,
    });
  }
  results.push(players);

  const dynasty = proof("DynastyProcess ID map (parseDynastyProcessCsv → the crosswalk)");
  const dp = readApp(`dynastyprocess:${DYNASTYPROCESS_IDS_URL}`);
  if (dp) {
    const reduced = reduceTimed(DYNASTYPROCESS_REDUCER, dp.text, dynasty);
    if (isDeepStrictEqual(parseDynastyProcessCsv(reduced), parseDynastyProcessCsv(dp.text))) dynasty.equal++;
  }
  results.push(dynasty);

  // Weekly projections, the import's form: normalizeSleeperLeague on the test league, three cached weeks at a time.
  const imported = proof("Sleeper weekly projections, import form (normalizeSleeperLeague)");
  const fixture = sleeperFixture();
  const state = sleeperStateText();
  if (fixture && state && resolver) {
    const label = (s: string) => fixture.get(`public-test-league/league/{leagueId}${s}`);
    const matchups: Record<number, unknown> = {};
    for (let w = 1; w <= 14; w++) if (label(`/matchups/${w}`) !== undefined) matchups[w] = label(`/matchups/${w}`);
    const transactions: Record<number, unknown> = {};
    for (let leg = 1; leg <= 4; leg++) if (label(`/transactions/${leg}`) !== undefined) transactions[leg] = label(`/transactions/${leg}`);
    const base = { state: JSON.parse(state) as unknown, league: label(""), users: label("/users"), rosters: label("/rosters"), matchups, transactions, tradedPicks: label("/traded_picks"), drafts: label("/drafts") };
    const six = weeks.filter((w) => isDeepStrictEqual(w.positions, POS6));
    const byWeek = new Map(six.map((w) => [w.week, w.text]));
    const reducedByWeek = new Map(six.map((w) => [w.week, reduceTimed(IMPORT_PROJECTIONS_REDUCER, w.text, imported)]));
    let windows = 0;
    let windowsEqual = 0;
    for (const w of six.map((x) => x.week)) {
      const span = [w, w + 1, w + 2].filter((x) => byWeek.has(x));
      if (span.length < 3) continue;
      const run = (texts: ReadonlyMap<number, string>) =>
        normalizeSleeperLeague({ ...base, projections: Object.fromEntries(span.map((x) => [x, JSON.parse(quoteBigInts(texts.get(x) as string))])), projectionWeek: w }, { now: NOW, resolver });
      windows++;
      if (isDeepStrictEqual(run(reducedByWeek), run(byWeek))) windowsEqual++;
    }
    // Every week counts as proven when every three-week window it's in came out the same.
    imported.equal = windows > 0 && windowsEqual === windows ? imported.bodies : 0;
    imported.type += ` [${windowsEqual}/${windows} three-week imports equal]`;
  }
  results.push(imported);

  const season = proof("Sleeper season projections (loadSleeperSeasonProjections)");
  for (const positions of POS_SETS) {
    const e = readApp(`sleeper:${sleeperSeasonProjectionsUrl(SEASON, positions)}`);
    if (!e) continue;
    const reduced = reduceTimed(SEASON_PROJECTIONS_REDUCER, e.text, season);
    const run = (text: string) => loadSleeperSeasonProjections(sleeperGate(oneBody(text, true), NOW), SEASON, positions);
    if (isDeepStrictEqual(await run(reduced), await run(e.text))) season.equal++;
  }
  results.push(season);

  const stats = proof("Sleeper weekly stats (loadSleeperStats)");
  for (const positions of POS_SETS)
    for (let week = 1; week <= 18; week++) {
      const e = readApp(`sleeper:${sleeperStatsUrl(SEASON, week, positions)}`);
      if (!e) continue;
      const reduced = reduceTimed(STATS_REDUCER, e.text, stats);
      const run = (text: string) => loadSleeperStats(sleeperGate(oneBody(text, true), NOW), SEASON, [week], positions);
      if (isDeepStrictEqual(await run(reduced), await run(e.text))) stats.equal++;
    }
  results.push(stats);
  return { results, resolver };
}

// ---------------------------------------------------------------------------------------------
// 2. Bytes per entry type

/** Every public key we know how to name, with its type (and the reducer that applies, if any). */
function knownKeys(): Map<string, { type: string; reducer?: BodyReducer }> {
  const out = new Map<string, { type: string; reducer?: BodyReducer }>();
  for (const positions of POS_SETS) {
    out.set(sha256(`sleeper:${sleeperSeasonProjectionsUrl(SEASON, positions)}`), { type: "Sleeper season projections", reducer: SEASON_PROJECTIONS_REDUCER });
    for (let w = 1; w <= 18; w++) {
      out.set(sha256(`sleeper:${sleeperUrls.projections(SEASON, w, positions)}`), { type: "Sleeper weekly projections (model form)", reducer: MODEL_PROJECTIONS_REDUCER });
      out.set(sha256(`sleeper:${sleeperStatsUrl(SEASON, w, positions)}`), { type: "Sleeper weekly stats", reducer: STATS_REDUCER });
    }
  }
  for (const p of SLEEPER_PLAYER_POSITIONS) out.set(sha256(`sleeper:${sleeperPlayersUrl(p)}`), { type: "Sleeper players lists", reducer: SLEEPER_PLAYERS_REDUCER });
  out.set(sha256(`dynastyprocess:${DYNASTYPROCESS_IDS_URL}`), { type: "DynastyProcess ID map", reducer: DYNASTYPROCESS_REDUCER });
  out.set(sha256(`fantasycalc:${FANTASYCALC_PLAYERS_URL}`), { type: "FantasyCalc /players (not reduced)" });
  for (const isDynasty of [false, true])
    for (const numQbs of [1, 2] as const)
      for (const numTeams of [8, 10, 12, 14])
        for (const ppr of [0, 0.5, 1] as const)
          for (const tep of [undefined, "te+", "te++"] as const) {
            out.set(sha256(`fantasycalc:${fantasyCalcValuesUrl({ isDynasty, numQbs, numTeams, ppr, ...(tep ? { tep } : {}) })}`), { type: "FantasyCalc value lists (not reduced)" });
          }
  for (const s of [SEASON - 1, SEASON]) out.set(sha256(nflScheduleCacheKey(s)), { type: "ESPN NFL schedule (not reduced)" });
  return out;
}

/** League data the keys of which hold ids: classified by shape (never printed). */
function leagueType(text: string): string {
  try {
    const j = JSON.parse(text) as unknown;
    if (Array.isArray(j)) return "Sleeper league data";
    const o = j as Record<string, unknown>;
    if (Array.isArray(o.transactions)) return "ESPN league data: transactions";
    if (Array.isArray(o.players) && !o.teams) return "ESPN league data: free agents and player cards";
    if (o.settings && Array.isArray(o.teams)) return "ESPN league data: league body";
    return "other";
  } catch {
    return "other (not JSON)";
  }
}

interface Bytes {
  n: number;
  file: number;
  sharedRaw: number;
  sharedReduced: number;
}

async function bytesByType(): Promise<Map<string, Bytes>> {
  const known = knownKeys();
  const out = new Map<string, Bytes>();
  for (const [name, e] of loadAppIndex()) {
    const k = known.get(name);
    const type = k?.type ?? leagueType(e.text);
    const value = { status: 200, contentType: e.contentType, text: e.text, fetchedAt: e.storedAt };
    const envelope = (text: string) => ({ storedAt: e.storedAt, expiresAt: e.expiresAt, value: { ...value, text } });
    const sharedRaw = (await encodeSharedEntry(envelope(e.text))).length;
    const sharedReduced = k?.reducer ? (await encodeSharedEntry(envelope(k.reducer.reduce(e.text)))).length : sharedRaw;
    const b = out.get(type) ?? { n: 0, file: 0, sharedRaw: 0, sharedReduced: 0 };
    b.n++;
    b.file += e.fileBytes;
    b.sharedRaw += sharedRaw;
    b.sharedReduced += sharedReduced;
    out.set(type, b);
    // The import's form of the same weekly projection bodies (a separate entry per import week).
    if (k?.reducer === MODEL_PROJECTIONS_REDUCER) {
      const t = "Sleeper weekly projections (import form, 3 weeks per import)";
      const i = out.get(t) ?? { n: 0, file: 0, sharedRaw: 0, sharedReduced: 0 };
      i.n++;
      i.file += e.fileBytes;
      i.sharedRaw += sharedRaw;
      i.sharedReduced += (await encodeSharedEntry(envelope(IMPORT_PROJECTIONS_REDUCER.reduce(e.text)))).length;
      out.set(t, i);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// 3. Sessions through the shared cache

/** How a request asked to be cached (HttpRequestOptions.cache), for the refresh arithmetic. Keys are never printed. */
interface RequestPolicy {
  ttlMs: number;
  retainMs: number;
  /** League-independent and locked across instances (cache.public) in any request of the key. */
  public: boolean;
}

/**
 * Where "live" answers come from: a request's cached copy in .cache/app (by its key, less any reducer's suffix), else the
 * test league's sanitized bodies. The wrapper notes the body for the request's URL (and ESPN's filter header) before the
 * request; the fetch serves it. It also notes each cache key's policy (`requests`).
 */
class Source {
  private readonly stash = new Map<string, { text: string; contentType: string }>();
  live = 0;
  missing = 0;
  bytesRead = 0;
  /** Every cache key requested, with its policy (the shortest TTL asked for, the longest retention). */
  readonly requests = new Map<string, RequestPolicy>();

  constructor(private readonly fixture: Map<string, unknown> | null) {}

  private note(c: NonNullable<HttpRequestOptions["cache"]>): void {
    const retainMs = Math.max(c.ttlMs, c.retainMs ?? c.ttlMs);
    const had = this.requests.get(c.key);
    this.requests.set(c.key, {
      ttlMs: Math.min(had?.ttlMs ?? c.ttlMs, c.ttlMs),
      retainMs: Math.max(had?.retainMs ?? retainMs, retainMs),
      public: (had?.public ?? false) || c.public === true,
    });
  }

  private static slot(url: string, headers: Record<string, string> | undefined): string {
    const filter = headers ? (Object.entries(headers).find(([k]) => k.toLowerCase() === "x-fantasy-filter")?.[1] ?? "") : "";
    return `${url}\n${filter}`;
  }

  /** Hosts of the requests nothing here could answer (a format or league no copy exists for): host names only. */
  readonly missingHosts = new Set<string>();

  readonly fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    this.live++;
    const hit = this.stash.get(Source.slot(String(input), init?.headers as Record<string, string> | undefined));
    if (!hit) {
      this.missing++;
      this.missingHosts.add(new URL(String(input)).host);
      return new Response("", { status: 404 });
    }
    return new Response(hit.text, { status: 200, headers: { "content-type": hit.contentType || "application/json" } });
  }) as unknown as typeof fetch;

  wrap(inner: HttpClient): HttpClient {
    return {
      get: async (url: string, opts?: HttpRequestOptions) => {
        if (opts?.cache) this.note(opts.cache);
        const key = opts?.cache?.key;
        const base = key?.replace(REDUCED_SUFFIX, "");
        const cached = base ? readApp(base) : undefined;
        const body = cached ? { text: cached.text, contentType: cached.contentType } : (() => {
          const t = leagueBodyFor(this.fixture, url);
          return t === undefined ? undefined : { text: t, contentType: "application/json" };
        })();
        if (body) this.stash.set(Source.slot(url, opts?.headers), body);
        const res = await inner.get(url, opts);
        this.bytesRead += res.text.length;
        return res;
      },
    };
  }
}

/** Today's committed behaviour: no fetch-time reducer (each reduced request goes back to its raw key and body). */
function asBefore(inner: HttpClient): HttpClient {
  return {
    get: (url, opts) => {
      if (!opts?.cache || !REDUCED_SUFFIX.test(opts.cache.key)) return inner.get(url, opts);
      const { transformText: _drop, ...rest } = opts;
      void _drop;
      return inner.get(url, { ...rest, cache: { ...opts.cache, key: opts.cache.key.replace(REDUCED_SUFFIX, "") } });
    },
  };
}

type Mode = "before" | "after";

/** FakeRedis that also notes each key's stored size (the bytes one refresh of that entry sends). */
class MeasuredRedis extends FakeRedis {
  readonly sizes = new Map<string, number>();
  override async set(key: string, value: string, opts: { px?: number; nx?: boolean } = {}): Promise<"OK" | null> {
    const res = await super.set(key, value, opts);
    if (res === "OK" && !opts.nx) this.sizes.set(key, Buffer.byteLength(value));
    return res;
  }
}

/** The Redis key RedisCache files a request's cache key under (format 1: the key itself; src/server/http.ts cacheStoreKey). */
const hiddenKey = (() => {
  const cache = new RedisCache(new FakeRedis(), { env: SHARED_ENV });
  return (key: string) => cache.storeKey(cacheStoreKey(key));
})();

/**
 * An instance's memory tier (MemoryLruCache) that can forget entries: the "new league" scenario drops a league's data
 * from it (and from Redis) and keeps the rest warm.
 */
class ForgetfulMemory implements MemoryTier {
  private readonly inner = new MemoryLruCache();
  private readonly forgotten = new Set<string>();

  forget(keys: Iterable<string>): void {
    for (const k of keys) this.forgotten.add(k);
  }

  get<T>(key: string, maxAgeMs: number, now?: number): Promise<CacheEntry<T> | undefined> {
    return this.forgotten.has(key) ? Promise.resolve(undefined) : this.inner.get<T>(key, maxAgeMs, now);
  }

  set<T>(key: string, value: T, retainMs: number, now?: number): Promise<void> {
    this.forgotten.delete(key);
    return this.inner.set(key, value, retainMs, now);
  }

  fill<T>(key: string, entry: CacheEntry<T>, now?: number): CacheEntry<T> | undefined {
    if (!this.forgotten.delete(key)) return this.inner.fill(key, entry, now);
    void this.inner.set(key, entry.value, entry.expiresAt - entry.storedAt, entry.storedAt); // in place of the forgotten copy
    return entry;
  }
}

/** One server instance on the shared FakeRedis: its own memory tier and HTTP client (and crosswalk memo), and the lock. */
function sharedInstance(source: Source, mode: Mode, redis: FakeRedis): { http: HttpClient; memory: ForgetfulMemory } {
  const memory = new ForgetfulMemory();
  const client = createHttpClient({
    cache: new TieredCache(memory, new RedisCache(redis, { env: SHARED_ENV })),
    lock: new RedisCacheLock(redis, { env: SHARED_ENV }),
    fetchImpl: source.fetchImpl,
    budget: null,
  });
  return { http: source.wrap(mode === "before" ? asBefore(client) : client), memory };
}

/** One server instance on a plain memory cache (no Redis): the CPU measurements. */
function plainInstance(source: Source, mode: Mode, cache: Cache): HttpClient {
  const client = createHttpClient({ cache, fetchImpl: source.fetchImpl, budget: null });
  return source.wrap(mode === "before" ? asBefore(client) : client);
}

interface EspnLeague {
  leagueId: string;
  season: number;
}

/** The public ESPN test league (CLAUDE.md §2.2: allowed to name). */
const ESPN_TEST_LEAGUE = "899513";

/**
 * An ESPN league whose league body .cache/app holds under its public key (ESPN keeps league data 10 minutes, so whichever
 * was imported last): Parker's (the newest saved dump's league) when it's there, else any other (never printed; only
 * whether it is Parker's or the public test league).
 */
function espnLeague(): (EspnLeague & { label: string }) | null {
  let parker: EspnLeague | null = null;
  const dump = newestDump(listDumps(ROOT));
  if (dump) {
    try {
      const s = JSON.parse(readFileSync(path.join(dump.dir, "snapshot.json"), "utf8")) as { platform?: string; leagueId?: string; season?: number };
      if (s.platform === "espn" && typeof s.leagueId === "string" && typeof s.season === "number") parker = { leagueId: s.leagueId, season: s.season };
    } catch {
      // no dump to read
    }
  }
  if (parker && readApp(`espn:public:${parker.season}:${parker.leagueId}:league`)) return { ...parker, label: "Parker's league" };
  for (const [name, e] of loadAppIndex()) {
    let body: { id?: unknown; seasonId?: unknown; settings?: unknown; teams?: unknown };
    try {
      body = JSON.parse(e.text) as typeof body;
    } catch {
      continue;
    }
    if (!body || !body.settings || !Array.isArray(body.teams) || typeof body.seasonId !== "number") continue;
    const league = { leagueId: String(body.id), season: body.seasonId };
    if (sha256(`espn:public:${league.season}:${league.leagueId}:league`) !== name) continue;
    return { ...league, label: league.leagueId === ESPN_TEST_LEAGUE ? `the public test league (${ESPN_TEST_LEAGUE})` : "a public ESPN league" };
  }
  return null;
}

/** The ESPN session: the Connect import, then the League page's model build (the model route imports again). */
async function espnSession(http: HttpClient, league: EspnLeague): Promise<void> {
  const deps = { http, resolver: await loadPlayerIdResolver({ http, now: NOW }), now: NOW };
  await importEspnLeague({ leagueId: league.leagueId, season: league.season }, deps);
  const got = await importEspnLeagueForModel({ leagueId: league.leagueId, season: league.season }, deps);
  await buildModelInputs({ snapshot: got.result.snapshot, http, resolver: deps.resolver, now: NOW, espn: got.espn, projectionArchive: null, fantasyCalcArchive: null });
}

/** The Sleeper session: the import by league ID, then the League page's model build. */
async function sleeperSession(http: HttpClient): Promise<void> {
  const deps = { http, resolver: await loadPlayerIdResolver({ http, now: NOW }), now: NOW };
  await importSleeperLeague({ season: SEASON, leagueId: FIXTURE_LEAGUE_ID }, deps);
  const again = await importSleeperLeague({ season: SEASON, leagueId: FIXTURE_LEAGUE_ID }, deps);
  await buildModelInputs({ snapshot: again.snapshot, http, resolver: deps.resolver, now: NOW, projectionArchive: null, fantasyCalcArchive: null });
}

interface SessionNumbers {
  scenario: string;
  commands: number;
  sentToRedis: number;
  receivedFromRedis: number;
  liveFetches: number;
  missing: number;
  cpuMs: number;
  parsed: number;
}

/** Whether a cache key holds the league's id as a whole number (league data), not as part of a longer one. */
function holdsLeague(key: string, leagueId: string): boolean {
  return new RegExp(`(^|[^0-9])${leagueId.replace(/[^0-9A-Za-z]/g, "")}([^0-9]|$)`).test(key);
}

/** A session kind's numbers per mode, and (after) what its first visitor stored: the refresh arithmetic's input. */
interface SessionRun {
  rows: Record<Mode, SessionNumbers[]>;
  requests: Map<string, RequestPolicy>;
  sizes: Map<string, number>;
}

async function sessions(kind: "ESPN" | "Sleeper", leagueId: string, run: (http: HttpClient) => Promise<void>, fixture: Map<string, unknown> | null, missingHosts: Set<string>): Promise<SessionRun> {
  const rows = {} as Record<Mode, SessionNumbers[]>;
  let requests = new Map<string, RequestPolicy>();
  let sizes = new Map<string, number>();
  for (const mode of ["before", "after"] as const) {
    const redis = new MeasuredRedis();
    const out: SessionNumbers[] = [];
    const scenario = async (label: string, http: HttpClient, source: Source) => {
      const s0 = { ...redis.stats };
      const live0 = source.live;
      const missing0 = source.missing;
      const read0 = source.bytesRead;
      const t = await timed(() => run(http));
      out.push({
        scenario: label,
        commands: redis.stats.commands - s0.commands,
        sentToRedis: redis.stats.bytesIn - s0.bytesIn,
        receivedFromRedis: redis.stats.bytesOut - s0.bytesOut,
        liveFetches: source.live - live0,
        missing: source.missing - missing0,
        cpuMs: t.cpuMs,
        parsed: source.bytesRead - read0,
      });
    };
    const source = new Source(fixture);
    await scenario(`${kind}: the day's first visitor (Redis empty, new instance)`, sharedInstance(source, mode, redis).http, source);
    if (mode === "after") {
      requests = new Map(source.requests);
      sizes = new Map(redis.sizes);
    }
    const second = sharedInstance(source, mode, redis);
    await scenario(`${kind}: a new instance (Redis warm, its memory empty)`, second.http, source);
    await scenario(`${kind}: the same instance again, the same league within its 10 minutes (memory warm)`, second.http, source);
    // A new league on a warm instance (review CA-3): its league data in neither memory nor Redis (the keys holding the
    // league's id: never printed), everything league-independent still in this instance's memory.
    const leagueKeys = [...source.requests.keys()].filter((k) => holdsLeague(k, leagueId));
    second.memory.forget(leagueKeys);
    for (const k of leagueKeys) await redis.del(hiddenKey(k));
    await scenario(`${kind}: the same instance, a new league (its league data cold, the rest warm)`, second.http, source);
    for (const host of source.missingHosts) missingHosts.add(host);
    rows[mode] = out;
  }
  return { rows, requests, sizes };
}

// ---------------------------------------------------------------------------------------------
// 4. Keeping league-independent data fresh (review CA-3)

/** Groups of league-independent entries by who shares them (a key's text is classified, never printed). */
function refreshGroup(key: string): { scope: "shape" | "sleeper" | "format" | "everyone"; label: string } | undefined {
  if (key.includes("#sleeper-proj-model-")) return { scope: "shape", label: "weekly projections, model form (one entry a week)" };
  if (key.includes("#sleeper-season-")) return { scope: "shape", label: "season projections" };
  if (key.includes("#sleeper-stats-")) return { scope: "shape", label: "weekly stats (one entry per finished week)" };
  if (key.includes("#sleeper-proj-import-")) return { scope: "sleeper", label: "weekly projections, the Sleeper import's form (3 weeks)" };
  if (key.startsWith("fantasycalc:") && key.includes("/values/current")) return { scope: "format", label: "FantasyCalc value list" };
  if (key.includes("#sleeper-players-")) return { scope: "everyone", label: "Sleeper players lists" };
  if (key.includes("#dynastyprocess-")) return { scope: "everyone", label: "DynastyProcess ID map" };
  if (key.startsWith("fantasycalc:") && key.endsWith("/players")) return { scope: "everyone", label: "FantasyCalc /players" };
  if (key.startsWith("espn:proTeamSchedules:")) return { scope: "everyone", label: "NFL schedule (ESPN)" };
  if (key.endsWith("/v1/state/nfl")) return { scope: "everyone", label: "Sleeper's NFL state" };
  return undefined;
}

interface RefreshRow {
  scope: "shape" | "sleeper" | "format" | "everyone";
  label: string;
  entries: number;
  /** Refreshes a day at most: each entry once per its TTL (if someone asks all day). */
  refreshes: number;
  commands: number;
  /** Bytes a day: the new copies written, and the stale copies read first (an entry kept past its TTL is read whole before it's found too old). */
  sent: number;
  staleRead: number;
}

/**
 * The most a day of refreshes can cost (every entry refreshed once per its TTL): a locked (public) refresh is 5 commands
 * (the GET that finds the copy too old, SET NX, SET, the release's GET and DEL), an unlocked one 2 (GET, SET); it sends
 * the new copy, and reads the old one first when Redis still keeps it (retention longer than the TTL).
 */
function refreshRows(requests: ReadonlyMap<string, RequestPolicy>, sizes: ReadonlyMap<string, number>, leagueId: string): RefreshRow[] {
  const rows = new Map<string, RefreshRow>();
  for (const [key, p] of requests) {
    if (holdsLeague(key, leagueId)) continue; // league data: the sessions' rows
    const group = refreshGroup(key);
    if (!group) continue;
    const size = sizes.get(hiddenKey(key));
    if (size === undefined) continue; // not cached (a format FantasyCalc had no copy of here)
    const perDay = DAY / p.ttlMs;
    const row = rows.get(group.label) ?? { ...group, entries: 0, refreshes: 0, commands: 0, sent: 0, staleRead: 0 };
    row.entries++;
    row.refreshes += perDay;
    row.commands += perDay * (p.public ? 5 : 2);
    row.sent += perDay * size;
    row.staleRead += p.retainMs > p.ttlMs ? perDay * size : 0;
    rows.set(group.label, row);
  }
  return [...rows.values()];
}

// ---------------------------------------------------------------------------------------------
// 5. CPU: a model build and the crosswalk's cold build, raw bodies vs reduced

async function cpuOf(league: EspnLeague, fixture: Map<string, unknown> | null): Promise<Record<Mode, { model: number; modelWall: number; crosswalk: number; parsedPerBuild: number }>> {
  const out = {} as Record<Mode, { model: number; modelWall: number; crosswalk: number; parsedPerBuild: number }>;
  for (const mode of ["before", "after"] as const) {
    const source = new Source(fixture);
    const memory = new MemoryCache();
    const http = plainInstance(source, mode, memory);
    const deps = { http, resolver: await loadPlayerIdResolver({ http, now: NOW }), now: NOW };
    const got = await importEspnLeagueForModel({ leagueId: league.leagueId, season: league.season }, deps);
    const build = () => buildModelInputs({ snapshot: got.result.snapshot, http, resolver: deps.resolver, now: NOW, espn: got.espn, projectionArchive: null, fantasyCalcArchive: null });
    await build(); // fills the cache (the "live" fetches); every run below reads it
    await build(); // warm-up
    const runs: { cpu: number; wall: number; parsed: number }[] = [];
    for (let i = 0; i < 5; i++) {
      const read0 = source.bytesRead;
      const t = await timed(build);
      runs.push({ cpu: t.cpuMs, wall: t.wallMs, parsed: source.bytesRead - read0 });
    }
    const walks: number[] = [];
    for (let i = 0; i < 5; i++) {
      const fresh = plainInstance(source, mode, memory); // a new client: the crosswalk memo is cold, the cache warm
      walks.push((await timed(() => loadPlayerIdResolver({ http: fresh, now: NOW }))).cpuMs);
    }
    out[mode] = { model: median(runs.map((r) => r.cpu)), modelWall: median(runs.map((r) => r.wall)), crosswalk: median(walks), parsedPerBuild: median(runs.map((r) => r.parsed)) };
  }
  return out;
}

// ---------------------------------------------------------------------------------------------

async function main(): Promise<void> {
  // Offline by construction (the header): no real request can go out.
  globalThis.fetch = (async () => {
    throw new Error("measure:cache is offline: a real request was refused");
  }) as typeof fetch;
  if (!existsSync(APP_DIR)) {
    console.log("No .cache/app on this computer: nothing to measure.");
    return;
  }
  const loaded = loadAppIndex(); // every body, read once before anything is timed (review CA-11)
  console.log(`measure:cache: offline, from .cache/app (read only: ${loaded.size} entries) at ${NOW.toISOString().slice(0, 16)}Z. Counts, sizes and timings only.\n`);

  console.log("## 1. Proof: consumers read the same from reduced bodies (every cached full-size body)\n");
  console.log("| Body | Bodies | Same output | Raw | Raw gzip | Reduced | Reduced gzip | Reducer time |");
  console.log("|---|---|---|---|---|---|---|---|");
  const { results } = await proofs();
  let allEqual = true;
  for (const p of results) {
    if (p.equal !== p.bodies) allEqual = false;
    console.log(`| ${p.type} | ${p.bodies} | ${p.equal === p.bodies ? `all ${p.equal}` : `${p.equal} of ${p.bodies} ✗`} | ${mb(p.rawBytes)} | ${kb(p.rawGzip)} | ${mb(p.reducedBytes)} | ${kb(p.reducedGzip)} | ${ms(p.reduceMs)} |`);
  }
  console.log(allEqual ? "\nEvery consumer read the same from every reduced body." : "\n✗ Some reduced bodies gave a different result (see the rows marked ✗).");

  console.log("\n## 2. Bytes per entry type (.cache/app now)\n");
  console.log("| Entry type | Entries | File cache | Shared cache, raw (gzip + base64) | Shared cache, reduced |");
  console.log("|---|---|---|---|---|");
  const bytes = await bytesByType();
  const total = { file: 0, raw: 0, reduced: 0 };
  for (const [type, b] of [...bytes].sort((x, y) => y[1].sharedRaw - x[1].sharedRaw)) {
    if (!type.includes("import form")) {
      total.file += b.file;
      total.raw += b.sharedRaw;
      total.reduced += b.sharedReduced;
    }
    console.log(`| ${type} | ${b.n} | ${mb(b.file)} | ${kb(b.sharedRaw)} | ${kb(b.sharedReduced)} |`);
  }
  console.log(`| Total (the import form counted in its rows only) | | ${mb(total.file)} | ${mb(total.raw)} | ${mb(total.reduced)} |`);

  const fixture = sleeperFixture();
  const league = espnLeague();
  const leagueCached = league !== null;
  console.log("\n## 3. Sessions through the shared cache (memory, then Redis; FakeRedis counts commands and bytes)\n");
  console.log("Before: no reducers (raw bodies, gzip + base64). After: reduced bodies. Bytes are what each command carries (the wire's size, give or take a few bytes of JSON).");
  console.log(`ESPN: ${league ? `${league.label}, the ESPN league .cache/app holds` : "none in .cache/app (league data is kept 10 minutes)"}. Sleeper: the public test league, sanitized (data-local/).`);
  console.log(`Free tier: how many such sessions a day Upstash's free plan allows alone (${Math.round(FREE_COMMANDS_PER_DAY).toLocaleString("en-US")} commands, ${mb(FREE_BYTES_PER_DAY)} a day; bandwidth counted both ways ⚠️).\n`);
  console.log("| Scenario | Mode | Redis commands | Sent to Redis | Received from Redis | Live fetches | Bodies parsed | CPU | Free tier: a day by commands · by bandwidth |");
  console.log("|---|---|---|---|---|---|---|---|---|");
  const missing = new Set<string>();
  const perDay = (budget: number, cost: number) => (cost > 0 ? Math.floor(budget / cost).toLocaleString("en-US") : "∞");
  const print = (rows: Record<Mode, SessionNumbers[]>) => {
    for (let i = 0; i < rows.before.length; i++)
      for (const mode of ["before", "after"] as const) {
        const r = rows[mode][i] as SessionNumbers;
        const free = `${perDay(FREE_COMMANDS_PER_DAY, r.commands)} · ${perDay(FREE_BYTES_PER_DAY, r.sentToRedis + r.receivedFromRedis)}`;
        console.log(`| ${r.scenario} | ${mode} | ${r.commands} | ${kb(r.sentToRedis)} | ${kb(r.receivedFromRedis)} | ${r.liveFetches}${r.missing ? ` (${r.missing} not cached)` : ""} | ${mb(r.parsed)} | ${ms(r.cpuMs)} | ${free} |`);
      }
  };
  const refresh: { kind: "ESPN" | "Sleeper"; rows: RefreshRow[] }[] = [];
  const run = async (kind: "ESPN" | "Sleeper", leagueId: string, session: (http: HttpClient) => Promise<void>) => {
    const got = await sessions(kind, leagueId, session, fixture, missing);
    print(got.rows);
    refresh.push({ kind, rows: refreshRows(got.requests, got.sizes, leagueId) });
  };
  if (league && leagueCached) await run("ESPN", league.leagueId, (http) => espnSession(http, league));
  else console.log("| ESPN session | — | skipped | | | | | | |");
  if (fixture && sleeperStateText()) await run("Sleeper", FIXTURE_LEAGUE_ID, sleeperSession);
  else console.log("| Sleeper session | — | skipped: the public test league's sanitized bodies aren't in data-local/ | | | | | | |");
  if (missing.size) console.log(`\nNot cached here (answered 404, as a source with no copy would be): requests to ${[...missing].sort().join(", ")}.`);

  console.log("\n## 4. Keeping league-independent data fresh: the most a day costs (every entry refreshed once per its TTL)\n");
  console.log("Per league shape: each position set seen in a day (Sleeper's projections and stats are filed per set of positions requested) and each FantasyCalc format seen; plus what every league shares. A locked refresh is 5 commands, an unlocked one 2; it sends the new copy, and first reads the old one whole when Redis keeps it past its TTL. Each other instance then reads the new copy once (the new-instance rows above).\n");
  console.log("| From the session | Shared by | Entries | Refreshes a day | Commands a day | Sent a day | Stale copies read a day |");
  console.log("|---|---|---|---|---|---|---|");
  const scopeText = { shape: "each position set", sleeper: "each position set (Sleeper leagues)", format: "each FantasyCalc format", everyone: "every league" } as const;
  for (const { kind, rows } of refresh) {
    const totals = new Map<RefreshRow["scope"], { commands: number; bytes: number }>();
    for (const r of rows.sort((a, b) => a.scope.localeCompare(b.scope) || b.sent - a.sent)) {
      console.log(`| ${kind}: ${r.label} | ${scopeText[r.scope]} | ${r.entries} | ${r.refreshes.toFixed(1)} | ${Math.round(r.commands)} | ${mb(r.sent)} | ${mb(r.staleRead)} |`);
      const t = totals.get(r.scope) ?? { commands: 0, bytes: 0 };
      t.commands += r.commands;
      t.bytes += r.sent + r.staleRead;
      totals.set(r.scope, t);
    }
    for (const [scope, t] of totals)
      console.log(`| ${kind}: all of it, ${scopeText[scope]} | | | | ${Math.round(t.commands)} (${((100 * t.commands) / FREE_COMMANDS_PER_DAY).toFixed(1)}% of the free day) | ${mb(t.bytes)} with stale reads (${((100 * t.bytes) / FREE_BYTES_PER_DAY).toFixed(1)}%) | |`);
  }

  console.log(`\n## 5. CPU (median of 5, this computer, warm cache: parsing and building only${league ? `; ESPN: ${league.label}` : ""})\n`);
  if (league && leagueCached) {
    const cpu = await cpuOf(league, fixture);
    console.log("| | Before | After |");
    console.log("|---|---|---|");
    console.log(`| Model build (ESPN league), CPU | ${ms(cpu.before.model)} | ${ms(cpu.after.model)} |`);
    console.log(`| Model build, wall | ${ms(cpu.before.modelWall)} | ${ms(cpu.after.modelWall)} |`);
    console.log(`| Bodies a model build parses | ${mb(cpu.before.parsedPerBuild)} | ${mb(cpu.after.parsedPerBuild)} |`);
    console.log(`| The crosswalk's cold build (a new instance), CPU | ${ms(cpu.before.crosswalk)} | ${ms(cpu.after.crosswalk)} |`);
  } else console.log("Skipped: no ESPN league in .cache/app.");
  if (!allEqual) process.exitCode = 1;
}

if (isMainModule(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(`measure:cache failed (${err instanceof Error ? err.name : typeof err}).`);
    process.exitCode = 1;
  });
}
