/**
 * The B4 load test, offline (planner reply to Checkpoint 4c, B4: "Load test: 50 imports at the same time against mocks, plus
 * a small live test within the politeness limits"; the live part is run separately, by hand). Results and findings:
 * reports/load-test.md. Run it with (about 4.5 minutes for every scenario):
 *
 *   npm run load:test                                  every scenario below (npx tsx scripts/load-test.ts)
 *   npm run load:test -- --scenarios 1,2,5b            some of them
 *   npm run load:test -- --scenarios 2 --redis-ms 200  a slow store, 200 ms an Upstash command (review of the Checkpoint 7b
 *                                                      load-test fixes, finding 1: the outbound budget's count mustn't hold a
 *                                                      host's turn; compare ESPN's sent requests and its smallest gap, 600 ms)
 *   options: --imports 50  --spread 10  --seed 7  --redis-ms 2  --fixture-size
 *            --latency espn=300-900,sleeper=80-250,fantasycalc=150-400,github=100-300
 *            --build-slots 8   each instance's cap on League page builds at once (src/server/buildSlots.ts; the default is
 *                              limits.modelBuildLimits.concurrent; 0: no cap, as before the Checkpoint 7b fix)
 *
 * What runs: the real route code in this process. Each request goes through withRoute (src/app/api/_lib/route.ts: the
 * origin check, the per-IP limit, the daily work budget, the deadline's scope, the log) into the real handler factories
 * (src/app/api/import/{espn,sleeper}/handler.ts, src/app/api/model/espn/handler.ts), the real adapters, the player-ID
 * crosswalk and the model build, over the real HTTP client (src/server/http.ts: per-host pacing, single-flight, the
 * cross-instance lock, the outbound budgets, the deadline). Only the outside is fake:
 * - The platforms: a mocked fetch answers every request from the committed sanitized fixtures (Parker's ESPN league,
 *   the Sleeper public test league, the shared public captures; the Sleeper players lists built from the fixtures' players
 *   plus fictional filler) after a random latency per host (seeded). Sleeper's public lists are padded to live-like row
 *   counts (LIVE_ROWS, LIVE_LIST_ROWS; a warm League page build then costs what live data cost at Checkpoint 7a) and
 *   FantasyCalc's to live length, unless --fixture-size. ESPN's bodies are the committed ones (its free-agent lists cut to
 *   about 60 players a position: an ESPN read here is lighter than a live one).
 * - Upstash: FakeRedis (src/server/redis.ts), with a small delay per command, counting commands and bytes per use (cache,
 *   lock, rate limit, budgets, work budget, log, usage). Each server instance is built exactly as on Vercel with the
 *   store connected (src/app/api/_lib/deps.ts selectServerCache, src/server/budget.ts budgetFor and workBudget,
 *   src/server/rateLimit.ts createSharedLimiter, src/app/api/model/memo.ts), each with its own memory tier, HTTP client
 *   and crosswalk, sharing the one store. @upstash/ratelimit runs for real over the fake store (its fixed-window script
 *   answered in kind: INCRBY, PEXPIRE on a window's first count).
 * - Visitors: requests with Vercel's headers (x-real-ip, the site's own Origin), each visitor in its own /24 unless the
 *   scenario says otherwise. Browser uploads are made as the browser makes them (src/lib/leagueRead.ts readInBrowser over
 *   the same mocked platform, gzipped), before the clock starts.
 *
 * Scenarios (each with 50 requests started at the same moment, on a cold store and cold instances unless said):
 *   1   50 visitors import the same public ESPN league (server path), 1 instance; 1m: the same on --spread instances
 *   2   50 visitors import 50 different ESPN leagues (server path), 1 instance; 2m: on --spread instances
 *   3   50 browser-path ESPN uploads (50 leagues)
 *   4   50 browser-path Sleeper uploads (50 leagues)
 *   5   one visitor (one IP) sends 50 server-path imports; 5b: the same visitor after 480 of its 500 work units today
 *   6   50 League page builds from signed imports (scenario 3's answers, 50 leagues), 1 instance; 6m: on --spread instances;
 *       6w: 1 instance with the public data already warm (another league's build first, not counted)
 * Each scenario prints its table; a summary table and the body sizes follow. One process plays every instance, so on
 * several instances the CPU-bound latency is pessimistic (they share one core) and the memory is all of theirs together.
 * Memory is the JS heap's growth over the scenario's start (after a garbage collection): 6m holds about 2 GB of heap at
 * once (ten instances' builds in one process, 5 each: under each instance's cap), under Node's default limit (about 4 GB on
 * a 64-bit machine with enough memory); 6, its one instance building at most 8 at once, about 0.6 GB (2 GB with
 * --build-slots 0, as before the cap).
 *
 * Offline by construction (the lead's rule: no network at all, every platform response a mock). The server's HTTP client
 * under test refuses every live fetch while OFFERSHEET_NETWORK is "off" (src/server/http.ts refuseIfNetworkOff runs before
 * its fetchImpl, so the mock could never answer), so this script doesn't set it; instead it makes the network
 * unreachable for the whole process: the global fetch refuses, every socket connection and DNS lookup throws (Node's
 * net and dns), the Redis variables (KV_*, UPSTASH_*) are removed so no Upstash client can be built, and .env.local is
 * never read. The secret it sets (SESSION_SECRET, for the HMAC keys and import tokens) is made up. It writes nothing
 * (no cache folder, no data-local) and prints counts, sizes and timings only.
 */
import dns from "node:dns";
import net from "node:net";
import os from "node:os";
import { performance } from "node:perf_hooks";
import v8 from "node:v8";
import vm from "node:vm";
import { gzipSync } from "node:zlib";
import { importEspnLeagueForModel, importEspnUpload } from "@/adapters/espn";
import { LABELS, parkerCards, readCross, readEspn } from "@/adapters/espn/test-helpers";
import { responseOf } from "@/adapters/httpShared";
import { importSleeperLeague, importSleeperUpload, leagueChoicesOf } from "@/adapters/sleeper";
import { loadTestLeague, type TestLeague } from "@/adapters/sleeper/test-helpers";
import type { HttpClient, HttpRequestOptions, HttpResponse, ImportDeps } from "@/adapters/types";
import type { LeagueUpload } from "@/adapters/upload";
import { withRoute, type RouteHandler } from "@/app/api/_lib/route";
import { createEspnImportHandler } from "@/app/api/import/espn/handler";
import { createSleeperImportHandler } from "@/app/api/import/sleeper/handler";
import { createModelMemo } from "@/app/api/model/memo";
import { createEspnModelHandler } from "@/app/api/model/espn/handler";
import { loadPlayerIdResolver, SLEEPER_PLAYER_POSITIONS } from "@/data";
import { parseDynastyProcessCsv } from "@/data/dynastyProcess";
import { SLEEPER_TEAM_CODES, STATIC_DEFENSE_IDS } from "@/data/teamCodes";
import { fixtureDynastyCsv, fixtureSleeperResponse, padDynastyCsv, sleeperDefList } from "@/data/testSupport";
import { readInBrowser } from "@/lib/leagueRead";
import { chargeWork, createBudget, createDailyQuota, slicedAllowance, utcDay, type BudgetPlatform, type DailyQuota } from "@/server/budget";
import { createBuildSlots } from "@/server/buildSlots";
import { MemoryLruCache, RedisCache, RedisCacheLock, SharedCacheBreaker, TieredCache } from "@/server/cache";
import { timeLeftMs } from "@/server/deadline";
import { createHttpClient } from "@/server/http";
import { budgets, cacheLimits, deadlines, modelBuildLimits, workLimits } from "@/server/limits";
import { setLogStoreForTests } from "@/server/log";
import { buildModelInputs } from "@/server/modelInputs";
import { clientIds, createSharedLimiter, type RatelimitRedis } from "@/server/rateLimit";
import { FakeRedis, keyPrefix } from "@/server/redis";
import { resetUsageForTests, setUsageStoreForTests } from "@/server/usage";
import { readSanitizedFixture } from "@/test-utils/fixtures";
import { isMainModule } from "./lib/runMode";

// ---------------------------------------------------------------------------------------------
// Options

export type HostKind = "espn" | "sleeper" | "fantasycalc" | "github";
export interface Range {
  min: number;
  max: number;
}

export interface LoadTestOptions {
  scenarios: string[];
  /** Requests per scenario, all started at the same moment. */
  imports: number;
  /** Server instances for the multi-instance variants (1m, 2m, 6m). */
  spread: number;
  /** Each platform's answer time, uniform in [min, max] ms (seeded). */
  latency: Record<HostKind, Range>;
  /** Each FakeRedis command's delay (ms): a command to Upstash from Vercel's iad1 takes a few. */
  redisMs: number;
  seed: number;
  /** Pad the public bodies to about their live sizes (measure:cache's). */
  liveSize: boolean;
  /** Each instance's cap on League page builds at once (src/server/buildSlots.ts); 0: none (as before Checkpoint 7b's fix). */
  buildSlots: number;
}

export const ALL_SCENARIOS = ["1", "1m", "2", "2m", "3", "4", "5", "5b", "6", "6m", "6w"] as const;

export const DEFAULT_OPTIONS: LoadTestOptions = {
  scenarios: [...ALL_SCENARIOS],
  imports: 50,
  spread: 10,
  latency: { espn: { min: 300, max: 900 }, sleeper: { min: 80, max: 250 }, fantasycalc: { min: 150, max: 400 }, github: { min: 100, max: 300 } },
  redisMs: 2,
  seed: 7,
  liveSize: true,
  buildSlots: modelBuildLimits.concurrent,
};

const HOST_KIND: Readonly<Record<string, HostKind>> = {
  "lm-api-reads.fantasy.espn.com": "espn",
  "api.sleeper.app": "sleeper",
  "api.fantasycalc.com": "fantasycalc",
  "raw.githubusercontent.com": "github",
};

/** The server client's minimum gap between two requests to a host, per instance (src/server/http.ts HOST_GAP_MS). */
export const SERVER_GAP_MS: Readonly<Record<HostKind, number>> = { espn: 600, sleeper: 120, fantasycalc: 1500, github: 300 };

/** Sleeper's documented limit: stay under 1,000 calls a minute (CLAUDE.md §2.3). */
const SLEEPER_PER_MINUTE = 1_000;

/** --latency espn=300-900,sleeper=80-250 → the ranges given, the defaults for the rest. */
export function parseLatency(text: string, base: Record<HostKind, Range> = DEFAULT_OPTIONS.latency): Record<HostKind, Range> {
  const out = { ...base };
  for (const part of text.split(",")) {
    const m = /^\s*(espn|sleeper|fantasycalc|github)\s*=\s*(\d+)\s*-\s*(\d+)\s*$/.exec(part);
    if (!m) throw new Error(`--latency: "${part}" isn't host=min-max (hosts: espn, sleeper, fantasycalc, github)`);
    const [min, max] = [Number(m[2]), Number(m[3])];
    if (min > max) throw new Error(`--latency: ${m[1]}'s min is above its max`);
    out[m[1] as HostKind] = { min, max };
  }
  return out;
}

export function parseArgs(argv: readonly string[]): LoadTestOptions {
  const opts: LoadTestOptions = { ...DEFAULT_OPTIONS, latency: { ...DEFAULT_OPTIONS.latency } };
  const value = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    const v = i >= 0 ? argv[i + 1] : undefined;
    return v !== undefined && !v.startsWith("--") ? v : undefined;
  };
  const int = (flag: string, min: number): number | undefined => {
    const v = value(flag);
    if (v === undefined) return undefined;
    const n = Number(v);
    if (!Number.isInteger(n) || n < min) throw new Error(`${flag} needs a whole number of at least ${min}`);
    return n;
  };
  const scenarios = value("--scenarios");
  if (scenarios) {
    const list = scenarios.split(",").map((s) => s.trim());
    const unknown = list.filter((s) => !(ALL_SCENARIOS as readonly string[]).includes(s));
    if (unknown.length) throw new Error(`--scenarios: unknown ${unknown.join(", ")} (known: ${ALL_SCENARIOS.join(", ")})`);
    opts.scenarios = list;
  }
  opts.imports = int("--imports", 1) ?? opts.imports;
  opts.spread = int("--spread", 2) ?? opts.spread;
  opts.seed = int("--seed", 0) ?? opts.seed;
  opts.redisMs = int("--redis-ms", 0) ?? opts.redisMs;
  opts.buildSlots = int("--build-slots", 0) ?? opts.buildSlots;
  const latency = value("--latency");
  if (latency) opts.latency = parseLatency(latency);
  if (argv.includes("--fixture-size")) opts.liveSize = false;
  return opts;
}

// ---------------------------------------------------------------------------------------------
// Small helpers

/** A seeded PRNG (mulberry32): the same seed, the same latencies. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** The p-th percentile (0–100) of `xs` by the nearest-rank rule; NaN for none. */
export function percentile(xs: readonly number[], p: number): number {
  if (!xs.length) return Number.NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))] as number;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;
const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;
const sec = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const lower = (h: Record<string, string> | undefined): Record<string, string> => Object.fromEntries(Object.entries(h ?? {}).map(([k, v]) => [k.toLowerCase(), v]));

// ---------------------------------------------------------------------------------------------
// The network guard (see the header)

let refusedConnections = 0;

/** Makes the network unreachable for this process (see the header). */
function installNetworkGuard(): void {
  const refuse = (what: string): never => {
    refusedConnections++;
    throw new Error(`load-test is offline: ${what} was refused`);
  };
  globalThis.fetch = (() => Promise.reject(new Error("load-test is offline: a fetch was refused"))) as typeof fetch;
  net.Socket.prototype.connect = function connect() {
    return refuse("a socket connection");
  } as unknown as typeof net.Socket.prototype.connect;
  dns.lookup = function lookup() {
    return refuse("a DNS lookup");
  } as unknown as typeof dns.lookup;
  for (const name of Object.keys(process.env)) if (/^(KV_|UPSTASH_|READONLY_STORE_)|^REDIS_URL$/.test(name)) delete process.env[name];
  // The HTTP client under test refuses every live fetch while this is "off" (see the header); the guard above stands in.
  delete process.env.OFFERSHEET_NETWORK;
}

// ---------------------------------------------------------------------------------------------
// The platforms' answers (fixtures, padded to live sizes)

interface Answer {
  status: number;
  contentType: string;
  text: string;
}

const JSON_TYPE = "application/json; charset=utf-8";
const json = (text: string): Answer => ({ status: 200, contentType: JSON_TYPE, text });
const SEASON = 2026;
/** Parker's league fixtures are week 4 of 2026, captured on Tuesday Sep 29 (before the week's first kickoff). */
export const FIXTURE_NOW = new Date("2026-09-29T20:00:00.000Z");

/** Sleeper's active players per position on 2026-09-29 (src/data/sleeperPlayers.ts header), the lists' live sizes. */
const LIVE_LIST_ROWS: Readonly<Record<string, number>> = { QB: 355, RB: 750, WR: 1364, TE: 647, K: 157, P: 130, DL: 1543, LB: 1253, DB: 1808 };
/**
 * ⚠️ Live-like row counts for Sleeper's public lists of the offense (--fixture-size leaves the captures as they are): a week
 * of projections about 650 projected players and 850 stubs (measure:cache, Checkpoint 7a: 193 KB gzipped, 32 KB in the
 * model's form; the pre-game archive: about 1,250 projected players a week for all nine positions), a finished week's
 * stats about 700 players with a line and 500 without, the season projections about 1,000 and 300. Calibrated so a warm
 * League page build costs what Checkpoint 7a measured on live data (0.35–0.55 s of CPU on this computer).
 */
const LIVE_ROWS = {
  projectionWeek: { stats: 650, stubs: 850 },
  statsWeek: { stats: 700, stubs: 500 },
  season: { stats: 1_000, stubs: 300 },
} as const;
/** FantasyCalc's lists hold about 197 redraft and 395 dynasty players (src/server/limits.ts snapshotLimits). */
const LIVE_FANTASYCALC_ROWS = { redraft: 200, dynasty: 400 } as const;

/** The ESPN free-agent lists by the slot id the request's filter names (measure-upload's table). */
const FA_SLOT_POS: Readonly<Record<number, string>> = { 0: "QB", 2: "RB", 4: "WR", 6: "TE", 17: "K", 16: "D/ST" };

type Row = Record<string, unknown>;

/** Fields a live Sleeper players row carries beyond what the crosswalk reads (about a kilobyte, as live rows). */
function sleeperRowExtras(id: number): Row {
  return {
    search_full_name: `filler${id}`,
    search_first_name: "filler",
    search_last_name: String(id),
    search_rank: 9_999_999,
    birth_date: "1999-01-01",
    birth_city: null,
    birth_state: null,
    birth_country: null,
    high_school: "Filler High School (TX)",
    college: "Filler State",
    height: "73",
    weight: "212",
    hashtag: `#filler-${id}-NFL-FA-00`,
    depth_chart_position: null,
    depth_chart_order: null,
    number: 0,
    sport: "nfl",
    practice_participation: null,
    practice_description: null,
    injury_body_part: null,
    injury_notes: null,
    injury_start_date: null,
    news_updated: 1_790_000_000_000,
    fantasy_data_id: id,
    stats_id: null,
    rotowire_id: id,
    rotoworld_id: id,
    swish_id: id,
    oddsjam_id: null,
    opta_id: null,
    pandascore_id: null,
    competitions: [],
    metadata: { channel_id: `11${id}00000000000000`, rookie_year: "2022", genius_id: String(id) },
  };
}

const DP_TO_SLEEPER: Readonly<Record<string, string>> = { QB: "QB", RB: "RB", WR: "WR", TE: "TE", PK: "K", PN: "P", DE: "DL", DT: "DL", LB: "LB", CB: "DB", S: "DB" };

/** Whether a projection or stats row carries any stat (a stub doesn't). */
const hasStats = (r: Row): boolean => Object.keys((r.stats ?? {}) as object).length > 0;

/** The real row with the most stats whose player object came along: the template the padding clones. */
function templateOf(rows: readonly Row[]): Row {
  let best: Row = rows[0] ?? {};
  for (const r of rows) if (r.player && Object.keys((r.stats ?? {}) as object).length > Object.keys((best.stats ?? {}) as object).length) best = r;
  return best;
}

/**
 * `rows` padded to `target` rows with stats and stubs (LIVE_ROWS): clones of `template` (a real row, its player object
 * included) under filler player ids, their numbers scaled down row by row (deep backups: they rank under the real players,
 * and differ as live numbers do), a stub without stats.
 */
function padRows(rows: readonly Row[], target: { stats: number; stubs: number }, template: Row, week?: number): Row[] {
  const out = [...rows];
  let withStats = rows.filter(hasStats).length;
  let stubs = rows.length - withStats;
  for (let i = 0; withStats < target.stats || stubs < target.stubs; i++) {
    const stub = withStats >= target.stats;
    const id = String(5_000_000 + i);
    const scale = 0.05 + 0.25 * (((i * 7919) % 1000) / 1000);
    const stats = stub ? {} : Object.fromEntries(Object.entries((template.stats ?? {}) as Record<string, unknown>).map(([k, v]) => [k, typeof v === "number" && k !== "gp" ? Math.round(v * scale * 100) / 100 : v]));
    out.push({ ...template, player_id: id, stats, ...(week !== undefined ? { week } : {}), player: { ...((template.player ?? {}) as Row), first_name: "Filler", last_name: id } });
    if (stub) stubs++;
    else withStats++;
  }
  return out;
}

/**
 * Every platform answer the scenarios need, by URL (and ESPN's filter header), computed once: Parker's ESPN league (the
 * committed sanitized fixtures), the Sleeper public test league (the committed minimized copy, its league id rewritten to
 * the one asked for), and the public data (shared captures, padded to live sizes unless --fixture-size).
 */
export class PlatformData {
  private readonly espnLeague = JSON.stringify(readEspn(LABELS.league));
  private readonly espnSchedule = JSON.stringify(readEspn(LABELS.proSchedule));
  private readonly espnTx = new Map<number, string>([1, 2, 3, 4].map((w) => [w, JSON.stringify(readEspn(LABELS.tx(w)))]));
  private readonly espnFa = new Map<number, string>(Object.entries(FA_SLOT_POS).map(([slot, pos]) => [Number(slot), JSON.stringify(readEspn(LABELS.fa(pos)))]));
  private readonly cards = parkerCards().players;
  private readonly cardTexts = new Map<string, string>();
  private readonly sleeperState = JSON.stringify(readSanitizedFixture("sleeper", "state/nfl"));
  private readonly testLeague: TestLeague = loadTestLeague();
  private readonly sleeperLists = new Map<string, string>();
  private readonly projectionWeeks = new Map<number, string>();
  private readonly statsWeeks = new Map<number, string>();
  private seasonText: string | undefined;
  private readonly fantasyCalcTexts = new Map<string, string>();
  readonly dynastyCsv: string;
  /** Public bodies' sizes, for the report: what one fetch of each moves (bytes of text). */
  readonly sizes = new Map<string, number>();

  constructor(readonly liveSize: boolean) {
    // LF first: a CRLF checkout of the fixture plus padDynastyCsv's LF rows reads as one record per filler block (csv-parse
    // takes the first line's ending for every record), and the map would fail its 10,000-row floor.
    this.dynastyCsv = padDynastyCsv(fixtureDynastyCsv().replace(/\r\n/g, "\n"), 10_000);
    this.buildSleeperLists();
    this.sizes.set("DynastyProcess CSV", this.dynastyCsv.length);
    this.sizes.set("ESPN league body (Parker's, sanitized)", this.espnLeague.length);
    this.sizes.set("ESPN free-agent lists (6)", [...this.espnFa.values()].reduce((n, t) => n + t.length, 0));
  }

  /** Sleeper's players lists: every player the fixtures name (with ESPN ids where known), then fillers up to live sizes. */
  private buildSleeperLists(): void {
    const known = new Map<string, Row>();
    for (const r of parseDynastyProcessCsv(fixtureDynastyCsv())) {
      const position = r.position ? DP_TO_SLEEPER[r.position] : undefined;
      if (!r.sleeperId || !position) continue;
      const [first, ...rest] = r.name.split(" ");
      known.set(r.sleeperId, { full_name: r.name, first_name: first ?? r.name, last_name: rest.join(" "), position, fantasy_positions: [position], team: r.team, active: true, status: "Active", espn_id: r.espnId, gsis_id: r.gsisId, sportradar_id: r.sportradarId });
    }
    for (const [id, p] of Object.entries(fixtureSleeperResponse())) {
      const name = `${String(p.first_name ?? "")} ${String(p.last_name ?? "")}`.trim();
      known.set(id, { ...known.get(id), ...p, full_name: name, active: true, status: "Active" });
    }
    for (const p of this.testLeague.players) {
      const [first, ...rest] = p.name.split(" ");
      known.set(p.id, { ...known.get(p.id), full_name: p.name, first_name: first ?? p.name, last_name: rest.join(" "), position: p.position, fantasy_positions: p.fantasyPositions, team: p.team, injury_status: p.injuryStatus, status: p.status ?? "Active", age: p.age, active: true, years_exp: p.yearsExp });
    }
    for (const r of readCross().rows) {
      const row = known.get(r.sleeperId);
      if (row && r.espnId > 0) row.espn_id = String(r.espnId);
    }
    let total = 0;
    SLEEPER_PLAYER_POSITIONS.forEach((position, index) => {
      if (position === "DEF") {
        const text = JSON.stringify(sleeperDefList());
        this.sleeperLists.set(position, text);
        total += text.length;
        return;
      }
      const list: Record<string, Row> = {};
      for (const [id, row] of known) {
        const fp = Array.isArray(row.fantasy_positions) ? (row.fantasy_positions as string[]) : [String(row.position)];
        if (fp.includes(position)) list[id] = row;
      }
      const target = this.liveSize ? (LIVE_LIST_ROWS[position] ?? 50) : 50;
      const base = 900_000 + 10_000 * (index + 1);
      for (let i = 0; Object.keys(list).length < target; i++) {
        const id = base + i;
        list[String(id)] = { full_name: `Filler ${id}`, first_name: "Filler", last_name: String(id), position, fantasy_positions: [position], team: SLEEPER_TEAM_CODES[id % SLEEPER_TEAM_CODES.length], active: true, status: "Active", age: 25, years_exp: 3, ...(this.liveSize ? sleeperRowExtras(id) : {}) };
      }
      const text = JSON.stringify(list);
      this.sleeperLists.set(position, text);
      total += text.length;
    });
    this.sizes.set("Sleeper players lists (10)", total);
  }

  /** The shared capture of a week's projections nearest `week`, as rows of that week. */
  private projectionRows(week: number): Row[] {
    const have = [4, 5, 10, 15, 17, 18];
    const nearest = have.reduce((best, w) => (Math.abs(w - week) < Math.abs(best - week) ? w : best), 4);
    const rows: Row[] = readSanitizedFixture<Row[]>("shared", `sleeper/projections/${SEASON}/${nearest} (top 150 QB/RB/WR/TE + 6 per K/DEF/IDP)`).map((r) => ({ ...r, week }));
    // The Sleeper test league's own players (its minimized projections of week 4), so its import ranks them as live.
    const seen = new Set(rows.map((r) => String(r.player_id)));
    for (const r of this.testLeague.projections as Row[]) if (!seen.has(String(r.player_id))) rows.push({ ...r, week });
    return rows;
  }

  private weekText(week: number): string {
    let text = this.projectionWeeks.get(week);
    if (text === undefined) {
      const rows = this.projectionRows(week);
      text = JSON.stringify(this.liveSize ? padRows(rows, LIVE_ROWS.projectionWeek, templateOf(rows), week) : rows);
      this.projectionWeeks.set(week, text);
      this.sizes.set("Sleeper projections, one week", text.length);
    }
    return text;
  }

  private statsText(week: number): string {
    let text = this.statsWeeks.get(week);
    if (text === undefined) {
      if (week < 1 || week > 3) text = "[]";
      else {
        const rows = readSanitizedFixture<Row[]>("shared", `sleeper/stats/${SEASON}/${week} (top 150 QB/RB/WR/TE + 6 per K/DEF/IDP)`);
        text = JSON.stringify(this.liveSize ? padRows(rows, LIVE_ROWS.statsWeek, templateOf(rows), week) : rows);
        this.sizes.set("Sleeper stats, one week", text.length);
      }
      this.statsWeeks.set(week, text);
    }
    return text;
  }

  private season(): string {
    if (this.seasonText === undefined) {
      const rows = readSanitizedFixture<Row[]>("shared", `sleeper/projections/${SEASON}?position=QB (season, top 40)`);
      this.seasonText = JSON.stringify(this.liveSize ? padRows(rows, LIVE_ROWS.season, templateOf(rows)) : rows);
      this.sizes.set("Sleeper season projections", this.seasonText.length);
    }
    return this.seasonText;
  }

  /** A FantasyCalc list for the asked format: the capture of that format, else the nearest one, padded to live length. */
  private fantasyCalc(u: URL): string {
    const isDynasty = u.searchParams.get("isDynasty") === "true";
    const numQbs = u.searchParams.get("numQbs") ?? "1";
    const key = `${isDynasty}|${numQbs}|${u.searchParams.get("numTeams")}|${u.searchParams.get("ppr")}|${u.searchParams.get("tep") ?? ""}`;
    let text = this.fantasyCalcTexts.get(key);
    if (text === undefined) {
      const exact = `fantasycalc/values?isDynasty=${isDynasty}&numQbs=${numQbs}&numTeams=${u.searchParams.get("numTeams")}&ppr=${u.searchParams.get("ppr")}`;
      const fallback = `fantasycalc/values?isDynasty=${isDynasty}&numQbs=${numQbs}&numTeams=12&ppr=1`;
      let rows: Row[];
      try {
        rows = readSanitizedFixture<Row[]>("shared", exact);
      } catch {
        rows = readSanitizedFixture<Row[]>("shared", fallback);
      }
      const target = isDynasty ? LIVE_FANTASYCALC_ROWS.dynasty : LIVE_FANTASYCALC_ROWS.redraft;
      const last = rows[rows.length - 1] ?? {};
      const lastValue = typeof last.value === "number" ? last.value : 1_000;
      for (let i = rows.length; i < target; i++) {
        const v = Math.max(1, lastValue - 5 * (i - rows.length + 1));
        rows.push({ ...last, player: { ...((last.player ?? {}) as Row), id: 980_000 + i, name: `Filler ${i}`, sleeperId: null, espnId: null, mflId: null, fleaflickerId: null }, value: v, redraftValue: v, overallRank: i + 1 });
      }
      text = JSON.stringify(rows);
      this.fantasyCalcTexts.set(key, text);
      this.sizes.set(`FantasyCalc list (${isDynasty ? "dynasty" : "redraft"})`, text.length);
    }
    return text;
  }

  private espn(u: URL, headers: Record<string, string>): Answer | undefined {
    const views = u.searchParams.getAll("view");
    if (/\/seasons\/\d+$/.test(u.pathname) && views.includes("proTeamSchedules_wl")) return json(this.espnSchedule);
    if (!/\/leagues\/\d+$/.test(u.pathname)) return undefined;
    if (views.includes("mSettings")) return json(this.espnLeague);
    if (views.includes("mTransactions2")) return json(this.espnTx.get(Number(u.searchParams.get("scoringPeriodId"))) ?? '{"transactions":[]}');
    const filter = JSON.parse(headers["x-fantasy-filter"] ?? "{}") as { players?: { filterSlotIds?: { value?: number[] }; filterIds?: { value?: number[] } } };
    if (views.includes("kona_player_info")) {
      const text = this.espnFa.get(filter.players?.filterSlotIds?.value?.[0] ?? -1);
      return text === undefined ? undefined : json(text);
    }
    if (views.includes("kona_playercard")) {
      const ids = filter.players?.filterIds?.value ?? [];
      const key = ids.join(",");
      let text = this.cardTexts.get(key);
      if (text === undefined) {
        const wanted = new Set(ids);
        text = JSON.stringify({ players: this.cards.filter((p) => wanted.has(p.id)) });
        this.cardTexts.set(key, text);
      }
      return json(text);
    }
    return undefined;
  }

  private sleeper(u: URL): Answer | undefined {
    const path = u.pathname;
    if (path === "/v1/state/nfl") return json(this.sleeperState);
    const list = /^\/v1\/players\/nfl$/.test(path) ? this.sleeperLists.get(u.searchParams.get("position") ?? "") : undefined;
    if (list !== undefined) return json(list);
    let m = /^\/projections\/nfl\/\d+\/(\d+)$/.exec(path);
    if (m) return json(this.weekText(Number(m[1])));
    if (/^\/projections\/nfl\/\d+$/.test(path)) return json(this.season());
    m = /^\/stats\/nfl\/\d+\/(\d+)$/.exec(path);
    if (m) return json(this.statsText(Number(m[1])));
    m = /^\/v1\/league\/(\d+)(\/.*)?$/.exec(path);
    if (!m) return undefined;
    const [id, sub] = [m[1] as string, m[2] ?? ""];
    const t = this.testLeague;
    if (sub === "") return json(JSON.stringify({ ...t.league, league_id: id }));
    if (sub === "/users") return json(JSON.stringify(t.users));
    if (sub === "/rosters") return json(JSON.stringify(t.rosters.map((r) => ({ ...r, league_id: id }))));
    if (sub === "/traded_picks") return json(JSON.stringify(t.tradedPicks));
    if (sub === "/drafts") return json(JSON.stringify(t.drafts));
    m = /^\/matchups\/(\d+)$/.exec(sub);
    if (m) return json(JSON.stringify(t.matchups[Number(m[1])] ?? []));
    m = /^\/transactions\/(\d+)$/.exec(sub);
    if (m) return json(JSON.stringify(t.transactions[Number(m[1])] ?? []));
    return undefined;
  }

  /** The platform's answer to a request (headers by lower-case name), or undefined (the mock then answers 404). */
  answer(url: string, headers: Record<string, string> = {}): Answer | undefined {
    const u = new URL(url);
    switch (HOST_KIND[u.host]) {
      case "espn":
        return this.espn(u, headers);
      case "sleeper":
        return this.sleeper(u);
      case "fantasycalc":
        return u.pathname === "/values/current" ? json(this.fantasyCalc(u)) : undefined;
      case "github":
        return u.pathname.endsWith("/db_playerids.csv") ? { status: 200, contentType: "text/plain; charset=utf-8", text: this.dynastyCsv } : undefined;
      default:
        return undefined;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// The mocked platforms: latency, abort, and a record of every request

export interface Outbound {
  instance: number;
  host: HostKind | "other";
  /** What was asked (a coarse label: "espn league", "sleeper projections" …), never the URL. */
  what: string;
  /** The URL and filter, kept in memory only for the repeat count (never printed). */
  key: string;
  start: number;
  end: number;
  aborted: boolean;
  status: number;
}

function whatOf(u: URL): string {
  const kind = HOST_KIND[u.host] ?? "other";
  if (kind === "espn") return u.pathname.includes("/leagues/") ? "espn league data" : "espn NFL schedule";
  if (kind === "sleeper") {
    if (u.pathname.startsWith("/v1/players")) return "sleeper players lists";
    if (u.pathname.startsWith("/projections")) return /\/\d+\/\d+$/.test(u.pathname) ? "sleeper weekly projections" : "sleeper season projections";
    if (u.pathname.startsWith("/stats")) return "sleeper stats";
    if (u.pathname === "/v1/state/nfl") return "sleeper NFL state";
    return "sleeper league data";
  }
  return kind;
}

export class MockPlatform {
  readonly records: Outbound[] = [];
  /** Requests nothing here could answer, by host (answered 404). */
  readonly unanswered = new Map<string, number>();
  inFlight = 0;
  private readonly rng: () => number;

  constructor(
    private readonly data: PlatformData,
    private readonly latency: Record<HostKind, Range>,
    seed: number,
  ) {
    this.rng = prng(seed);
  }

  /** The fetch an instance's HTTP client uses (each instance's requests are recorded under its number). */
  fetchFor(instance: number): typeof fetch {
    return (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const u = new URL(url);
      const host = HOST_KIND[u.host] ?? "other";
      const headers = lower(init?.headers as Record<string, string> | undefined);
      const answer = this.data.answer(url, headers);
      const range = host === "other" ? { min: 0, max: 0 } : this.latency[host];
      const wait = range.min + Math.floor(this.rng() * (range.max - range.min + 1));
      const record: Outbound = { instance, host, what: whatOf(u), key: `${url}\u0000${headers["x-fantasy-filter"] ?? ""}`, start: Date.now(), end: 0, aborted: false, status: answer?.status ?? 404 };
      this.records.push(record);
      this.inFlight++;
      try {
        await new Promise<void>((resolve, reject) => {
          const signal = init?.signal;
          // An AbortSignal.timeout keeps its timer after the answer came: only an abort before it counts, as with fetch.
          const onAbort = () => {
            clearTimeout(timer);
            record.aborted = true;
            reject(signal?.reason ?? new Error("aborted"));
          };
          const timer = setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
          }, wait);
          if (signal?.aborted) onAbort();
          else signal?.addEventListener("abort", onAbort, { once: true });
        });
      } finally {
        record.end = Date.now();
        this.inFlight--;
      }
      if (!answer) {
        this.unanswered.set(u.host, (this.unanswered.get(u.host) ?? 0) + 1);
        return new Response("", { status: 404 });
      }
      return new Response(answer.text, { status: answer.status, headers: { "content-type": answer.contentType } });
    }) as typeof fetch;
  }
}

/** The browser's own client over the mocked platforms (no latency: the upload is made before the clock starts). */
function browserClient(data: PlatformData): HttpClient {
  return {
    async get(url: string, opts: HttpRequestOptions = {}): Promise<HttpResponse> {
      const answer = data.answer(url, lower(opts.headers));
      if (!answer) return { status: 404, ok: false, isHtml: false, json: undefined, text: "", fromCache: false };
      const text = opts.transformText ? opts.transformText(answer.text) : answer.text;
      return responseOf({ status: answer.status, contentType: answer.contentType, text }, { fromCache: false, bigInts: opts.bigIntsAsStrings ?? false, fetchedAt: Date.now() });
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Upstash: FakeRedis with a delay per command and its use per kind of key

export type RedisUse = "cache" | "lock" | "rate limit" | "budgets" | "work budget" | "log" | "usage" | "other";
interface RedisTally {
  commands: number;
  bytesIn: number;
  bytesOut: number;
}

/**
 * FakeRedis (src/server/redis.ts: it counts commands and the bytes each moves, as Upstash bills them) with a delay per
 * command, the commands tallied by what their key is for, the latest value of every counter it increments, and the two
 * script calls @upstash/ratelimit makes (its fixed window: INCRBY, and PEXPIRE on a window's first count; billed as the
 * EVALSHA plus the commands it runs, as src/server/rateLimit.ts counts them).
 */
export class CountingRedis extends FakeRedis {
  readonly uses = new Map<RedisUse, RedisTally>();
  readonly counters = new Map<string, number>();
  /** The counters' values when the counts were last reset (resetCounts): a scenario's numbers are what it added. */
  readonly counterBase = new Map<string, number>();

  /** Starts the counts again (a warm-up's commands, bytes and counter increments aren't the scenario's). */
  resetCounts(): void {
    this.stats.commands = 0;
    this.stats.bytesIn = 0;
    this.stats.bytesOut = 0;
    this.uses.clear();
    this.counterBase.clear();
    for (const [k, v] of this.counters) this.counterBase.set(k, v);
  }

  constructor(
    private readonly prefix: string,
    private readonly delayMs: number,
  ) {
    super();
  }

  private useOf(key: string): RedisUse {
    const rest = key.startsWith(this.prefix) ? key.slice(this.prefix.length) : key;
    const head = rest.split(":")[0];
    switch (head) {
      case "c":
        return "cache";
      case "lock":
        return "lock";
      case "rl":
        return "rate limit";
      case "budget":
        return "budgets";
      case "work":
        return "work budget";
      case "log":
        return "log";
      case "usage":
        return "usage";
      default:
        return "other";
    }
  }

  /** Runs one command of FakeRedis (synchronous inside, so its counts are this call's), tallies it, then waits the delay. */
  private async tally<T>(key: string, run: () => Promise<T>): Promise<T> {
    const before = { ...this.stats };
    const pending = run();
    const t = this.uses.get(this.useOf(key)) ?? { commands: 0, bytesIn: 0, bytesOut: 0 };
    t.commands += this.stats.commands - before.commands;
    t.bytesIn += this.stats.bytesIn - before.bytesIn;
    t.bytesOut += this.stats.bytesOut - before.bytesOut;
    this.uses.set(this.useOf(key), t);
    const value = await pending;
    if (this.delayMs > 0) await sleep(this.delayMs);
    return value;
  }

  override get(key: string) {
    return this.tally(key, () => super.get(key));
  }
  override mget(...keys: string[]) {
    return this.tally(keys[0] ?? "", () => super.mget(...keys));
  }
  override set(key: string, value: string, opts?: { px?: number; nx?: boolean }) {
    return this.tally(key, () => super.set(key, value, opts));
  }
  override del(...keys: string[]) {
    return this.tally(keys[0] ?? "", () => super.del(...keys));
  }
  override incr(key: string) {
    return this.tally(key, () => super.incr(key));
  }
  override pexpire(key: string, ms: number) {
    return this.tally(key, () => super.pexpire(key, ms));
  }
  override lpush(key: string, ...values: string[]) {
    return this.tally(key, () => super.lpush(key, ...values));
  }
  override ltrim(key: string, start: number, stop: number) {
    return this.tally(key, () => super.ltrim(key, start, stop));
  }
  override lrange(key: string, start: number, stop: number) {
    return this.tally(key, () => super.lrange(key, start, stop));
  }
  override sadd(key: string, ...members: string[]) {
    return this.tally(key, () => super.sadd(key, ...members));
  }
  override smembers(key: string) {
    return this.tally(key, () => super.smembers(key));
  }
  override saddExpire(key: string, members: readonly string[], ttlMs: number) {
    return this.tally(key, () => super.saddExpire(key, members, ttlMs));
  }
  override lpushTrimExpire(key: string, values: readonly string[], keep: number, ttlMs: number) {
    return this.tally(key, () => super.lpushTrimExpire(key, values, keep, ttlMs));
  }
  override async incrExpire(entries: ReadonlyArray<{ key: string; by: number; ttlMs: number }>) {
    const values = await this.tally(entries[0]?.key ?? "", () => super.incrExpire(entries));
    entries.forEach((e, i) => this.counters.set(e.key, values[i] ?? 0));
    return values;
  }

  /** @upstash/ratelimit's fixed-window script (see the class doc): [count after the increment, the limit]. */
  async evalsha(_sha: string, keys: string[], args: unknown[]): Promise<[number, number]> {
    const key = keys[0] ?? "";
    const t = this.uses.get("rate limit") ?? { commands: 0, bytesIn: 0, bytesOut: 0 };
    t.commands += 1; // the EVALSHA itself
    t.bytesIn += 40 + key.length + args.join(",").length;
    this.uses.set("rate limit", t);
    this.stats.commands += 1;
    const count = await this.incr(key);
    if (count === Number(args[2] ?? 1)) await this.pexpire(key, Number(args[1]));
    this.counters.set(key, count);
    return [count, Number(args[0])];
  }

  async eval(_script: string, keys: string[], args: unknown[]): Promise<[number, number]> {
    return this.evalsha("", keys, args);
  }
}

// ---------------------------------------------------------------------------------------------
// The server: instances built as on Vercel with the shared store (see the header)

/** A made-up secret (never a real one): the HMAC keys and import tokens need one, and nothing leaves this process. */
const MADE_UP_SECRET = "load-test: a made-up secret for the HMAC keys, never a real one";
export const VERCEL_ENV: Readonly<Record<string, string>> = { VERCEL: "1", VERCEL_ENV: "preview", SESSION_SECRET: MADE_UP_SECRET };
const PREFIX = keyPrefix(VERCEL_ENV);

export type RouteName = "importEspn" | "importSleeper" | "modelEspn";

export interface Instance {
  id: number;
  routes: Record<RouteName, RouteHandler>;
  work: DailyQuota;
}

export interface World {
  redis: CountingRedis;
  platform: MockPlatform;
  instances: Instance[];
  /** After-response writes (next/server's after(), the log's and usage's), awaited when the scenario settles. */
  pending: Promise<void>[];
  /** Work units charged to the daily work budget, by its verdict (every instance's quota: see tallied). */
  work: { ok: number; refused: number };
  /** Each instance's cap on League page builds at once (LoadTestOptions.buildSlots; 0: none). */
  buildSlots: number;
}

/**
 * The daily work budget with every shared charge's verdict tallied (withRoute's on arrival, the handlers' extra charges):
 * the units the store's counters took for work done, and those they took for requests the budget refused. A verdict known
 * at once (a refusal this instance already remembers) increments nothing, so it isn't tallied.
 */
function tallied(quota: DailyQuota, work: World["work"]): DailyQuota {
  return {
    refusedAlready: (who, now) => quota.refusedAlready(who, now),
    charge(units, who, now) {
      const v = quota.charge(units, who, now);
      return typeof v === "string"
        ? v
        : v.then((verdict) => {
            work[verdict === "ok" ? "ok" : "refused"] += units;
            return verdict;
          });
    },
  };
}

/** ESPN cookies: none (every league here is public; a private league's cookies change its cache key, not its load). */
const noCookies = async () => ({ source: "none" as const });

/** The model build without the local archives (off on Vercel anyway; this script writes nothing). */
const buildInputs: Parameters<typeof createEspnModelHandler>[0]["buildInputs"] = (args) => buildModelInputs({ ...args, projectionArchive: null, fantasyCalcArchive: null });

function newInstance(world: Omit<World, "instances">, id: number): Instance {
  // src/app/api/_lib/deps.ts selectServerCache with Redis on Vercel (the memory tier's sweep timer left out: it would keep
  // each scenario's instances alive; the tier still sweeps on every read and write).
  const breaker = new SharedCacheBreaker();
  const cache = new TieredCache(new MemoryLruCache(cacheLimits.memoryBytes), new RedisCache(world.redis, { env: VERCEL_ENV, breaker }));
  const lock = new RedisCacheLock(world.redis, { env: VERCEL_ENV, breaker, timeLeftMs: () => timeLeftMs(), minAttemptMs: deadlines.minAttemptMs });
  // src/server/budget.ts budgetFor on Vercel: the shared day, the visitors' shares, the cookie reserve, the slices.
  const budget = createBudget({ redis: world.redis, prefix: PREFIX, perClient: budgets.perClientPerDay, reserved: budgets.reservedForCookies, slices: budgets.slices, burstShare: budgets.burstShare });
  const http = createHttpClient({ cache, lock, budget, fetchImpl: world.platform.fetchFor(id) });
  // src/server/rateLimit.ts processLimiter on Vercel, and src/server/budget.ts workBudget.
  const limiter = createSharedLimiter(world.redis as unknown as RatelimitRedis, { prefix: PREFIX });
  const work = tallied(createDailyQuota({ name: "work", redis: world.redis, prefix: PREFIX, perClient: workLimits.perClientPerDay, perGroup: workLimits.perGroupPerDay, perDay: workLimits.perDay }), world.work);
  const memo = createModelMemo();
  // src/server/buildSlots.ts modelBuildSlots: each instance its own (--build-slots 0: no cap, as before the fix).
  const slots = createBuildSlots(world.buildSlots > 0 ? world.buildSlots : Number.POSITIVE_INFINITY);
  const getDeps = async (): Promise<ImportDeps> => ({ http, resolver: await loadPlayerIdResolver({ http, now: FIXTURE_NOW }), now: FIXTURE_NOW });
  const getModelDeps = async () => ({ http, resolver: STATIC_DEFENSE_IDS, now: FIXTURE_NOW });
  const charge = (units: number) => chargeWork(units, Date.now(), work);
  const after = (task: () => Promise<void>) => {
    world.pending.push(task().catch(() => {}));
  };
  const opts = (platform: "espn" | "sleeper") => ({ platform, limiter, work, env: VERCEL_ENV, after });
  return {
    id,
    work,
    routes: {
      importEspn: withRoute("import", createEspnImportHandler({ importLeague: importEspnLeagueForModel, importUpload: importEspnUpload, getDeps, credentialsFor: noCookies, chargeWork: charge }), opts("espn")),
      importSleeper: withRoute("import", createSleeperImportHandler({ importLeague: importSleeperLeague, importUpload: importSleeperUpload, getDeps, choicesOf: leagueChoicesOf }), opts("sleeper")),
      modelEspn: withRoute("model", createEspnModelHandler({ importLeague: importEspnLeagueForModel, buildInputs, getDeps, getModelDeps, credentialsFor: noCookies, memo, chargeWork: charge, slots }), opts("espn")),
    },
  };
}

export function newWorld(data: PlatformData, opts: Pick<LoadTestOptions, "latency" | "seed" | "redisMs"> & { buildSlots?: number }, instances: number): World {
  const base = {
    redis: new CountingRedis(PREFIX, opts.redisMs),
    platform: new MockPlatform(data, opts.latency, opts.seed),
    pending: [] as Promise<void>[],
    work: { ok: 0, refused: 0 },
    buildSlots: opts.buildSlots ?? modelBuildLimits.concurrent,
  };
  // The log's and usage's after-response writes go to this world's store (src/server/log.ts, usage.ts test hooks).
  setLogStoreForTests(base.redis);
  setUsageStoreForTests(base.redis);
  resetUsageForTests();
  return { ...base, instances: Array.from({ length: instances }, (_, i) => newInstance(base, i)) };
}

// ---------------------------------------------------------------------------------------------
// Visitors' requests

const SITE = "https://offersheet.vercel.app";

function headersFor(ip: string, contentType: string, length: number): Record<string, string> {
  return { host: "offersheet.vercel.app", origin: SITE, "sec-fetch-site": "same-origin", "x-forwarded-proto": "https", "x-real-ip": ip, "x-forwarded-for": ip, "content-type": contentType, "content-length": String(length) };
}

export function jsonRequest(path: string, ip: string, body: unknown): Request {
  const text = JSON.stringify(body);
  return new Request(`${SITE}${path}`, { method: "POST", headers: headersFor(ip, "application/json", Buffer.byteLength(text)), body: text });
}

export function gzipRequest(path: string, ip: string, bytes: Uint8Array): Request {
  return new Request(`${SITE}${path}`, { method: "POST", headers: headersFor(ip, "application/gzip", bytes.byteLength), body: bytes as Uint8Array<ArrayBuffer> });
}

/** Visitor i's address: its own /24 (so each counts as its own group: src/server/rateLimit.ts ipGroup). */
export const visitorIp = (i: number) => `10.${Math.floor(i / 250)}.${i % 250}.7`;

/** A template upload (one browser read), rewritten for each league id (the URLs, the request and the league's own id). */
export interface UploadTemplate {
  text: string;
  template: string;
}

export async function uploadTemplate(data: PlatformData, platform: "espn" | "sleeper"): Promise<UploadTemplate> {
  const template = platform === "espn" ? "3999999999" : "4999999999999999999";
  const body = platform === "espn" ? { leagueId: template, season: SEASON } : { season: SEASON, leagueId: template };
  const read = await readInBrowser({ platform, body, http: browserClient(data), espnCookies: "none" });
  if (read.kind !== "upload") throw new Error(`the browser's read of the ${platform} template didn't make an upload (${read.kind})`);
  return { text: JSON.stringify(read.upload satisfies LeagueUpload), template };
}

export const uploadFor = (t: UploadTemplate, leagueId: string): Uint8Array => gzipSync(Buffer.from(t.text.split(t.template).join(leagueId), "utf8"), { level: 6 });

export const espnLeagueId = (i: number) => String(2_000_000_000 + i);
export const sleeperLeagueId = (i: number) => `4${String(i).padStart(18, "0")}`;

// ---------------------------------------------------------------------------------------------
// Running a scenario

export interface Job {
  instance: number;
  route: RouteName;
  request: Request;
}

export interface Outcome {
  route: RouteName;
  status: number;
  code: string | undefined;
  ms: number;
  /** The League page's body for a signed import answer (scenario 3's, for scenario 6); nothing else is kept. */
  signed?: Uint8Array;
}

export interface ScenarioReport {
  id: string;
  title: string;
  instances: number;
  outcomes: Outcome[];
  wallMs: number;
  cpuMs: number;
  rssBase: number;
  rssPeak: number;
  /** The JS heap in use after a garbage collection at the start, and at its peak during the scenario. */
  heapBase: number;
  heapPeak: number;
  outbound: Outbound[];
  unanswered: Map<string, number>;
  redis: CountingRedis;
  /** Work units the store's counters took, for work done and for refused requests (World.work). */
  work: { ok: number; refused: number };
  logs: Map<string, number>;
  /** Warning codes and unavailable sources in the 200 answers (a source the mock failed would show here), by answers. */
  warnings: Map<string, number>;
  unhandled: number;
  notes: string[];
}

/**
 * The warning codes an answer carries (the import's snapshot, the model inputs) and the data sources it says didn't load:
 * what tells a full answer from one a mock gap degraded (the crosswalk, the loaders carry on without a source).
 */
export function answerWarnings(body: unknown): string[] {
  const out = new Set<string>();
  const b = body as { snapshot?: { warnings?: Array<{ code?: unknown }> }; dataSources?: Array<{ name?: unknown; available?: unknown }>; model?: { warnings?: Array<{ code?: unknown }> }; import?: unknown } | undefined;
  for (const w of b?.snapshot?.warnings ?? []) if (typeof w.code === "string") out.add(w.code);
  for (const w of b?.model?.warnings ?? []) if (typeof w.code === "string") out.add(w.code);
  for (const s of b?.dataSources ?? []) if (s.available === false) out.add(`unavailable: ${String(s.name)}`);
  if (b?.import) for (const w of answerWarnings(b.import)) out.add(w);
  return [...out];
}

let gc: (() => void) | undefined;

function collectGarbage(): void {
  try {
    if (!gc) {
      v8.setFlagsFromString("--expose-gc");
      gc = vm.runInNewContext("gc") as () => void;
    }
    gc();
  } catch {
    // no gc: the memory numbers include what earlier scenarios left
  }
}

let unhandled = 0;

/**
 * Starts every job at the same moment, waits for every answer, then for the after-response writes and any request still
 * out (so each scenario's numbers are its own), measuring the process's CPU, peak memory and the log's lines meanwhile.
 */
export async function runJobs(id: string, title: string, world: World, jobs: Job[], notes: string[] = [], signedFor?: (i: number) => string): Promise<ScenarioReport> {
  collectGarbage();
  const rssBase = process.memoryUsage().rss;
  let rssPeak = rssBase;
  const heapBase = process.memoryUsage().heapUsed;
  let heapPeak = heapBase;
  const sampler = setInterval(() => {
    const m = process.memoryUsage();
    rssPeak = Math.max(rssPeak, m.rss);
    heapPeak = Math.max(heapPeak, m.heapUsed);
  }, 20);
  const logs = new Map<string, number>();
  const consoleError = console.error;
  console.error = (...args: unknown[]) => {
    const line = args.map(String).join(" ");
    let label = "other console line";
    try {
      const e = JSON.parse(line) as { event?: string; code?: string; platform?: string };
      if (e.event) label = [e.event, e.code, e.platform].filter(Boolean).join(" ");
    } catch {
      // not a log event
    }
    logs.set(label, (logs.get(label) ?? 0) + 1);
  };
  const unhandledBefore = unhandled;
  const warnings = new Map<string, number>();
  const cpu0 = process.cpuUsage();
  const t0 = performance.now();
  let outcomes: Outcome[];
  try {
    outcomes = await Promise.all(
      jobs.map(async (job, i) => {
        const started = performance.now();
        const instance = world.instances[job.instance] as Instance;
        const res = await instance.routes[job.route](job.request);
        const text = await res.text();
        const ms = performance.now() - started;
        let body: unknown;
        try {
          body = JSON.parse(text);
        } catch {
          body = undefined;
        }
        const code = (body as { error?: { code?: unknown } } | undefined)?.error?.code;
        if (res.status === 200) for (const w of answerWarnings(body)) warnings.set(w, (warnings.get(w) ?? 0) + 1);
        const signed = signedFor && res.status === 200 ? signedBody(body, signedFor(i)) : undefined;
        return { route: job.route, status: res.status, code: typeof code === "string" ? code : undefined, ms, ...(signed ? { signed } : {}) };
      }),
    );
    const wallMs = performance.now() - t0;
    // The after-response writes, and anything still out (a background crosswalk build, a fetch a waiter gave up on).
    await Promise.all(world.pending);
    for (let waited = 0; world.platform.inFlight > 0 && waited < 60_000; waited += 50) await sleep(50);
    await Promise.all(world.pending);
    const cpu = process.cpuUsage(cpu0);
    return {
      id,
      title,
      instances: world.instances.length,
      outcomes,
      wallMs,
      cpuMs: (cpu.user + cpu.system) / 1000,
      rssBase,
      rssPeak,
      heapBase,
      heapPeak,
      outbound: world.platform.records,
      unanswered: world.platform.unanswered,
      redis: world.redis,
      work: world.work,
      logs,
      warnings,
      unhandled: unhandled - unhandledBefore,
      notes,
    };
  } finally {
    clearInterval(sampler);
    console.error = consoleError;
  }
}

// ---------------------------------------------------------------------------------------------
// The checks

export interface HostCheck {
  requests: number;
  /** Most requests to the host at once from one instance (the client allows 1). */
  maxConcurrent: number;
  /** Least time between one request's end and the next one's start on an instance (ms), or undefined for fewer than two. */
  minGapMs: number | undefined;
  /** The instance with the most requests to the host, and how many. */
  busiestInstance: number;
}

/** Per host: concurrency and gaps on each instance (the server client's pacing), over every instance. */
export function hostChecks(records: readonly Outbound[]): Map<HostKind | "other", HostCheck> {
  const out = new Map<HostKind | "other", HostCheck>();
  const byHostInstance = new Map<string, Outbound[]>();
  for (const r of records) {
    const k = `${r.host}\u0000${r.instance}`;
    const list = byHostInstance.get(k) ?? [];
    list.push(r);
    byHostInstance.set(k, list);
  }
  for (const [k, list] of byHostInstance) {
    const host = k.split("\u0000")[0] as HostKind | "other";
    const sorted = [...list].sort((a, b) => a.start - b.start);
    let maxConcurrent = 0;
    for (const r of sorted) maxConcurrent = Math.max(maxConcurrent, sorted.filter((o) => o.start <= r.start && o.end > r.start).length);
    let minGap: number | undefined;
    for (let i = 1; i < sorted.length; i++) {
      const gap = (sorted[i] as Outbound).start - (sorted[i - 1] as Outbound).end;
      minGap = minGap === undefined ? gap : Math.min(minGap, gap);
    }
    const c = out.get(host) ?? { requests: 0, maxConcurrent: 0, minGapMs: undefined, busiestInstance: 0 };
    c.requests += list.length;
    c.maxConcurrent = Math.max(c.maxConcurrent, maxConcurrent);
    if (minGap !== undefined) c.minGapMs = c.minGapMs === undefined ? minGap : Math.min(c.minGapMs, minGap);
    c.busiestInstance = Math.max(c.busiestInstance, list.length);
    out.set(host, c);
  }
  return out;
}

/** The most requests to `host` that started within any 60 seconds, over every instance. */
export function maxPerMinute(records: readonly Outbound[], host: HostKind): number {
  const starts = records.filter((r) => r.host === host).map((r) => r.start).sort((a, b) => a - b);
  let best = 0;
  for (let i = 0, j = 0; i < starts.length; i++) {
    while ((starts[i] as number) - (starts[j] as number) >= 60_000) j++;
    best = Math.max(best, i - j + 1);
  }
  return best;
}

/** Requests one instance made again for the same resource (URL and filter) within the scenario. */
export function repeats(records: readonly Outbound[]): number {
  const seen = new Set<string>();
  let n = 0;
  for (const r of records) {
    const k = `${r.instance}\u0000${r.key}`;
    if (seen.has(k)) n++;
    seen.add(k);
  }
  return n;
}

/** A counter's value by the key's shape (the latest value FakeRedis returned), summed over matching keys. */
function counterSum(redis: CountingRedis, pattern: RegExp): number {
  let n = 0;
  for (const [k, v] of redis.counters) if (pattern.test(k)) n += v - (redis.counterBase.get(k) ?? 0);
  return n;
}

function counterMax(redis: CountingRedis, pattern: RegExp): number {
  let n = 0;
  for (const [k, v] of redis.counters) if (pattern.test(k)) n = Math.max(n, v - (redis.counterBase.get(k) ?? 0));
  return n;
}

/** Starts a world's counts again after a warm-up (its store and instances keep what the warm-up left in them). */
function resetCounts(world: World): void {
  world.platform.records.length = 0;
  world.platform.unanswered.clear();
  world.redis.resetCounts();
  world.work.ok = 0;
  world.work.refused = 0;
}

// ---------------------------------------------------------------------------------------------
// The report (markdown, printed)

const PLATFORMS: readonly BudgetPlatform[] = ["espn", "sleeper", "fantasycalc", "github"];

function answersText(outcomes: readonly Outcome[]): string {
  const by = new Map<string, number>();
  for (const o of outcomes) {
    const k = o.code ? `${o.status} ${o.code}` : String(o.status);
    by.set(k, (by.get(k) ?? 0) + 1);
  }
  return [...by].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} × ${k}`).join(", ");
}

function latencyText(outcomes: readonly Outcome[], filter?: (o: Outcome) => boolean): string {
  const ms = outcomes.filter(filter ?? (() => true)).map((o) => o.ms);
  if (!ms.length) return "—";
  return `${sec(percentile(ms, 50))} / ${sec(percentile(ms, 95))} / ${sec(Math.max(...ms))}`;
}

export interface Verdicts {
  internal: number;
  overDeadline: number;
  politeness: string[];
}

/** The scenario's table (markdown lines), its verdicts and its row of the summary table. */
export function describe(r: ScenarioReport): { lines: string[]; verdicts: Verdicts; row: string } {
  const lines: string[] = [];
  const ok = r.outcomes.filter((o) => o.status === 200);
  lines.push(`### ${r.id}. ${r.title} (${r.instances} instance${r.instances > 1 ? "s" : ""})`, "");
  lines.push("| Measure | Value |", "|---|---|");
  lines.push(`| Answers | ${answersText(r.outcomes)} |`);
  lines.push(`| Latency p50 / p95 / max, all | ${latencyText(r.outcomes)} (wall ${sec(r.wallMs)}) |`);
  if (ok.length && ok.length < r.outcomes.length) lines.push(`| Latency p50 / p95 / max, 200s | ${latencyText(r.outcomes, (o) => o.status === 200)} |`);
  const byWhat = new Map<string, number>();
  for (const o of r.outbound) byWhat.set(o.what, (byWhat.get(o.what) ?? 0) + 1);
  const outbound = PLATFORMS.map((p) => [p, r.outbound.filter((o) => o.host === p).length] as const);
  lines.push(`| Outbound requests | ${outbound.map(([p, n]) => `${p} ${n}`).join(" · ")} (${[...byWhat].map(([w, n]) => `${w} ${n}`).join(", ")}) |`);
  const aborted = r.outbound.filter((o) => o.aborted).length;
  const rep = repeats(r.outbound);
  if (aborted || rep) lines.push(`| Cut or repeated | ${aborted} cut by the deadline mid-answer · ${rep} asked again by the same instance |`);
  if (r.unanswered.size) lines.push(`| Unanswered by the mock (404) | ${[...r.unanswered].map(([h, n]) => `${h} ${n}`).join(", ")} |`);
  const uses = [...r.redis.uses].filter(([, t]) => t.commands > 0).sort((a, b) => b[1].commands - a[1].commands);
  lines.push(`| Upstash commands | ${r.redis.stats.commands} (${uses.map(([u, t]) => `${u} ${t.commands}`).join(", ")}) |`);
  lines.push(`| Upstash bytes | ${mb(r.redis.stats.bytesIn)} sent, ${mb(r.redis.stats.bytesOut)} received (cache ${mb((r.redis.uses.get("cache")?.bytesIn ?? 0) + (r.redis.uses.get("cache")?.bytesOut ?? 0))}) |`);
  const per = r.outcomes.length ? r.cpuMs / r.outcomes.length : 0;
  lines.push(`| Process CPU | ${sec(r.cpuMs)} (${(per / 1000).toFixed(2)} s a request) |`);
  lines.push(`| Peak memory | JS heap ${mb(r.heapPeak)} (${mb(r.heapPeak - r.heapBase)} over its start after a GC); process RSS ${mb(r.rssPeak)} |`);
  const day = utcDay(Date.now());
  const work = counterSum(r.redis, new RegExp(`work:${day}$`));
  const workClient = counterMax(r.redis, /work:client:/);
  // Refused charges' units go back to their counters (src/server/budget.ts; Checkpoint 7b load test, defect 2): what the
  // day's counter holds past the units charged for work done is what stayed counted for them.
  const keptForRefused = work - r.work.ok;
  const refusedText = r.work.refused ? `; refused charges ${r.work.refused} units, ${keptForRefused > 0 ? `${keptForRefused} of them still counted` : "all given back"}` : "";
  lines.push(
    `| Work units | the server's day counter ${work} (${r.work.ok} charged for work done${refusedText}; the day's ${workLimits.perDay}: ${slicedAllowance(workLimits.perDay, Date.now())} open now); one visitor's counter at most ${workClient} of ${workLimits.perClientPerDay} |`,
  );
  const budgetLine = PLATFORMS.map((p) => {
    const counted = counterSum(r.redis, new RegExp(`budget:${p}:${day}$`));
    const sent = r.outbound.filter((o) => o.host === p).length;
    return counted || sent ? `${p} ${counted} counted / ${sent} sent` : "";
  }).filter(Boolean);
  lines.push(`| Outbound budgets | ${budgetLine.join(" · ") || "none used"}; most of one group's ESPN share ${counterMax(r.redis, /budget:client:espn:/)} of ${budgets.perClientPerDay.espn} |`);
  // Politeness: the server's pacing per instance, and Sleeper's per-minute rule over all of them.
  const checks = hostChecks(r.outbound);
  const politeness: string[] = [];
  const pace: string[] = [];
  for (const [host, c] of checks) {
    if (host === "other") continue;
    const gapOk = c.minGapMs === undefined || c.minGapMs >= SERVER_GAP_MS[host] - 2;
    if (c.maxConcurrent > 1) politeness.push(`${host}: ${c.maxConcurrent} at once on one instance`);
    if (!gapOk) politeness.push(`${host}: a gap of ${c.minGapMs} ms (the client's is ${SERVER_GAP_MS[host]})`);
    pace.push(`${host} ${c.maxConcurrent === 1 && gapOk ? "✓" : "✗"} (at most ${c.maxConcurrent} at once, gap ≥ ${c.minGapMs ?? "—"} ms, busiest instance ${c.busiestInstance})`);
  }
  const sleeperMinute = maxPerMinute(r.outbound, "sleeper");
  if (sleeperMinute > SLEEPER_PER_MINUTE) politeness.push(`sleeper: ${sleeperMinute} calls in a minute`);
  lines.push(`| Politeness | ${pace.join(" · ") || "no requests"}; Sleeper's busiest minute ${sleeperMinute} of ${SLEEPER_PER_MINUTE} |`);
  const internal = r.outcomes.filter((o) => o.status >= 500 && o.status !== 503 && o.status !== 504).length;
  // A route's answer may run past its deadline by the cache's grace and a late floor (src/server/deadline.ts), never 5 s.
  const deadlineMs = (route: RouteName) => (route === "modelEspn" ? deadlines.modelMs : deadlines.importMs);
  const over = r.outcomes.filter((o) => o.ms > deadlineMs(o.route) + 5_000).length;
  lines.push(`| Errors | ${internal} × 5xx other than BUSY/SOURCE_SLOW · ${over} answers past the deadline + 5 s · ${r.unhandled} unhandled rejections |`);
  const logs = [...r.logs].sort((a, b) => b[1] - a[1]);
  lines.push(`| Log lines | ${logs.length ? logs.map(([e, n]) => `${e} ×${n}`).join(", ") : "none"} |`);
  const warned = [...r.warnings].sort((a, b) => a[0].localeCompare(b[0]));
  lines.push(`| Warnings in the 200 answers | ${warned.length ? warned.map(([w, n]) => `${w} ×${n}`).join(", ") : "none"} |`);
  for (const n of r.notes) lines.push(`| Note | ${n} |`);
  lines.push("");
  // One row of the run's summary table (SUMMARY_HEADER).
  const sent = (p: BudgetPlatform) => r.outbound.filter((o) => o.host === p).length;
  const espnCounted = counterSum(r.redis, new RegExp(`budget:espn:${day}$`));
  const row = [
    `${r.id} (${r.instances})`,
    answersText(r.outcomes),
    latencyText(r.outcomes),
    `${sent("espn")}${espnCounted !== sent("espn") ? ` (${espnCounted} counted)` : ""} / ${sent("sleeper")} / ${sent("fantasycalc")} / ${sent("github")}`,
    `${r.redis.stats.commands} · ${mb(r.redis.stats.bytesIn + r.redis.stats.bytesOut)}`,
    `${sec(r.cpuMs)} (${(per / 1000).toFixed(2)})`,
    `${mb(r.heapPeak - r.heapBase)}`,
    `${work}${r.work.refused ? ` (${r.work.refused} refused: ${keptForRefused > 0 ? `${keptForRefused} kept` : "given back"})` : ""}`,
  ];
  return { lines, verdicts: { internal, overDeadline: over, politeness }, row: `| ${row.join(" | ")} |` };
}

/** The summary table's header (describe's `row`). */
export const SUMMARY_HEADER = [
  "| Scenario (instances) | Answers | Latency p50 / p95 / max | Sent: ESPN / Sleeper / FantasyCalc / GitHub | Upstash commands · bytes | CPU (a request) | Peak heap growth | Work units (the day's counter) |",
  "|---|---|---|---|---|---|---|---|",
];

// ---------------------------------------------------------------------------------------------
// The scenarios

interface Context {
  data: PlatformData;
  opts: LoadTestOptions;
  espnUpload?: UploadTemplate;
  sleeperUpload?: UploadTemplate;
  /** Scenario 3's signed imports (the League page's bodies for scenario 6), by league. */
  signed?: Array<{ leagueId: string; body: Uint8Array }>;
}

const MODEL_PATH = "/api/model/espn";

/** The League page's gzip body for a signed import answer (src/lib/api.ts SignedModelBody). */
function signedBody(answer: unknown, leagueId: string): Uint8Array | undefined {
  const a = answer as { snapshot?: unknown; modelPart?: unknown; signed?: unknown };
  if (!a?.snapshot || !a.modelPart || !a.signed) return undefined;
  return gzipSync(Buffer.from(JSON.stringify({ v: 1, leagueId, season: SEASON, import: { snapshot: a.snapshot, modelPart: a.modelPart }, signed: a.signed }), "utf8"));
}

async function espnUploads(ctx: Context): Promise<UploadTemplate> {
  ctx.espnUpload ??= await uploadTemplate(ctx.data, "espn");
  return ctx.espnUpload;
}

async function sleeperUploads(ctx: Context): Promise<UploadTemplate> {
  ctx.sleeperUpload ??= await uploadTemplate(ctx.data, "sleeper");
  return ctx.sleeperUpload;
}

/**
 * Scenario 3's work: `count` ESPN uploads (leagues `from`, `from` + 1 …) on `world`'s first instance, and the signed imports
 * they answered (the League page's bodies).
 */
async function uploadEspnLeagues(ctx: Context, world: World, id: string, title: string, count: number, from = 0): Promise<{ report: ScenarioReport; signed: Array<{ leagueId: string; body: Uint8Array }> }> {
  const t = await espnUploads(ctx);
  const league = (i: number) => espnLeagueId(from + i);
  const bodies = Array.from({ length: count }, (_, i) => uploadFor(t, league(i)));
  const jobs = bodies.map((b, i) => ({ instance: 0, route: "importEspn" as const, request: gzipRequest("/api/import/espn", visitorIp(from + i), b) }));
  const report = await runJobs(id, title, world, jobs, [`each upload ${kb(bodies[0]?.byteLength ?? 0)} gzipped (${mb(t.text.length)} of JSON), made before the clock started`], league);
  return { report, signed: report.outcomes.flatMap((o, i) => (o.signed ? [{ leagueId: league(i), body: o.signed }] : [])) };
}

/** One scenario on its own cold world (a fresh store, fresh instances: see the header). */
async function scenario(id: string, ctx: Context): Promise<ScenarioReport> {
  const { opts, data } = ctx;
  const n = opts.imports;
  const spread = id.endsWith("m") ? opts.spread : 1;
  const on = (i: number) => i % spread;
  switch (id) {
    case "1":
    case "1m": {
      const jobs = Array.from({ length: n }, (_, i) => ({ instance: on(i), route: "importEspn" as const, request: jsonRequest("/api/import/espn", visitorIp(i), { leagueId: "1000000001", season: SEASON }) }));
      return runJobs(id, `${n} visitors import the same public ESPN league, server path`, newWorld(data, opts, spread), jobs);
    }
    case "2":
    case "2m": {
      const jobs = Array.from({ length: n }, (_, i) => ({ instance: on(i), route: "importEspn" as const, request: jsonRequest("/api/import/espn", visitorIp(i), { leagueId: espnLeagueId(i), season: SEASON }) }));
      return runJobs(id, `${n} visitors import ${n} different ESPN leagues, server path`, newWorld(data, opts, spread), jobs);
    }
    case "3": {
      const { report, signed } = await uploadEspnLeagues(ctx, newWorld(data, opts, 1), "3", `${n} browser-path ESPN uploads (${n} leagues)`, n);
      ctx.signed = signed;
      return report;
    }
    case "4": {
      const t = await sleeperUploads(ctx);
      const bodies = Array.from({ length: n }, (_, i) => uploadFor(t, sleeperLeagueId(i)));
      const jobs = bodies.map((b, i) => ({ instance: 0, route: "importSleeper" as const, request: gzipRequest("/api/import/sleeper", visitorIp(i), b) }));
      return runJobs("4", `${n} browser-path Sleeper uploads (${n} leagues)`, newWorld(data, opts, 1), jobs, [`each upload ${kb(bodies[0]?.byteLength ?? 0)} gzipped`]);
    }
    case "5":
    case "5b": {
      const ip = "10.250.0.9";
      const notes: string[] = [];
      const world = newWorld(data, opts, 1);
      if (id === "5b") {
        // The visitor's day so far: 480 of its 500 units (about 80 server-path imports), charged through the real quota.
        const ids = clientIds(new Request(SITE, { headers: { "x-real-ip": ip } }), VERCEL_ENV);
        await (world.instances[0] as Instance).work.charge(480, { client: ids.client, group: ids.group });
        notes.push("the visitor had used 480 of its 500 work units today before the burst (charged through the real quota; counted in the units above)");
      }
      const jobs = Array.from({ length: n }, () => ({ instance: 0, route: "importEspn" as const, request: jsonRequest("/api/import/espn", ip, { leagueId: "1000000001", season: SEASON }) }));
      return runJobs(id, `one visitor (one IP) sends ${n} server-path imports${id === "5b" ? ", near its day's work budget" : ""}`, world, jobs, notes);
    }
    case "6":
    case "6m":
    case "6w": {
      // Scenario 3 didn't run (or answered fewer): its uploads, imported on a throwaway world, make the signed imports.
      if (!ctx.signed || ctx.signed.length < n) ctx.signed = (await uploadEspnLeagues(ctx, newWorld(data, opts, 1), "setup", "signed imports for scenario 6", n)).signed;
      const signed = ctx.signed.slice(0, n);
      // 6w: one more league's signed import, built first so the public data is warm (on the instance and in the store).
      const warmUp = id === "6w" ? (await uploadEspnLeagues(ctx, newWorld(data, opts, 1), "setup", "the warm-up's signed import", 1, n)).signed[0] : undefined;
      const world = newWorld(data, opts, spread);
      const notes = [`each signed import ${kb(signed[0]?.body.byteLength ?? 0)} gzipped`];
      if (warmUp) {
        await runJobs("warm-up", "warm-up", world, [{ instance: 0, route: "modelEspn", request: gzipRequest(MODEL_PATH, visitorIp(n), warmUp.body) }]);
        resetCounts(world);
        notes.push("the public data warm: another league's build ran first, not counted");
      }
      const jobs = signed.map((s, i) => ({ instance: on(i), route: "modelEspn" as const, request: gzipRequest(MODEL_PATH, visitorIp(i), s.body) }));
      return runJobs(id, `${signed.length} League page builds from signed imports (${signed.length} leagues)${id === "6w" ? ", public data warm" : ""}`, world, jobs, notes);
    }
    default:
      throw new Error(`unknown scenario ${id}`);
  }
}

// ---------------------------------------------------------------------------------------------

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  installNetworkGuard();
  process.env.VERCEL = VERCEL_ENV.VERCEL;
  process.env.VERCEL_ENV = VERCEL_ENV.VERCEL_ENV;
  process.env.SESSION_SECRET = MADE_UP_SECRET;
  process.on("unhandledRejection", () => {
    unhandled++;
  });
  const opts = parseArgs(argv);
  const data = new PlatformData(opts.liveSize);
  const cpu = os.cpus()[0]?.model.trim() ?? "unknown CPU";
  console.log(`# Load test (offline), ${new Date().toISOString().slice(0, 16)}Z`);
  console.log("");
  console.log(`Node ${process.versions.node} on ${cpu} (${os.cpus().length} threads; one process plays every instance). ${opts.imports} requests a scenario, started at once; seed ${opts.seed}; Upstash ${opts.redisMs} ms a command; League page builds at once per instance: ${opts.buildSlots > 0 ? opts.buildSlots : "no cap"}.`);
  console.log(`Latency (ms): ${Object.entries(opts.latency).map(([h, r]) => `${h} ${r.min}–${r.max}`).join(", ")}. Bodies: ${opts.liveSize ? "public data padded to live sizes" : "fixture sizes"}.`);
  console.log(`The day's budgets open now (UTC slice): ESPN ${slicedAllowance(budgets.perDay.espn - budgets.reservedForCookies.espn, Date.now())} without cookies, Sleeper ${slicedAllowance(budgets.perDay.sleeper, Date.now())}, work ${slicedAllowance(workLimits.perDay, Date.now())} units.`);
  console.log("");
  const ctx: Context = { data, opts };
  // Only the verdicts are kept from one scenario to the next (each report's records go with it).
  const verdicts: Array<{ id: string; v: Verdicts }> = [];
  const rows: string[] = [];
  for (const id of opts.scenarios) {
    const { lines, verdicts: v, row } = describe(await scenario(id, ctx));
    for (const l of lines) console.log(l);
    verdicts.push({ id, v });
    rows.push(row);
  }
  console.log("### Summary", "");
  for (const l of [...SUMMARY_HEADER, ...rows]) console.log(l);
  console.log("");
  console.log("### Body sizes (one fetch each)", "");
  for (const [what, bytes] of data.sizes) console.log(`- ${what}: ${mb(bytes)}`);
  console.log("");
  const bad = verdicts.filter(({ v }) => v.internal || v.overDeadline || v.politeness.length);
  console.log(`Network guard: ${refusedConnections} connection attempts refused (must be 0).`);
  console.log(bad.length ? `✗ Problems: ${bad.map(({ id, v }) => `${id}: ${[v.internal ? `${v.internal} × 5xx` : "", v.overDeadline ? `${v.overDeadline} past the deadline` : "", ...v.politeness].filter(Boolean).join("; ")}`).join(" | ")}` : "✓ No 500s, no answer past its deadline, every host paced.");
  if (bad.length || refusedConnections) process.exitCode = 1;
}

if (isMainModule(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(`load-test stopped: ${err instanceof Error ? `${err.name}: ${err.message}` : "error"}`);
    process.exitCode = 1;
  });
}
