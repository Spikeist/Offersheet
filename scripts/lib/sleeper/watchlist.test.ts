import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { pruneStaleFixtures } from "./fixturePrune";
import { isUsefulWatchValue, Watchlist } from "./watchlist";

describe("Watchlist", () => {
  it("collects league, member and roster identities and merges with the saved file", async () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "sleeper-watch-")), "watchlist.json");
    writeFileSync(file, JSON.stringify([{ value: "old-value-123", category: "league-name" }]));
    const w = new Watchlist(file);
    w.addLeague({ league_id: "111122223333444455", previous_league_id: null, draft_id: "999988887777666655", name: "Zorblax Invitational", last_author_display_name: "Quintavious", metadata: { division_1: "Vexmoor Division", auto_continue: "on" } });
    w.addUser({ user_id: "500000000000000001", username: "zorb_fan", display_name: "Zorbfan", metadata: { team_name: "Quintavious Squad" } });
    w.addRoster({ owner_id: "500000000000000002", co_owners: ["500000000000000003"] });
    w.add("", "username");
    w.add(0, "other-id");
    w.add("home", "league-name"); // a single short word identifies nobody
    w.addLeague({ league_id: "111122223333444466", last_author_is_bot: true, last_author_display_name: "botnamezz" });
    expect(w.size).toBe(12); // + the second league's ID; the bot's name is skipped
    expect(await w.save()).toBe(13);
    const saved = JSON.parse(readFileSync(file, "utf8")) as Array<{ value: string; category: string }>;
    expect(saved).toContainEqual({ value: "Vexmoor Division", category: "team-name" });
    expect(saved).toContainEqual({ value: "old-value-123", category: "league-name" });
    expect(saved.some((e) => e.value === "on")).toBe(false);
    expect(saved.some((e) => e.value === "home" || e.value === "botnamezz")).toBe(false);
  });

  it("drops generic short names already in the saved file", async () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "sleeper-watch-")), "watchlist.json");
    writeFileSync(file, JSON.stringify([{ value: "test", category: "league-name" }, { value: "Qz Team", category: "team-name" }, { value: "abc", category: "username" }]));
    expect(await new Watchlist(file).save()).toBe(2);
    expect(isUsefulWatchValue("Zorb", "owner-name")).toBe(false);
    expect(isUsefulWatchValue("Zorb9", "owner-name")).toBe(true);
    expect(isUsefulWatchValue("Zorbs", "owner-name")).toBe(true);
    expect(isUsefulWatchValue("1234567890", "league-id")).toBe(true);
  });
});

describe("pruneStaleFixtures", () => {
  it("deletes stale fixtures under the prefix, with their index entries", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "sleeper-prune-"));
    const index = {
      "a.json": { label: "public-test-league/keep" },
      "b.json": { label: "public-test-league/stale" },
      "c.json": { label: "manifest" },
    };
    writeFileSync(path.join(dir, "index.json"), JSON.stringify(index));
    for (const f of Object.keys(index)) writeFileSync(path.join(dir, f), "{}");
    const removed = await pruneStaleFixtures(dir, "public-test-league/", new Set(["public-test-league/keep"]));
    expect(removed).toEqual(["public-test-league/stale"]);
    const left = JSON.parse(readFileSync(path.join(dir, "index.json"), "utf8")) as Record<string, unknown>;
    expect(Object.keys(left).sort()).toEqual(["a.json", "c.json"]);
    expect(() => readFileSync(path.join(dir, "b.json"))).toThrow();
  });
});
