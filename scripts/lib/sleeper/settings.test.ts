import { describe, expect, it } from "vitest";
import { crawlConfidence, crawlReading, describeSettings, patternMeaning, type CrawlCheck } from "./settings";

const crawl = new Map<string, CrawlCheck>([
  ["CODES.playoffType", { status: "ok", summary: "Verified: 0 → losers advance" }],
  ["CODES.tradeReview", { status: "ok", summary: "Verified: veto poll only with veto_auto_poll = 1" }],
  ["CODES.positionLimits", { status: "warn", summary: "Keys seen: position_limit_qb …" }],
  ["CODES.type", { status: "ok", summary: "Verified: 0/1/2" }],
]);

describe("crawlConfidence", () => {
  it("upgrades a key the crawl verified", () => {
    expect(crawlConfidence("playoff_type", crawl)).toEqual({ confidence: "verified (crawl)", basis: "probe:sleeper-codes CODES.playoffType" });
  });

  it("keeps partly verified keys inferred, with the crawl as basis", () => {
    expect(crawlConfidence("trade_review_days", crawl)?.confidence).toBe("inferred");
    expect(crawlConfidence("trade_review_days", crawl)?.basis).toBe("partly verified by probe:sleeper-codes (CODES.tradeReview ok): matters only with veto_auto_poll = 1; that it is the vote length is inferred from the name");
    expect(crawlConfidence("position_limit_qb", crawl)?.confidence).toBe("inferred");
  });

  it("uses the check for the league's own value (type 3 → CODES.type3, deadline 99 → CODES.tradeDeadlineNone)", () => {
    expect(crawlConfidence("type", crawl, 2)).toEqual({ confidence: "verified (crawl)", basis: "probe:sleeper-codes CODES.type" });
    expect(crawlConfidence("type", crawl, 3)).toBeNull();
    const more = new Map(crawl)
      .set("CODES.type3", { status: "ok", summary: "Verified: 3 = guillotine" })
      .set("CODES.tradeDeadline", { status: "ok", summary: "Verified: D = last leg with trades" })
      .set("CODES.tradeDeadlineNone", { status: "warn", summary: "Inferred: 99 → no deadline. Reading: no trade deadline" });
    expect(crawlConfidence("type", more, 3)?.basis).toBe("probe:sleeper-codes CODES.type3");
    expect(crawlConfidence("trade_deadline", more, 11)?.confidence).toBe("verified (crawl)");
    expect(crawlConfidence("trade_deadline", more, 99)?.confidence).toBe("inferred");
    expect(crawlConfidence("trade_deadline", more, 99)?.basis).toBe("partly verified by probe:sleeper-codes (CODES.tradeDeadlineNone warn) (reading: no trade deadline)");
  });

  it("quotes the crawl's own reading in the basis", () => {
    expect(crawlReading("Keys seen: … Rosters vs the limit … Reading: a cap on the active roster ✓, IR exempt ✓")).toBe("a cap on the active roster ✓, IR exempt ✓");
    expect(crawlReading("Reading: 1 = best ball. More text")).toBe("1 = best ball");
    expect(crawlReading("no reading here")).toBeNull();
    const withReading = new Map(crawl).set("CODES.positionLimits", { status: "ok", summary: "… Reading: a cap on the active roster ✓, IR exempt ✓" });
    expect(crawlConfidence("position_limit_qb", withReading)).toEqual({ confidence: "verified (crawl)", basis: "probe:sleeper-codes CODES.positionLimits (reading: a cap on the active roster ✓, IR exempt ✓)" });
  });

  it("says nothing without crawl output or a crawl basis", () => {
    expect(crawlConfidence("playoff_type", null)).toBeNull();
    expect(crawlConfidence("bench_lock", crawl)).toBeNull();
  });
});

describe("describeSettings", () => {
  it("takes the strongest of this league's evidence and the crawl, keeping both bases", () => {
    const rows = describeSettings(
      { playoff_type: 0, veto_auto_poll: 0, squads: 1, bench_lock: 0 },
      { veto_auto_poll: { confidence: "corroborated", basis: "veto poll on 0/2 trades here" } },
      crawl,
    );
    const by = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(by.playoff_type?.confidence).toBe("verified (crawl)");
    expect(by.veto_auto_poll?.confidence).toBe("verified (crawl)");
    expect(by.veto_auto_poll?.basis).toBe("veto poll on 0/2 trades here; probe:sleeper-codes CODES.tradeReview");
    expect(by.squads?.confidence).toBe("unknown");
    expect(by.bench_lock?.confidence).toBe("inferred");
  });

  it("describes position limits as caps on the active roster", () => {
    expect(patternMeaning("position_limit_qb")?.meaning).toBe("max QB on the active roster (players minus IR and taxi)");
  });
});
