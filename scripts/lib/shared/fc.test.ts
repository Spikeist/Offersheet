import { describe, expect, it } from "vitest";
import type { FcEntry } from "../fantasycalc";
import { belowFloor, compareFormats, compareNameSets, countsByPosition, fieldPresence, idCoverage, isPickId, parsePickName, pickKeyForms, pickRows, redraftGap, topEntry, unionPlayers, valueRelations } from "./fc";

const entry = (id: number, position: string, value: number, extra: Partial<FcEntry["player"]> = {}, redraftValue = value): FcEntry => ({
  player: { id, name: `P${id}`, position, sleeperId: String(1000 + id), espnId: String(2000 + id), mflId: String(3000 + id), fleaflickerId: null, ffpcId: null, maybeTeam: "KC", maybeAge: 25, ...extra },
  value,
  redraftValue,
  combinedValue: value + redraftValue,
  overallRank: 1,
  positionRank: 1,
  trend30Day: 0,
  maybeTier: 1,
  maybeTradeFrequency: 0.01,
});

describe("FantasyCalc analysis", () => {
  it("parses pick names, including the Early/Mid/Late split", () => {
    expect(parsePickName("2027 1st (Early)")).toEqual({ season: 2027, round: 1, tier: "Early" });
    expect(parsePickName("2028 2nd")).toEqual({ season: 2028, round: 2, tier: null });
    expect(parsePickName("2029 4th")).toEqual({ season: 2029, round: 4, tier: null });
    expect(parsePickName("Jahmyr Gibbs")).toBeNull();
  });

  it("recognises pick keys stored in player ID fields", () => {
    expect(isPickId("FP_2027_early_0")).toBe(true);
    expect(isPickId("FP_2028_1")).toBe(true);
    expect(isPickId("9221")).toBe(false);
    expect(isPickId(9221)).toBe(false);
  });

  it("extracts pick rows with ids and flags names that don't parse", () => {
    const picks = pickRows([
      entry(1, "RB", 9000),
      entry(2, "PICK", 4600, { name: "2027 1st (Early)", sleeperId: "FP_2027_early_0", espnId: null }, 0),
      entry(3, "PICK", 100, { name: "Future pick" }, 0),
    ]);
    expect(picks).toHaveLength(2);
    expect(picks[0]).toMatchObject({ season: 2027, round: 1, tier: "Early", value: 4600, redraftValue: 0, parsed: true });
    expect(picks[0]?.ids.sleeperId).toBe("FP_2027_early_0");
    expect(picks[1]?.parsed).toBe(false);
  });

  it("reads pick key forms: FP_ keys vs nulls, and 1-based generic vs 0-based tiered numbering", () => {
    const pick = (id: number, name: string, key: string) => entry(id, "PICK", 100, { name, sleeperId: key, mflId: key, fleaflickerId: key, espnId: null, ffpcId: null }, 0);
    const picks = pickRows([pick(1, "2027 1st", "FP_2027_1"), pick(2, "2027 1st (Early)", "FP_2027_early_0"), pick(3, "2027 4th (Late)", "FP_2027_late_3"), pick(4, "2028 2nd", "FP_2028_2")]);
    const k = pickKeyForms(picks);
    expect(k.byField.sleeperId).toEqual({ "FP_ key": 4 });
    expect(k.byField.espnId).toEqual({ null: 4 });
    expect(k.roundOffset).toEqual({ generic: { "0": 2 }, tiered: { "-1": 2 } });
    expect(k.sameKeyAcrossFields).toBe(4);
    expect(k.seasonMismatches).toBe(0);
    expect(compareNameSets(["2027 1st", "2028 2nd"], ["2028 2nd", "2027 1st"])).toEqual({ same: true, onlyA: [], onlyB: [] });
    expect(compareNameSets(["2027 1st"], ["2027 2nd"])).toEqual({ same: false, onlyA: ["2027 1st"], onlyB: ["2027 2nd"] });
  });

  it("checks whether dynasty redraftValue could fill the redraft list, and the floor inversion", () => {
    const redraft = [entry(1, "RB", 9000), entry(2, "TE", 1)];
    const dynasty = [entry(1, "RB", 9500, {}, 9000), entry(2, "TE", 800, {}, 1), entry(3, "WR", 700, {}, 0), entry(4, "WR", 600, {}, 0), entry(5, "PICK", 500, {}, 0)];
    expect(redraftGap(redraft, dynasty)).toEqual({ missingFromRedraft: 2, missingWithRedraftValue: 0, inBoth: 2, redraftValueMatches: 2 });
    const bf = belowFloor(redraft, 90);
    expect(bf).toMatchObject({ below: 1, atOrBelow: 1 });
    expect(bf.min?.player.id).toBe(2);
  });

  it("compares formats: same, changed, dropped, added and median ratio by position", () => {
    const base = [entry(1, "TE", 1000), entry(2, "TE", 2000), entry(3, "RB", 5000), entry(4, "WR", 10)];
    const other = [entry(1, "TE", 1150), entry(2, "TE", 2300), entry(3, "RB", 5000), entry(5, "QB", 50)];
    const c = compareFormats(base, other);
    expect(c).toMatchObject({ same: 1, changed: 2, onlyInBase: 1, onlyInOther: 1, changedPositions: ["TE"] });
    expect(c.medianRatioByPos.TE).toBe(1.15);
    expect(c.medianRatioByPos.RB).toBe(1);
  });

  it("reports field presence, counts, top entry, value relations and ID coverage", () => {
    const list = [entry(1, "RB", 100, { espnId: null }), entry(2, "WR", 300), entry(3, "PICK", 50, { sleeperId: "FP_2027_1" }, 0)];
    const fp = fieldPresence(list);
    expect(fp.player.find((f) => f.field === "espnId")).toMatchObject({ present: 3, nonNull: 2, total: 3 });
    expect(fp.extraEntryKeys).toContain("combinedValue");
    expect(countsByPosition(list)).toEqual({ RB: 1, WR: 1, PICK: 1 });
    expect(topEntry(list)?.player.id).toBe(2);
    expect(valueRelations(list)).toMatchObject({ valueEqualsRedraft: 2, combinedIsSum: 3, withCombined: 3, total: 3 });
    expect(idCoverage(list)).toEqual({ players: 2, byField: { sleeperId: 2, espnId: 1, mflId: 2, fleaflickerId: 0, ffpcId: 0 } });
    expect([...unionPlayers(list, [entry(2, "WR", 1), entry(9, "TE", 1)]).keys()]).toEqual([1, 2, 9]);
  });
});
