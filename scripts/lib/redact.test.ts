import { describe, expect, it } from "vitest";
import { Scrubber } from "./redact";

describe("Scrubber", () => {
  it("replaces a SWID in every common spelling", () => {
    const s = new Scrubber();
    s.add("{ABCDEF12-3456-7890-ABCD-EF1234567890}", "[SWID]");
    const text = [
      "cookie SWID={ABCDEF12-3456-7890-ABCD-EF1234567890};",
      "path /fans/%7BABCDEF12-3456-7890-ABCD-EF1234567890%7D",
      "lower abcdef12-3456-7890-abcd-ef1234567890",
    ].join("\n");
    const out = s.scrub(text);
    expect(out).not.toMatch(/ABCDEF12|abcdef12/);
    expect(out.match(/\[SWID\]/g)?.length).toBe(3);
  });

  it("matches numeric IDs only as whole numbers", () => {
    const s = new Scrubber();
    s.add("12345", "[LEAGUE]");
    expect(s.scrub("leagues/12345?view=x id=123456 t=912345")).toBe("leagues/[LEAGUE]?view=x id=123456 t=912345");
  });

  it("handles %-encoded secrets in both forms", () => {
    const s = new Scrubber();
    s.add("AEBxyz%2Babc%3D", "[S2]");
    expect(s.scrub("a=AEBxyz%2Babc%3D b=AEBxyz+abc=")).toBe("a=[S2] b=[S2]");
  });

  it("ignores values too short to scrub safely", () => {
    const s = new Scrubber();
    s.add("ab", "[X]");
    s.add(undefined, "[Y]");
    expect(s.size).toBe(0);
    expect(s.scrub("abc")).toBe("abc");
  });

  it("deep-scrubs JSON values and keys", () => {
    const s = new Scrubber();
    s.add("123456789", "[ID]");
    expect(s.scrubDeep({ id: 123456789, url: "x/123456789", "123456789": true, n: 42 })).toEqual({ id: "[ID]", url: "x/[ID]", "[ID]": true, n: 42 });
  });
});
