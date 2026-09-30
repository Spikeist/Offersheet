import { describe, expect, it } from "vitest";
import { isRejectedId, normalizeId } from "./ids";

describe("normalizeId", () => {
  it("accepts digit ids as strings or numbers, trimmed", () => {
    expect(normalizeId("espn", 4429795)).toBe("4429795");
    expect(normalizeId("espn", " 4429795 ")).toBe("4429795");
    expect(normalizeId("sleeper", "13545")).toBe("13545");
    expect(normalizeId("yahoo", 40042)).toBe("40042");
    expect(normalizeId("fleaflicker", "17016")).toBe("17016");
  });

  it("keeps MFL leading zeros (team defenses are 0501…0532)", () => {
    expect(normalizeId("mfl", "0501")).toBe("0501");
    expect(normalizeId("mfl", "17462")).toBe("17462");
  });

  it("drops blanks and every placeholder seen in the sources", () => {
    for (const v of [null, undefined, "", "  ", "NA", "UNK", "null"]) expect(normalizeId("espn", v)).toBeNull();
    expect(normalizeId("mfl", "UNK")).toBeNull();
    expect(normalizeId("mfl", "RESERVED")).toBeNull();
    expect(normalizeId("sleeper", "RESERVED")).toBeNull();
    expect(normalizeId("fleaflicker", "empty_ff_id")).toBeNull();
  });

  it("drops FantasyCalc draft-pick keys", () => {
    expect(normalizeId("sleeper", "FP_2027_1")).toBeNull();
    expect(normalizeId("mfl", "FP_2027_early_0")).toBeNull();
  });

  it("rejects negative, fractional and unsafe numbers (ESPN D/ST ids go through defenseId)", () => {
    expect(normalizeId("espn", -16025)).toBeNull();
    expect(normalizeId("espn", "-16025")).toBeNull();
    expect(normalizeId("espn", 12.5)).toBeNull();
    expect(normalizeId("espn", Number.MAX_SAFE_INTEGER + 2)).toBeNull();
    expect(normalizeId("espn", { id: 1 })).toBeNull();
  });

  it("lower-cases Sportradar UUIDs and rejects anything else", () => {
    expect(normalizeId("sportradar", "B1DED115-092A-4199-9A55-CAB9F4B5BB18")).toBe("b1ded115-092a-4199-9a55-cab9f4b5bb18");
    expect(normalizeId("sportradar", "not-a-uuid")).toBeNull();
  });

  it("trims padded GSIS ids and rejects other formats", () => {
    expect(normalizeId("gsis", " 00-0041562")).toBe("00-0041562");
    expect(normalizeId("gsis", "ABC123456")).toBeNull();
  });
});

describe("isRejectedId", () => {
  it("flags placeholders but not blanks", () => {
    expect(isRejectedId("mfl", "UNK")).toBe(true);
    expect(isRejectedId("fleaflicker", "empty_ff_id")).toBe(true);
    expect(isRejectedId("mfl", "NA")).toBe(false);
    expect(isRejectedId("mfl", "")).toBe(false);
    expect(isRejectedId("mfl", null)).toBe(false);
    expect(isRejectedId("mfl", "0501")).toBe(false);
  });
});
