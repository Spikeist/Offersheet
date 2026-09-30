import { describe, expect, it } from "vitest";
import {
  NameWatch,
  PREV_STRATA,
  extractDocSeeds,
  hashOrder,
  linkKind,
  numericSettings,
  playoffWeeksToFetch,
  realId,
  selectCurrentSample,
  selectDeeperSeasons,
  selectPicksSample,
  selectPrevSample,
  selectTradeControlSample,
  summarizeDraft,
  summarizePicks,
  toLeague2026,
  tradeLegsToFetch,
  trimTx,
  type League2026,
  type Prev2025,
} from "./crawl";

function season(id: string, settings: Record<string, number>, previousLeagueId: string | null = null, depth = 1): Prev2025 {
  return {
    fromLeagueId: `f${id}`,
    leagueId: id,
    depth,
    previousLeagueId,
    previousLink: previousLeagueId ? "id" : "null",
    hasBracketOverrides: false,
    httpStatus: 200,
    found: true,
    settings,
    rosterPositions: [],
    standings: [],
    matchups: {},
    transactions: {},
    nameKeywords: [],
  };
}

function league(id: string, settings: Record<string, number>, extra: Partial<League2026> = {}): League2026 {
  return {
    leagueId: id,
    previousLeagueId: `9${id}`,
    previousLink: "id",
    draftId: `8${id}`,
    hop: 1,
    settings,
    rosterPositions: [],
    scoringNonzero: [],
    metadataKeys: [],
    nameKeywords: [],
    hasBracketIds: false,
    ...extra,
  };
}

describe("seeds and records", () => {
  it("extracts example IDs from the docs page", () => {
    const html = `<pre>{ "league_id": "<span>111111111111111111</span>", "previous_league_id": "222222222222222222", "owner_id": "333333333333333333", "user_id": "12345678" }</pre>`;
    expect(extractDocSeeds(html)).toEqual({ leagueIds: ["111111111111111111", "222222222222222222"], userIds: ["333333333333333333"] });
  });

  it("orders deterministically for a salt, differently across salts", () => {
    const ids = Array.from({ length: 20 }, (_, i) => `id${i}`);
    const a = hashOrder(ids, (s) => s, "salt-a");
    expect(hashOrder([...ids].reverse(), (s) => s, "salt-a")).toEqual(a);
    expect([...a].sort()).toEqual([...ids].sort());
    expect(hashOrder(ids, (s) => s, "salt-b")).not.toEqual(a);
  });

  it("keeps numeric settings only", () => {
    expect(numericSettings({ type: 2, name: "x", best_ball: 0, "Weird Key": 1, bad: Number.NaN })).toEqual({ type: 2, best_ball: 0 });
  });

  it('treats previous_league_id "0" as no previous season', () => {
    expect(linkKind("0")).toBe("zero");
    expect(linkKind("000")).toBe("zero");
    expect(linkKind(null)).toBe("null");
    expect(linkKind(undefined)).toBe("absent");
    expect(linkKind("1234567890123456789")).toBe("id");
    expect(linkKind("abc")).toBe("other");
    expect(realId("0")).toBeNull();
    expect(realId("1234567890123456789")).toBe("1234567890123456789");
    const rec = toLeague2026({ league_id: "1234567890123456789", previous_league_id: "0", draft_id: "0", settings: {} }, 1);
    expect(rec).toMatchObject({ previousLeagueId: null, previousLink: "zero", draftId: null });
  });

  it("trims a league to codes and keyword flags (no name)", () => {
    const rec = toLeague2026(
      {
        league_id: "1234567890123456789",
        previous_league_id: null,
        draft_id: "1234567890123456780",
        name: "Zorblax Dynasty Syndicate",
        status: "in_season",
        season: "2026",
        season_type: "regular",
        total_rosters: 12,
        settings: { type: 2, taxi_slots: 3 },
        roster_positions: ["QB", "RB", "SUPER_FLEX", "BN"],
        scoring_settings: { rec: 1, pass_td: 4, fum: 0 },
        metadata: { auto_continue: "on", division_1: "Name" },
      },
      2,
    );
    expect(rec).toMatchObject({ previousLeagueId: null, previousLink: "null", hop: 2, status: "in_season", totalRosters: 12, settings: { type: 2, taxi_slots: 3 }, scoringNonzero: ["pass_td", "rec"], nameKeywords: ["dynasty"] });
    expect(JSON.stringify(rec)).not.toContain("Zorblax");
    expect(toLeague2026({ name: "no id" }, 0)).toBeUndefined();
  });

  it("summarizes drafts and picks", () => {
    expect(summarizeDraft({ type: "snake", status: "complete", settings: { rounds: 4, player_type: 1, teams: 12 }, metadata: { scoring_type: "dynasty_ppr", league_type: "2", name: "My Draft" } })).toEqual({
      type: "snake",
      status: "complete",
      rounds: 4,
      playerType: 1,
      teams: 12,
      scoringType: "dynasty_ppr",
      leagueTypeMeta: "2",
      hasBudget: false,
    });
    expect(
      summarizePicks([
        { roster_id: 1, is_keeper: true, metadata: { years_exp: "3" } },
        { roster_id: 1, is_keeper: true, metadata: { years_exp: "5" } },
        { roster_id: 2, is_keeper: null, metadata: { years_exp: "0" } },
        { roster_id: 3, metadata: {} },
      ]),
    ).toEqual({ picks: 4, keepers: 2, rookies: 1, withYearsExp: 3, maxKeepersPerRoster: 2 });
  });

  it("trims transactions to codes and counts", () => {
    expect(trimTx({ type: "waiver", status: "complete", leg: 5, created: 1, status_updated: 2, roster_ids: [3], settings: { waiver_bid: 7, seq: 1 }, draft_picks: [], metadata: null })).toEqual({
      type: "waiver",
      status: "complete",
      leg: 5,
      created: 1,
      statusUpdated: 2,
      rosters: 1,
      consenters: 0,
      draftPicks: 0,
      waiverBid: 7,
      settingsKeys: ["waiver_bid", "seq"],
      metadataKeys: [],
    });
  });
});

describe("sampling", () => {
  it("picks completed drafts per league type and renewal", () => {
    const ls = [
      league("1", { type: 0 }, { draft: { status: "complete", hasBudget: false } }),
      league("2", { type: 0 }, { draft: { status: "complete", hasBudget: false } }),
      league("3", { type: 2 }, { draft: { status: "complete", hasBudget: false }, previousLeagueId: null, previousLink: "zero" }),
      league("4", { type: 2 }, { draft: { status: "pre_draft", hasBudget: false } }),
    ];
    const s = selectPicksSample(ls, 1);
    expect(s).toHaveLength(2);
    expect(s.some((l) => l.leagueId === "3")).toBe(true);
  });

  it("covers every code value before filling, and never picks a league without a real previous season", () => {
    const common = { playoff_round_type: 0, league_average_match: 0, playoff_type: 0, playoff_seed_type: 0, type: 0, waiver_type: 2, trade_deadline: 11, disable_trades: 0, pick_trading: 1 };
    const ls = [
      ...Array.from({ length: 20 }, (_, i) => league(String(100 + i), common)),
      league("7", { ...common, playoff_round_type: 2 }),
      league("8", { ...common, trade_deadline: 99 }),
      league("9", { ...common, best_ball: 1 }),
      league("10", { ...common, league_average_match: 1 }, { previousLeagueId: null, previousLink: "zero" }),
      league("11", { ...common, playoff_teams: 7 }),
    ];
    const s = selectPrevSample(ls, 5, 1, "any-salt").map((l) => l.leagueId);
    expect(s).toHaveLength(5);
    expect(s).toEqual(expect.arrayContaining(["7", "8", "9", "11"]));
    expect(s).not.toContain("10"); // "0" link: no previous season to fetch
  });

  it("stratifies trading off/on within guillotine leagues and pick trading within dynasty leagues", () => {
    expect(PREV_STRATA.disable_trades?.({ disable_trades: 1, type: 3 })).toBe("1|guillotine");
    expect(PREV_STRATA.disable_trades?.({ disable_trades: 0, type: 0 })).toBe("0|other");
    expect(PREV_STRATA.pick_trading?.({ pick_trading: 0, type: 2 })).toBe("0|dynasty");
    expect(PREV_STRATA.veto_review?.({ trade_review_days: 2 })).toBe("absent|2");
  });

  it("plans playoff weeks and transaction legs", () => {
    expect(playoffWeeksToFetch(15, 3)).toEqual([15, 16, 17, 18]);
    expect(playoffWeeksToFetch(13, 2)).toEqual([13, 14, 15, 16]);
    expect(playoffWeeksToFetch(0, 3)).toEqual([]);
    expect(tradeLegsToFetch(11)).toEqual([10, 11, 12]);
    expect(tradeLegsToFetch(1)).toEqual([1, 2]);
    expect(tradeLegsToFetch(99)).toEqual([15, 16, 17]);
    expect(tradeLegsToFetch(undefined)).toEqual([15, 16, 17]);
  });

  it("goes a season deeper only for rare playoff-round codes", () => {
    const prev = [
      season("1", { playoff_round_type: 2 }, "11"),
      season("2", { playoff_round_type: 1 }, "12"),
      season("3", { playoff_round_type: 1 }, "13"),
      season("4", { playoff_round_type: 1 }, "14"),
      season("5", { playoff_round_type: 0 }, "15"),
      season("6", { playoff_round_type: 2 }, null),
    ];
    expect(selectDeeperSeasons(prev, 3, 3)).toEqual([{ fromLeagueId: "f1", leagueId: "11", depth: 2 }]);
    // Once the older season is in, the next step goes one further back (and never refetches).
    const next = selectDeeperSeasons([...prev, season("11", { playoff_round_type: 2 }, "21", 2)], 4, 3);
    expect(next).toContainEqual({ fromLeagueId: "f11", leagueId: "21", depth: 3 });
    expect(next.map((l) => l.leagueId)).not.toContain("11");
  });

  it("pairs seasons with trading off with controls of the same league type when possible", () => {
    const prev = [
      season("1", { disable_trades: 1, type: 3 }),
      season("2", { disable_trades: 0, type: 0 }),
      season("3", { disable_trades: 0, type: 3 }),
      season("4", { disable_trades: 1, type: 3 }, null, 2),
      season("5", { disable_trades: 1, type: 3 }),
    ];
    const s = selectTradeControlSample(prev, 5, "salt");
    expect(s.disabled.map((x) => x.leagueId).sort()).toEqual(["1", "5"]);
    expect(s.enabled).toHaveLength(2);
    expect(s.enabled.map((x) => x.leagueId)).toContain("3"); // the guillotine control comes first
  });

  it("samples in-season 2026 rosters for position limits too", () => {
    const ls = [
      league("1", { type: 0, position_limit_qb: 3, start_week: 1 }, { status: "in_season" }),
      league("2", { type: 0, start_week: 1 }, { status: "in_season" }),
      league("3", { type: 3, position_limit_qb: 3 }, { status: "in_season" }),
      league("4", { type: 0, position_limit_qb: 3 }, { status: "pre_draft" }),
    ];
    const s = selectCurrentSample(ls, 6, "salt");
    expect(s.find((c) => c.league.leagueId === "1")?.reasons).toEqual(["position_limit_*", "control"]);
    expect(s.map((c) => c.league.leagueId)).not.toContain("3"); // guillotine
    expect(s.map((c) => c.league.leagueId)).not.toContain("4"); // not in season
  });

  it("watches names without exposing them", () => {
    const w = new NameWatch();
    w.add("Short");
    w.add("A Much Longer League Name");
    w.add("Fantasy Football League"); // generic: would flag the report's own words
    w.add("consolation"); // report vocabulary
    expect(w.names.size).toBe(1);
    expect(w.findIn("report text with A Much Longer League Name inside")).toHaveLength(1);
    expect(w.findIn("report text with A Much Longer League Names inside")).toHaveLength(0); // whole words only
    expect(w.findIn("clean report")).toHaveLength(0);
  });
});
