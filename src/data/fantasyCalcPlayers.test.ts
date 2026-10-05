import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as players from "./fantasyCalcPlayers";
import { fantasyCalcPlayersSchema, reduceFantasyCalcPlayers } from "./fantasyCalcPlayers";
import { fixtureFantasyCalcPlayers, fixtureFantasyCalcResponse } from "./testSupport";

describe("FantasyCalc /players: parsed from saved bodies only", () => {
  it("parses the committed first-100 fixture, dropping the UNK placeholder", () => {
    const parsed = fixtureFantasyCalcPlayers();
    expect(parsed).toHaveLength(100);
    expect(parsed.every((p) => p.sleeperId !== null)).toBe(true);
    const raw = fixtureFantasyCalcResponse() as Array<{ mflId?: unknown }>;
    const unk = raw.filter((p) => p.mflId === "UNK").length;
    expect(unk).toBeGreaterThan(0);
    expect(parsed.filter((p) => p.mflId === null).length).toBeGreaterThanOrEqual(unk);
    expect(parsed.some((p) => p.mflId === "UNK")).toBe(false);
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

  /** The modules (not tests) under `dir` that name /players, relative to `base`. */
  function naming(dir: string, base: string): string[] {
    const out: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && !/testSupport|testFakes|testFixtures/.test(e.name)) {
          const text = readFileSync(p, "utf8");
          if (/FANTASYCALC_PLAYERS_URL|FC_PLAYERS_URL|fantasycalc\.com\/players/.test(text)) out.push(path.relative(base, p).split(path.sep).join("/"));
        }
      }
    };
    walk(dir);
    return out.sort();
  }

  it("the app never calls it (FantasyCalc's conditions of 2026-10-05: only /values/current): nothing fetches it, and no app module names it", () => {
    expect(Object.keys(players).filter((k) => /fetch|load/i.test(k))).toEqual([]);
    const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    expect(naming(src, src)).toEqual(["data/fantasyCalcPlayers.ts"]);
  });

  it("nor does any script (review of Checkpoint 7b's server work: probe:shared and probe:mfl still asked for it under probe:all); only an offline reader of a saved copy names it", () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
    // scripts/measure-cache.ts reads a /players body already in the cache, offline (it never fetches).
    expect(naming(path.join(root, "scripts"), root)).toEqual(["scripts/measure-cache.ts"]);
  });
});
