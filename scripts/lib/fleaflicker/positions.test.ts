import { describe, expect, it } from "vitest";
import { flexKind, mapEligibility, mapInjury, mapPos, positionMatches, summarizeLineup } from "./positions";

describe("positions", () => {
  it("maps Fleaflicker labels to model positions", () => {
    expect(["QB", "D/ST", "CB", "S", "EDR", "IL", "DE", "DT", "LB", "WR/CB"].map(mapPos)).toEqual(["QB", "DEF", "DB", "DB", "DL", "DL", "DL", "DL", "LB", "WR"]);
    expect(mapPos("P")).toBeNull();
    expect(mapEligibility(["K", "P"])).toEqual({ eligible: ["K"], unmapped: ["P"] });
  });

  it("maps injury codes (typeAbbreviaition is the API's spelling)", () => {
    expect(mapInjury(undefined)).toEqual({ status: "ACTIVE", known: true });
    expect(mapInjury({ typeAbbreviaition: "Q", severity: "QUESTIONABLE" }).status).toBe("QUESTIONABLE");
    expect(mapInjury({ typeAbbreviaition: "IR", severity: "OUT" }).status).toBe("IR");
    expect(mapInjury({ typeAbbreviaition: "IRD", severity: "OUT" }).status).toBe("IR");
    expect(mapInjury({ typeAbbreviaition: "PUP", severity: "OUT" }).status).toBe("PUP");
    expect(mapInjury({ typeAbbreviaition: "EX", severity: "OUT" }).status).toBe("NA");
    expect(mapInjury({ typeAbbreviaition: "ZZ", severity: "OUT" })).toEqual({ status: "OUT", known: false });
  });

  it("summarizes roster positions: START slots, BN (group omitted = BENCH), IR, TAXI, limits", () => {
    const s = summarizeLineup([
      { label: "QB", group: "START", eligibility: ["QB"], min: 1, max: 3, start: 1 },
      { label: "RB/WR/TE", group: "START", eligibility: ["RB", "WR", "TE"], start: 2 },
      { label: "QB/RB/WR/TE", group: "START", eligibility: ["QB", "RB", "WR", "TE"], start: 1 },
      { label: "K/P", group: "START", eligibility: ["K", "P"], start: 1 },
      { label: "D/ST", group: "START", eligibility: ["D/ST"], max: 1 },
      { label: "IR", group: "INJURED", eligibility: ["QB", "RB"], start: 6 },
      { label: "TAXI", group: "TAXI", eligibility: ["QB", "RB"], start: 4 },
      { label: "BN", max: 15 },
    ]);
    expect(s.lineup.map((x) => `${x.slot}×${x.count}`)).toEqual(["QB×1", "RB/WR/TE×2", "QB/RB/WR/TE×1", "K/P×1"]);
    expect(s).toMatchObject({ benchSlots: 15, irSlots: 6, taxiSlots: 4, rosterOnly: ["D/ST"], positionLimits: { QB: 3, DEF: 1 }, positionMinimums: { QB: 1 } });
    expect(s.unmappedEligibility).toEqual([{ slot: "K/P", labels: ["P"] }]);
    expect(s.lineup.map(flexKind)).toEqual([null, "FLEX", "SUPER_FLEX", null]);
  });

  it("keeps the league's own per-label maxima next to the merged model limits", () => {
    const s = summarizeLineup([
      { label: "CB", group: "START", eligibility: ["CB"], min: 2, max: 4, start: 2 },
      { label: "S", group: "START", eligibility: ["S"], min: 2, max: 4, start: 2 },
      { label: "LB", group: "START", eligibility: ["LB"], max: 4, start: 2 },
    ]);
    expect(s.positionLimits).toEqual({ DB: 8, LB: 4 });
    expect(s.labelLimits).toEqual({ CB: 4, S: 4, LB: 4 });
    expect(s.mergedLimits).toEqual([{ pos: "DB", labels: ["CB", "S"] }]);
    expect(s.positionMinimums).toEqual({ CB: 2, S: 2 });
  });

  it("checks a listed player against a position filter (the API can ignore the filter)", () => {
    expect(positionMatches({ position: "D/ST" }, "D/ST")).toBe(true);
    expect(positionMatches({ position: "WR/CB" }, "CB")).toBe(true);
    expect(positionMatches({ position: "LB", positionEligibility: ["LB", "EDR"] }, "EDR")).toBe(true);
    expect(positionMatches({ position: "K" }, "D/ST")).toBe(false);
  });
});
