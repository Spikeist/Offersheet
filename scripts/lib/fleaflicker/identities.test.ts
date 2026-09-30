import { describe, expect, it } from "vitest";
import { scrubEverything } from "../redact";
import { Redactor } from "../sanitize";
import { FleaIdentities, isNflWordsOnly, protectPublic } from "./identities";

// Synthetic response in Fleaflicker's shape (made-up names and ids).
const standings = {
  divisions: [
    {
      id: 5501,
      name: "The Invented Division",
      teams: [
        { id: 7654321, name: "Imaginary Gridiron Club", logoUrl: "https://cdn.example.test/t7654321.png", initials: "IG", owners: [{ id: 8765432, displayName: "madeup_owner_one", avatarUrl: "https://cdn.example.test/u8765432.jpg", initials: "M", lastSeen: "1790000000000" }] },
        { id: 7654322, name: "TE", initials: "TE", owners: [{ id: 4321, displayName: "shortid_owner", lastSeen: "1790000000000" }] },
      ],
    },
  ],
  league: { id: 987654, name: "The Fictional League", logoUrl: "https://cdn.example.test/l987654.png", maxKeepers: 5, description: "Welcome madeup_owner_one!", chatChannel: "league-987654" },
};

const box = {
  lineups: [
    {
      group: "START",
      slots: [
        {
          position: { label: "WR", group: "START", eligibility: ["WR"], min: 2, max: 9, start: 3 },
          home: { proPlayer: { id: 1234, nameFull: "Real Player Name", position: "WR", proTeam: { abbreviation: "KC", name: "Chiefs" } }, owner: { id: 7654321, name: "Imaginary Gridiron Club", initials: "IG" }, viewingActualPoints: { value: 12.5, formatted: "12.5" } },
        },
      ],
    },
  ],
  trades: [{ id: 9990001, description: "Imaginary Gridiron Club traded Real Player Name" }],
};

describe("FleaIdentities", () => {
  it("registers leaguemates and replaces them by key and value; player data is kept", () => {
    const r = new Redactor("test-flea");
    const ids = new FleaIdentities(r);
    ids.leagueId(987654);
    ids.sweep(standings);
    ids.sweep(box);
    expect(ids.teams).toBe(2);
    expect(ids.owners).toBe(2);
    expect(ids.skippedNames).toBe(1); // team named "TE" looks like data: replaced by key only
    expect(ids.shortUserIds).toBe(1); // 4-digit owner id could equal a player id: not registered globally

    const cleanSt = r.apply(ids.prepare(standings, { trim: true }), { protect: protectPublic }) as typeof standings;
    const team = cleanSt.divisions[0]?.teams[0];
    expect(team?.id).toBe(4000001);
    expect(team?.name).toBe("Team 1");
    expect(team?.initials).toBe("XX");
    expect(team?.logoUrl).toMatch(/^https:\/\/example\.invalid\/avatar\//);
    expect(team?.owners[0]).toMatchObject({ id: 2000001, displayName: "Owner 1" });
    expect(team?.owners[0]).not.toHaveProperty("lastSeen");
    expect(cleanSt.divisions[0]?.teams[1]).toMatchObject({ id: 4000002, name: "Team 2" });
    expect(cleanSt.divisions[0]?.teams[1]?.owners[0]).toMatchObject({ id: 2000002, displayName: "Owner 2" });
    expect(cleanSt.divisions[0]?.name).toBe("Division 1");
    expect(cleanSt.divisions[0]?.id).toBe(5000001);
    expect(cleanSt.league).toMatchObject({ id: 100001, name: "League 1", description: "[redacted]", chatChannel: "[redacted]" });
    expect(r.findLeaks(cleanSt, { protect: protectPublic })).toEqual([]);

    const cleanBox = r.apply(ids.prepare(box, { trim: true }), { protect: protectPublic }) as typeof box;
    const slot = cleanBox.lineups[0]?.slots[0];
    expect(slot?.position).toEqual({ label: "WR", group: "START" });
    expect(slot?.home.proPlayer).toEqual({ id: 1234, nameFull: "Real Player Name", position: "WR" }); // proTeam trimmed, name kept
    expect(slot?.home.owner).toEqual({ id: 4000001 });
    expect(cleanBox.trades[0]).toEqual({ id: 9990001, description: "[redacted]" });
    expect(r.findLeaks(cleanBox, { protect: protectPublic })).toEqual([]);
  });

  it("treats team names made only of NFL team words as data, not identities", () => {
    expect(isNflWordsOnly("Vegas Raiders")).toBe(true);
    expect(isNflWordsOnly("New York Giants")).toBe(true);
    expect(isNflWordsOnly("Imaginary Gridiron Club")).toBe(false);
    expect(isNflWordsOnly("Eagle Eye Squad")).toBe(false);
    const ids = new FleaIdentities(new Redactor("test-nfl"));
    ids.team({ id: 7000001, name: "Philadelphia Eagles" });
    expect(ids.skippedNames).toBe(1);
    expect(ids.prepare({ id: 7000001, name: "Philadelphia Eagles" })).toEqual({ id: 4000001, name: "Team 1" }); // still replaced by key
  });

  it("never registers public names (NFL players) and keeps screened league ids out of the map", () => {
    const r = new Redactor("test-public");
    const ids = new FleaIdentities(r);
    ids.addPublicNames(["Famous Quarterback"]);
    ids.division({ id: 1, name: "Famous Quarterback", teams: [] });
    expect(r.entries()).toEqual([]);
    expect(ids.prepare({ divisions: [{ id: 1, name: "Famous Quarterback", teams: [] }] })).toEqual({ divisions: [{ id: 5000001, name: "Division 1", teams: [] }] });
    expect(ids.isPublicName("Famous Quarterback")).toBe(true);
    expect(ids.isPublicName("Zorblax Quintavious")).toBe(false);

    ids.transientLeagueId("55501");
    expect(scrubEverything("FetchLeagueRules?league_id=55501&x=155501")).toBe("FetchLeagueRules?league_id={otherLeagueId}&x=155501");
    expect(r.entries()).toEqual([]);
  });

  it("replaces division ids by key (placeholder 500000N), also for a division without a name", () => {
    const r = new Redactor("test-div");
    const ids = new FleaIdentities(r);
    const st = {
      divisions: [
        { id: 7770001, name: "Zorblax Quintavious Division", teams: [{ id: 6660001, name: "Imaginary Gridiron Club" }] },
        { id: 7770002, teams: [{ id: 6660002, name: "Made Up Squad" }] },
        { id: 5502, teams: [] },
      ],
      league: { id: 987654, maxKeepers: 0 },
    };
    ids.sweep(st);
    const clean = r.apply(ids.prepare(st), { protect: protectPublic }) as { divisions: Array<{ id: number; name?: string }> };
    expect(clean.divisions.map((d) => d.id)).toEqual([5000001, 5000002, 5000003]);
    expect(clean.divisions[0]?.name).toBe("Division 1");
    // 7-digit division ids are registered for global replacement; a 4-digit one (could equal a player id) is not.
    expect(r.placeholderOf("7770001")).toBe("5000001");
    expect(r.placeholderOf("5502")).toBeUndefined();
    expect(r.findLeaks(clean, { protect: protectPublic })).toEqual([]);
  });

  it("does not take a trade (an object with teams[] outside `divisions`) for a division", () => {
    const ids = new FleaIdentities(new Redactor("test-trade"));
    const trades = { trades: [{ id: 9990001, teams: [{ team: { id: 6660001, name: "Imaginary Gridiron Club" } }] }] };
    ids.sweep(trades);
    const out = ids.prepare(trades) as { trades: Array<{ id: number; teams: Array<{ team: { id: number; name: string } }> }> };
    expect(out.trades[0]?.id).toBe(9990001);
    expect(out.trades[0]?.teams[0]?.team).toEqual({ id: 4000001, name: "Team 1" });
  });

  it("protects public NFL subtrees only", () => {
    expect(protectPublic(["lineups", 0, "slots", 0, "home", "proPlayer", "nameFull"])).toBe(true);
    expect(protectPublic(["lineups", 0, "slots", 0, "home", "owner", "name"])).toBe(false);
    expect(protectPublic(["groups", 0, "scoringRules", 1, "category", "nameSingular"])).toBe(true);
  });
});
