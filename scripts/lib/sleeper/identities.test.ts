import { describe, expect, it } from "vitest";
import { Redactor } from "../sanitize";
import { SleeperIdentities, isNonIdentifying, placeholderCollisions, protectDraftPicks, protectLeagueData, structuralStrings } from "./identities";
import type { SleeperDraft, SleeperLeague, SleeperRoster, SleeperTransaction, SleeperUser } from "./types";

// Synthetic data only: made-up IDs and names in Sleeper's shapes.
const league = {
  league_id: "111122223333444455",
  previous_league_id: "111122223333444400",
  draft_id: "999988887777666655",
  name: "Made Up Fantasy League",
  avatar: "0123456789abcdef0123456789abcdef",
  season: "2026",
  status: "in_season",
  sport: "nfl",
  season_type: "regular",
  total_rosters: 3,
  settings: { num_teams: 3, type: 2 },
  scoring_settings: { rec: 1, pass_td: 4 },
  roster_positions: ["QB", "RB", "FLEX", "BN"],
  last_author_id: "500000000000000009",
  last_author_display_name: "Chatty Zorblax",
  last_message_id: "700000000000000001",
  metadata: { division_1: "North Division", division_1_avatar: "https://example.test/a.png", auto_continue: "on", promo_id: "01ABCDEFGHJKMNPQRSTVWXYZ12", latest_league_winner_roster_id: "2" },
} as unknown as SleeperLeague;

const users = [
  { user_id: "500000000000000001", display_name: "AlphaUser", avatar: "aaaaaaaaaaaaaaaa", metadata: { team_name: "The Alpha Squad", allow_pn: "on", mascot_item_type_id_leg_1: "cowboy_hat" } },
  { user_id: "500000000000000002", display_name: "QB", avatar: "bbbbbbbbbbbbbbbb", metadata: { mascot_message_leg_2: "gg all" } },
  { user_id: "500000000000000003", display_name: "Qz", avatar: null, metadata: {} },
  { user_id: "500000000000000004", display_name: "Co Owner Vexmoor", avatar: null, metadata: {} },
] as unknown as SleeperUser[];

const rosters = [
  { roster_id: 1, owner_id: "500000000000000002", co_owners: null, players: ["4034", "DAL"], starters: ["4034"], reserve: [], taxi: [], settings: {}, metadata: { record: "WLW", streak: "1W", p_nick_4034: "Big Game Zorb", allow_pn_news: "on" } },
  { roster_id: 2, owner_id: "500000000000000001", co_owners: ["500000000000000004"], players: ["1234"], starters: ["1234"], reserve: [], taxi: [], settings: {}, metadata: {} },
  { roster_id: 3, owner_id: "500000000000000003", co_owners: null, players: ["5678"], starters: ["5678"], reserve: [], taxi: [], settings: {}, metadata: {} },
] as unknown as SleeperRoster[];

const txs = [
  { transaction_id: "800000000000000001", type: "waiver", status: "failed", leg: 1, created: 1, creator: "500000000000000001", adds: { "1234": 2 }, drops: null, metadata: { notes: "Your waiver claim was outbid by another team." } },
] as unknown as SleeperTransaction[];

const drafts = [
  { draft_id: "999988887777666655", league_id: "111122223333444455", season: "2026", status: "complete", type: "linear", creators: ["500000000000000001"], draft_order: { "500000000000000001": 1, "500000000000000002": 2, "500000000000000003": 3 }, metadata: { name: "Made Up Fantasy League", description: "", scoring_type: "dynasty_ppr" } },
] as unknown as SleeperDraft[];

function setup() {
  const r = new Redactor("test-sleeper");
  const structural = structuralStrings({ league, rosters, transactions: txs, drafts, playerNames: ["Zorblax Quintavious"] });
  const ids = new SleeperIdentities(r, structural, rosters.length);
  ids.league(league, 1);
  ids.members(users, rosters);
  ids.leagueExtras(league);
  ids.transactions(txs);
  ids.drafts(drafts);
  ids.sweepLongIds({ league, users, rosters, txs, drafts });
  return { r, ids };
}

describe("SleeperIdentities", () => {
  it("numbers users by the roster they own; co-owners get numbers after the last roster", () => {
    const { r } = setup();
    expect(r.placeholderOf("500000000000000002")).toBe("200000000000000001"); // owns roster 1
    expect(r.placeholderOf("500000000000000001")).toBe("200000000000000002");
    expect(r.placeholderOf("500000000000000003")).toBe("200000000000000003");
    expect(r.placeholderOf("500000000000000004")).toBe("200000000000000004"); // co-owner → 4
    expect(r.placeholderOf("AlphaUser")).toBe("Owner 2");
    expect(r.placeholderOf("The Alpha Squad")).toBe("Team 2");
    expect(r.placeholderOf("Co Owner Vexmoor")).toBe("Owner 4");
    expect(r.placeholderOf("Qz")).toBe("Owner 3"); // a 2-letter display name is still an identity
    expect(r.placeholderOf("111122223333444455")).toBe("100000000000000001");
    expect(r.placeholderOf("Made Up Fantasy League")).toBe("League 1");
  });

  it("replaces short names on exact match only", () => {
    const { r } = setup();
    const clean = r.apply({ users, note: "Qz is also a substring of Qzx" }, { protect: protectLeagueData });
    expect(clean.users[2]?.display_name).toBe("Owner 3");
    expect(clean.note).toBe("Qz is also a substring of Qzx");
  });

  it("never gives two raw values the same placeholder", () => {
    const { r } = setup();
    const byPlaceholder = new Map<string, string>();
    for (const e of r.entries()) {
      if (e.category === "swid") continue;
      const prev = byPlaceholder.get(e.placeholder);
      expect(prev === undefined || prev === e.raw).toBe(true);
      byPlaceholder.set(e.placeholder, e.raw);
    }
  });

  it("registers free text but not flags, records, enum tokens, or names equal to ordinary data", () => {
    const { r, ids } = setup();
    expect(r.placeholderOf("Big Game Zorb")).toBeDefined(); // player nickname
    expect(r.placeholderOf("North Division")).toBeDefined();
    expect(r.placeholderOf("gg all")).toBeDefined();
    expect(r.placeholderOf("Chatty Zorblax")).toBeDefined();
    expect(r.placeholderOf("Your waiver claim was outbid by another team.")).toBeDefined();
    expect(r.placeholderOf("01ABCDEFGHJKMNPQRSTVWXYZ12")).toBeDefined(); // promo_id → other-id
    expect(r.placeholderOf("WLW")).toBeUndefined();
    expect(r.placeholderOf("1W")).toBeUndefined();
    expect(r.placeholderOf("on")).toBeUndefined();
    expect(r.placeholderOf("cowboy_hat")).toBeUndefined();
    expect(r.placeholderOf("dynasty_ppr")).toBeUndefined();
    expect(r.placeholderOf("QB")).toBeUndefined(); // display name equal to a slot name
    expect(ids.skipped).toBeGreaterThan(0);
  });

  it("sanitizes a roster response without touching player IDs and leaves no leaks", () => {
    const { r } = setup();
    const clean = r.apply(rosters, { protect: protectLeagueData });
    expect(clean[0]?.players).toEqual(["4034", "DAL"]);
    expect(clean[0]?.owner_id).toBe("200000000000000001");
    expect(clean[1]?.co_owners).toEqual(["200000000000000004"]);
    expect(clean[0]?.metadata?.record).toBe("WLW");
    expect(r.findLeaks(clean, { protect: protectLeagueData })).toEqual([]);
  });

  it("replaces user IDs used as draft_order keys", () => {
    const { r } = setup();
    const clean = r.apply(drafts, { protect: protectLeagueData });
    expect(Object.keys(clean[0]?.draft_order ?? {}).sort()).toEqual(["200000000000000001", "200000000000000002", "200000000000000003"]);
    expect(r.findLeaks(clean)).toEqual([]);
  });

  it("protects drafted players' names in draft picks", () => {
    const r = new Redactor("test-sleeper");
    r.register("Zorblax", "owner-name", "Owner 9");
    const picks = [{ picked_by: "500000000000000001", player_id: "4984", metadata: { first_name: "Zorblax", last_name: "Quintavious" } }];
    const clean = r.apply(picks, { protect: protectDraftPicks });
    expect(clean[0]?.metadata.first_name).toBe("Zorblax");
  });
});

describe("isNonIdentifying", () => {
  it("treats numbers, flags and records as data in free text, but keeps long IDs", () => {
    const s = new Set<string>();
    expect(isNonIdentifying("12", s)).toBe(true);
    expect(isNonIdentifying("on", s)).toBe(true);
    expect(isNonIdentifying("WWLW", s)).toBe(true);
    expect(isNonIdentifying("123456789012345678", s)).toBe(false);
    expect(isNonIdentifying("Gridiron Gang", s)).toBe(false);
  });

  it("keeps every name, however short, unless it equals ordinary data", () => {
    const s = new Set<string>(["qb"]);
    expect(isNonIdentifying("2468", s, true)).toBe(false);
    expect(isNonIdentifying("12", s, true)).toBe(false);
    expect(isNonIdentifying("Qz", s, true)).toBe(false);
    expect(isNonIdentifying("X", s, true)).toBe(false);
    expect(isNonIdentifying("QB", s, true)).toBe(true);
    expect(isNonIdentifying("none", s, true)).toBe(true);
    expect(isNonIdentifying("  ", s, true)).toBe(true);
  });
});

describe("placeholder numbering", () => {
  it("keeps league placeholders unique across the probed league, its previous season and other leagues", () => {
    const r = new Redactor("test-sleeper");
    const ids = new SleeperIdentities(r, new Set(), 3);
    ids.league(league, 1); // registers previous_league_id too (→ League/ID 2)
    const other1 = { ...league, league_id: "111122223333444466", previous_league_id: null, name: "Another Made Up League", draft_id: "999988887777666600" } as unknown as SleeperLeague;
    const other2 = { ...league, league_id: "111122223333444477", previous_league_id: "111122223333444488", name: "Third Made Up League", draft_id: "999988887777666611" } as unknown as SleeperLeague;
    ids.league(other1, 2); // 2 is taken by the previous season → gets the next free number
    ids.league(other2, 3);
    ids.drafts([{ ...drafts[0], metadata: { name: "Some Other Draft Name" } } as unknown as SleeperDraft]);
    expect(placeholderCollisions(r)).toEqual([]);
    expect(r.placeholderOf("111122223333444400")).toBe("100000000000000002");
    expect(r.placeholderOf("111122223333444466")).toBe("100000000000000003");
    expect(r.placeholderOf("Another Made Up League")).toBe("League 3");
  });

  it("names the last chat author after their user number", () => {
    const { r } = setup();
    expect(r.placeholderOf("500000000000000009")).toBe("200000000000000005");
    expect(r.placeholderOf("Chatty Zorblax")).toBe("Owner 5");
    expect(placeholderCollisions(r)).toEqual([]);
  });
});
