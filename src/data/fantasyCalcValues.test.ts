import { describe, expect, it } from "vitest";
import type { HttpClient } from "@/adapters/types";
import type { FantasyCalcFormat } from "@/engine/inputs";
import type { PlayerInfo } from "@/engine/model";
import { DAY, MemoryCache, STALE_PUBLIC_RETAIN_MS, TTL } from "@/server/cache";
import { createHttpClient } from "@/server/http";
import { fixtureLabels, readSanitizedFixture } from "@/test-utils/fixtures";
import {
  FANTASYCALC_DYNASTY_MIN_PLAYERS,
  FANTASYCALC_REDRAFT_MIN_PLAYERS,
  FANTASYCALC_VALUES_TIMEOUT_MS,
  fantasyCalcKnownIds,
  fantasyCalcMatcher,
  fantasyCalcValuesFor,
  fantasyCalcValuesSchema,
  fantasyCalcValuesUrl,
  loadFantasyCalcValues,
  marketInputsFrom,
  reduceFantasyCalcValues,
  type FantasyCalcValueRow,
  type FantasyCalcValuesLoad,
} from "./fantasyCalcValues";
import { fakeHttp } from "./testSupport";

const fmt = (over: Partial<FantasyCalcFormat> = {}): FantasyCalcFormat => ({ isDynasty: false, numQbs: 1, numTeams: 12, ppr: 1, substitutions: [], ...over });
/** Parker's format: redraft, 1 QB, 10 teams, half PPR (no committed capture; the 10-team PPR one stands in below). */
const REDRAFT_10 = fmt({ numTeams: 10 });
const DYNASTY_12 = fmt({ isDynasty: true });

type ValueRow = { player: { id: number | string; name: string; position: string; sleeperId?: unknown; espnId?: unknown }; value: number; redraftValue?: number };
const capture = (url: string) => {
  const label = `fantasycalc/values?${url.split("?")[1] ?? ""}`;
  return readSanitizedFixture<ValueRow[]>("shared", label);
};

/** A /values/current body: the given rows plus fictional filler players (no ids, value 1) up to `players` player rows. */
function valuesWith(rows: ValueRow[], players: number): ValueRow[] {
  const have = rows.filter((r) => r.player.position !== "PICK").length;
  const filler = Array.from({ length: Math.max(0, players - have) }, (_, i) => ({ player: { id: 900_000 + i, name: `Filler ${i}`, position: "WR", sleeperId: null, espnId: null }, value: 1, redraftValue: 1 }));
  return [...rows, ...filler];
}

describe("fantasyCalcValuesUrl (CLAUDE.md §2.9)", () => {
  it("encodes every committed capture's format exactly as it was requested, TE premium as tep=te%2B / te%2B%2B", () => {
    const labels = fixtureLabels("fixtures/sanitized/shared").filter((l) => l.startsWith("fantasycalc/values?"));
    expect(labels.length).toBeGreaterThanOrEqual(11);
    for (const label of labels) {
      const q = new URLSearchParams(label.split("?")[1]);
      const f = fmt({ isDynasty: q.get("isDynasty") === "true", numQbs: Number(q.get("numQbs")) as 1 | 2, numTeams: Number(q.get("numTeams")), ppr: Number(q.get("ppr")) as 0 | 0.5 | 1, ...(q.get("tep") ? { tep: q.get("tep") as "te+" | "te++" } : {}) });
      expect(fantasyCalcValuesUrl(f)).toBe(`https://api.fantasycalc.com/values/current?${label.split("?")[1]}`);
    }
    expect(fantasyCalcValuesUrl(fmt({ tep: "te+" }))).toBe("https://api.fantasycalc.com/values/current?isDynasty=false&numQbs=1&numTeams=12&ppr=1&tep=te%2B");
    expect(fantasyCalcValuesUrl(fmt({ tep: "te++", isDynasty: true, numQbs: 2 }))).toBe("https://api.fantasycalc.com/values/current?isDynasty=true&numQbs=2&numTeams=12&ppr=1&tep=te%2B%2B");
    expect(fantasyCalcValuesUrl(fmt({ numTeams: 10, ppr: 0.5 }))).toBe("https://api.fantasycalc.com/values/current?isDynasty=false&numQbs=1&numTeams=10&ppr=0.5");
    // One cache key per format: the explanation of a substitution isn't part of the request.
    expect(fantasyCalcValuesUrl(fmt({ numTeams: 14, substitutions: ["16 teams → 14-team values"] }))).toBe(fantasyCalcValuesUrl(fmt({ numTeams: 14 })));
  });
});

describe("reduceFantasyCalcValues", () => {
  it("keeps draft picks apart from player values (dynasty only), by name", () => {
    const dynasty = reduceFantasyCalcValues(fantasyCalcValuesSchema.parse(capture(fantasyCalcValuesUrl(DYNASTY_12))));
    expect(dynasty.players).toHaveLength(49);
    expect(dynasty.picks).toHaveLength(24);
    for (const p of dynasty.picks) expect(p.name).toMatch(/^\d{4} \d+(st|nd|rd|th)( \((Early|Mid|Late)\))?$/);
    expect(dynasty.picks).toContainEqual({ name: "2027 1st (Early)", value: 0 /* [value] */ });
    expect(dynasty.players.every((p) => p.position !== "PICK" && p.sleeperId !== null && !/^FP_/.test(p.sleeperId))).toBe(true);
    const redraft = reduceFantasyCalcValues(fantasyCalcValuesSchema.parse(capture(fantasyCalcValuesUrl(REDRAFT_10))));
    expect(redraft.picks).toEqual([]);
    expect(redraft.players[0]).toEqual({
      fantasyCalcId: "9821",
      name: "Jahmyr Gibbs",
      position: "RB",
      sleeperId: "9221",
      espnId: "4429795",
      mflId: "16162",
      fleaflickerId: "17612",
      team: "DET",
      value: 10717,
      redraftValue: 10605, // the 12-team PPR baseline: not this format's value
      overallRank: 1, // kept for the local archive only
      positionRank: 1,
    });
  });
});

describe("loadFantasyCalcValues (CLAUDE.md §2.10: 24 h per format)", () => {
  const url = fantasyCalcValuesUrl(REDRAFT_10);

  it("fetches with a 24 h cache, a 7-day saved copy and one retry, and reports the top value", async () => {
    const { http, calls } = fakeHttp({ [url]: { json: valuesWith(capture(url), FANTASYCALC_REDRAFT_MIN_PLAYERS), fetchedAt: 42 } });
    const load = await loadFantasyCalcValues(http, REDRAFT_10);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.opts?.cache).toEqual({ key: `fantasycalc:${url}`, ttlMs: TTL.fantasyCalc, retainMs: STALE_PUBLIC_RETAIN_MS, staleIfError: true });
    expect(calls[0]?.opts).toMatchObject({ maxRetries: 1, timeoutMs: FANTASYCALC_VALUES_TIMEOUT_MS });
    expect(load).toMatchObject({ format: REDRAFT_10, topValue: 10717, fromCache: false, stale: false, fetchedAt: 42 });
    expect(load.players).toHaveLength(FANTASYCALC_REDRAFT_MIN_PLAYERS);
    expect(load.players.filter((p) => p.sleeperId)).toHaveLength(50); // the capture's rows; the filler has no ids
  });

  it("can skip the retry (a keeper league's second list right after FantasyCalc didn't answer), and a saved copy still stands in then", async () => {
    const { http, calls } = fakeHttp({ [url]: { json: valuesWith(capture(url), FANTASYCALC_REDRAFT_MIN_PLAYERS), stale: true, fetchedAt: 7 } });
    await expect(loadFantasyCalcValues(http, REDRAFT_10, { maxRetries: 0 })).resolves.toMatchObject({ stale: true, fetchedAt: 7 });
    expect(calls.map((c) => c.opts?.maxRetries)).toEqual([0]);
    expect(calls[0]?.opts?.cache).toMatchObject({ staleIfError: true });
    // Through the real client: FantasyCalc down (503), no saved copy: exactly one attempt, then the failure.
    let requests = 0;
    const fetchImpl = (async () => {
      requests++;
      return new Response("", { status: 503 });
    }) as unknown as typeof fetch;
    await expect(loadFantasyCalcValues(createHttpClient({ fetchImpl, cache: new MemoryCache() }), REDRAFT_10, { maxRetries: 0 })).rejects.toMatchObject({ code: "SOURCE_DOWN", message: "FantasyCalc redraft values: HTTP 503", detail: { status: 503 } });
    expect(requests).toBe(1);
  });

  it("rejects (and never caches) a list below its row floor: 150 redraft, 300 dynasty players (picks don't count)", async () => {
    const short = capture(url);
    const { http, calls } = fakeHttp({ [url]: { json: short } });
    await expect(loadFantasyCalcValues(http, REDRAFT_10)).rejects.toMatchObject({ code: "BAD_RESPONSE", message: "FantasyCalc redraft values: 50 rows, expected at least 150 player rows", detail: { path: "(root)" } });
    const cacheIf = calls[0]?.opts?.cacheIf;
    const res = (json: unknown) => ({ status: 200, ok: true, isHtml: false, json, text: JSON.stringify(json), fromCache: false });
    expect(cacheIf?.(res(short))).toBe(false);
    expect(cacheIf?.(res(valuesWith(short, 150)))).toBe(true);
    const dUrl = fantasyCalcValuesUrl(DYNASTY_12);
    const dynasty = capture(dUrl); // 49 players + 24 picks
    await expect(loadFantasyCalcValues(fakeHttp({ [dUrl]: { json: valuesWith(dynasty, 299) } }).http, DYNASTY_12)).rejects.toMatchObject({ code: "BAD_RESPONSE", message: "FantasyCalc dynasty values: 299 rows, expected at least 300 player rows" });
    const ok = await loadFantasyCalcValues(fakeHttp({ [dUrl]: { json: valuesWith(dynasty, 300) } }).http, DYNASTY_12);
    expect({ players: ok.players.length, picks: ok.picks.length }).toEqual({ players: 300, picks: 24 });
    expect([FANTASYCALC_REDRAFT_MIN_PLAYERS, FANTASYCALC_DYNASTY_MIN_PLAYERS]).toEqual([150, 300]);
  });

  it("throws on a missing field (naming its JSON path), an error status or a non-JSON body", async () => {
    const rows = valuesWith(capture(url), 150);
    const broken = structuredClone(rows) as Array<Partial<ValueRow>>;
    delete broken[1]?.value;
    await expect(loadFantasyCalcValues(fakeHttp({ [url]: { json: broken } }).http, REDRAFT_10)).rejects.toMatchObject({ code: "BAD_RESPONSE", detail: { path: "[1].value" } });
    await expect(loadFantasyCalcValues(fakeHttp({ [url]: { status: 503, json: {} } }).http, REDRAFT_10)).rejects.toMatchObject({ code: "SOURCE_DOWN", message: "FantasyCalc redraft values: HTTP 503" });
    await expect(loadFantasyCalcValues(fakeHttp({ [url]: { text: "<html>", isHtml: true } }).http, REDRAFT_10)).rejects.toMatchObject({ code: "SOURCE_DOWN" });
    await expect(loadFantasyCalcValues(fakeHttp({ [url]: { json: { players: [] } } }).http, REDRAFT_10)).rejects.toMatchObject({ code: "BAD_RESPONSE", detail: { path: "(root)" } });
    const thrower: HttpClient = { get: async () => Promise.reject(new Error(`timeout at ${url}`)) };
    const err = await loadFantasyCalcValues(thrower, REDRAFT_10).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "SOURCE_DOWN", message: "FantasyCalc redraft values: couldn't be reached" });
  });

  it("serves a saved copy (up to 7 days old) when FantasyCalc fails, and says so", async () => {
    const { http } = fakeHttp({ [url]: { json: valuesWith(capture(url), 150), stale: true, fetchedAt: 5 } });
    await expect(loadFantasyCalcValues(http, REDRAFT_10)).resolves.toMatchObject({ fromCache: true, stale: true, fetchedAt: 5 });
    // Through the real client: a copy stored 2 days ago (past the 24 h TTL) stands in for a broken answer.
    const cache = new MemoryCache();
    const savedAt = Date.now() - 2 * DAY;
    await cache.set(`fantasycalc:${url}`, { status: 200, contentType: "application/json", text: JSON.stringify(valuesWith(capture(url), 150)), fetchedAt: savedAt }, STALE_PUBLIC_RETAIN_MS, savedAt);
    let requests = 0;
    const fetchImpl = (async () => {
      requests++;
      return new Response(JSON.stringify(capture(url)), { status: 200, headers: { "content-type": "application/json" } }); // 50 rows: below the floor
    }) as unknown as typeof fetch;
    const load = await loadFantasyCalcValues(createHttpClient({ fetchImpl, cache }), REDRAFT_10);
    expect(requests).toBe(1);
    expect(load).toMatchObject({ fromCache: true, stale: true, fetchedAt: savedAt });
    expect(load.players).toHaveLength(150);
  });

  it("asks again, once, when a fresh cached copy fails the check, and replaces it", async () => {
    const cache = new MemoryCache();
    await cache.set(`fantasycalc:${url}`, { status: 200, contentType: "application/json", text: "[]" }, TTL.fantasyCalc);
    let requests = 0;
    const fetchImpl = (async () => {
      requests++;
      return new Response(JSON.stringify(valuesWith(capture(url), 150)), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    const load = await loadFantasyCalcValues(createHttpClient({ fetchImpl, cache }), REDRAFT_10);
    expect(requests).toBe(1);
    expect(load).toMatchObject({ fromCache: false, stale: false });
    const stored = await cache.get<{ text: string }>(`fantasycalc:${url}`, TTL.fantasyCalc);
    expect(JSON.parse(stored?.value.text ?? "[]")).toHaveLength(150);
  });
});

// Fictional players (made-up ids and names) for the join rules.
const row = (over: Partial<FantasyCalcValueRow>): FantasyCalcValueRow => ({ fantasyCalcId: "1", name: "Zorblax Quintavious", position: "WR", sleeperId: null, espnId: null, mflId: null, fleaflickerId: null, team: null, value: 1000, redraftValue: null, ...over });
const info = (id: string, name: string, pos: PlayerInfo["pos"], eligible: PlayerInfo["pos"][] = [pos]): PlayerInfo => ({ id, name, pos, eligible, nflTeam: "DAL", injury: "ACTIVE", ids: {} });

describe("joining FantasyCalc to canonical ids (§4 canonical ids; §9 v_i)", () => {
  const rows = [
    row({ fantasyCalcId: "1", sleeperId: "90001", espnId: "4400001", value: 5000 }),
    row({ fantasyCalcId: "2", name: "Quillon Thrasp Jr.", position: "TE", sleeperId: "90002", espnId: "4400002", mflId: "16002", fleaflickerId: "17002", value: 3000 }),
    row({ fantasyCalcId: "3", name: "Brontis Vell", position: "RB", sleeperId: "90003", espnId: "4400003", value: 800 }),
    row({ fantasyCalcId: "4", name: "Duplicate Row", sleeperId: "90001", value: 1 }),
  ];
  const players: Record<string, PlayerInfo> = {
    "90001": info("90001", "Somebody Else Entirely", "WR"), // a Sleeper id joins on sleeperId alone
    "espn:4400002": info("espn:4400002", "Quillon Thrasp", "TE"), // suffix and punctuation don't matter
    "espn:4400003": info("espn:4400003", "Brontis Vell", "WR"), // FantasyCalc says RB: a namesake, no match
    "espn:4400001": info("espn:4400001", "Different Person", "WR"), // FantasyCalc's espnId is stale here
    "mfl:16002": info("mfl:16002", "Quillon Thrasp", "WR", ["WR", "TE"]),
    "fleaflicker:17002": info("fleaflicker:17002", "Quillon Thrasp", "TE"),
    DAL: info("DAL", "Dallas D/ST", "DEF"),
    "yahoo:4400002": info("yahoo:4400002", "Quillon Thrasp", "TE"),
  };

  it("joins a Sleeper id on sleeperId, and a platform id only when name and position agree too", () => {
    const match = fantasyCalcMatcher(rows);
    expect(match("90001", players["90001"])?.fantasyCalcId).toBe("1"); // first row wins over the duplicate
    expect(match("90001", undefined)?.fantasyCalcId).toBe("1");
    expect(match("espn:4400002", players["espn:4400002"])?.fantasyCalcId).toBe("2");
    expect(match("espn:4400003", players["espn:4400003"])).toBeUndefined();
    expect(match("espn:4400001", players["espn:4400001"])).toBeUndefined();
    expect(match("espn:4400002", undefined)).toBeUndefined(); // nothing to check the name against
    expect(match("mfl:16002", players["mfl:16002"])?.fantasyCalcId).toBe("2"); // eligible at TE
    expect(match("fleaflicker:17002", players["fleaflicker:17002"])?.fantasyCalcId).toBe("2");
    expect(match("DAL", players.DAL)).toBeUndefined();
    expect(match("yahoo:4400002", players["yahoo:4400002"])).toBeUndefined(); // FantasyCalc has no Yahoo id
    expect(match("toString:4400002", players["espn:4400002"])).toBeUndefined();
    expect(match("constructor:4400002", players["espn:4400002"])).toBeUndefined();
    expect(fantasyCalcValuesFor(rows, players, ["90001", "espn:4400002", "espn:4400003", "DAL", "90009"])).toEqual({ "90001": 5000, "espn:4400002": 3000 });
  });

  it("knownIds: players matched in /players or in the value rows, in order, without repeats", () => {
    const fcPlayers = [{ fantasyCalcId: "7", name: "Vellum Oats", position: "QB", sleeperId: "90007", espnId: "4400007", mflId: null, fleaflickerId: null, team: null }];
    const known = fantasyCalcKnownIds(["90007", "90001", "espn:4400003", "90001", "90008", "espn:4400007"], { ...players, "espn:4400007": info("espn:4400007", "Vellum Oats", "QB") }, [rows, fcPlayers]);
    expect(known).toEqual(["90007", "90001", "espn:4400007"]);
  });

  it("works on the committed captures: every value row's Sleeper id finds its row", () => {
    const load = reduceFantasyCalcValues(fantasyCalcValuesSchema.parse(capture(fantasyCalcValuesUrl(REDRAFT_10))));
    const ids = load.players.map((p) => p.sleeperId as string);
    const values = fantasyCalcValuesFor(load.players, {}, ids);
    expect(Object.keys(values)).toHaveLength(50);
    expect(values["9221"]).toBe(10717);
  });
});

function loaded(format: FantasyCalcFormat, players: FantasyCalcValueRow[], fetchedAt?: number): FantasyCalcValuesLoad {
  return { format, players, picks: [], topValue: Math.max(...players.map((p) => p.value)), fromCache: false, stale: false, ...(fetchedAt !== undefined ? { fetchedAt } : {}) };
}

describe("market inputs (§9: which number a league uses)", () => {
  const players: Record<string, PlayerInfo> = { "90001": info("90001", "Zorblax Quintavious", "WR"), "90002": info("90002", "Quillon Thrasp", "TE"), "90003": info("90003", "Brontis Vell", "RB") };
  const NOW = new Date("2026-09-30T12:00:00Z");

  it("redraft: the league-format value for relevant players only; knownIds include /players", () => {
    const values = loaded(REDRAFT_10, [row({ sleeperId: "90001", value: 7000 }), row({ sleeperId: "90009", value: 9000 })], 1_000);
    const m = marketInputsFrom({ values, fantasyCalcPlayers: [{ fantasyCalcId: "3", name: "Brontis Vell", position: "RB", sleeperId: "90003", espnId: null, mflId: null, fleaflickerId: null, team: null }], players, relevantIds: ["90001", "90002", "90003"], now: NOW });
    expect(m).toEqual({ format: REDRAFT_10, fetchedAt: new Date(1_000).toISOString(), values: { "90001": 7000 }, knownIds: ["90001", "90003"], topValue: 9000 });
  });

  it("keeper: dynasty values for the future term, redraft values for perception; the oldest fetch time", () => {
    const dynasty = loaded(DYNASTY_12, [row({ sleeperId: "90001", value: 8000 }), row({ sleeperId: "90002", value: 4000 })], 2_000);
    const redraft = loaded(fmt(), [row({ sleeperId: "90001", value: 6000 })], 1_500);
    const m = marketInputsFrom({ values: dynasty, redraft, fantasyCalcPlayers: null, players, relevantIds: new Set(["90001", "90002", "90003"]), now: NOW });
    expect(m).toEqual({ format: DYNASTY_12, fetchedAt: new Date(1_500).toISOString(), values: { "90001": 8000, "90002": 4000 }, redraftValues: { "90001": 6000 }, knownIds: ["90001", "90002"], topValue: 8000 });
    expect(marketInputsFrom({ values: loaded(DYNASTY_12, [row({ sleeperId: "90001" })]), fantasyCalcPlayers: null, players, relevantIds: [], now: NOW }).fetchedAt).toBe(NOW.toISOString());
  });

  it("dynasty: this season's list (the market blend's, §6 step 8) becomes seasonValues, never redraftValues; it counts for knownIds and the oldest fetch time", () => {
    const dynasty = loaded(DYNASTY_12, [row({ sleeperId: "90001", value: 8000 })], 2_000);
    const season = loaded(fmt(), [row({ sleeperId: "90001", value: 6000 }), row({ sleeperId: "90003", value: 3000 })], 1_200);
    const m = marketInputsFrom({ values: dynasty, season, fantasyCalcPlayers: null, players, relevantIds: ["90001", "90002", "90003"], now: NOW });
    expect(m).toEqual({ format: DYNASTY_12, fetchedAt: new Date(1_200).toISOString(), values: { "90001": 8000 }, seasonValues: { "90001": 6000, "90003": 3000 }, knownIds: ["90001", "90003"], topValue: 8000 });
  });
});
