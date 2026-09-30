import { describe, expect, it } from "vitest";
import { parseJsonKeepingBigInts, quoteBigIntegers } from "./json";

describe("quoteBigIntegers", () => {
  it("keeps 19-digit integer IDs as strings", () => {
    const body = '[{"draft_id":1234567890123456789,"round":1,"season":"2027"}]';
    expect(parseJsonKeepingBigInts(body)).toEqual([{ draft_id: "1234567890123456789", round: 1, season: "2027" }]);
  });

  it("never touches the fraction or exponent of a float, negative numbers or digits inside strings", () => {
    const body = '{"pass_yd":0.030303030303030304,"fg":0.10000000149011612,"big":-12345678901234567,"e":1.5e+300,"s":"id 1234567890123456789","esc":"a\\"12345678901234567890"}';
    expect(quoteBigIntegers(body)).toBe(body.replace("-12345678901234567", '"-12345678901234567"'));
    const parsed = parseJsonKeepingBigInts(body) as Record<string, unknown>;
    expect(parsed.pass_yd).toBeCloseTo(0.0303030303, 9);
    expect(parsed.fg).toBeCloseTo(0.1, 6);
    expect(parsed.big).toBe("-12345678901234567");
    expect(parsed.s).toBe("id 1234567890123456789");
  });

  it("returns undefined for bodies that aren't JSON objects or arrays", () => {
    expect(parseJsonKeepingBigInts("null")).toBeUndefined();
    expect(parseJsonKeepingBigInts("<html>")).toBeUndefined();
    expect(parseJsonKeepingBigInts("{broken")).toBeUndefined();
  });

  it("parses a float with 16+ fractional digits (a scoring rate such as 1/33)", () => {
    expect(parseJsonKeepingBigInts('{"pass_yd":0.030303030303030304}')).toEqual({ pass_yd: 0.030303030303030304 });
  });
});
