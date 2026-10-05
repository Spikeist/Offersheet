/**
 * A league the browser sends is the browser's word (track BF; review BF-R1): the server's work on it must stay bounded
 * whatever numbers and sizes it holds. Forged uploads made from the committed fixtures (Parker's ESPN league,
 * placeholders only; the Sleeper test league, minimized) with extreme values in the league's own settings must import
 * quickly into a bounded snapshot (or be turned down), the loops over those numbers never run past real ranges, grouping
 * many rows that share a key stays linear, the import route refuses an upload holding more than any real league
 * (uploadShapeProblem), an import whose model build would cost more than any real league's isn't signed
 * (uploadedImportProblem), and the replay answers no more requests than an honest read could ask. No network.
 */
import { describe, expect, it } from "vitest";
import { readLeagueUpload, uploadedImportProblem, modelWorkOf } from "@/app/api/_lib/upload";
import { gzipRequest } from "@/app/api/_lib/testFakes";
import { readInBrowser } from "@/lib/leagueRead";
import { uploadShapeLimits } from "@/server/limits";
import type { ScoringRule } from "@/engine/model";
import { importEspnUpload } from "./espn";
import { LAST_SCORING_PERIOD, fetchEspnLeagueData, filterHeaderOf } from "./espn/leagueData";
import { NOW, PARKER, fakeResolver as espnResolver } from "./espn/test-helpers";
import { tradeHistory, type TradeAcquisition, type TradeRow } from "./espn/trades";
import { importSleeperUpload } from "./sleeper";
import { LAST_NFL_WEEK, sleeperUrls } from "./sleeper/leagueData";
import { MAX_DRAFT_ROUNDS, normalizeSleeperLeague } from "./sleeper/normalize";
import { fakeResolver as sleeperResolver, loadTestLeague, rawOf } from "./sleeper/test-helpers";
import { AT, espnAnswer, platform, sleeperAnswer } from "./test-platform";
import { LeagueImportError } from "./types";
import { replayClient, uploadShapeProblem, type LeagueUpload } from "./upload";

/** Time and size bounds for one forged import (the old loops took 15 s for 1e6 periods and 4.6 s, 866 MB for 1e5 draft rounds). */
const MAX_MS = 2_000;
/** Grouping 60,000 rows: linear takes well under a second; the old quadratic grouping took about 9 s at that size (1 s at 20,000). */
const LINEAR_MS = 4_000;
const MAX_JSON_CHARS = 5_000_000;

type Json = Record<string, unknown>;

async function espnUpload(): Promise<LeagueUpload> {
  const read = await readInBrowser({ platform: "espn", body: { leagueId: PARKER.leagueId, season: 2026 }, http: platform(espnAnswer()), clock: () => AT, espnCookies: "none" });
  if (read.kind !== "upload") throw new Error(read.kind);
  return read.upload;
}

async function sleeperUpload(): Promise<LeagueUpload> {
  const t = loadTestLeague();
  const read = await readInBrowser({ platform: "sleeper", body: { season: 2026, leagueId: String(t.league.league_id) }, http: platform(sleeperAnswer(t)), clock: () => AT });
  if (read.kind !== "upload") throw new Error(read.kind);
  return read.upload;
}

/** The server's public data for the replays: ESPN's NFL schedule, Sleeper's NFL state and projections. */
const espnPublic = () => platform((url, headers) => (url.includes("proTeamSchedules") ? espnAnswer()(url, headers) : { status: 500, body: null }));
const sleeperPublic = (t = loadTestLeague()) => platform((url) => (url === sleeperUrls.state() || url.includes("/projections/") ? sleeperAnswer(t)(url) : { status: 500, body: null }));

/**
 * The import of a forged upload, timed: its result's size, or the error it threw (an import error, or a value the
 * normalizer can't use, such as a date past JavaScript's range: the route answers INTERNAL and the browser asks the
 * server to read the league), and how long it took.
 */
async function timedImport(upload: LeagueUpload): Promise<{ ms: number; json: number; error?: string }> {
  const t0 = performance.now();
  try {
    const got =
      upload.platform === "espn"
        ? (await importEspnUpload(upload, { http: espnPublic(), resolver: espnResolver(), now: NOW })).result
        : await importSleeperUpload(upload, { http: sleeperPublic(), resolver: sleeperResolver(loadTestLeague().players), now: NOW });
    return { ms: performance.now() - t0, json: JSON.stringify(got).length };
  } catch (err) {
    return { ms: performance.now() - t0, json: 0, error: err instanceof LeagueImportError ? err.code : (err as Error).name };
  }
}

/** Every numeric leaf under `root` (paths as key lists), skipping the subtrees `skip` names. */
function numericLeaves(root: unknown, skip: (path: string[]) => boolean, path: string[] = []): string[][] {
  if (skip(path)) return [];
  if (typeof root === "number") return [path];
  if (Array.isArray(root)) return root.flatMap((v, i) => numericLeaves(v, skip, [...path, String(i)]));
  if (root && typeof root === "object") return Object.entries(root).flatMap(([k, v]) => numericLeaves(v, skip, [...path, k]));
  return [];
}

function setAt(root: unknown, path: string[], value: unknown): void {
  let o = root as Json;
  for (const k of path.slice(0, -1)) o = o[k] as Json;
  o[path.at(-1) as string] = value;
}

const forged = (u: LeagueUpload) => JSON.parse(JSON.stringify(u)) as LeagueUpload;
const espnLeague = (u: LeagueUpload) => u.parts[0]?.json as Json;
const sleeperLeague = (u: LeagueUpload) => u.parts.find((p) => /\/v1\/league\/\d+$/.test(new URL(p.url).pathname))?.json as Json;

describe("forged numbers in a league the browser sends: every import stays quick and bounded (review BF-R1)", () => {
  it("ESPN: any number in the league's status and schedule settings, one at a time; all its other settings at once", { timeout: 120_000 }, async () => {
    const honest = await espnUpload();
    const leaves = numericLeaves(espnLeague(honest), (p) => p[0] === "teams" || p[0] === "members" || p[0] === "schedule" || (p[0] === "settings" && ["scoringSettings", "rosterSettings"].includes(p[1] ?? "")));
    // The numbers the league-data half and the normalizer count with (its weeks and periods), each on its own.
    const periodWeeks = leaves.filter((p) => p[2] === "matchupPeriods");
    const drivers = leaves.filter((p) => (p[0] === "status" || p[1] === "scheduleSettings") && !periodWeeks.includes(p));
    expect(drivers.length).toBeGreaterThan(8);
    expect(periodWeeks.length).toBeGreaterThan(10);
    const cases: Array<[string, (league: Json) => void]> = [];
    // ±1e6: large enough to run a loop over it a million times, small enough to stay within JavaScript's array limits.
    for (const path of drivers) for (const value of [1e6, -1e6, 1e308, 2.5]) cases.push([`${path.join(".")} = ${value}`, (l) => setAt(l, path, value)]);
    // The matchup periods' weeks, all at once.
    for (const value of [1e6, -1e6, 1e308, 2.5]) cases.push([`every matchup period's week = ${value}`, (l) => periodWeeks.forEach((path) => setAt(l, path, value))]);
    // Every other number (trade, draft, waiver settings, the league's own id and season) at once.
    const others = leaves.filter((p) => !drivers.includes(p) && !periodWeeks.includes(p));
    expect(others.length).toBeGreaterThan(5);
    for (const value of [1e6, -1e6]) cases.push([`every other setting = ${value}`, (l) => others.forEach((path) => setAt(l, path, value))]);
    for (const [what, edit] of cases) {
      const u = forged(honest);
      edit(espnLeague(u));
      const got = await timedImport(u);
      expect(got.ms, what).toBeLessThan(MAX_MS);
      expect(got.json, what).toBeLessThan(MAX_JSON_CHARS);
    }
  });

  it("ESPN: the latest scoring period drives the transactions loop only through 1…18", async () => {
    for (const value of [1e6, 1e308, -5, 4.7]) {
      const u = forged(await espnUpload());
      (espnLeague(u).status as Json).latestScoringPeriod = value;
      const asked: string[] = [];
      const replay = replayClient(u, AT, 120);
      await fetchEspnLeagueData(
        { leagueId: PARKER.leagueId, season: 2026 },
        (url, request) => {
          asked.push(url);
          const headers = filterHeaderOf(request);
          return replay.get(url, headers ? { headers } : {});
        },
        { now: NOW, withCookies: false },
      );
      expect(asked.filter((url) => url.includes("mTransactions2")).length).toBeLessThanOrEqual(LAST_SCORING_PERIOD);
    }
  });

  it("Sleeper: any number in the league's settings, a dynasty league's draft settings included", { timeout: 60_000 }, async () => {
    const honest = await sleeperUpload();
    const keys = Object.keys(sleeperLeague(honest).settings as Json).filter((k) => typeof (sleeperLeague(honest).settings as Json)[k] === "number");
    expect(keys.length).toBeGreaterThan(15);
    for (const key of [...new Set([...keys, "draft_rounds", "start_week", "playoff_week_start"])]) {
      for (const value of [1e6, -1e6, 1e308]) {
        const u = forged(honest);
        const settings = sleeperLeague(u).settings as Json;
        settings.type = 2; // dynasty: the draft picks are built
        delete settings.pick_trading;
        settings[key] = value;
        const got = await timedImport(u);
        expect(got.ms, `${key} = ${value}`).toBeLessThan(MAX_MS);
        expect(got.json, `${key} = ${value}`).toBeLessThan(MAX_JSON_CHARS);
      }
    }
  });

  it("Sleeper: weeks held to 1…19, at most MAX_DRAFT_ROUNDS rounds and Sleeper's window of seasons for the draft picks", async () => {
    const t = loadTestLeague();
    const settings = t.league.settings as Json;
    settings.type = 2;
    delete settings.pick_trading;
    Object.assign(settings, { start_week: -1e9, playoff_week_start: 5e6, draft_rounds: 1e5 });
    t.tradedPicks = [
      { season: "99999", round: 1, roster_id: 1, owner_id: 2, previous_owner_id: 1 },
      { season: "1e308", round: 1, roster_id: 1, owner_id: 2, previous_owner_id: 1 },
      { season: "2027", round: 1, roster_id: 1, owner_id: 2, previous_owner_id: 1 },
    ];
    const got = normalizeSleeperLeague(rawOf(t), { now: NOW, resolver: sleeperResolver(t.players) });
    const s = got.snapshot.settings;
    expect(s.regularSeasonWeeks.length).toBeLessThanOrEqual(LAST_NFL_WEEK);
    expect(Math.min(...s.regularSeasonWeeks)).toBeGreaterThanOrEqual(1);
    const picks = got.snapshot.draftPicks ?? [];
    expect(new Set(picks.map((p) => p.round)).size).toBe(MAX_DRAFT_ROUNDS);
    expect(Math.max(...picks.map((p) => p.season))).toBeLessThanOrEqual(2026 + 4);
    expect(picks.find((p) => p.season === 2027 && p.round === 1 && p.originalTeamId === "1")?.ownerTeamId).toBe("2");
    const codes = got.snapshot.warnings.map((w) => w.code);
    expect(codes).toContain("DRAFT_ROUNDS_CAPPED");
    expect(codes).toContain("TRADED_PICK_OUT_OF_RANGE");
    // A season that isn't a year is turned down, whatever it is.
    for (const season of ["1e308", "-5", "2026.5", "99999", ""]) {
      const bad = loadTestLeague();
      bad.league.season = season;
      expect(() => normalizeSleeperLeague(rawOf(bad), { now: NOW, resolver: sleeperResolver(bad.players) })).toThrow(expect.objectContaining({ code: "BAD_RESPONSE" }));
    }
  });
});

describe("grouping many rows that share a key stays linear (review BF-R1: it was quadratic)", () => {
  it("Sleeper: 60,000 matchup rows of one matchup and 60,000 rosters of one division normalize in well under a second each", () => {
    const t = loadTestLeague();
    t.matchups[1] = Array.from({ length: 60_000 }, (_, i) => ({ roster_id: i + 1, matchup_id: 1 }));
    let t0 = performance.now();
    normalizeSleeperLeague(rawOf(t), { now: NOW, resolver: sleeperResolver(t.players) });
    expect(performance.now() - t0).toBeLessThan(LINEAR_MS);
    const d = loadTestLeague();
    (d.league.settings as Json).divisions = 1;
    (d.league.settings as Json).pick_trading = 0; // the grouping alone (60,000 teams' picks are many by design)
    d.rosters = Array.from({ length: 60_000 }, (_, i) => ({ roster_id: i + 1, settings: { division: 1 } }));
    t0 = performance.now();
    normalizeSleeperLeague(rawOf(d), { now: NOW, resolver: sleeperResolver(d.players) });
    expect(performance.now() - t0).toBeLessThan(LINEAR_MS);
  });

  it("ESPN: 60,000 trade rows sharing a key and naming 60,000 teams, or 60,000 acquisitions of one player, group in well under a second", () => {
    const rows: TradeRow[] = Array.from({ length: 60_000 }, (_, i) => ({
      row: { id: `t${i}`, type: "TRADE_ACCEPT", status: "EXECUTED", relatedTransactionId: "same", scoringPeriodId: 1, teamId: i + 1, proposedDate: AT - 86_400_000, processDate: null, teamActions: null },
      moves: [],
    }));
    let t0 = performance.now();
    expect(tradeHistory(rows, [], { now: AT, tradeCounters: new Map() }).trades).toHaveLength(1);
    expect(performance.now() - t0).toBeLessThan(LINEAR_MS);
    const acquisitions: TradeAcquisition[] = Array.from({ length: 60_000 }, (_, i) => ({ playerId: "4046", teamId: String((i % 10) + 1), at: AT - i * 120_000 }));
    t0 = performance.now();
    tradeHistory([], acquisitions, { now: AT, tradeCounters: new Map() });
    expect(performance.now() - t0).toBeLessThan(LINEAR_MS);
  });
});

describe("uploadShapeProblem: no more in an upload than a real league holds (review BF-R1)", () => {
  it("lets the committed leagues through with room to spare", async () => {
    expect(uploadShapeProblem(await espnUpload(), uploadShapeLimits)).toBeNull();
    expect(uploadShapeProblem(await sleeperUpload(), uploadShapeLimits)).toBeNull();
  });

  it("refuses too many teams, rostered players, scoring rules, matchup weeks or transactions (ESPN)", async () => {
    const honest = await espnUpload();
    const league = espnLeague(honest);
    const teams = league.teams as Json[];
    const one = teams[0] as Json;
    const entry = ((one.roster as Json).entries as unknown[])[0];
    const cases: Array<[string, (l: Json, u: LeagueUpload) => void]> = [
      ["more teams than an ESPN league has", (l) => (l.teams = Array.from({ length: uploadShapeLimits.espn.teams + 1 }, () => ({ ...one, roster: { entries: [] } })))],
      ["more rostered players than an ESPN league has", (l) => ((((l.teams as Json[])[0] as Json).roster as Json).entries = Array.from({ length: uploadShapeLimits.espn.rosterEntries }, () => entry))],
      ["more scoring rules than an ESPN league has", (l) => (((l.settings as Json).scoringSettings as Json).scoringItems = Array.from({ length: uploadShapeLimits.espn.scoringItems + 1 }, () => ({ statId: 1, points: 1 })))],
      ["more matchup weeks than an ESPN season has", (l) => (((l.settings as Json).scheduleSettings as Json).matchupPeriods = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [String(i + 1), [1, 2]])))],
      [
        "more transactions than an ESPN league has",
        (_l, u) => {
          for (const p of u.parts.filter((x) => x.url.includes("mTransactions2"))) (p.json as Json).transactions = Array.from({ length: Math.ceil(uploadShapeLimits.espn.transactions / 4) + 1 }, (_, i) => ({ id: `t${i}` }));
        },
      ],
    ];
    for (const [why, edit] of cases) {
      const u = forged(honest);
      edit(espnLeague(u), u);
      expect(uploadShapeProblem(u, uploadShapeLimits), why).toBe(why);
    }
  });

  it("refuses too many rosters, rostered players, scoring keys or lineup spots (Sleeper), any list too long and anything nested too deep", async () => {
    const honest = await sleeperUpload();
    const rostersOf = (u: LeagueUpload) => u.parts.find((p) => p.url.endsWith("/rosters")) as { json: unknown };
    const cases: Array<[string, (u: LeagueUpload) => void]> = [
      ["more teams than a Sleeper league has", (u) => (rostersOf(u).json = Array.from({ length: uploadShapeLimits.sleeper.rosters + 1 }, (_, i) => ({ roster_id: i + 1 })))],
      ["more rostered players than a Sleeper league has", (u) => (rostersOf(u).json = Array.from({ length: 2 }, (_, i) => ({ roster_id: i + 1, players: Array.from({ length: 1_000 }, (_, k) => String(k)), reserve: ["1"] })))],
      ["more scoring rules than a Sleeper league has", (u) => (sleeperLeague(u).scoring_settings = Object.fromEntries(Array.from({ length: uploadShapeLimits.sleeper.scoringKeys + 1 }, (_, i) => [`bonus_rush_yd_${i}`, 1])))],
      ["more lineup spots than a Sleeper league has", (u) => (sleeperLeague(u).roster_positions = Array.from({ length: uploadShapeLimits.sleeper.rosterPositions + 1 }, () => "BN"))],
      ["a list longer than a league's", (u) => ((u.parts.find((p) => p.url.includes("/matchups/1")) as { json: unknown }).json = Array.from({ length: uploadShapeLimits.maxEntries + 1 }, (_, i) => ({ roster_id: i, matchup_id: 1 })))],
      [
        "nested deeper than a league's data",
        (u) => {
          let deep: unknown = 1;
          for (let i = 0; i < 100_000; i++) deep = [deep];
          (u.parts.find((p) => p.url.endsWith("/drafts")) as { json: unknown }).json = deep;
        },
      ],
    ];
    for (const [why, edit] of cases) {
      const u = forged(honest);
      edit(u);
      expect(uploadShapeProblem(u, uploadShapeLimits), why).toBe(why);
    }
  });

  it("the import route answers such an upload BAD_UPLOAD-style (refused before any replay)", async () => {
    const u = forged(await sleeperUpload());
    sleeperLeague(u).roster_positions = Array.from({ length: uploadShapeLimits.sleeper.rosterPositions + 1 }, () => "BN");
    const read = await readLeagueUpload(gzipRequest("http://localhost:3000/api/import/sleeper", u), "sleeper");
    expect(read).toEqual({ ok: false, why: "more lineup spots than a Sleeper league has" });
  });

  it("the import route also refuses a Sleeper upload whose scoring makes more rules than any real league's (the import scores every free agent under each)", async () => {
    const route = async (u: LeagueUpload) => readLeagueUpload(gzipRequest("http://localhost:3000/api/import/sleeper", u), "sleeper");
    expect((await route(await sleeperUpload())).ok).toBe(true);
    const u = forged(await sleeperUpload());
    // Fewer keys than the key cap, but each a yardage tier: a rule apiece.
    sleeperLeague(u).scoring_settings = { ...(sleeperLeague(u).scoring_settings as Json), ...Object.fromEntries(Array.from({ length: uploadShapeLimits.sleeperScoringRules + 1 }, (_, i) => [`bonus_rush_yd_${10 * (i + 1)}`, 0.5])) };
    expect(Object.keys(sleeperLeague(u).scoring_settings as Json).length).toBeLessThanOrEqual(uploadShapeLimits.sleeper.scoringKeys);
    expect(await route(u)).toEqual({ ok: false, why: "more scoring rules than a Sleeper league has" });
  });
});

describe("uploadedImportProblem: the model build of an import from a browser stays within a real league's (review BF-R1)", () => {
  it("lets Parker's league through, and refuses one with as many players and scoring rules as an upload can hold", async () => {
    const honest = await importEspnUpload(await espnUpload(), { http: espnPublic(), resolver: espnResolver(), now: NOW });
    const snapshot = honest.result.snapshot;
    expect(modelWorkOf(snapshot)).toBeLessThan(uploadShapeLimits.modelWork / 10);
    expect(uploadedImportProblem(snapshot)).toBeNull();
    const rule: ScoringRule = { kind: "stepped", stat: "pass_yd", every: 5, points: 0.2 };
    const heavy = { ...snapshot, settings: { ...snapshot.settings, scoring: { ...snapshot.settings.scoring, rules: Array.from({ length: 200 }, () => rule) } } };
    expect(modelWorkOf(heavy)).toBeGreaterThan(uploadShapeLimits.modelWork);
    expect(uploadedImportProblem(heavy)).not.toBeNull();
    // A snapshot missing pieces counts them as empty (never throws).
    expect(modelWorkOf({} as never)).toBe(0);
  });
});

describe("the replay's backstop (review BF-R1)", () => {
  it("answers no more than an upload's parts plus maxParts requests, then throws BAD_RESPONSE", async () => {
    const replay = replayClient({ sentAt: AT, parts: [{ url: "https://x.test/a", status: 200, json: {}, at: AT }] }, AT, 2);
    for (let i = 0; i < 3; i++) await replay.get("https://x.test/a");
    await expect(replay.get("https://x.test/a")).rejects.toMatchObject({ name: "LeagueImportError", code: "BAD_RESPONSE" });
  });
});
