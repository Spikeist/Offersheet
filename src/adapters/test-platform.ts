/**
 * Test-only: ESPN and Sleeper answering as they would over the wire, from the committed fixtures (Parker's league,
 * placeholders only; the Sleeper test league, minimized), for the tests of the browser path (track BF: upload.test.ts,
 * src/lib/leagueFetch.test.ts). Each body goes out as text, rewritten by the request's transformText and parsed as both
 * clients do (./httpShared.ts). No network. Not imported by app code.
 */
import { responseOf } from "./httpShared";
import type { HttpClient, HttpResponse } from "./types";
import { LABELS, NOW, parkerCards, readEspn } from "./espn/test-helpers";
import { sleeperUrls } from "./sleeper/leagueData";
import type { TestLeague } from "./sleeper/test-helpers";

/** When every answer arrives (the fixtures' "now"). */
export const AT = NOW.getTime();

/** One answer: its status (200), body and whether it's an HTML page; undefined: a 404. */
export type Answer = { status?: number; body?: unknown; html?: boolean } | undefined;

/** A platform answering each request by `answer` (see the header), recording the addresses asked. */
export function platform(answer: (url: string, headers: Record<string, string>) => Answer): HttpClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async get(url, opts = {}): Promise<HttpResponse> {
      calls.push(url);
      const r = answer(url, opts.headers ?? {}) ?? { status: 404, body: { details: [{ type: "GENERAL_NOT_FOUND" }] } };
      const raw = r.html ? "<!doctype html><html><body>Log in</body></html>" : r.body === undefined ? "" : JSON.stringify(r.body);
      const text = opts.transformText ? opts.transformText(raw) : raw;
      return responseOf({ status: r.status ?? 200, contentType: r.html ? "text/html" : "application/json", text }, { fromCache: false, bigInts: opts.bigIntsAsStrings ?? false, fetchedAt: AT });
    },
  };
}

const FA_FILE: Record<number, string> = { 0: "QB", 2: "RB", 4: "WR", 6: "TE", 17: "K", 16: "D/ST" };
/** The free-agent lists the fixtures hold, by position label. */
export const ESPN_FA_LABELS = Object.values(FA_FILE);
const filterOf = (headers: Record<string, string>) => JSON.parse(headers["x-fantasy-filter"] ?? "{}") as { players?: { filterSlotIds?: { value: number[] }; filterIds?: { value: number[] } } };

/** ESPN answering for Parker's league (`fail`: a request to answer otherwise; null: as ESPN would). */
export function espnAnswer(fail: (url: string) => Answer | null = () => null) {
  return (url: string, headers: Record<string, string>): Answer => {
    const failed = fail(url);
    if (failed !== null) return failed;
    const u = new URL(url);
    const views = u.searchParams.getAll("view");
    if (views.includes("proTeamSchedules_wl")) return { body: readEspn(LABELS.proSchedule) };
    if (views.includes("mTransactions2")) return { body: readEspn(LABELS.tx(Number(u.searchParams.get("scoringPeriodId")))) };
    if (views.includes("kona_playercard")) {
      const ids = new Set(filterOf(headers).players?.filterIds?.value ?? []);
      return { body: { players: parkerCards().players.filter((p) => ids.has(p.id)) } };
    }
    if (views.includes("kona_player_info")) return { body: readEspn(LABELS.fa(FA_FILE[filterOf(headers).players?.filterSlotIds?.value[0] as number] as string)) };
    if (views.includes("mSettings")) return { body: readEspn(LABELS.league) };
    return undefined;
  };
}

/** The Sleeper test league's user (a made-up username) and the positions it starts. */
export const SLEEPER_USERNAME = "zorblax_q";
export const SLEEPER_POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"];

/** Sleeper answering for the test league (`leagues`: the username's leagues; `fail`: a request to answer otherwise). */
export function sleeperAnswer(t: TestLeague, opts: { leagues?: unknown[]; fail?: (url: string) => Answer | null } = {}) {
  const id = String(t.league.league_id);
  const bodies = new Map<string, unknown>([
    [sleeperUrls.state(), t.state],
    [sleeperUrls.league(id), t.league],
    [sleeperUrls.users(id), t.users],
    [sleeperUrls.rosters(id), t.rosters],
    [sleeperUrls.tradedPicks(id), t.tradedPicks],
    [sleeperUrls.drafts(id), t.drafts],
    [sleeperUrls.winnersBracket(id), t.winnersBracket],
    [sleeperUrls.user(SLEEPER_USERNAME), { user_id: t.meta.me.userId, username: SLEEPER_USERNAME, display_name: "Zorblax Quintavious", avatar: "abc" }],
    [sleeperUrls.userLeagues(t.meta.me.userId, 2026), opts.leagues ?? [t.league]],
  ]);
  for (const w of [4, 5, 6]) bodies.set(sleeperUrls.projections(2026, w, SLEEPER_POSITIONS), t.projections.map((r: Record<string, unknown>) => ({ ...r, week: w })));
  for (let w = 1; w <= 14; w++) bodies.set(sleeperUrls.matchups(id, w), t.matchups[w]);
  for (let leg = 1; leg <= 4; leg++) bodies.set(sleeperUrls.transactions(id, leg), t.transactions[leg] ?? []);
  return (url: string): Answer => {
    const failed = opts.fail?.(url) ?? null;
    if (failed !== null) return failed;
    return bodies.has(url) ? { body: bodies.get(url) } : undefined;
  };
}
