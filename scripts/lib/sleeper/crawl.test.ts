import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { crawlGist, crawlValueClause, eligibleForOracle, firstClause, pickOneMore, pickOracleLeagues, readCrawlLeagues, readCrawlScoringKeys, readProbeChecks, targetsCovered, type CrawlLeague } from "./crawl";

describe("crawlValueClause", () => {
  it("cites what the crawl says about one value", () => {
    const s = "Partly verified from pairings: 0 → 1-week rounds (29/29 seasons from 29 leagues); 1 → 2-week final (5/5); 2 → 2-week rounds (3/3 seasons from 2 leagues; below the 3-league minimum)";
    expect(crawlValueClause(s, 0)).toBe("0 → 1-week rounds (29/29 seasons from 29 leagues)");
    expect(crawlValueClause(s, 2)).toBe("2 → 2-week rounds (3/3 seasons from 2 leagues");
    expect(crawlValueClause("Verified: 0 = redraft ✓, 1 = keeper ✓", 1)).toBe("1 → keeper ✓");
    expect(crawlValueClause("Verified: 0 = redraft ✓, 1 = keeper ✓", 0)).toBe("0 → redraft ✓");
    expect(crawlValueClause(s, 7)).toBeNull();
  });
});

const league = (id: string, scoring: string[], settings: Record<string, unknown> = {}, slots: string[] = ["QB", "RB", "WR", "TE", "FLEX", "K", "DEF", "BN"]): CrawlLeague => ({
  leagueId: id,
  status: "in_season",
  season: "2026",
  totalRosters: 12,
  settings: { last_scored_leg: 3, start_week: 1, type: 0, ...settings },
  rosterPositions: slots,
  scoringNonzero: scoring,
});

describe("crawlGist", () => {
  it("skips the leading verification label", () => {
    expect(crawlGist("Inferred: 99 → trades completed after week 14 in 1/5 seasons; below the minimum")).toBe("99 → trades completed after week 14 in 1/5 seasons");
    expect(crawlGist("Partly verified (hours, incl. accept time): veto_auto_poll = 1 → 3/3 polled; more")).toBe("veto_auto_poll = 1 → 3/3 polled");
    expect(crawlGist("29 more codes reported as distributions only (meaning not verified): a, b")).toBe("29 more codes reported as distributions only (meaning not verified)");
  });
});

describe("firstClause", () => {
  it("cuts a check summary at its first clause", () => {
    expect(firstClause("Verified: 0 = redraft. More text")).toBe("Verified:");
    expect(firstClause("leg is the league's own week; more")).toBe("leg is the league's own week;");
    expect(firstClause("no punctuation here")).toBe("no punctuation here");
    expect(firstClause("x".repeat(50), 10)).toBe(`${"x".repeat(9)}…`);
  });
});

describe("oracle league picking", () => {
  const pool = [
    league("L1", ["rec", "pass_td"]),
    league("L2", ["rec", "bonus_rec_te", "bonus_rec_yd_100"]),
    league("L3", ["idp_tkl_solo", "rec_fd", "fgm_50_59"], {}, ["QB", "RB", "WR", "TE", "K", "DL", "LB", "DB", "BN"]),
    league("L4", ["yds_allow_0_100", "yds_allow_100_199", "yds_allow_300_349", "rec"]),
    league("L5", ["rec"], { type: 3 }), // guillotine: never picked
    league("L6", ["rec"], { last_scored_leg: 2 }), // week 3 not scored yet
    league("L7", ["idp_sack", "fgm_50_59", "yds_allow_0_100"], {}, ["QB", "RB", "WR", "TE", "BN"]), // scores them but can't start K/DEF/IDP
  ];

  it("counts a feature only when the league can start the players it applies to", () => {
    expect(targetsCovered(pool[6] as CrawlLeague)).toEqual([]);
    expect(targetsCovered(pool[2] as CrawlLeague)).toEqual(["IDP (idp_*)", "first downs (*_fd, bonus_fd_*)", "long field goals (fgm_50_59, fgm_60p)"]);
  });

  it("picks one more league for features that stayed unexercised", () => {
    const more = pickOneMore(pool, [2, 3], "salt-a", new Set(["L2", "L3"]), new Set(["yards-allowed brackets (yds_allow_*)"]));
    expect(more?.leagueId).toBe("L4");
    expect(pickOneMore(pool, [2, 3], "salt-a", new Set(["L4"]), new Set(["yards-allowed brackets (yds_allow_*)"]))).toBeNull();
  });

  it("filters to in-season leagues that scored the oracle weeks", () => {
    expect(eligibleForOracle(pool[0] as CrawlLeague, [2, 3])).toBe(true);
    expect(eligibleForOracle(pool[4] as CrawlLeague, [2, 3])).toBe(false);
    expect(eligibleForOracle(pool[5] as CrawlLeague, [2, 3])).toBe(false);
    expect(eligibleForOracle(pool[0] as CrawlLeague, [])).toBe(false);
  });

  it("covers every target feature with few leagues, then tops up to the minimum", () => {
    const picked = pickOracleLeagues(pool, [2, 3], "salt-a", 5, 3);
    const covered = new Set(picked.flatMap(targetsCovered));
    expect(covered.size).toBe(7);
    expect(picked.map((l) => l.leagueId).sort()).toEqual(["L2", "L3", "L4"]);
    expect(pickOracleLeagues(pool, [2, 3], "salt-a", 5, 3)).toEqual(picked); // stable for a salt
    expect(pickOracleLeagues([pool[0] as CrawlLeague], [2, 3], "salt-a", 5, 3)).toHaveLength(1);
  });
});

describe("reading other probes' outputs", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "sleeper-crawl-test-"));
  writeFileSync(
    path.join(dir, "sleeper-codes.json"),
    JSON.stringify({
      generatedAt: "2026-09-29T00:00:00Z",
      checks: [{ key: "CODES.type", status: "ok", summary: "Verified: 0 = redraft" }, { bad: true }],
      questions: ["Reject guillotine leagues?"],
      meta: { sample: { leagues2026: 250 }, scoringKeysNonzero: { rec: 244, bonus_rec_te: 27, junk: "x" } },
    }),
  );
  writeFileSync(path.join(dir, "leagues.json"), JSON.stringify([{ leagueId: "L9", status: "in_season", settings: { type: 2 }, scoringNonzero: ["rec", 5] }, { settings: {} }, "junk"]));

  it("reads check statuses and questions, skipping malformed rows", () => {
    const r = readProbeChecks("sleeper-codes", dir);
    expect(r?.checks.get("CODES.type")?.status).toBe("ok");
    expect(r?.checks.size).toBe(1);
    expect(r?.questions).toEqual(["Reject guillotine leagues?"]);
    expect(readProbeChecks("missing", dir)).toBeNull();
  });

  it("reads the crawl's scoring-key counts, most used first", () => {
    expect(readCrawlScoringKeys(dir)).toEqual({ leagues: 250, keys: [{ key: "rec", leagues: 244 }, { key: "bonus_rec_te", leagues: 27 }] });
  });

  it("reads crawl league summaries defensively", () => {
    const leagues = readCrawlLeagues(path.join(dir, "leagues.json"));
    expect(leagues).toHaveLength(1);
    expect(leagues?.[0]?.scoringNonzero).toEqual(["rec"]);
    expect(readCrawlLeagues(path.join(dir, "nope.json"))).toBeNull();
  });
});
