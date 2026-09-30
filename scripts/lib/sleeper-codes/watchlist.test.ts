import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { countByCategory, harvestFolder, harvestIdentities, isGenericName, isWatchable, looksLikePlaceholder, mergeWatchEntries, writeWatchlist } from "./watchlist";

// Obviously fictional identities only.
const USERS = [
  { user_id: "700000000000000001", display_name: "zorblax_q77", avatar: "0123456789abcdef0123456789abcdef", metadata: { team_name: "Quintavious Quokkas", avatar: "https://example.invalid/uploads/zq.png" }, league_id: "800000000000000001" },
  { user_id: "700000000000000002", display_name: "Team 3", metadata: { team_name: "Fantasy Football Team" }, league_id: "800000000000000001" },
];
const LEAGUE = { league_id: "800000000000000001", previous_league_id: "0", draft_id: "900000000000000001", name: "Zorblax Invitational", last_author_display_name: "sys", last_author_id: "700000000000000003", metadata: { copy_from_league_id: "800000000000000009" } };
const DRAFT = { draft_id: "900000000000000001", league_id: "800000000000000001", metadata: { name: "Quokka Cup Draft" }, draft_order: { "700000000000000004": 1 } };
const ROSTER = { roster_id: 1, owner_id: "700000000000000005", co_owners: ["700000000000000006"], league_id: "800000000000000001", players: ["4046"] };
const TX = { transaction_id: "123", creator: "700000000000000007", roster_ids: [1, 2], leg: 5 };

describe("watch list harvest", () => {
  it("collects names and IDs by key, never generic or placeholder-like values", () => {
    const got = mergeWatchEntries(...[USERS, LEAGUE, DRAFT, ROSTER, TX].map((x) => harvestIdentities(x)));
    const values = (cat: string) => got.filter((e) => e.category === cat).map((e) => e.value).sort();
    expect(values("username")).toEqual(["zorblax_q77"]); // "Team 3" is placeholder-like, "sys" generic
    expect(values("team-name")).toEqual(["Quintavious Quokkas"]); // "Fantasy Football Team" is generic
    expect(values("league-name")).toEqual(["Quokka Cup Draft", "Zorblax Invitational"]);
    expect(values("league-id")).toEqual(["800000000000000001", "800000000000000009"]); // "0" is no ID
    expect(values("draft-id")).toEqual(["900000000000000001"]);
    expect(values("user-id")).toEqual(["700000000000000001", "700000000000000002", "700000000000000003", "700000000000000004", "700000000000000005", "700000000000000006", "700000000000000007"]);
    expect(values("other-id")).toEqual(["0123456789abcdef0123456789abcdef", "https://example.invalid/uploads/zq.png"]);
    expect(got.some((e) => e.value === "4046" || e.value === "123")).toBe(false); // player and transaction IDs aren't identities
  });

  it("leaves out one short word as a league or team name, but keeps short usernames", () => {
    expect(isWatchable("Check", "league-name")).toBe(false);
    expect(isWatchable("Quokkas", "team-name")).toBe(false);
    expect(isWatchable("Quokkas", "username")).toBe(true); // a Sleeper username can be looked up
    expect(isWatchable("Zorblaxians", "team-name")).toBe(true);
    expect(isWatchable("Q Quokkas", "team-name")).toBe(true);
    expect(isWatchable("0", "league-id")).toBe(false);
  });

  it("recognizes generic names and our placeholders", () => {
    expect(isGenericName("2026 Fantasy Football League")).toBe(true);
    expect(isGenericName("The Dynasty League")).toBe(true);
    expect(isGenericName("Quokka League")).toBe(false);
    expect(looksLikePlaceholder("user12")).toBe(true);
    expect(looksLikePlaceholder("League 4")).toBe(true);
    expect(looksLikePlaceholder("T7")).toBe(true);
    expect(looksLikePlaceholder("zorblax_q77")).toBe(false);
  });

  it("merges, skips values already in a redaction map, and writes cumulatively", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "watch-"));
    try {
      await writeFile(path.join(dir, "a.json"), JSON.stringify(USERS));
      await writeFile(path.join(dir, "index.json"), JSON.stringify({ x: { label: "ignored" } }));
      const h = await harvestFolder(dir);
      expect(h.files).toBe(1);
      const file = path.join(dir, "watchlist.json");
      const first = await writeWatchlist(file, h.entries, new Set(["700000000000000001"]));
      expect(first.byCategory["user-id"]).toBe(1);
      const second = await writeWatchlist(file, [{ value: "Zorblax Invitational", category: "league-name" }]);
      expect(second.added).toBe(1);
      expect(second.total).toBe(first.total + 1);
      const saved = JSON.parse(await readFile(file, "utf8")) as unknown[];
      expect(saved).toHaveLength(second.total);
      // A tightened rule cleans older entries too.
      await writeFile(file, JSON.stringify([...(saved as object[]), { value: "Check", category: "league-name" }]));
      const third = await writeWatchlist(file, []);
      expect(third.dropped).toBe(1);
      expect(third.total).toBe(second.total);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("counts by category in a stable order", () => {
    const merged = mergeWatchEntries([{ value: "b", category: "user-id" }], [{ value: "a", category: "league-id" }, { value: "b", category: "user-id" }]);
    expect(merged).toEqual([
      { value: "a", category: "league-id" },
      { value: "b", category: "user-id" },
    ]);
    expect(countByCategory(merged)).toEqual({ "league-id": 1, "user-id": 1 });
  });
});
