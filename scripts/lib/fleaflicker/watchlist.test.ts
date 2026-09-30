import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { WatchList, watchable } from "./watchlist";

// Made-up identities only.
const standings = {
  league: { id: 987654, name: "Zorblax Quintavious Invitational" },
  divisions: [
    {
      id: 7770001,
      teams: [
        { id: 6660001, name: "Imaginary Gridiron Club", owners: [{ id: 8765432, displayName: "madeup_owner_one" }, { id: 4321, displayName: "Team 3" }] },
        { id: 6660002, name: "Famous Quarterback", owners: [] },
      ],
    },
  ],
};

describe("WatchList", () => {
  it("keeps ids of 6+ digits and names that aren't public data or placeholders", async () => {
    const w = new WatchList((v) => v === "Famous Quarterback");
    w.addStandings(standings, "55501");
    const dir = mkdtempSync(path.join(tmpdir(), "ff-watch-"));
    try {
      const file = path.join(dir, "watchlist.json");
      const n = await w.save(file);
      const saved = JSON.parse(readFileSync(file, "utf8")) as Array<{ value: string; category: string }>;
      expect(n).toBe(saved.length);
      const values = saved.map((e) => `${e.category}:${e.value}`);
      expect(values).toEqual(
        expect.arrayContaining(["league-id:987654", "league-name:Zorblax Quintavious Invitational", "other-id:7770001", "other-id:6660001", "team-name:Imaginary Gridiron Club", "user-id:8765432", "owner-name:madeup_owner_one"]),
      );
      expect(values.some((x) => x.endsWith(":55501") || x.endsWith(":4321"))).toBe(false); // < 6 digits: left out
      expect(values.some((x) => x.endsWith("Team 3") || x.endsWith("Famous Quarterback"))).toBe(false);
      expect(w.skippedShortIds).toBe(2);
      expect(w.skippedNames).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("leaves out names shaped like an ordinary word, keeps handles and multi-word names", () => {
    expect(watchable("Zorblaxian", "owner-name")).toBe(false); // letters only, initial capital
    expect(watchable("quintavious", "owner-name")).toBe(false);
    expect(watchable("zorblax_42", "owner-name")).toBe(true);
    expect(watchable("ZorblaxQuint", "owner-name")).toBe(true); // inner capital: a handle
    expect(watchable("Imaginary Gridiron Club", "team-name")).toBe(true);
    expect(watchable("12345", "league-id")).toBe(false);
    expect(watchable("123456", "league-id")).toBe(true);
  });

  it("re-applies the rules to entries saved earlier", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ff-watch-"));
    try {
      const file = path.join(dir, "watchlist.json");
      writeFileSync(file, JSON.stringify([{ value: "quintavious", category: "owner-name" }, { value: "zorblax_42", category: "owner-name" }]));
      expect(await new WatchList().save(file)).toBe(1);
      expect(JSON.parse(readFileSync(file, "utf8"))).toEqual([{ value: "zorblax_42", category: "owner-name" }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("merges with the saved list instead of replacing it", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ff-watch-"));
    try {
      const file = path.join(dir, "watchlist.json");
      const a = new WatchList();
      a.addId(1234567, "league-id");
      await a.save(file);
      const b = new WatchList();
      b.addName("Imaginary Gridiron Club", "team-name");
      expect(await b.save(file)).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
