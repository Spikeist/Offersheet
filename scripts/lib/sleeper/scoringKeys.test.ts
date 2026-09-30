import { describe, expect, it } from "vitest";
import { aliasSourcesSeen, keyGroup, projectedKeySets, projectionCoverage, statsFrequency, toScoringStats, type RowKind } from "./scoringKeys";

describe("keyGroup", () => {
  it("assigns each scoring key the position group it applies to", () => {
    expect(["fgmiss", "fgm_50_59", "xpm", "fgm_yds_over_30", "fga"].map(keyGroup)).toEqual(["K", "K", "K", "K", "K"]);
    expect(["fg_ret_yd", "blk_kick_ret_yd"].map(keyGroup)).toEqual(["DEF", "DEF"]); // returns by the defense, not kicking
    expect(["idp_sack", "bonus_tkl_10p", "bonus_sack_2p"].map(keyGroup)).toEqual(["IDP", "IDP", "IDP"]);
    expect(["pts_allow_0", "yds_allow_550p", "def_st_td", "sack", "blk_kick", "bonus_def_int_td_50p"].map(keyGroup)).toEqual(["DEF", "DEF", "DEF", "DEF", "DEF", "DEF"]);
    expect(["rec", "st_td", "bonus_rec_yd_100", "pass_int_td"].map(keyGroup)).toEqual(["OFF", "OFF", "OFF", "OFF"]);
  });
});

describe("toScoringStats", () => {
  it("maps a DEF row's special-teams TD to def_st_td and drops return components", () => {
    const out = toScoringStats({ st_td: 0.06, def_kr_td: 0.06, def_pr_td: 0.06, pr_td: 0.06, pr_yd: 14, def_pr_yd: 120, sack: 2.5 }, "DEF");
    expect(out).toEqual({ def_st_td: 0.06, def_pr_yd: 120, sack: 2.5 });
  });

  it("maps a returner's TDs to st_td and kick-return yards to kr_yd", () => {
    const out = toScoringStats({ def_kr_td: 0.05, pr_td: 0.04, def_kr_yd: 40, pr_yd: 9, rec: 3 }, "player");
    expect(out.st_td).toBeCloseTo(0.09, 9);
    expect(out).toMatchObject({ kr_yd: 40, pr_yd: 9, rec: 3 });
    expect(out).not.toHaveProperty("def_kr_td");
    expect(out).not.toHaveProperty("pr_td");
    expect(out).not.toHaveProperty("def_kr_yd");
  });

  it("leaves unrelated keys and empty input alone", () => {
    expect(toScoringStats(null, "player")).toEqual({});
    expect(toScoringStats({ pass_yd: 250 }, "DEF")).toEqual({ pass_yd: 250 });
  });
});

describe("projection key coverage", () => {
  const rows: Array<{ kind: RowKind; stats: Record<string, number> }> = [
    { kind: "DEF", stats: { st_td: 0.1, pts_allow: 20.75, pts_allow_14_20: 1, def_kr_td: 0.05, sack: 2 } },
    { kind: "player", stats: { def_kr_td: 0.05, def_kr_yd: 30, rec: 4, fga: 2, fgm: 1.7 } },
  ];
  const { seen, direct } = projectedKeySets(rows, (r) => r.kind);
  const aliases = aliasSourcesSeen(seen);

  it("separates keys projected directly from alias sources and DEF duplicates", () => {
    expect(direct.has("rec")).toBe(true);
    expect(direct.has("st_td")).toBe(false); // DEF alias source
    expect(direct.has("def_kr_td")).toBe(false); // player alias source, DEF duplicate
    expect(direct.has("def_kr_yd")).toBe(false);
    expect(aliases.get("def_st_td")).toEqual(["st_td (DEF rows)"]);
    expect(aliases.get("st_td")).toEqual(["def_kr_td (player rows)"]);
    expect(aliases.get("kr_yd")).toEqual(["def_kr_yd (player rows)"]);
  });

  it("proposes a treatment per missing key, using /stats frequency for the rest", () => {
    const freq = statsFrequency(
      [
        [
          { player_id: "AAA", stats: { def_st_ff: 1, pts_allow: 17 } },
          { player_id: "BBB", stats: { pts_allow: 24 } },
          { player_id: "p1", stats: { gp: 1, rec: 5 } },
          { player_id: "p2", stats: { gp: 0, st_ff: 1 } }, // didn't play: not counted
        ],
      ],
      (id) => (id.length === 3 ? "DEF" : "OFF"),
    );
    expect(freq.rows).toEqual({ DEF: 2, K: 0, IDP: 0, OFF: 1 });
    const table = projectionCoverage(
      ["rec", "def_st_td", "fgmiss", "pts_allow_0", "bonus_rec_yd_100", "def_st_ff", "def_2pt", "fgm_60p"].map((key) => ({ key, leagues: 10 })),
      direct,
      aliases,
      freq,
    );
    const kind = Object.fromEntries(table.map((r) => [r.key, r.kind]));
    expect(kind).toEqual({
      rec: "projected",
      def_st_td: "alias",
      fgmiss: "derive",
      pts_allow_0: "expected-value",
      bonus_rec_yd_100: "expected-value",
      def_st_ff: "rate-model", // non-zero on 1 of 2 DEF team-weeks
      def_2pt: "zero-rare",
      fgm_60p: "derive",
    });
    expect(table.find((r) => r.key === "def_st_ff")?.statsShare).toBe(0.5);
  });
});
