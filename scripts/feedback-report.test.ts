/**
 * `npm run feedback:report -- --live` (planner reply to Checkpoint 7a, §4 privacy item 3: totals only, never a raw record;
 * it replaces feedback:pull): its arguments, the days it reads (one LRANGE each, on FakeRedis), the entries it accepts (the
 * store's own schema; anything else counted, never kept), the records as they stand, the calibration table, the days to
 * check, and a report with no id, player or record's own number in it. Fictional league; no network.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { tradeSnapshot } from "@/components/trades/testFixtures";
import type { FeedbackEvent, StoredFeedbackEvent } from "@/lib/feedbackEvent";
import { feedbackEventOf, feedbackShareContext } from "@/lib/feedbackShare";
import { applyFeedback, type FeedbackChange, type FeedbackRecord } from "@/lib/feedbackStore";
import { storeFeedback } from "@/server/feedbackSink";
import { feedbackLimits } from "@/server/limits";
import { FakeRedis } from "@/server/redis";
import {
  MAX_DAYS,
  feedbackReportArgs,
  flaggedDays,
  formatFeedbackReport,
  oldDownloads,
  parseFeedbackEntries,
  readFeedbackDays,
  reportDays,
  summarizeFeedback,
} from "./feedback-report";

const T0 = Date.UTC(2026, 9, 4, 18, 30, 0);
const PREVIEW = { VERCEL: "1", VERCEL_ENV: "preview" };

/** A copy of a record after some presses (its random id `rid`), its card's estimate `pAccept`. */
function copyOf(rid: string, changes: FeedbackChange[], opts: { removed?: boolean; pAccept?: number } = {}): FeedbackEvent {
  let list: FeedbackRecord[] = [];
  for (const change of changes) {
    list = applyFeedback(list, {
      leagueKey: "espn:1a2b3c4d",
      evaluation: {
        key: "2|give:106|get:204",
        proposal: { partnerId: "2", give: [{ kind: "player", id: "106" }], get: [{ kind: "player", id: "204" }] },
        features: { g: 0, n: 0.2, h: 0, c: 0, a: 0, hist: null, ctx: 0, hot: 0, urg: 0, z: -0.5 },
        b: 2,
        b3: 6,
        tradeScore: 28,
        pAccept: opts.pAccept ?? 0.38,
        pComplete: opts.pAccept ?? 0.38,
        overall: 12,
        dPO: 0.02,
        dCH: 0.01,
        dPPW: 1,
        gMine: 0,
        gPartner: 0,
      },
      change: { ...change, rid },
      at: "2026-10-04T12:00:00.000Z",
    });
  }
  return feedbackEventOf({ record: list[0] as FeedbackRecord, kind: "outcome", removed: opts.removed ?? false, context: feedbackShareContext(tradeSnapshot(), "title") }) as FeedbackEvent;
}

// Share ids: 16 bytes' worth (the last character A, Q, g or w).
const A = "AAAAAAAAAAAAAAAAAAAAAA";
const B = "BBBBBBBBBBBBBBBBBBBBBQ";
const C = "CCCCCCCCCCCCCCCCCCCCCg";
const D = "DDDDDDDDDDDDDDDDDDDDDw";

let temp: string | undefined;
afterEach(() => {
  if (temp) rmSync(temp, { recursive: true, force: true });
  temp = undefined;
});

describe("feedbackReportArgs and the days", () => {
  it("previews and the store's whole year by default; --env production; --days 1–366; anything else in words", () => {
    expect(MAX_DAYS).toBe(feedbackLimits.retainDays + 1);
    expect(feedbackReportArgs([])).toEqual({ env: "preview", days: MAX_DAYS });
    expect(feedbackReportArgs(["--live", "--env", "production", "--days", "30"])).toEqual({ env: "production", days: 30 });
    expect(feedbackReportArgs(["--env", "development"])).toEqual({ error: "--env takes preview or production." });
    for (const d of ["0", "367", "1.5", "x"]) expect(feedbackReportArgs(["--days", d])).toEqual({ error: "--days takes a whole number from 1 to 366." });
  });

  it("reads today and the days before it, oldest first", () => {
    expect(reportDays(T0, 3)).toEqual(["2026-10-02", "2026-10-03", "2026-10-04"]);
    expect(reportDays(Date.UTC(2027, 0, 1, 1), 2)).toEqual(["2026-12-31", "2027-01-01"]);
  });
});

describe("reading, checking and counting (totals only)", () => {
  it("one LRANGE a day; the store's schema keeps what it accepts; each record as its latest copy says; the calibration by the card's labels", async () => {
    let now = T0;
    const redis = new FakeRedis(() => now);
    // A: sent (version full, 38%), then accepted. B: a "never accept" report at 10%. C: rejected at 60%, then taken back.
    await storeFeedback(redis, copyOf(A, [{ outcome: "sent", sent: { version: "full", key: "2|give:106|get:204", pAccept: 0.38, pComplete: 0.38 } }]), { now, env: PREVIEW });
    await storeFeedback(redis, copyOf(B, [{ report: { reason: "never-accept" } }], { pAccept: 0.1 }), { now, env: PREVIEW });
    await storeFeedback(redis, copyOf(A, [{ outcome: "sent", sent: { version: "full", key: "2|give:106|get:204", pAccept: 0.38, pComplete: 0.38 } }, { outcome: "accepted" }]), { now, env: PREVIEW });
    await redis.lpush("os:preview:fb:2026-10-04", "{not json", JSON.stringify({ v: 1, rid: A, leagueId: "12345678" }));
    now = Date.UTC(2026, 9, 2, 9);
    await storeFeedback(redis, copyOf(C, [{ outcome: "rejected" }], { pAccept: 0.6 }), { now, env: PREVIEW });
    await storeFeedback(redis, copyOf(D, [{ outcome: "rejected" }], { pAccept: 0.4 }), { now, env: PREVIEW });
    now = Date.UTC(2026, 9, 3, 9);
    await storeFeedback(redis, copyOf(C, [{ outcome: "rejected" }], { removed: true, pAccept: 0.6 }), { now, env: PREVIEW });
    // Production's list is apart, and never read for previews.
    await storeFeedback(redis, copyOf(B, [{ outcome: "sent" }]), { now: T0, env: { VERCEL: "1", VERCEL_ENV: "production" } });

    const days = reportDays(T0, 5);
    const before = redis.stats.commands;
    const read = await readFeedbackDays(redis, "os:preview:", days);
    expect(redis.stats.commands - before).toBe(5);
    expect([...read.byDay]).toEqual([
      ["2026-10-02", 2],
      ["2026-10-03", 1],
      ["2026-10-04", 5],
    ]);
    const { events, invalid } = parseFeedbackEntries(read.entries);
    expect(invalid).toBe(2);
    expect(events.map((e) => [e.rid, e.outcome ?? e.reason ?? "taken back", e.day])).toEqual([
      [C, "rejected", "2026-10-02"],
      [D, "rejected", "2026-10-02"],
      [C, "taken back", "2026-10-03"],
      [A, "sent", "2026-10-04"],
      [B, "never-accept", "2026-10-04"],
      [A, "accepted", "2026-10-04"],
    ]);

    const report = summarizeFeedback(events, invalid, read.byDay);
    expect(report).toMatchObject({ copies: 6, invalid: 2, records: 4, takenBack: 1, unpredicted: 0, flagged: [] });
    expect(report.byOutcome).toEqual([
      ["accepted", 1],
      ["rejected", 1],
      ["none", 1],
    ]);
    expect(report.byReason).toEqual([
      ["none", 2],
      ["never-accept", 1],
    ]);
    expect(report.byVersion).toEqual([
      ["full", 1],
      ["unknown", 1],
    ]);
    expect(report.byGoal).toEqual([["title", 3]]);
    expect(report.byPlatform).toEqual([["espn", 3]]);
    expect(report.refit).toEqual({ decided: 2, needed: 30, ready: false });
    // Long shot: B's report (10%). Decent: A accepted (38%), D rejected (40%). C was taken back.
    expect(report.calibration.map((b) => [b.label, b.decided, b.accepted, b.rejected, b.neverAccept, b.observed])).toEqual([
      ["Long shot", 0, 0, 0, 1, null],
      ["Possible", 0, 0, 0, 0, null],
      ["Decent", 2, 1, 1, 0, 0.5],
      ["Likely", 0, 0, 0, 0, null],
    ]);
    expect(report.calibration[2]?.meanPredicted).toBeCloseTo(0.39, 6);

    // The report: totals only, never a share id, a player, a league or a record's own number.
    const text = formatFeedbackReport(report, { env: "preview", days: 5 }, days, "2026-10-04T18:30:00.000Z");
    expect(text).toContain("preview's store, 2026-09-30 to 2026-10-04 (UTC). Generated 2026-10-04T18:30:00.000Z. Totals only: no copy, id, player or note is kept.");
    expect(text).toContain("6 copies of 4 record(s), 2 unreadable entries skipped.");
    expect(text).toContain("Records as they stand: 3, and 1 taken back (every button cleared).");
    expect(text).toContain("| Decent (35%–55%) | 2 | 1 | 1 | 50% | 39% | 0 | 0 | 0 |");
    expect(text).toContain("2 decided outcomes of the 30 the acceptance refit needs (§11).");
    for (const leak of [A, B, C, D, "106", "204", "1a2b3c4d", "12345678", "espn:"]) expect(text).not.toContain(leak);
  });

  it("nothing stored: one line", () => {
    const report = summarizeFeedback([], 0);
    expect(formatFeedbackReport(report, { env: "production", days: 2 }, ["2026-10-03", "2026-10-04"], "2026-10-04T00:00:00.000Z")).toContain("0 copies of 0 record(s).\n\nNothing stored.");
  });

  it("a record without an estimate is left out of the calibration and counted", () => {
    const e = { ...(copyOf(A, [{ outcome: "rejected" }]) as StoredFeedbackEvent), day: "2026-10-04" };
    const report = summarizeFeedback([{ ...e, numbers: { ...e.numbers, pAccept: null } }], 0);
    expect(report.unpredicted).toBe(1);
    expect(report.calibration.every((b) => b.decided === 0)).toBe(true);
  });
});

describe("days to check", () => {
  it("a day at the store's cap, or at least SPIKE_MIN copies and 3 times the median day's, oldest first", () => {
    const days = new Map<string, number>([
      ["2026-10-01", 4],
      ["2026-10-02", 5],
      ["2026-10-03", 6],
      ["2026-10-04", feedbackLimits.maxPerDay],
      ["2026-10-05", 30],
      ["2026-10-06", 12],
    ]);
    expect(flaggedDays(days)).toEqual([
      { day: "2026-10-04", copies: feedbackLimits.maxPerDay, why: "cap" },
      { day: "2026-10-05", copies: 30, why: "spike" }, // the median day has 9: 30 is over 27
    ]);
    expect(flaggedDays(new Map())).toEqual([]);
  });
});

describe("the old feedback:pull's downloads", () => {
  it("oldDownloads: how many files data-local/feedback-server holds (raw copies outside the store's year), or null without the folder; nothing is deleted", () => {
    temp = mkdtempSync(path.join(tmpdir(), "offersheet-feedback-report-"));
    expect(oldDownloads(temp)).toBeNull();
    mkdirSync(path.join(temp, "feedback-server", "preview"), { recursive: true });
    writeFileSync(path.join(temp, "feedback-server", "preview", "2026-10.json"), "{}");
    writeFileSync(path.join(temp, "feedback-server", "preview", "2026-09.json"), "{}");
    expect(oldDownloads(temp)).toBe(2);
    expect(oldDownloads(temp)).toBe(2);
  });
});
