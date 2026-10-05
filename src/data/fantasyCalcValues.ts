/**
 * FantasyCalc market values (CLAUDE.md §2.9, §9, §2.10). Server-side.
 *
 * GET https://api.fantasycalc.com/values/current?isDynasty=…&numQbs=…&numTeams=…&ppr=…[&tep=…], the only
 * FantasyCalc endpoint Offer Sheet calls. FantasyCalc's conditions for free use (their reply of 2026-10-05,
 * reports/fantasycalc-permission.md; planner reply to Checkpoint 7a, §5.4): "call only /values/current", and since their
 * values update every 3 hours, refresh each format's list "at most once every 3 hours, and only when someone needs it"
 * (TTL.fantasyCalc, 3 hours: a list is asked for only by a model build that reads it and finds no copy that fresh; before
 * the conditions, 24 hours). Non-commercial use only, under about 10,000 sessions a month (npm run usage:report), and a
 * link back to fantasycalc.com on every page that shows anything derived from their values (the UI's job).
 *
 * - One cache key per format: the parameters always go in the same order (fantasyCalcValuesUrl).
 * - getPublicSource: only a body that passes the check (shape and row floor) is cached, a saved copy
 *   stands in when FantasyCalc fails (the load says `stale`, and `fetchedAt` is when FantasyCalc served that
 *   copy), and a fresh saved copy that fails the check is fetched again once. A failure throws LeagueImportError.
 * - Phase 4c (planner reply to Checkpoint 4b, change 12): FantasyCalc stays the only market source, with fallbacks.
 *   Its lists are kept FANTASYCALC_RETAIN_MS (src/server/cache.ts: config.market.fantasyCalcCurveDays, 90 days) instead
 *   of the other public sources' 7 (keptLonger raises the retention getPublicSource asks for), still through the Cache
 *   interface (production has no disk: a KV store will keep them the same way; the dev-only archive in data-local/ is
 *   never read back), still served fresh only within the TTL (3 hours since FantasyCalc's conditions: at most one request
 *   every 3 hours per format), and older copies only when FantasyCalc fails. ⚠️ Ours: one entry per format with a long retention, rather than a second copy
 *   under another key: a saved copy can't drift from the list the app last read, and nothing is written twice.
 *   fantasyCalcListUse then says what a copy may do at the build time: "fresh" (FantasyCalc answered), "saved" (at most
 *   fantasyCalcStaleDays old: stands in as FantasyCalc's own, with a "values from <date>" note), "curve" (older, at
 *   most fantasyCalcCurveDays: only calibrates the model's own value curve, src/engine/market.ts) or "expired".
 *   src/server/modelInputs.ts acts on it.
 * - The outage memory (Phase 4c's polish; CLAUDE.md §0.9; fantasyCalcGate, the Sleeper gate's rule and numbers,
 *   src/data/sleeperProjections.ts): until then nothing remembered a failure, so during a FantasyCalc outage every model
 *   build past the TTL asked again, with its retry. Now, once a value-list request finds FantasyCalc not answering
 *   (no response, 429, 5xx or an HTML page, a saved copy standing in or not), FantasyCalc isn't asked for 5 minutes, then
 *   10, at most 15 while it lasts, in-process, by that build's later lists and every build on the same client: they read
 *   only what the server cache holds (HttpRequestOptions.cacheOnly: a copy within the TTL as FantasyCalc's answer, an older
 *   retained one standing in as it would after a failed request), and one answer ends the outage. A request Offer Sheet
 *   itself held back (its deadline, or the day's FantasyCalc budget: src/server/budget.ts) says nothing about FantasyCalc
 *   and starts nothing (review of Checkpoint 7b's server work: a budget cut read as an outage let anyone who spent the
 *   budget hold every format off).
 * - Answers the checks turn down (review of Checkpoint 7b's server work: "the 3-hour rule is enforced only by caching good
 *   answers"): only good bodies are cached, so a format FantasyCalc answers with a short list, a changed shape or an error
 *   status (a 404) was asked again by every build. Now the gate remembers such an answer per format for TTL.fantasyCalc
 *   (FantasyCalcGate.rejected): meanwhile that format is read from the server cache only (a saved copy stands in; none: the
 *   load fails as "not asked again yet"), so it's asked at most once every 3 hours like a good one. ⚠️ In-process, like the
 *   outage memory: each server instance remembers its own (src/server/cache.ts's header lists what isn't shared).
 * - Row floors (review HTTP-1): 196–198 players in every redraft format and 395–396 in dynasty
 *   (Phase 0); fewer than 150 / 300 is a broken or partial answer.
 * - Draft picks (position PICK, dynasty only: "2027 1st (Early)" …) are kept apart from player values
 *   (`picks`, by name; their id fields hold pick keys such as FP_2027_1, never player ids).
 *
 * Which number (Phase 2 reader, re-analysis of the Phase 0 captures; ⚠️ inferred from equalities):
 * `value` is the value in the REQUESTED format, while `redraftValue` is FantasyCalc's baseline redraft
 * number (same numQbs, 12 teams, PPR, no TE premium) whatever format is asked for, off by up to 3% at
 * QB and TE in Parker's format. So a league always uses `value` from a request in its own format:
 * redraft → isDynasty=false; dynasty → isDynasty=true; keeper → both, dynasty `value` for the future
 * term (MarketInputs.values) and redraft `value` for perception (MarketInputs.redraftValues) (§9).
 * Dynasty leagues with weeks left to project also get the redraft `value` in their own format for the
 * market blend (MarketInputs.seasonValues, §6 step 8: "redraftValue" in the planner's words, ⚠️ read
 * as the redraft list's own `value` in the league's format, by the rule above).
 *
 * Joining to canonical ids (§4): a Sleeper id (the canonical id when known) joins on the row's
 * sleeperId, which FantasyCalc gives on every row. A platform id (`espn:<id>`, `mfl:<id>`,
 * `fleaflicker:<id>`; players the crosswalk couldn't map) joins on that platform's id only when the
 * name (crosswalk.playerNameKey) and position agree too: FantasyCalc had a namesake's or another
 * player's ESPN id on 8 of 1,761 players (Phase 0 XWALK.sleeperVsOthers). ⚠️ A namesake at the same
 * position still passes that check.
 *
 * src/server/modelInputs.ts loads a league's formats here (one request at a time, each failure a
 * warning; a keeper league's lists each on their own, review DATA-2) and joins them to its players with
 * the pure marketInputsFrom.
 */
import { z } from "zod";
import { LeagueImportError, type HttpClient, type HttpResponse } from "@/adapters/types";
import { config } from "@/engine/config";
import type { FantasyCalcFormat, MarketInputs } from "@/engine/inputs";
import type { PlayerInfo, Pos } from "@/engine/model";
import { DAY, FANTASYCALC_RETAIN_MS, HOUR, MINUTE, TTL } from "@/server/cache";
import { playerNameKey } from "./crosswalk";
import { normalizeId } from "./ids";
import { checkedJson, getPublicSource, sourceError, tooFewRows, type PublicSourceResult } from "./source";
import { cleanTeamCode } from "./teamCodes";

export const FANTASYCALC_VALUES_URL = "https://api.fantasycalc.com/values/current";

/** Player-row floors (review HTTP-1; Phase 0: redraft 196–198 players, dynasty 395–396). */
export const FANTASYCALC_REDRAFT_MIN_PLAYERS = 150;
export const FANTASYCALC_DYNASTY_MIN_PLAYERS = 300;

/** Bodies are 150–330 KB; one retry. */
export const FANTASYCALC_VALUES_TIMEOUT_MS = 30_000;
export const FANTASYCALC_VALUES_MAX_RETRIES = 1;

/** The request parameters of a format (FantasyCalcFormat.substitutions only explains them). */
export type FantasyCalcRequest = Pick<FantasyCalcFormat, "isDynasty" | "numQbs" | "numTeams" | "ppr" | "tep">;

/**
 * The values URL for a format, parameters in a fixed order (one cache key per format), encoded by
 * URLSearchParams: te+ is sent as tep=te%2B (a literal "+" would read as a space). tep is left out
 * when the league has no TE premium (FantasyCalc's default is none).
 */
export function fantasyCalcValuesUrl(f: FantasyCalcRequest): string {
  const q = new URLSearchParams({ isDynasty: String(f.isDynasty), numQbs: String(f.numQbs), numTeams: String(f.numTeams), ppr: String(f.ppr) });
  if (f.tep) q.set("tep", f.tep);
  return `${FANTASYCALC_VALUES_URL}?${q.toString()}`;
}

/**
 * The formats a league requests (§9): `values` in its own list (redraft → the redraft list, dynasty and
 * keeper → the dynasty list), plus the redraft list for keeper leagues (perception) and, for dynasty
 * leagues, the redraft list in the league's format as `season` (§6 step 8: the market blend weighs this
 * season's projections against this season's market; Phase 4b). src/server/modelInputs.ts marketFormats
 * builds them with src/engine/market.ts fantasyCalcFormat.
 */
export interface MarketFormats {
  values: FantasyCalcFormat;
  redraft?: FantasyCalcFormat;
  /** Dynasty leagues: the redraft list in the league's own format, read only by the market blend (MarketInputs.seasonValues). */
  season?: FantasyCalcFormat;
}

const idLike = z.union([z.string(), z.number()]).nullish().catch(null);

const valueRowSchema = z.object({
  player: z.object({
    id: z.union([z.number(), z.string()]),
    name: z.string(),
    position: z.string(),
    sleeperId: idLike,
    espnId: idLike,
    mflId: idLike,
    fleaflickerId: idLike,
    maybeTeam: z.string().nullish().catch(null),
  }),
  value: z.number(),
  redraftValue: z.number().nullish().catch(null),
  /** Kept only for the local FantasyCalc archive (src/server/fantasyCalcArchive.ts); the engine never reads them. */
  overallRank: z.number().nullish().catch(null),
  positionRank: z.number().nullish().catch(null),
});

export const fantasyCalcValuesSchema = z.array(valueRowSchema);
export type FantasyCalcValuesResponse = z.infer<typeof fantasyCalcValuesSchema>;

/** Who a FantasyCalc row says the player is (value rows; once also /players rows, which the app no longer reads). */
export interface FantasyCalcIdentity {
  name: string;
  /** QB, RB, WR or TE. */
  position: string;
  sleeperId: string | null;
  espnId: string | null;
  mflId: string | null;
  fleaflickerId: string | null;
}

export interface FantasyCalcValueRow extends FantasyCalcIdentity {
  fantasyCalcId: string;
  /** maybeTeam, Sleeper-style code; null for free agents. */
  team: string | null;
  /** The value in the requested format (§9 v_i). */
  value: number;
  /** FantasyCalc's baseline redraft number (12 teams, PPR, no TE premium): never a league's value (see the header). */
  redraftValue: number | null;
  /** FantasyCalc's overall and position ranks in this format, for the local archive only (Phase 6's marketBlend backtest). */
  overallRank?: number | null;
  positionRank?: number | null;
}

export interface FantasyCalcPickValue {
  /** "2027 1st", "2027 1st (Early)", … */
  name: string;
  value: number;
}

export interface FantasyCalcValues {
  players: FantasyCalcValueRow[];
  picks: FantasyCalcPickValue[];
}

/** Split a parsed response into player values and draft-pick values (pure). */
export function reduceFantasyCalcValues(response: FantasyCalcValuesResponse): FantasyCalcValues {
  const players: FantasyCalcValueRow[] = [];
  const picks: FantasyCalcPickValue[] = [];
  for (const row of response) {
    const p = row.player;
    const position = p.position.trim().toUpperCase();
    if (position === "PICK") {
      picks.push({ name: p.name.trim(), value: row.value });
      continue;
    }
    players.push({
      fantasyCalcId: String(p.id),
      name: p.name.trim(),
      position,
      sleeperId: normalizeId("sleeper", p.sleeperId),
      espnId: normalizeId("espn", p.espnId),
      mflId: normalizeId("mfl", p.mflId),
      fleaflickerId: normalizeId("fleaflicker", p.fleaflickerId),
      team: cleanTeamCode(p.maybeTeam),
      value: row.value,
      redraftValue: row.redraftValue ?? null,
      overallRank: row.overallRank ?? null,
      positionRank: row.positionRank ?? null,
    });
  }
  return { players, picks };
}

function whatOf(f: FantasyCalcRequest): string {
  return `FantasyCalc ${f.isDynasty ? "dynasty" : "redraft"} values`;
}

/**
 * The check every values body passes before it's read or cached (shape and row floor; a LeagueImportError otherwise). The
 * probes (scripts/lib/fantasycalc.ts) read the app's cache entries through it too, so they never cache a list the app
 * would turn down.
 */
export function fantasyCalcValuesCheck(f: FantasyCalcRequest): (res: HttpResponse) => FantasyCalcValues {
  const what = whatOf(f);
  const floor = f.isDynasty ? FANTASYCALC_DYNASTY_MIN_PLAYERS : FANTASYCALC_REDRAFT_MIN_PLAYERS;
  return (res) => {
    const parsed = fantasyCalcValuesSchema.safeParse(checkedJson(res, what));
    if (!parsed.success) throw sourceError(what, parsed.error);
    const reduced = reduceFantasyCalcValues(parsed.data);
    if (reduced.players.length < floor) throw tooFewRows(what, reduced.players.length, `at least ${floor} player rows`);
    return reduced;
  };
}

export interface FantasyCalcValuesLoad extends FantasyCalcValues {
  format: FantasyCalcFormat;
  /** The highest player value in this format (valueFloor and waiverCreditMin are fractions of it, §9). */
  topValue: number;
  fromCache: boolean;
  /** A saved copy stood in because FantasyCalc couldn't be refreshed (fetchedAt is when that copy was fetched). */
  stale: boolean;
  /** When FantasyCalc served these values (epoch ms), when the client reports it. */
  fetchedAt?: number;
}

/**
 * The client with FantasyCalc's longer retention (the file header) on every cached request it makes: getPublicSource asks
 * for STALE_PUBLIC_RETAIN_MS. Every FantasyCalc values request goes through here, so every request of a key carries the same
 * retention (src/server/http.ts: the fetch that starts a single-flight governs the cache write).
 */
function keptLonger(http: HttpClient): HttpClient {
  return { get: (url, opts) => http.get(url, opts?.cache ? { ...opts, cache: { ...opts.cache, retainMs: Math.max(opts.cache.retainMs ?? 0, FANTASYCALC_RETAIN_MS) } } : opts) };
}

// ---------------------------------------------------------------------------------------------
// The outage memory (Phase 4c's polish; CLAUDE.md §0.9, be polite to data sources: the Sleeper gate's rule,
// src/data/sleeperProjections.ts, for FantasyCalc's value lists)

/**
 * How long a FantasyCalc outage is remembered (FantasyCalc isn't asked meanwhile), doubling while it lasts, up to
 * FANTASYCALC_OUTAGE_MAX_HOLD_MS: the Sleeper gate's numbers (SLEEPER_OUTAGE_HOLD_MS), so a long outage costs a probe (2
 * attempts: the one retry) every 15 minutes, and a recovered FantasyCalc is noticed within 15 minutes.
 */
export const FANTASYCALC_OUTAGE_HOLD_MS = 5 * MINUTE;
export const FANTASYCALC_OUTAGE_MAX_HOLD_MS = 15 * MINUTE;

/** The hold after `outages` outages in a row (no outage: 0). */
export function fantasyCalcOutageHoldMs(outages: number): number {
  if (outages <= 0) return 0;
  return Math.min(FANTASYCALC_OUTAGE_MAX_HOLD_MS, FANTASYCALC_OUTAGE_HOLD_MS * 2 ** (outages - 1));
}

/** What the process remembers about FantasyCalc, per HttpClient (one client per server process, src/app/api/_lib/deps.ts). */
interface FantasyCalcHealth {
  /** FantasyCalc isn't asked before this (epoch ms). */
  downUntil: number;
  /** Why: the failure that started the hold ("HTTP 503", "no response", …). */
  reason: string;
  /** Outages in a row: each doubles the next hold; back to 0 once FantasyCalc answers. */
  outages: number;
  /**
   * Formats whose last answer the checks turned down (the file header), by values URL: not asked again before `until`
   * (TTL.fantasyCalc after that answer), with what the answer was ("HTTP 404", "a list that failed our checks"). At most one
   * entry per format (144), and the ones past their time go whenever another is noted.
   */
  rejected: Map<string, { until: number; reason: string }>;
}

const healthByClient = new WeakMap<HttpClient, FantasyCalcHealth>();

/** What one value-list request told about FantasyCalc (loadFantasyCalcValues; FantasyCalcGate.saw). */
export type FantasyCalcOutcome = { answered: true } | { answered: false; reason: string };

/** What FantasyCalc's answer for one format was (FantasyCalcGate.sawFormat): a list the checks accept, or not and why. */
export type FantasyCalcFormatVerdict = { usable: true } | { usable: false; reason: string };

/**
 * One model build's way to FantasyCalc's value lists (the outage memory, and the memory of answers the checks turned down):
 * while an outage is remembered nothing is asked of FantasyCalc, and while a format's last answer is remembered as unusable
 * that format isn't (loadFantasyCalcValues reads only what the server cache holds); each request's outcome starts,
 * lengthens or ends them.
 */
export interface FantasyCalcGate {
  /** Why FantasyCalc isn't asked (an outage this process remembers, at the build's time); undefined while it is. */
  down(): string | undefined;
  /** Notes what a request found: an answer ends any outage; none starts one, or (after the last hold ran out) a longer one. */
  saw(outcome: FantasyCalcOutcome): void;
  /**
   * Why this format (its values URL: fantasyCalcValuesUrl) isn't asked again yet: FantasyCalc's last answer for it couldn't
   * be used, less than TTL.fantasyCalc before the build's time; undefined when it may be asked.
   */
  rejected(url: string): string | undefined;
  /** Notes FantasyCalc's answer for one format: usable (forgets a rejection) or not (remembered TTL.fantasyCalc from the build's time). */
  sawFormat(url: string, verdict: FantasyCalcFormatVerdict): void;
}

/**
 * A gate for one model build at `now` (the build's time: holds are measured from it), mirroring the Sleeper gate
 * (sleeperProjections.ts sleeperGate): "FantasyCalc didn't answer" is no response (a network error or a timeout), 429,
 * 5xx or an HTML page after the request's retry, whether a saved copy then stood in (HttpResponse.liveFailure) or not; a
 * 404 or a 200 body that fails the checks is an answer about that format, so it starts no outage (FantasyCalc is up, and
 * another league's format must still be asked), only that format's own hold (rejected, sawFormat: TTL.fantasyCalc, so a
 * format FantasyCalc keeps answering badly is asked as rarely as a good one is refreshed). The outage is remembered per
 * HttpClient for FANTASYCALC_OUTAGE_HOLD_MS, doubling while it lasts (at most FANTASYCALC_OUTAGE_MAX_HOLD_MS), so the builds
 * in between, and this build's later lists, ask nothing: they read the copy the server cache holds
 * (HttpRequestOptions.cacheOnly: a copy within the 3-hour TTL as FantasyCalc's answer, an older retained one standing in as
 * it would after a failed request), and a format with no copy gets none. A later build asks again, and one answer ends the
 * outage. Builds on the same client share what it remembers, so a build running alongside the one that finds FantasyCalc
 * down holds off from its next request on.
 */
export function fantasyCalcGate(http: HttpClient, now: Date): FantasyCalcGate {
  const at = now.getTime();
  let health = healthByClient.get(http);
  if (!health) {
    health = { downUntil: Number.NEGATIVE_INFINITY, reason: "", outages: 0, rejected: new Map() };
    healthByClient.set(http, health);
  }
  const h = health;
  return {
    down: () => (h.downUntil > at ? h.reason : undefined),
    saw(outcome) {
      if (outcome.answered) {
        h.outages = 0;
        h.downUntil = Number.NEGATIVE_INFINITY;
        h.reason = "";
        return;
      }
      // A build running alongside may have started the hold already: one outage, one doubling.
      if (h.downUntil > at) return;
      h.outages += 1;
      h.downUntil = at + fantasyCalcOutageHoldMs(h.outages);
      h.reason = outcome.reason;
    },
    rejected(url) {
      const r = h.rejected.get(url);
      return r !== undefined && r.until > at ? r.reason : undefined;
    },
    sawFormat(url, verdict) {
      if (verdict.usable) {
        h.rejected.delete(url);
        return;
      }
      for (const [u, r] of h.rejected) if (r.until <= at) h.rejected.delete(u);
      h.rejected.set(url, { until: at + TTL.fantasyCalc, reason: verdict.reason });
    },
  };
}

/** A live answer that isn't FantasyCalc serving data: no response, 429, 5xx or an HTML page (the Sleeper gate's test). */
function notAnswering(x: { status: number; isHtml: boolean }): boolean {
  return x.status === 0 || x.status === 429 || x.status >= 500 || x.isHtml;
}

/** A failed answer in words, as the Sleeper gate says it: "no response", "HTTP 503", "a web page instead of data". */
function failureWords(x: { status: number; isHtml: boolean } | undefined): string {
  if (!x) return "no usable answer";
  if (x.status === 0) return "no response";
  if (x.isHtml) return "a web page instead of data";
  return `HTTP ${x.status}`;
}

/**
 * What a request's response says about FantasyCalc (the gate's rule): null when no request went out (a copy within the
 * TTL) or Offer Sheet itself held it back (cut: its deadline or its daily budget); else whether FantasyCalc answered: the
 * live answer's own status, or, for a saved copy standing in, the failed answer it stood in for (HttpResponse.liveFailure; a
 * client that doesn't report it counts as no answer).
 */
export function fantasyCalcOutcome(res: Pick<HttpResponse, "status" | "isHtml" | "fromCache" | "stale" | "liveFailure" | "cut">): FantasyCalcOutcome | null {
  // Cut by the request's own deadline (Checkpoint 7a, review RL-2) or by the day's FantasyCalc budget (review of Checkpoint
  // 7b's server work: read as an outage, a budget anyone could spend held every format off): FantasyCalc wasn't asked, or
  // not waited for long enough, which says nothing about it; a saved copy standing in for the cut carries the mark too.
  if (res.cut === "deadline" || res.cut === "budget") return null;
  if (res.stale) return res.liveFailure && !notAnswering(res.liveFailure) ? { answered: true } : { answered: false, reason: failureWords(res.liveFailure) };
  if (res.fromCache) return null;
  return notAnswering(res) ? { answered: false, reason: failureWords(res) } : { answered: true };
}

/** An answer the checks turned down, in words for a note: its status when it wasn't a 200, else what was wrong with it. */
function rejectionWords(res: Pick<HttpResponse, "status" | "stale" | "liveFailure">): string {
  const status = res.stale ? res.liveFailure?.status : res.status;
  return status !== undefined && status !== 200 ? `HTTP ${status}` : "a list that failed our checks";
}

/** TTL.fantasyCalc in words ("3 hours"), for the "not asked again yet" note. */
const TTL_WORDS = `${TTL.fantasyCalc / HOUR} hour${TTL.fantasyCalc === HOUR ? "" : "s"}`;

/**
 * Fetch and check one format's values (TTL.fantasyCalc, 3 hours: FantasyCalc's conditions; a saved copy, kept up to FANTASYCALC_RETAIN_MS, stands in when
 * FantasyCalc fails: fantasyCalcListUse says for what). Throws LeagueImportError.
 * `maxRetries` overrides the one retry, e.g. 0 for a second list right after a saved copy stood in for a first list
 * FantasyCalc answered with a body the checks turned down (src/server/modelInputs.ts; after a first it didn't answer at
 * all, the gate holds FantasyCalc off instead, review POL-2). `gate` (the build's FantasyCalcGate: src/server/modelInputs.ts
 * passes one): while it holds FantasyCalc off, nothing is asked and only the cache's copy is read (a copy within the TTL as
 * FantasyCalc's answer, an older one as a saved copy standing in; none: SOURCE_DOWN, status 0, "not asked while FantasyCalc
 * isn't answering"); likewise while it remembers that this format's last answer couldn't be used (FantasyCalcGate.rejected;
 * none: BAD_RESPONSE, "not asked again yet"); otherwise the request's outcome goes to it (fantasyCalcOutcome), and so does
 * the format's own verdict when FantasyCalc answered (sawFormat). A request the day's FantasyCalc budget held back with no
 * copy to stand in fails as "not asked: Offer Sheet has used today's share of requests to FantasyCalc" (SOURCE_DOWN, status
 * 0), not as a network error.
 */
export async function loadFantasyCalcValues(http: HttpClient, format: FantasyCalcFormat, opts: { maxRetries?: number; gate?: FantasyCalcGate } = {}): Promise<FantasyCalcValuesLoad> {
  const url = fantasyCalcValuesUrl(format);
  const held = opts.gate?.down();
  const rejected = held === undefined ? opts.gate?.rejected(url) : undefined;
  /** FantasyCalc may be asked: no outage held, and this format's last answer wasn't one the checks turned down (recently). */
  const asks = held === undefined && rejected === undefined;
  let got: PublicSourceResult<FantasyCalcValues>;
  try {
    const request = {
      key: `fantasycalc:${url}`,
      ttlMs: TTL.fantasyCalc,
      timeoutMs: FANTASYCALC_VALUES_TIMEOUT_MS,
      maxRetries: asks ? (opts.maxRetries ?? FANTASYCALC_VALUES_MAX_RETRIES) : 0,
      ...(asks ? {} : { cacheOnly: true, refetchBadCopy: false }),
    };
    got = await getPublicSource(keptLonger(http), url, request, fantasyCalcValuesCheck(format));
  } catch (err) {
    if (asks) opts.gate?.saw({ answered: false, reason: "no response" });
    // The real client never throws; any other client's error text could hold a URL, so it isn't echoed.
    if (err instanceof LeagueImportError) throw err;
    throw new LeagueImportError("SOURCE_DOWN", `${whatOf(format)}: couldn't be reached`);
  }
  if (held !== undefined) {
    // Nothing was asked: no copy in the cache (or none it could use) is FantasyCalc's outage, not this request's.
    if ("error" in got) throw new LeagueImportError("SOURCE_DOWN", `${whatOf(format)}: not asked while FantasyCalc isn't answering (${held})`, { status: 0 });
  } else if (rejected !== undefined) {
    // Nothing was asked: FantasyCalc answered this format with something unusable less than TTL.fantasyCalc ago.
    if ("error" in got) throw new LeagueImportError("BAD_RESPONSE", `${whatOf(format)}: not asked again yet, since its last answer was ${rejected} and a format is asked at most once every ${TTL_WORDS}`);
    // A good copy within the TTL (another request's: this instance's or, through the shared cache, another's): over.
    if (!got.res.stale) opts.gate?.sawFormat(url, { usable: true });
  } else {
    const outcome = fantasyCalcOutcome(got.res);
    if (outcome) opts.gate?.saw(outcome);
    if (outcome?.answered) opts.gate?.sawFormat(url, "error" in got || got.res.stale ? { usable: false, reason: rejectionWords(got.res) } : { usable: true });
    // Held back by the day's FantasyCalc budget, with no saved copy: Offer Sheet's own limit, not FantasyCalc failing.
    if ("error" in got && got.res.cut === "budget") throw new LeagueImportError("SOURCE_DOWN", `${whatOf(format)}: not asked: Offer Sheet has used today's share of requests to FantasyCalc`, { status: 0 });
  }
  if ("error" in got) throw got.error;
  const { res, value } = got;
  let topValue = 0;
  for (const p of value.players) topValue = Math.max(topValue, p.value);
  return { format, ...value, topValue, fromCache: res.fromCache, stale: res.stale === true, ...(res.fetchedAt !== undefined ? { fetchedAt: res.fetchedAt } : {}) };
}

/** What a loaded list may do (fantasyCalcListUse; the file header). */
export type FantasyCalcListUse = "fresh" | "saved" | "curve" | "expired";

/** The config.market keys fantasyCalcListUse reads. */
export interface FantasyCalcAgeConfig {
  readonly fantasyCalcStaleDays: number;
  readonly fantasyCalcCurveDays: number;
}

/**
 * What a loaded list may do at `now`, the build time (pure; the file header): "fresh" when FantasyCalc answered (not
 * stale: a live answer, or a cached one within the 3-hour TTL); a saved copy that stood in (stale) by its age since
 * FantasyCalc served it: at most fantasyCalcStaleDays → "saved", at most fantasyCalcCurveDays → "curve", older →
 * "expired". ⚠️ A saved copy of unknown age (no fetchedAt; the real client always reports one) reads "saved", as every
 * saved copy did before Phase 4c.
 */
export function fantasyCalcListUse(load: Pick<FantasyCalcValuesLoad, "stale" | "fetchedAt">, now: Date, cfg: FantasyCalcAgeConfig = config.market): FantasyCalcListUse {
  if (!load.stale) return "fresh";
  if (load.fetchedAt === undefined || !Number.isFinite(load.fetchedAt)) return "saved";
  const age = now.getTime() - load.fetchedAt;
  if (age <= cfg.fantasyCalcStaleDays * DAY) return "saved";
  return age <= cfg.fantasyCalcCurveDays * DAY ? "curve" : "expired";
}

// ---------------------------------------------------------------------------------------------
// Joining FantasyCalc rows to canonical ids

type IdField = "sleeperId" | "espnId" | "mflId" | "fleaflickerId";

/** Platforms whose ids FantasyCalc carries, by canonical-id prefix. */
const PLATFORM_ID_FIELD: ReadonlyMap<string, IdField> = new Map([
  ["espn", "espnId"],
  ["mfl", "mflId"],
  ["fleaflicker", "fleaflickerId"],
]);
const ID_FIELDS: readonly IdField[] = ["sleeperId", "espnId", "mflId", "fleaflickerId"];

/** The snapshot facts the join checks a platform-id match against. */
export type JoinPlayer = Pick<PlayerInfo, "name" | "pos" | "eligible">;

function samePerson(row: FantasyCalcIdentity, player: JoinPlayer | undefined): boolean {
  if (!player) return false;
  const key = playerNameKey(row.name);
  if (!key || key !== playerNameKey(player.name)) return false;
  return row.position === player.pos || player.eligible.includes(row.position as Pos);
}

/**
 * A lookup from canonical id to its FantasyCalc row (pure; the first row per id wins):
 * - a canonical Sleeper id (no ":") → the row with that sleeperId;
 * - `espn:<id>` / `mfl:<id>` / `fleaflicker:<id>` → the row with that platform id, when its name key and
 *   position match the player's (a row carrying another player's id is no match; ⚠️ a namesake at the
 *   same position is);
 * - anything else (team defenses, other platforms) → undefined: FantasyCalc values QB/RB/WR/TE only.
 */
export function fantasyCalcMatcher<T extends FantasyCalcIdentity>(rows: readonly T[]): (id: string, player: JoinPlayer | undefined) => T | undefined {
  const index = new Map<IdField, Map<string, T>>(ID_FIELDS.map((f) => [f, new Map<string, T>()]));
  for (const row of rows)
    for (const field of ID_FIELDS) {
      const id = row[field];
      const byId = index.get(field) as Map<string, T>;
      if (id && !byId.has(id)) byId.set(id, row);
    }
  return (id, player) => {
    const colon = id.indexOf(":");
    if (colon < 0) return index.get("sleeperId")?.get(id);
    const field = PLATFORM_ID_FIELD.get(id.slice(0, colon));
    const row = field ? index.get(field)?.get(id.slice(colon + 1)) : undefined;
    return row && samePerson(row, player) ? row : undefined;
  };
}

/** Canonical id → value for the given players FantasyCalc values (pure). */
export function fantasyCalcValuesFor(rows: readonly FantasyCalcValueRow[], players: Readonly<Record<string, JoinPlayer>>, ids: Iterable<string>): Record<string, number> {
  const match = fantasyCalcMatcher(rows);
  const out: Record<string, number> = {};
  for (const id of ids) {
    const row = match(id, players[id]);
    if (row) out[id] = row.value;
  }
  return out;
}

/**
 * The given players FantasyCalc knows (pure): matched in any of `sources` (the value rows the build loaded; until
 * FantasyCalc's conditions of 2026-10-05 also its /players list, about 4,000 players most of whom have no value). In `ids`
 * order, without repeats.
 */
export function fantasyCalcKnownIds(ids: Iterable<string>, players: Readonly<Record<string, JoinPlayer>>, sources: ReadonlyArray<readonly FantasyCalcIdentity[]>): string[] {
  const matchers = sources.map((rows) => fantasyCalcMatcher(rows));
  const out: string[] = [];
  for (const id of new Set(ids)) if (matchers.some((match) => match(id, players[id]))) out.push(id);
  return out;
}

/**
 * ModelInputs.market from loaded values (pure). `values` is the load in the league's format (dynasty
 * for dynasty and keeper leagues); keeper leagues pass the redraft load as `redraft`. A keeper league
 * whose dynasty list couldn't be loaded passes its redraft load as `values` and no `redraft`: the
 * market's format then says isDynasty false, so a reader of the future term can tell that it's missing
 * (src/server/modelInputs.ts, review DATA-2). Dynasty leagues pass their redraft list in the league's
 * format as `season`, which becomes seasonValues (the market blend's table, §6 step 8; never
 * redraftValues, which perception would read). knownIds is the players the loaded lists name (⚠️ since FantasyCalc's
 * conditions of 2026-10-05, which allow only /values/current: its /players list no longer widens it to players it lists
 * without a value; only the reports read knownIds). fetchedAt is the oldest load's time (`now` when the client didn't
 * report one).
 */
export function marketInputsFrom(input: {
  values: FantasyCalcValuesLoad;
  redraft?: FantasyCalcValuesLoad;
  season?: FantasyCalcValuesLoad;
  players: Readonly<Record<string, JoinPlayer>>;
  relevantIds: Iterable<string>;
  now: Date;
}): MarketInputs {
  const ids = [...new Set(input.relevantIds)];
  const sources: Array<readonly FantasyCalcIdentity[]> = [input.values.players];
  if (input.redraft) sources.push(input.redraft.players);
  if (input.season) sources.push(input.season.players);
  const times = [input.values.fetchedAt, input.redraft?.fetchedAt, input.season?.fetchedAt].filter((t): t is number => t !== undefined);
  return {
    format: input.values.format,
    fetchedAt: new Date(times.length ? Math.min(...times) : input.now.getTime()).toISOString(),
    values: fantasyCalcValuesFor(input.values.players, input.players, ids),
    ...(input.redraft ? { redraftValues: fantasyCalcValuesFor(input.redraft.players, input.players, ids) } : {}),
    ...(input.season ? { seasonValues: fantasyCalcValuesFor(input.season.players, input.players, ids) } : {}),
    knownIds: fantasyCalcKnownIds(ids, input.players, sources),
    topValue: input.values.topValue,
  };
}
