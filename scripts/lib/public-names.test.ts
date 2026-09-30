import { describe, expect, it } from "vitest";
import { quoteBigInts } from "./http";
import { buildPublicNames, countOutsidePlayerNames, inPlayerName, isPlayerName } from "./public-names";
import type { SleeperPlayer } from "./sleeper-players";

// Deliberately fictional names: the leak checker treats real people's names in scripts/ as hard hits.
const names = buildPublicNames({
  "1": { player_id: "1", full_name: "Zorblax Quintavious", first_name: "Zorblax", last_name: "Quintavious", position: "WR", college: "Plumbus State" },
  "2": { player_id: "2", full_name: "D'Varnox Blerp", first_name: "D'Varnox", last_name: "Blerp", position: "RB" },
  "3": { player_id: "3", first_name: "Gazorpazorp", last_name: "Snarflers", position: "DEF" },
} as Record<string, SleeperPlayer>);

describe("public NFL names", () => {
  it("recognises player names in several spellings", () => {
    expect(isPlayerName("Zorblax Quintavious", names)).toBe(true);
    expect(isPlayerName("Quintavious, Zorblax", names)).toBe(true);
    expect(isPlayerName("D'Varnox Blerp", names)).toBe(true);
    expect(isPlayerName("Zorblax Smithers", names)).toBe(false);
    expect(names.publicWords.has("snarflers")).toBe(true);
    expect(names.publicWords.has("plumbus state")).toBe(true);
  });

  it("counts a first name only where it is not part of a player's name (JSON)", () => {
    const doc = {
      players: [{ player: { first_name: "Zorblax", last_name: "Quintavious", twitter: "Zorblax_14" } }, { fullName: "D'Varnox Blerp" }],
      members: [{ firstName: "Zorblax", lastName: "Last 3", displayName: "Owner 3" }],
      notes: "Zorblax proposed a trade",
      evidence: ["Zorblax Quintavious: 320.76", "Quintavious, Zorblax (WR)"],
    };
    expect(countOutsidePlayerNames(doc, "Zorblax", names)).toBe(2); // members[].firstName and notes
    expect(countOutsidePlayerNames(doc, "Varnox", names)).toBe(0);
  });

  it("discounts neighbouring words that form a player's name (plain text)", () => {
    const md = "Misses: Zorblax Quintavious (IR), Quintavious, Zorblax; owner Zorblax.";
    const at = [...md.matchAll(/Zorblax/g)].map((m) => m.index ?? 0);
    expect(at.map((i) => inPlayerName(md, i, "Zorblax", names))).toEqual([true, true, false]);
  });

  it("judges a word inside an apostrophe name by the whole name (unquoted CSV)", () => {
    const csv = "1234,D'Varnox Blerp,RB,KC\n5678,Varnox Smithers,WR,NE";
    const at = [...csv.matchAll(/Varnox/g)].map((m) => m.index ?? 0);
    expect(at.map((i) => inPlayerName(csv, i, "Varnox", names))).toEqual([true, false]);
  });
});

describe("quoteBigInts", () => {
  it("keeps 16+ digit integers exact and leaves strings, decimals and small numbers alone", () => {
    const text = '{"draft_id":1234567890123456789,"s":"id 1234567890123456789 \\" 1234567890123456789","n":12345,"f":1234567890123456789.5,"neg":-1234567890123456789,"arr":[9999999999999999999, 7]}';
    const j = JSON.parse(quoteBigInts(text)) as Record<string, unknown>;
    expect(j.draft_id).toBe("1234567890123456789");
    expect(j.s).toBe('id 1234567890123456789 " 1234567890123456789');
    expect(j.n).toBe(12345);
    expect(typeof j.f).toBe("number");
    expect(j.neg).toBe("-1234567890123456789");
    expect(j.arr).toEqual(["9999999999999999999", 7]);
    expect(quoteBigInts('{"a":1}')).toBe('{"a":1}');
  });

  it("never splits long decimals or exponents (Sleeper rates like 1/33 or float32 noise)", () => {
    const text = '{"rate":0.030303030303030304,"noise":0.10000000149011612,"big":1.5e+25,"neg":-0.12345678901234567,"id":1234567890123456789}';
    const j = JSON.parse(quoteBigInts(text)) as Record<string, unknown>;
    expect(j.rate).toBeCloseTo(1 / 33, 15);
    expect(j.noise).toBe(0.10000000149011612);
    expect(j.big).toBe(1.5e25);
    expect(j.neg).toBe(-0.12345678901234567);
    expect(j.id).toBe("1234567890123456789");
  });
});
