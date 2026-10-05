import { describe, expect, it } from "vitest";
import { MemoryCache, STALE_PUBLIC_RETAIN_MS, TTL } from "@/server/cache";
import { createHttpClient } from "@/server/http";
import { FANTASYCALC_MIN_ROWS, FANTASYCALC_PLAYERS_URL, FANTASYCALC_TIMEOUT_MS, fantasyCalcPlayersSchema, fetchFantasyCalcPlayers, reduceFantasyCalcPlayers } from "./fantasyCalcPlayers";
import { fakeHttp, fantasyCalcWith, fixtureFantasyCalcPlayers, fixtureFantasyCalcResponse } from "./testSupport";

describe("FantasyCalc /players", () => {
  it("parses the committed first-100 fixture, dropping the UNK placeholder", () => {
    const players = fixtureFantasyCalcPlayers();
    expect(players).toHaveLength(100);
    expect(players.every((p) => p.sleeperId !== null)).toBe(true);
    const raw = fixtureFantasyCalcResponse() as Array<{ mflId?: unknown }>;
    const unk = raw.filter((p) => p.mflId === "UNK").length;
    expect(unk).toBeGreaterThan(0);
    expect(players.filter((p) => p.mflId === null).length).toBeGreaterThanOrEqual(unk);
    expect(players.some((p) => p.mflId === "UNK")).toBe(false);
  });

  it("treats every FantasyCalc placeholder as blank and skips pick rows", () => {
    const reduced = reduceFantasyCalcPlayers(
      fantasyCalcPlayersSchema.parse([
        { id: 1, name: "Zorblax Quintavious", position: "QB", sleeperId: "RESERVED", espnId: null, mflId: "RESERVED", fleaflickerId: "empty_ff_id", maybeTeam: null },
        { id: 2, name: "Quillon Thrasp", position: "WR", sleeperId: "90002", espnId: "4400002", mflId: "UNK", fleaflickerId: "17016", maybeTeam: "JAX" },
        { id: 3, name: "2027 1st", position: "PICK", sleeperId: "FP_2027_1", mflId: "FP_2027_1", fleaflickerId: "FP_2027_1" },
      ]),
    );
    expect(reduced).toEqual([
      { fantasyCalcId: "1", name: "Zorblax Quintavious", position: "QB", sleeperId: null, espnId: null, mflId: null, fleaflickerId: null, team: null },
      { fantasyCalcId: "2", name: "Quillon Thrasp", position: "WR", sleeperId: "90002", espnId: "4400002", mflId: null, fleaflickerId: "17016", team: "JAX" },
    ]);
  });

  it("fetches with a 24 h cache, a 7-day saved copy and one retry, and names the JSON path of a missing field", async () => {
    const body = fantasyCalcWith(fixtureFantasyCalcResponse() as unknown[]);
    const { http, calls } = fakeHttp({ [FANTASYCALC_PLAYERS_URL]: { json: body } });
    const load = await fetchFantasyCalcPlayers(http);
    expect(load.players).toHaveLength(FANTASYCALC_MIN_ROWS);
    expect(load.players.filter((p) => p.sleeperId)).toHaveLength(100); // the fixture's rows; the filler has no ids
    expect(load).toMatchObject({ fromCache: false, stale: false });
    // League-independent (public: the shared cache's lock); not reduced, so its key stays shared with the stable copy (one fetch a day).
    expect(calls[0]?.opts?.cache).toEqual({ key: `fantasycalc:${FANTASYCALC_PLAYERS_URL}`, ttlMs: TTL.fantasyCalc, retainMs: STALE_PUBLIC_RETAIN_MS, staleIfError: true, public: true });
    expect(calls[0]?.opts?.transformText).toBeUndefined();
    expect(calls[0]?.opts).toMatchObject({ maxRetries: 1, timeoutMs: FANTASYCALC_TIMEOUT_MS });
    const bad = fakeHttp({ [FANTASYCALC_PLAYERS_URL]: { json: fantasyCalcWith([{ id: 1, name: "Zorblax Quintavious", position: "QB" }, { id: 2, position: "RB" }]) } });
    await expect(fetchFantasyCalcPlayers(bad.http)).rejects.toMatchObject({ code: "BAD_RESPONSE", detail: { path: "[1].name" } });
    await expect(fetchFantasyCalcPlayers(fakeHttp({ [FANTASYCALC_PLAYERS_URL]: { json: [] } }).http)).rejects.toMatchObject({ code: "BAD_RESPONSE" });
    await expect(fetchFantasyCalcPlayers(fakeHttp({ [FANTASYCALC_PLAYERS_URL]: { json: { players: [] } } }).http)).rejects.toMatchObject({ code: "BAD_RESPONSE", detail: { path: "(root)" } });
  });

  it("rejects (and never caches) a list below the row floor", async () => {
    const short = fixtureFantasyCalcResponse();
    const { http, calls } = fakeHttp({ [FANTASYCALC_PLAYERS_URL]: { json: short } });
    await expect(fetchFantasyCalcPlayers(http)).rejects.toMatchObject({ code: "BAD_RESPONSE", message: "FantasyCalc players: 100 rows, expected at least 1,000", detail: { path: "(root)" } });
    const cacheIf = calls[0]?.opts?.cacheIf;
    const res = (json: unknown) => ({ status: 200, ok: true, isHtml: false, json, text: JSON.stringify(json), fromCache: false });
    expect(cacheIf?.(res(short))).toBe(false);
    expect(cacheIf?.(res(fantasyCalcWith(short as unknown[])))).toBe(true);
    expect(cacheIf?.(res({ players: [] }))).toBe(false);
    expect(FANTASYCALC_MIN_ROWS).toBe(1_000);
  });

  it("reports a saved copy that stood in for a failed refresh", async () => {
    const { http } = fakeHttp({ [FANTASYCALC_PLAYERS_URL]: { json: fantasyCalcWith([]), stale: true, fetchedAt: 5 } });
    await expect(fetchFantasyCalcPlayers(http)).resolves.toMatchObject({ fromCache: true, stale: true, fetchedAt: 5 });
  });

  it("asks again, once, when a fresh cached copy fails the check (cached before the check existed)", async () => {
    const { http, calls } = fakeHttp({ [FANTASYCALC_PLAYERS_URL]: (attempt) => (attempt === 1 ? { json: [], fromCache: true } : { json: fantasyCalcWith([]) }) });
    await expect(fetchFantasyCalcPlayers(http)).resolves.toMatchObject({ fromCache: false });
    expect(calls.map((c) => c.opts?.cache?.ttlMs)).toEqual([TTL.fantasyCalc, Number.NEGATIVE_INFINITY]); // no copy is fresh enough: a live request
    // Through the real client: the bad entry is replaced by the good body.
    const cache = new MemoryCache();
    await cache.set(`fantasycalc:${FANTASYCALC_PLAYERS_URL}`, { status: 200, contentType: "application/json", text: "[]" }, TTL.fantasyCalc);
    let requests = 0;
    const fetchImpl = (async () => {
      requests++;
      return new Response(JSON.stringify(fantasyCalcWith([])), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const load = await fetchFantasyCalcPlayers(createHttpClient({ fetchImpl, cache }));
    expect(load.players).toHaveLength(FANTASYCALC_MIN_ROWS);
    expect(requests).toBe(1);
    const stored = await cache.get<{ text: string }>(`fantasycalc:${FANTASYCALC_PLAYERS_URL}`, TTL.fantasyCalc);
    expect(JSON.parse(stored?.value.text ?? "[]")).toHaveLength(FANTASYCALC_MIN_ROWS);
  });
});
