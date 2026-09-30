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
    r.register("Zorblax", "real-name", "Name 1"); // an owner's first name
    const raw = { members: [{ firstName: "Zorblax" }], roster: [{ player: { fullName: "Zorblax Quintavious", firstName: "Zorblax" } }] };
    const clean = r.apply(raw, { protect: isPlayerPath });
    expect(clean.members[0]?.firstName).toBe("Name 1");
    expect(clean.roster[0]?.player.fullName).toBe("Zorblax Quintavious");
    expect(clean.roster[0]?.player.firstName).toBe("Zorblax");
    expect(r.findLeaks(clean, { protect: isPlayerPath })).toEqual([]);
  });

  it("flags a short name left inside unprotected free text as a 'word' hit (for review)", () => {
    const r = new Redactor("test");
    r.register("Zorblax", "owner-name");
    const hits = r.findLeaks({ message: "Zorblax proposed a trade" });
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

  it("refuses to register tiny numbers as IDs, but still replaces a short numeric name as an exact string", () => {
    const r = new Redactor("test");
    expect(r.register(7, "other-id")).toBeUndefined();
    expect(r.apply({ teamId: 7 })).toEqual({ teamId: 7 });
    r.register("123", "team-abbrev", "T4");
    expect(r.apply({ abbrev: "123", points: 123, note: "scored 123 points" })).toEqual({ abbrev: "T4", points: 123, note: "scored 123 points" });
    // …and report text keeps its numbers.
    expect(r.scrubText("123 of 123 players (123.0%)")).toBe("123 of 123 players (123.0%)");
    expect(r.findLeaks({ note: "scored 123 points" })).toEqual([]);
  });

  it("keeps numeric placeholders beyond 2^53 as strings", () => {
    // JSON.parse has already rounded a bare 19-digit ID; a sweep registers that same rounded number.
    const parsed = JSON.parse('{"draft_id": 1234567890123456789}') as { draft_id: number };
    const r = new Redactor("test");
    const ph = r.register(parsed.draft_id, "draft-id");
    expect(ph).toMatch(/^3\d{18}$/);
    expect(r.apply(parsed).draft_id).toBe(ph); // a string: Number(ph) would round again
  });

  it("sweeps unknown locations by pattern", () => {
    const r = new Redactor("test");
    const raw = { a: { memberId: "{AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE}" }, b: ["{AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE}"] };
    r.sweep(raw, (v) => (SWID_RE.test(v) ? "swid" : null));
    const clean = r.apply(raw);
    expect(clean.a.memberId).toBe(clean.b[0]);
    expect(clean.a.memberId).toMatch(/^\{00000000-/);
  });

  it("never registers placeholders as real values (sweeping sanitized data is a no-op)", () => {
    const r = new Redactor("test");
    const ph = r.register("{AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE}", "swid");
    const manifest = { mySwid: ph, team: "Team 3" };
    r.register("Real Team Name", "team-name", "Team 3");
    r.sweep(manifest, (v) => (SWID_RE.test(v) ? "swid" : null));
    expect(r.register("Team 3", "team-name")).toBe("Team 3");
    expect(r.apply(manifest)).toEqual(manifest);
    expect(r.entries().some((e) => e.raw === ph || e.raw === "Team 3")).toBe(false);
  });

  it("scrubText replaces whole words only", () => {
    const r = new Redactor("test");
    r.register("Gribnok", "owner-name", "Owner 2");
    expect(r.scrubText("Gribnok traded with Gribnoky")).toBe("Owner 2 traded with Gribnoky");
  });

  it("default placeholders keep ID formats", () => {
    expect(defaultPlaceholder("user-id", "123456789012345678", 7)).toBe("200000000000000007");
    expect(defaultPlaceholder("league-id", "899513", 1)).toBe("100001");
    expect(defaultPlaceholder("swid", "{x}", 10)).toBe("{00000000-0000-4000-8000-00000000000A}");
  });
});
