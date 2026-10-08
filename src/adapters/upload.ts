/**
 * A league the browser read, on its way to the server (planner reply to Checkpoint 4c, Part B, B1: browser fetching;
 * track BF). The browser runs an adapter's league-data half (src/adapters/espn/leagueData.ts, src/adapters/sleeper/
 * leagueData.ts) through a recording client: every response it gets is kept in the adapter's own "schema-kept" form
 * (parsed with the adapter's zod schemas, unknown keys removed: trimEspnBody, trimSleeperBody), in the order asked. The
 * browser gzips that record (a LeagueUpload) and posts it to the import route, where the server checks it
 * (src/app/api/_lib/upload.ts), replays it through the SAME league-data half (replayClient: each request answered from the
 * record), adds the public data it reads itself (ESPN's NFL schedule, Sleeper's projections and NFL state) and normalizes
 * it as its own read would be. So the two paths can't drift: the browser and the replay ask the same requests in the same
 * order and judge every answer alike, and a response missing from the record is "no response" (the adapter's usual
 * warning, or its SOURCE_DOWN for a required one).
 *
 * The schema-kept form is a fixed point: the adapter's schemas read it exactly as they read the raw body (a row a schema
 * turns down is kept as it came, so it's turned down again; upload.test.ts proves the normalizer's output identical on the
 * committed fixtures, and scripts/measure-upload.ts on full-size bodies), and it holds only what Offer Sheet reads (about
 * 2.1 MB of an ESPN league's 8, half a megabyte gzipped). The record never holds credentials (the browser path is for
 * leagues read without cookies) or SWIDs (pseudonymized in the browser, and again on arrival). Browser-safe.
 *
 * What a browser sends is its own word, so the server bounds its work on it (review BF-R1): uploadShapeProblem refuses an
 * upload that holds more than any real league (UploadShapeLimits: entries per list, nesting, teams, rostered players,
 * scoring rules, transactions), the adapters hold the league's own numbers that drive their loops to real ranges, and
 * the replay answers no more requests than an honest read could ask.
 */
import { BracketMatchSchema, DraftSchema, LeagueListItemSchema, LeagueSchema as SleeperLeagueSchema, LeagueUserSchema, MatchupSchema, RosterSchema, StateSchema, TradedPickSchema, TransactionSchema as SleeperTransactionSchema, UserSchema } from "./sleeper/schemas";
import { LeagueSchema as EspnLeagueSchema, PlayerCardSchema, PlayerListResponseSchema, PoolPlayerSchema, TransactionSchema as EspnTransactionSchema, TransactionsResponseSchema } from "./espn/schema";
import { ESPN_READS_BASE, FILTER_HEADER, LEAGUE_VIEWS } from "./espn/leagueData";
import { SLEEPER_API } from "./sleeper/leagueData";
import { LeagueImportError, type HttpClient, type HttpRequestOptions, type HttpResponse } from "./types";

/** The upload format's version (LeagueUpload.v). */
export const UPLOAD_VERSION = 1;

/** One response the browser got (see the header). */
export interface UploadPart {
  /** The platform's own address it asked. */
  url: string;
  /** ESPN's X-Fantasy-Filter header as sent (JSON text), when the request had one (several ESPN views share a URL). */
  filter?: string;
  /** The answer's HTTP status; 0 when there was none (a network error, a timeout). */
  status: number;
  /** The answer was an HTML page (an ESPN login page) rather than data. */
  html?: true;
  /** The body in its schema-kept form; absent when it wasn't JSON. */
  json?: unknown;
  /** When it arrived, by the browser's clock (epoch ms). */
  at: number;
}

/** What the browser sends the import route (see the header). */
export interface LeagueUpload {
  v: typeof UPLOAD_VERSION;
  platform: "espn" | "sleeper";
  /**
   * What was read: the league and its season, and for Sleeper the username the user typed (it finds their team; the
   * league a username's list offered is sent as its league ID).
   */
  request: { leagueId: string; season: number; username?: string };
  /** When the browser sent it, by its own clock: a part's age is sentAt − at (the server never compares the two clocks). */
  sentAt: number;
  parts: UploadPart[];
}

/** The key a part is filed under: its address and, for ESPN's filtered views, the filter. */
function partKey(url: string, filter: string | undefined): string {
  return `${url}\u0000${filter ?? ""}`;
}

/** A request's X-Fantasy-Filter header (any case), or undefined. */
function filterOf(opts: HttpRequestOptions | undefined): string | undefined {
  for (const [name, value] of Object.entries(opts?.headers ?? {})) if (name.toLowerCase() === FILTER_HEADER) return value;
  return undefined;
}

/** A client that records what it got (recordingClient). */
export interface RecordingClient extends HttpClient {
  /** The responses so far, in the order first asked. */
  parts(): UploadPart[];
}

/**
 * A client over `inner` that keeps each response in its schema-kept form (`trim`) and answers with that form, so the
 * browser's own read of the league judges exactly what the server's replay will (see the header). A request asked twice
 * (a username looked up for the league list, then again for the league) is answered from the first response.
 */
export function recordingClient(inner: HttpClient, trim: (url: string, json: unknown) => unknown, clock: () => number = Date.now): RecordingClient {
  const parts = new Map<string, UploadPart>();
  const toResponse = (p: UploadPart): HttpResponse => ({
    status: p.status,
    ok: p.status >= 200 && p.status < 300,
    isHtml: p.html === true,
    json: p.json,
    text: "",
    fromCache: false,
    fetchedAt: p.at,
  });
  return {
    parts: () => [...parts.values()],
    async get(url, opts) {
      const filter = filterOf(opts);
      const key = partKey(url, filter);
      const seen = parts.get(key);
      if (seen) return toResponse(seen);
      const res = await inner.get(url, opts);
      const part: UploadPart = {
        url,
        ...(filter !== undefined ? { filter } : {}),
        status: res.status,
        ...(res.isHtml ? { html: true as const } : {}),
        ...(res.json !== undefined ? { json: trim(url, res.json) } : {}),
        at: res.fetchedAt ?? clock(),
      };
      parts.set(key, part);
      return toResponse(part);
    },
  };
}

/**
 * A client that answers each request from an upload's parts (see the header): a part's fetch time is the server's clock
 * less the part's age by the browser's, and a request the upload doesn't hold gets "no response" (status 0). It asks
 * nobody. A backstop (review BF-R1): once it has answered more requests than the upload holds parts plus `maxParts` (an
 * honest read asks each of its requests once, and the league-data halves ask at most a few dozen), it throws
 * BAD_RESPONSE instead of answering again, so no loop over the league's own numbers can run on.
 */
export function replayClient(upload: Pick<LeagueUpload, "parts" | "sentAt">, now: number, maxParts = upload.parts.length): HttpClient {
  const parts = new Map(upload.parts.map((p) => [partKey(p.url, p.filter), p]));
  const allowed = upload.parts.length + maxParts;
  let asked = 0;
  return {
    async get(url, opts) {
      asked += 1;
      if (asked > allowed) throw new LeagueImportError("BAD_RESPONSE", "The league data the browser sent asks for more than a league holds.", {});
      const p = parts.get(partKey(url, filterOf(opts)));
      if (!p) return { status: 0, ok: false, isHtml: false, json: undefined, text: "", fromCache: false };
      return {
        status: p.status,
        ok: p.status >= 200 && p.status < 300,
        isHtml: p.html === true,
        json: p.json,
        text: "",
        fromCache: false,
        fetchedAt: now - Math.max(0, upload.sentAt - p.at),
      };
    },
  };
}

/** Why an upload's times can't be used, or null: every part arrived at most `maxAgeMs` before the upload was sent. */
export function uploadTimesProblem(upload: Pick<LeagueUpload, "parts" | "sentAt">, maxAgeMs: number): string | null {
  for (const p of upload.parts) {
    const age = upload.sentAt - p.at;
    if (!Number.isFinite(age) || age < 0 || age > maxAgeMs) return "a response is older than the upload allows, or from after it was sent";
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// The schema-kept form

interface Parser {
  safeParse(x: unknown): { success: true; data: unknown } | { success: false };
}

/** A row its schema reads, as the schema keeps it; one it turns down, as it came (so it's turned down again). */
function kept(schema: Parser, row: unknown): unknown {
  const r = schema.safeParse(row);
  return r.success ? r.data : row;
}

/** An array body, row by row (anything else as it came). */
function rows(schema: Parser, json: unknown): unknown {
  return Array.isArray(json) ? json.map((row) => kept(schema, row)) : json;
}

/** An ESPN list body ({ players: [...] } or { transactions: [...] }): its envelope as its schema keeps it, its rows row by row. */
function espnList(envelope: Parser, field: "players" | "transactions", row: Parser, json: unknown): unknown {
  const env = envelope.safeParse(json);
  if (!env.success) return json;
  const data = env.data as Record<string, unknown>;
  const list = data[field];
  return Array.isArray(list) ? { ...data, [field]: list.map((r) => kept(row, r)) } : data;
}

/**
 * An ESPN body in its schema-kept form, by the view it answers (src/adapters/espn/leagueData.ts requests 1–4): the league
 * view by LeagueSchema, transactions, free agents and player cards row by row, as the normalizer reads them.
 */
export function trimEspnBody(url: string, json: unknown): unknown {
  let views: string[];
  try {
    views = new URL(url).searchParams.getAll("view");
  } catch {
    return json;
  }
  if (views.includes("mSettings")) return kept(EspnLeagueSchema, json);
  if (views.includes("mTransactions2")) return espnList(TransactionsResponseSchema, "transactions", EspnTransactionSchema, json);
  if (views.includes("kona_player_info")) return espnList(PlayerListResponseSchema, "players", PoolPlayerSchema, json);
  if (views.includes("kona_playercard")) return espnList(PlayerListResponseSchema, "players", PlayerCardSchema, json);
  return json;
}

/**
 * A league member as the normalizer reads it (src/adapters/sleeper/normalize.ts teamNameOf): its schema-kept fields, and
 * of its metadata only the team name (review BF-R5: the rest of a member's metadata, an avatar or notification settings,
 * is nothing Offer Sheet reads, so it isn't sent). A row the schema turns down comes as it was, like any other.
 */
function leagueUser(row: unknown): unknown {
  const r = LeagueUserSchema.safeParse(row);
  if (!r.success) return row;
  const { metadata, ...rest } = r.data;
  if (metadata === null || metadata === undefined) return r.data;
  return { ...rest, metadata: Object.hasOwn(metadata, "team_name") ? { team_name: metadata.team_name } : {} };
}

/** The Sleeper league-data responses by their path (src/adapters/sleeper/leagueData.ts), each with how its body is read. */
const SLEEPER_BODIES: ReadonlyArray<[RegExp, (json: unknown) => unknown]> = [
  [/^\/v1\/state\/nfl$/, (j) => kept(StateSchema, j)],
  [/^\/v1\/user\/[^/]+$/, (j) => kept(UserSchema, j)],
  [/^\/v1\/user\/[^/]+\/leagues\/nfl\/\d+$/, (j) => rows(LeagueListItemSchema, j)],
  [/^\/v1\/league\/\d+$/, (j) => kept(SleeperLeagueSchema, j)],
  [/^\/v1\/league\/\d+\/users$/, (j) => (Array.isArray(j) ? j.map(leagueUser) : j)],
  [/^\/v1\/league\/\d+\/rosters$/, (j) => rows(RosterSchema, j)],
  [/^\/v1\/league\/\d+\/matchups\/\d+$/, (j) => rows(MatchupSchema, j)],
  [/^\/v1\/league\/\d+\/transactions\/\d+$/, (j) => rows(SleeperTransactionSchema, j)],
  [/^\/v1\/league\/\d+\/traded_picks$/, (j) => rows(TradedPickSchema, j)],
  [/^\/v1\/league\/\d+\/drafts$/, (j) => rows(DraftSchema, j)],
  // Checkpoint 7c (planner reply to Checkpoint 7b, §6): the playoff bracket, each match kept as its round, number and the
  // place it decides (no rosters). An older bundle's upload simply lacks it: the replay reads it as no answer.
  [/^\/v1\/league\/\d+\/winners_bracket$/, (j) => rows(BracketMatchSchema, j)],
];

/** The ESPN views the league-data half reads (src/adapters/espn/leagueData.ts requests 1–4). */
const ESPN_LEAGUE_DATA_VIEWS: ReadonlySet<string> = new Set([...LEAGUE_VIEWS, "mTransactions2", "kona_player_info", "kona_playercard"]);
const ESPN_LEAGUE_PATH = /^\/apis\/v3\/games\/ffl\/seasons\/\d{4}\/segments\/0\/leagues\/\d{1,12}$/;

/**
 * Whether an address is one of the league-data reads the browser path makes (pure): ESPN's league views (the league,
 * transactions, free agents, player cards) and Sleeper's league-data paths (the NFL state, a user and their leagues, a
 * league and its users, rosters, matchups, transactions, traded picks, drafts and, since Checkpoint 7c, its winners
 * bracket). Anything else on those hosts (projections, stats, the players list, the NFL schedule) is the server's to read
 * (review BF-R6: check:browser flags it).
 */
export function isLeagueDataRead(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.origin === new URL(ESPN_READS_BASE).origin) {
    const views = u.searchParams.getAll("view");
    return ESPN_LEAGUE_PATH.test(u.pathname) && views.length > 0 && views.every((v) => ESPN_LEAGUE_DATA_VIEWS.has(v));
  }
  if (u.origin === new URL(SLEEPER_API).origin) return SLEEPER_BODIES.some(([pattern]) => pattern.test(u.pathname));
  return false;
}

/** A Sleeper body in its schema-kept form, by its path (a body of any other path as it came). */
export function trimSleeperBody(url: string, json: unknown): unknown {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return json;
  }
  for (const [pattern, keep] of SLEEPER_BODIES) if (pattern.test(path)) return keep(json);
  return json;
}

// ---------------------------------------------------------------------------------------------
// How much an upload may hold (review BF-R1)

/**
 * What a league upload may hold (src/server/limits.ts uploadShapeLimits, passed in: this module stays free of server
 * code). The server's work on what a browser sent grows with these counts (the normalizers' grouping and trade matching,
 * the model build's scoring), and no real league comes near them, so an upload past any of them is refused and the
 * server reads the league itself.
 */
export interface UploadShapeLimits {
  /** Entries of any one list or object in any part. */
  maxEntries: number;
  /** How deep any part nests. */
  maxDepth: number;
  espn: {
    /** The league's teams. */
    teams: number;
    /** Roster entries over all teams. */
    rosterEntries: number;
    /** Scoring items (settings.scoringSettings.scoringItems). */
    scoringItems: number;
    /** Weeks over every matchup period (settings.scheduleSettings.matchupPeriods). */
    matchupPeriodWeeks: number;
    /** Transaction rows over every scoring period. */
    transactions: number;
  };
  sleeper: {
    /** The league's rosters. */
    rosters: number;
    /** Player ids over every roster's players, reserve and taxi. */
    rosterPlayers: number;
    /** Keys of the league's scoring_settings. */
    scoringKeys: number;
    /** The league's roster_positions. */
    rosterPositions: number;
  };
}

const isRecord = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === "object" && !Array.isArray(x);
const lengthOf = (x: unknown): number => (Array.isArray(x) ? x.length : 0);

/** The first list or object in `json` with more than `maxEntries` entries, or nested `maxDepth` deep, in words; null when none. Iterative. */
function containerProblem(json: unknown, maxEntries: number, maxDepth: number): string | null {
  const stack: Array<[unknown, number]> = [[json, 0]];
  while (stack.length) {
    const [value, depth] = stack.pop() as [unknown, number];
    if (value === null || typeof value !== "object") continue;
    if (depth >= maxDepth) return "nested deeper than a league's data";
    const children: unknown[] = Array.isArray(value) ? value : Object.values(value);
    if (children.length > maxEntries) return "a list longer than a league's";
    for (const child of children) if (child !== null && typeof child === "object") stack.push([child, depth + 1]);
  }
  return null;
}

function espnShapeProblem(parts: readonly UploadPart[], caps: UploadShapeLimits["espn"]): string | null {
  let transactions = 0;
  for (const p of parts) {
    if (!isRecord(p.json)) continue;
    let views: string[];
    try {
      views = new URL(p.url).searchParams.getAll("view");
    } catch {
      continue;
    }
    const body = p.json;
    if (views.includes("mSettings")) {
      const teams = Array.isArray(body.teams) ? body.teams : [];
      if (teams.length > caps.teams) return "more teams than an ESPN league has";
      let entries = 0;
      for (const t of teams) if (isRecord(t) && isRecord(t.roster)) entries += lengthOf(t.roster.entries);
      if (entries > caps.rosterEntries) return "more rostered players than an ESPN league has";
      const settings = isRecord(body.settings) ? body.settings : {};
      const scoring = isRecord(settings.scoringSettings) ? settings.scoringSettings : {};
      if (lengthOf(scoring.scoringItems) > caps.scoringItems) return "more scoring rules than an ESPN league has";
      const schedule = isRecord(settings.scheduleSettings) ? settings.scheduleSettings : {};
      let weeks = 0;
      if (isRecord(schedule.matchupPeriods)) for (const w of Object.values(schedule.matchupPeriods)) weeks += lengthOf(w);
      if (weeks > caps.matchupPeriodWeeks) return "more matchup weeks than an ESPN season has";
    } else if (views.includes("mTransactions2")) transactions += lengthOf(body.transactions);
  }
  return transactions > caps.transactions ? "more transactions than an ESPN league has" : null;
}

function sleeperShapeProblem(parts: readonly UploadPart[], caps: UploadShapeLimits["sleeper"]): string | null {
  for (const p of parts) {
    let path: string;
    try {
      path = new URL(p.url).pathname;
    } catch {
      continue;
    }
    if (/\/v1\/league\/\d+$/.test(path) && isRecord(p.json)) {
      if (lengthOf(p.json.roster_positions) > caps.rosterPositions) return "more lineup spots than a Sleeper league has";
      if (isRecord(p.json.scoring_settings) && Object.keys(p.json.scoring_settings).length > caps.scoringKeys) return "more scoring rules than a Sleeper league has";
    } else if (/\/v1\/league\/\d+\/rosters$/.test(path) && Array.isArray(p.json)) {
      if (p.json.length > caps.rosters) return "more teams than a Sleeper league has";
      let players = 0;
      for (const r of p.json) if (isRecord(r)) players += lengthOf(r.players) + lengthOf(r.reserve) + lengthOf(r.taxi);
      if (players > caps.rosterPlayers) return "more rostered players than a Sleeper league has";
    }
  }
  return null;
}

/**
 * Why an upload holds more than any real league (UploadShapeLimits), in words, or null (review BF-R1). Linear in the
 * upload's size and iterative, so any upload the size caps let through is checked quickly.
 */
export function uploadShapeProblem(upload: Pick<LeagueUpload, "platform" | "parts">, limits: UploadShapeLimits): string | null {
  for (const p of upload.parts) {
    const problem = containerProblem(p.json, limits.maxEntries, limits.maxDepth);
    if (problem) return problem;
  }
  return upload.platform === "espn" ? espnShapeProblem(upload.parts, limits.espn) : sleeperShapeProblem(upload.parts, limits.sleeper);
}
