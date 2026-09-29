import { describe, expect, it } from "vitest";
import { Redactor, SWID_RE, defaultPlaceholder } from "./sanitize";

const isPlayerPath = (p: ReadonlyArray<string | number>) => p.includes("player");

describe("Redactor", () => {
  it("replaces registered values in values and keys, with stable placeholders", () => {
    const r = new Redactor("test");
    r.register("{11111111-2222-3333-4444-555555555555}", "swid");
    r.register("Gridiron Gurus", "team-name", "Team 3");
    r.register("123456789012345678", "user-id");
    const raw = {
      teams: [{ id: 3, name: "Gridiron Gurus", owners: ["{11111111-2222-3333-4444-555555555555}"] }],
      draft_order: { "123456789012345678": 1 },
      note: "trade by Gridiron Gurus",
      url: "/fans/%7B11111111-2222-3333-4444-555555555555%7D",
    };
    const clean = r.apply(raw);
    expect(clean.teams[0]?.name).toBe("Team 3");
    expect(clean.teams[0]?.owners[0]).toMatch(SWID_RE);
    expect(clean.teams[0]?.owners[0]).toBe("{00000000-0000-4000-8000-000000000001}");
    expect(Object.keys(clean.draft_order)).toEqual(["200000000000000001"]);
    expect(clean.note).toBe("trade by Team 3");
    expect(clean.url).toBe("/fans/%7B00000000-0000-4000-8000-000000000001%7D");
    expect(r.findLeaks(clean)).toEqual([]);
  });

  it("does not touch short names inside other strings, and never names on protected paths", () => {
    const r = new Redactor("test");
    r.register("Josh", "real-name", "Name 1"); // an owner's first name
    const raw = { members: [{ firstName: "Josh" }], roster: [{ player: { fullName: "Josh Allen", firstName: "Josh" } }] };
    const clean = r.apply(raw, { protect: isPlayerPath });
    expect(clean.members[0]?.firstName).toBe("Name 1");
    expect(clean.roster[0]?.player.fullName).toBe("Josh Allen");
    expect(clean.roster[0]?.player.firstName).toBe("Josh");
    expect(r.findLeaks(clean, { protect: isPlayerPath })).toEqual([]);
  });

  it("flags a short name left inside unprotected free text as a 'word' hit (for review)", () => {
    const r = new Redactor("test");
    r.register("Josh", "owner-name");
    const hits = r.findLeaks({ message: "Josh proposed a trade" });
    expect(hits).toEqual([{ category: "owner-name", path: "message", kind: "word" }]);
  });

  it("reports exact misses with path and category only", () => {
    const r = new Redactor("test");
    r.register("Secret Team Name", "team-name");
    const hits = r.findLeaks({ teams: [{ name: "Secret Team Name" }] });
    expect(hits).toEqual([{ category: "team-name", path: "teams[0].name", kind: "exact" }]);
    expect(JSON.stringify(hits)).not.toContain("Secret");
  });

  it("replaces numeric league IDs as numbers and inside strings, whole-number only", () => {
    const r = new Redactor("test");
    r.register(87654321, "league-id");
    const clean = r.apply({ id: 87654321, other: 876543210, href: "leagues/87654321/x" });
    expect(clean).toEqual({ id: 10000001, other: 876543210, href: "leagues/10000001/x" });
  });

  it("refuses to register tiny numbers that would corrupt ordinary data", () => {
    const r = new Redactor("test");
    expect(r.register(7, "other-id")).toBeUndefined();
    expect(r.apply({ teamId: 7 })).toEqual({ teamId: 7 });
  });

  it("sweeps unknown locations by pattern", () => {
    const r = new Redactor("test");
    const raw = { a: { memberId: "{AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE}" }, b: ["{AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE}"] };
    r.sweep(raw, (v) => (SWID_RE.test(v) ? "swid" : null));
    const clean = r.apply(raw);
    expect(clean.a.memberId).toBe(clean.b[0]);
    expect(clean.a.memberId).toMatch(/^\{00000000-/);
  });

  it("scrubText replaces whole words only", () => {
    const r = new Redactor("test");
    r.register("Mike", "owner-name", "Owner 2");
    expect(r.scrubText("Mike traded with Mikey")).toBe("Owner 2 traded with Mikey");
  });

  it("default placeholders keep ID formats", () => {
    expect(defaultPlaceholder("user-id", "123456789012345678", 7)).toBe("200000000000000007");
    expect(defaultPlaceholder("league-id", "899513", 1)).toBe("100001");
    expect(defaultPlaceholder("swid", "{x}", 10)).toBe("{00000000-0000-4000-8000-00000000000A}");
  });
});
