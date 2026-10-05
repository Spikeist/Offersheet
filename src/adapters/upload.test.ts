/**
 * Proof that a league the browser reads (track BF) imports exactly as the server's own read of it does (src/adapters/
 * upload.ts): the same platform answers, read once by the server (importEspnLeagueForModel, importSleeperLeague) and once
 * by the browser path (src/lib/leagueRead.ts readInBrowser: the adapter's league-data half through a recording client,
 * each body in its schema-kept form), gzipped and checked by the import route's reader (src/app/api/_lib/upload.ts), then
 * replayed with the server's own public data (importEspnUpload, importSleeperUpload), give deep-equal results, warnings,
 * notes and ESPN's projections included; also when a platform request fails, or a part is missing from the upload. On the
 * committed fixtures (Parker's league, placeholders only; the Sleeper test league, minimized); scripts/measure-upload.ts
 * does the same on full-size bodies. No network.
 */
import { describe, expect, it } from "vitest";
import type { HttpClient } from "@/adapters/types";
import { readLeagueUpload } from "@/app/api/_lib/upload";
import { gzipRequest } from "@/app/api/_lib/testFakes";
import { readInBrowser } from "@/lib/leagueRead";
import { importEspnLeagueForModel, importEspnUpload } from "./espn";
import { FREE_AGENT_LIMIT } from "./espn/leagueData";
import { LABELS, NOW, PARKER, fakeResolver as espnResolver, parkerCards, readEspn } from "./espn/test-helpers";
import { importSleeperLeague, importSleeperUpload } from "./sleeper";
import { sleeperUrls } from "./sleeper/leagueData";
import { fakeResolver as sleeperResolver, loadTestLeague } from "./sleeper/test-helpers";
import { AT, ESPN_FA_LABELS, SLEEPER_POSITIONS as POSITIONS, SLEEPER_USERNAME as USERNAME, espnAnswer, platform, sleeperAnswer, type Answer } from "./test-platform";
import { recordingClient, replayClient, trimEspnBody, trimSleeperBody, uploadTimesProblem, type LeagueUpload } from "./upload";

/** The upload as the import route reads it: gzipped, unpacked within the caps, SWIDs pseudonymized again, checked. */
async function throughRoute(upload: LeagueUpload): Promise<LeagueUpload> {
  const read = await readLeagueUpload(gzipRequest(`http://localhost:3000/api/import/${upload.platform}`, upload), upload.platform);
  if (!read.ok) throw new Error(`the route refused the upload: ${read.why}`);
  return read.value;
}

async function browserUpload(platformName: "espn" | "sleeper", body: Record<string, unknown>, http: HttpClient): Promise<LeagueUpload> {
  const read = await readInBrowser({ platform: platformName, body: body as never, http, clock: () => AT, espnCookies: "none" });
  if (read.kind !== "upload") throw new Error(`expected an upload, got ${read.kind}`);
  return read.upload;
}

// ---------------------------------------------------------------------------------------------
// ESPN: Parker's league (sanitized fixtures)

/** The server's import of Parker's league, and the browser path's (read in the browser, through the route, replayed). */
async function espnBothWays(fail?: (url: string) => Answer | null, editUpload: (u: LeagueUpload) => LeagueUpload = (u) => u) {
  const server = platform(espnAnswer(fail));
  const want = await importEspnLeagueForModel({ leagueId: PARKER.leagueId, season: 2026 }, { http: server, resolver: espnResolver(), now: NOW });
  const browser = platform(espnAnswer(fail));
  const upload = editUpload(await browserUpload("espn", { leagueId: PARKER.leagueId, season: 2026 }, browser));
  // The server answers the replay's public data only (ESPN's NFL schedule).
  const publicOnly = platform((url, headers) => (url.includes("proTeamSchedules") ? espnAnswer(fail)(url, headers) : { status: 500, body: { note: "league data must come from the upload" } }));
  const got = await importEspnUpload(await throughRoute(upload), { http: publicOnly, resolver: espnResolver(), now: NOW });
  return { want, got, upload, browser, publicOnly };
}

describe("ESPN: a public league the browser reads imports exactly as the server's own read (Parker's league)", () => {
  it("gives the same snapshot, notes, warnings and ESPN projections; the browser asks only for the league's own data", async () => {
    const { want, got, browser, publicOnly } = await espnBothWays();
    expect(got).toEqual(want);
    expect(Object.keys(want.espn).length).toBeGreaterThan(50);
    expect(want.result.snapshot.teams).toHaveLength(10);
    expect(browser.calls.some((u) => u.includes("proTeamSchedules"))).toBe(false);
    expect(publicOnly.calls).toEqual([expect.stringContaining("proTeamSchedules_wl")]);
  });

  it("sends only schema-kept bodies, smaller than ESPN's, with no SWID left (pseudonymized in the browser)", async () => {
    const { upload } = await espnBothWays();
    const text = JSON.stringify(upload);
    expect(text).not.toMatch(/\{[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\}|%7B[0-9A-Fa-f]{8}-/);
    expect(text).toContain("{pseudo:");
    const raw = [readEspn(LABELS.league), ...[1, 2, 3, 4].map((w) => readEspn(LABELS.tx(w))), ...ESPN_FA_LABELS.map((p) => readEspn(LABELS.fa(p)))];
    const rawBytes = raw.reduce<number>((n, b) => n + JSON.stringify(b).length, 0);
    expect(text.length).toBeLessThan(rawBytes * 0.7);
    // One part per request, in the order asked: the league, periods 1–4, a free-agent list per position, the card batches.
    expect(upload.parts[0]?.url).toContain("view=mSettings");
    expect(upload.parts.filter((p) => p.url.includes("mTransactions2"))).toHaveLength(4);
    expect(upload.parts.filter((p) => p.url.includes("kona_player_info"))).toHaveLength(6);
    expect(upload.parts.every((p) => p.status === 200 && p.at === AT)).toBe(true);
    expect(upload.request).toEqual({ leagueId: PARKER.leagueId, season: 2026 });
  });

  it("keeps the same warnings when ESPN fails a request, and reads a part the upload lacks as no answer", async () => {
    const tx2 = (url: string): Answer | null => (url.includes("mTransactions2") && url.includes("scoringPeriodId=2") ? { status: 503, html: true } : null);
    const failed = await espnBothWays(tx2);
    expect(failed.got).toEqual(failed.want);
    expect(failed.want.result.snapshot.warnings.map((w) => w.code)).toContain("ESPN_TRANSACTIONS_UNAVAILABLE");
    // A free-agent list missing from the upload reads as ESPN not answering it (status 0), as the server's read would.
    const noAnswer = (url: string): Answer | null => (url.includes("kona_player_info") ? { status: 0 } : null);
    const server = await importEspnLeagueForModel({ leagueId: PARKER.leagueId, season: 2026 }, { http: platform(espnAnswer(noAnswer)), resolver: espnResolver(), now: NOW });
    const dropped = await espnBothWays(undefined, (u) => ({ ...u, parts: u.parts.filter((p) => !p.url.includes("kona_player_info")) }));
    expect(dropped.got.result.snapshot.warnings).toEqual(server.result.snapshot.warnings);
    expect(dropped.got.result.snapshot.freeAgents).toEqual(server.result.snapshot.freeAgents);
    // The browser itself never sends a league with a request it got no answer to (review BF-R3): the server reads it.
    expect((await readInBrowser({ platform: "espn", body: { leagueId: PARKER.leagueId, season: 2026 }, http: platform(espnAnswer(noAnswer)), clock: () => AT, espnCookies: "none" })).kind).toBe("fallback");
  });

  it("the schema-kept form is a fixed point: trimming a trimmed body changes nothing", () => {
    const league = readEspn(LABELS.league);
    const url = (view: string) => `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leagues/${PARKER.leagueId}?view=${view}`;
    for (const [u, body] of [
      [url("mSettings"), league],
      [url("mTransactions2"), readEspn(LABELS.tx(3))],
      [url("kona_player_info"), readEspn(LABELS.fa("WR"))],
      [url("kona_playercard"), { players: parkerCards().players.slice(0, 40) }],
    ] as const) {
      const once = trimEspnBody(u, body);
      expect(trimEspnBody(u, JSON.parse(JSON.stringify(once)))).toEqual(once);
      expect(JSON.stringify(once).length).toBeLessThan(JSON.stringify(body).length);
    }
    // A body its schema turns down comes back as it was (so the server turns it down the same way).
    const odd = { players: "not a list" };
    expect(trimEspnBody(url("kona_player_info"), odd)).toBe(odd);
    expect(FREE_AGENT_LIMIT).toBe(500);
  });
});

// ---------------------------------------------------------------------------------------------
// Sleeper: the test league (minimized fixtures)

async function sleeperBothWays(body: { season: number; leagueId?: string; username?: string }, opts: Parameters<typeof sleeperAnswer>[1] = {}) {
  const t = loadTestLeague();
  const server = platform(sleeperAnswer(t, opts));
  const want = await importSleeperLeague(body, { http: server, resolver: sleeperResolver(t.players), now: NOW });
  const browser = platform(sleeperAnswer(t, opts));
  const upload = await browserUpload("sleeper", body, browser);
  // The server answers the replay's public data only (Sleeper's NFL state and the projection weeks).
  const publicOnly = platform((url) => (url === sleeperUrls.state() || url.includes("/projections/") ? sleeperAnswer(t, opts)(url) : { status: 500, body: null }));
  const got = await importSleeperUpload(await throughRoute(upload), { http: publicOnly, resolver: sleeperResolver(t.players), now: NOW });
  return { t, want, got, upload, browser, publicOnly };
}

describe("Sleeper: a league the browser reads imports exactly as the server's own read (the test league)", () => {
  it("by league ID: the same snapshot; the browser never asks for projections, the server reads its own state and projections", async () => {
    const t0 = loadTestLeague();
    const { want, got, browser, publicOnly } = await sleeperBothWays({ season: 2026, leagueId: String(t0.league.league_id) });
    expect(got).toEqual(want);
    expect(want.snapshot.myTeamId).toBeNull();
    expect(browser.calls.some((u) => u.includes("/projections/"))).toBe(false);
    expect(publicOnly.calls).toEqual([sleeperUrls.state(), ...[4, 5, 6].map((w) => sleeperUrls.projections(2026, w, POSITIONS))]);
  });

  it("with a username: the user's team is found the same way, and the upload carries the lookup but never the username's league list", async () => {
    const t0 = loadTestLeague();
    const byId = await sleeperBothWays({ season: 2026, leagueId: String(t0.league.league_id), username: USERNAME });
    expect(byId.got).toEqual(byId.want);
    expect(byId.want.snapshot.myTeamId).toBe(String(t0.meta.me.rosterId));
    // A username alone (one league): the browser picks it and sends it by its ID.
    const byName = await sleeperBothWays({ season: 2026, username: USERNAME });
    expect(byName.got).toEqual(byName.want);
    expect(byName.browser.calls).toContain(sleeperUrls.userLeagues(t0.meta.me.userId, 2026));
    expect(byName.upload.parts.some((p) => p.url.includes("/leagues/nfl/"))).toBe(false);
    expect(byName.upload.request).toEqual({ leagueId: String(t0.league.league_id), season: 2026, username: USERNAME });
    // The lookup's schema-kept form: no avatar.
    expect(JSON.stringify(byName.upload)).not.toContain("avatar");
  });

  it("Sleeper's NFL state: the browser's copy stands in for the server's only when it names the season being played (review BF-R2)", async () => {
    const t = loadTestLeague();
    const id = String(t.league.league_id);
    const upload = await throughRoute(await browserUpload("sleeper", { season: 2026, leagueId: id }, platform(sleeperAnswer(t))));
    // The server can't read Sleeper's state (its share of the day's requests used up, say); projections still answer.
    const noState = () => platform((url) => (url.includes("/projections/") ? sleeperAnswer(t)(url) : { status: 500, body: null }));
    const standIn = noState();
    const got = await importSleeperUpload(upload, { http: standIn, resolver: sleeperResolver(t.players), now: NOW });
    expect(got.snapshot.currentWeek).toBe(t.state.week);
    expect(standIn.calls.filter((u) => u.includes("/projections/"))).toEqual([4, 5, 6].map((w) => sleeperUrls.projections(2026, w, POSITIONS)));
    // A browser's state for another season isn't taken: the server would fetch that season's projections on its word.
    const forged = JSON.parse(JSON.stringify(upload)) as LeagueUpload;
    const state = forged.parts.find((p) => p.url === sleeperUrls.state());
    if (!state) throw new Error("the upload carries the state");
    state.json = { ...(state.json as object), season: "2019" };
    const refused = noState();
    await expect(importSleeperUpload(forged, { http: refused, resolver: sleeperResolver(t.players), now: NOW })).rejects.toMatchObject({ code: "SOURCE_DOWN" });
    expect(refused.calls.some((u) => u.includes("/projections/"))).toBe(false);
  });

  it("several leagues for a username: the browser offers the choice itself, as the import route would", async () => {
    const t = loadTestLeague();
    const other = { ...t.league, league_id: "999999999999999999", name: "Another League" };
    const browser = platform(sleeperAnswer(t, { leagues: [t.league, other] }));
    const read = await readInBrowser({ platform: "sleeper", body: { season: 2026, username: USERNAME }, http: browser, clock: () => AT });
    expect(read.kind).toBe("choose");
    if (read.kind !== "choose") return;
    expect(read.choose.chooseLeague.username).toBe(USERNAME);
    expect(read.choose.chooseLeague.leagues.map((l) => l.id).sort()).toEqual([String(t.league.league_id), "999999999999999999"].sort());
    // Nothing but the user lookup and the list was asked.
    expect(browser.calls).toEqual([sleeperUrls.user(USERNAME), sleeperUrls.userLeagues(t.meta.me.userId, 2026)]);
  });

  it("sends only the team name of each member's metadata (review BF-R5), and the import reads the same", async () => {
    const t0 = loadTestLeague();
    const id = String(t0.league.league_id);
    const members = [
      { user_id: "1", display_name: "Zorblax", metadata: { team_name: "Moonbeam Mudcats", avatar: "https://example.invalid/a.png", mention_pn: "on", allow_pn: "off" } },
      { user_id: "2", display_name: "Quintavious", metadata: { avatar: "x" } },
      { user_id: "3", display_name: "Gloop", metadata: null },
      { user_id: "4", display_name: "Mudd" },
    ];
    expect(trimSleeperBody(sleeperUrls.users(id), members)).toEqual([
      { user_id: "1", display_name: "Zorblax", metadata: { team_name: "Moonbeam Mudcats" } },
      { user_id: "2", display_name: "Quintavious", metadata: {} },
      { user_id: "3", display_name: "Gloop", metadata: null },
      { user_id: "4", display_name: "Mudd" },
    ]);
    // A fixed point, and a row the schema turns down comes as it was.
    const once = trimSleeperBody(sleeperUrls.users(id), members);
    expect(trimSleeperBody(sleeperUrls.users(id), JSON.parse(JSON.stringify(once)))).toEqual(once);
    expect(trimSleeperBody(sleeperUrls.users(id), [{ display_name: "no id" }])).toEqual([{ display_name: "no id" }]);
    // Members with more metadata than a team name import the same either way.
    const rich = loadTestLeague();
    rich.users = rich.users.map((u: Record<string, unknown>, i: number) => ({ ...u, metadata: { ...(u.metadata as object), avatar: `a${i}`, mention_pn: "on" } }));
    const both = await sleeperBothWays({ season: 2026, leagueId: id }, { fail: (url) => (url === sleeperUrls.users(id) ? { body: rich.users } : null) });
    expect(both.got).toEqual(both.want);
    expect(JSON.stringify(both.upload)).not.toContain("mention_pn");
  });

  it("keeps the same warnings when Sleeper fails a week, and the schema-kept form is a fixed point", async () => {
    const t0 = loadTestLeague();
    const fail = (url: string): Answer | null => (url.endsWith("/matchups/3") ? { status: 503 } : null);
    const failed = await sleeperBothWays({ season: 2026, leagueId: String(t0.league.league_id) }, { fail });
    expect(failed.got).toEqual(failed.want);
    expect(failed.want.snapshot.warnings.map((w) => w.code)).toContain("MATCHUPS_MISSING");
    const id = String(t0.league.league_id);
    for (const [url, body] of [
      [sleeperUrls.league(id), t0.league],
      [sleeperUrls.rosters(id), t0.rosters],
      [sleeperUrls.users(id), t0.users],
      [sleeperUrls.matchups(id, 2), t0.matchups[2]],
      [sleeperUrls.transactions(id, 1), t0.transactions[1] ?? []],
      [sleeperUrls.drafts(id), t0.drafts],
    ] as const) {
      const once = trimSleeperBody(url, body);
      expect(trimSleeperBody(url, JSON.parse(JSON.stringify(once)))).toEqual(once);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// The record and its replay

describe("recordingClient and replayClient", () => {
  it("records each request once (a repeat is answered from the record), in the schema-kept form it answers with", async () => {
    const inner = platform((url) => ({ body: { url, extra: "dropped", league_id: "12345678901234567" } }));
    const rec = recordingClient(inner, (_url, json) => ({ url: (json as { url: string }).url }));
    const a = await rec.get("https://api.sleeper.app/v1/league/12345678901234567");
    const b = await rec.get("https://api.sleeper.app/v1/league/12345678901234567");
    await rec.get("https://lm-api-reads.fantasy.espn.com/x", { headers: { "X-Fantasy-Filter": '{"a":1}' } });
    expect(inner.calls).toHaveLength(2);
    expect(a.json).toEqual({ url: "https://api.sleeper.app/v1/league/12345678901234567" });
    expect(b).toEqual(a);
    expect(rec.parts().map((p) => [p.url, p.filter])).toEqual([
      ["https://api.sleeper.app/v1/league/12345678901234567", undefined],
      ["https://lm-api-reads.fantasy.espn.com/x", '{"a":1}'],
    ]);
  });

  it("replays by address and filter, dating each part by its age on the browser's clock, and answers anything else with no answer", async () => {
    const upload: Pick<LeagueUpload, "parts" | "sentAt"> = {
      sentAt: 1_000_000,
      parts: [
        { url: "https://x.test/a", status: 200, json: { a: 1 }, at: 999_000 },
        { url: "https://x.test/a", filter: '{"f":2}', status: 403, html: true, at: 1_000_000 },
      ],
    };
    const replay = replayClient(upload, 50_000_000);
    expect(await replay.get("https://x.test/a")).toMatchObject({ status: 200, ok: true, json: { a: 1 }, fetchedAt: 49_999_000 });
    expect(await replay.get("https://x.test/a", { headers: { "x-fantasy-filter": '{"f":2}' } })).toMatchObject({ status: 403, ok: false, isHtml: true, fetchedAt: 50_000_000 });
    expect(await replay.get("https://x.test/b")).toMatchObject({ status: 0, ok: false, json: undefined });
    expect(uploadTimesProblem(upload, 10 * 60_000)).toBeNull();
    expect(uploadTimesProblem({ ...upload, sentAt: 999_000 + 11 * 60_000 }, 10 * 60_000)).not.toBeNull();
    expect(uploadTimesProblem({ ...upload, sentAt: 998_000 }, 10 * 60_000)).not.toBeNull();
  });
});
