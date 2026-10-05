/**
 * `npm run feedback:pull -- --live` (Checkpoint 7a, track FB): its arguments, the months it reads (one LRANGE each, on
 * FakeRedis), the entries it keeps (the store's own schema; anything else counted, never kept), the counts it prints (no
 * ids, no players, no numbers), where its files go, and when they're deleted (review FB-R2: a temporary folder). Fictional
 * league; no network.
 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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
  MAX_MONTHS,
  feedbackFileDueAt,
  feedbackPullArgs,
  feedbackPullFile,
  flaggedDays,
  formatFeedbackPull,
  formatPruned,
  monthDays,
  newestDayIn,
  parseFeedbackEntries,
  pruneFeedbackFiles,
  pullMonths,
  readFeedbackMonths,
  summarizeFeedback,
} from "./feedback-pull";

const T0 = Date.UTC(2026, 9, 4, 18, 30, 0);
const PREVIEW = { VERCEL: "1", VERCEL_ENV: "preview" };

/** A copy of a record after some presses (its random id `rid`). */
function copyOf(rid: string, changes: FeedbackChange[], removed = false): FeedbackEvent {
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
        pAccept: 0.38,
        pComplete: 0.38,
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
  return feedbackEventOf({ record: list[0] as FeedbackRecord, kind: "outcome", removed, context: feedbackShareContext(tradeSnapshot(), "title") }) as FeedbackEvent;
}

// Share ids: 16 bytes' worth (the last character A, Q, g or w).
const A = "AAAAAAAAAAAAAAAAAAAAAA";
const B = "BBBBBBBBBBBBBBBBBBBBBQ";
const C = "CCCCCCCCCCCCCCCCCCCCCg";

describe("feedbackPullArgs", () => {
  it("previews and 13 months by default; --env production; --months 1–13; anything else in words", () => {
    expect(feedbackPullArgs([])).toEqual({ env: "preview", months: MAX_MONTHS });
    expect(feedbackPullArgs(["--live", "--env", "production", "--months", "2"])).toEqual({ env: "production", months: 2 });
    expect(feedbackPullArgs(["--env", "development"])).toEqual({ error: "--env takes preview or production." });
    for (const m of ["0", "14", "1.5", "x"]) expect(feedbackPullArgs(["--months", m])).toEqual({ error: "--months takes a whole number from 1 to 13." });
    expect(feedbackPullArgs(["--months"])).toEqual({ error: "--months takes a whole number from 1 to 13." });
  });

  it("reads this UTC month and the ones before it, newest first, across a year", () => {
    expect(pullMonths(T0, 3)).toEqual(["2026-10", "2026-09", "2026-08"]);
    expect(pullMonths(Date.UTC(2027, 0, 31, 23, 59), 2)).toEqual(["2027-01", "2026-12"]);
    expect(pullMonths(T0, MAX_MONTHS)).toHaveLength(13);
  });
});

describe("reading, checking and counting", () => {
  it("reads each month's list as the store wrote it, keeps what the schema accepts oldest first, counts the rest", async () => {
    let now = T0;
    const redis = new FakeRedis(() => now);
    await storeFeedback(redis, copyOf(A, [{ outcome: "sent", sent: { version: "full", key: "2|give:106|get:204", pAccept: 0.38, pComplete: 0.38 } }]), { now, env: PREVIEW });
    await storeFeedback(redis, copyOf(B, [{ report: { reason: "never-accept" } }]), { now, env: PREVIEW });
    await storeFeedback(redis, copyOf(A, [{ outcome: "sent", sent: { version: "full", key: "2|give:106|get:204", pAccept: 0.38, pComplete: 0.38 } }, { outcome: "accepted" }]), { now, env: PREVIEW });
    await redis.lpush("os:preview:fb:2026-10-04", "{not json", JSON.stringify({ v: 1, rid: A, leagueId: "12345678" }));
    now = Date.UTC(2026, 8, 20);
    await storeFeedback(redis, copyOf(C, [{ outcome: "rejected" }]), { now, env: PREVIEW });
    await storeFeedback(redis, copyOf(C, [{ outcome: "rejected" }], true), { now: now + 1000, env: PREVIEW });
    // Production's list is apart, and never read for previews.
    await storeFeedback(redis, copyOf(B, [{ outcome: "sent" }]), { now: T0, env: { VERCEL: "1", VERCEL_ENV: "production" } });

    const before = redis.stats.commands;
    const { byMonth: raw, byDay } = await readFeedbackMonths(redis, "os:preview:", pullMonths(T0, 3), T0);
    // One LRANGE a day (final review SEC-3: a list per day), none after today: October's 4, September's 30, August's 31.
    expect(redis.stats.commands - before).toBe(4 + 30 + 31);
    expect([...byDay]).toEqual([
      ["2026-10-04", 5],
      ["2026-09-20", 2],
    ]);
    const parsed = new Map([...raw].map(([month, entries]) => [month, parseFeedbackEntries(entries)] as const));
    expect(parsed.get("2026-10")?.invalid).toBe(2);
    expect(parsed.get("2026-10")?.events.map((e) => [e.rid, e.outcome ?? e.reason, e.day])).toEqual([
      [A, "sent", "2026-10-04"],
      [B, "never-accept", "2026-10-04"],
      [A, "accepted", "2026-10-04"],
    ]);
    expect(parsed.get("2026-08")).toEqual({ events: [], invalid: 0 });

    const summary = summarizeFeedback(parsed, byDay);
    expect(summary).toMatchObject({ copies: 5, invalid: 2, records: 3, takenBack: 1, flagged: [] });
    expect(summary.byOutcome).toEqual([
      ["accepted", 1],
      ["none", 1],
    ]);
    expect(summary.byReason).toEqual([
      ["never-accept", 1],
      ["none", 1],
    ]);
    expect(summary.byVersion).toEqual([["full", 1]]);
    expect(summary.byPlatform).toEqual([["espn", 2]]);
    expect(summary.months).toEqual([
      { month: "2026-08", copies: 0, invalid: 0 },
      { month: "2026-09", copies: 2, invalid: 0 },
      { month: "2026-10", copies: 3, invalid: 2 },
    ]);

    // The report: counts only, never an id, a player or a number of the model.
    const text = formatFeedbackPull(summary, { env: "preview", months: 3 }, ["data-local/feedback-server/preview/2026-10.json"]);
    expect(text).toContain("Offer Sheet anonymous feedback: preview, 2026-08 to 2026-10 (UTC), 5 copies of 3 record(s), 2 unreadable entries skipped.");
    expect(text).toContain("Records as they stand: 2, and 1 taken back (every button cleared).");
    for (const leak of [A, B, C, "106", "204", "12345678", "0.38"]) expect(text, leak).not.toContain(leak);
    expect(formatFeedbackPull(summarizeFeedback(new Map()), { env: "production", months: 1 }, [])).toContain("Nothing stored.");
  });

  it("reads a month's days newest first, none after today (final review SEC-3)", () => {
    expect(monthDays("2026-10", T0)).toEqual(["2026-10-04", "2026-10-03", "2026-10-02", "2026-10-01"]);
    expect(monthDays("2026-09", T0)).toHaveLength(30);
    expect(monthDays("2024-02", T0)).toHaveLength(29);
    expect(monthDays("2026-11", T0)).toEqual([]);
  });

  it("names the days to check (final review SEC-3): a day at the store's daily cap, or 3 times a usual day's and at least 20", () => {
    expect(feedbackLimits.maxPerDay).toBe(100);
    const days = new Map([
      ["2026-10-01", 6],
      ["2026-10-02", 8],
      ["2026-10-03", 100],
      ["2026-10-04", 7],
      ["2026-10-05", 45],
      ["2026-10-06", 9],
    ]);
    expect(flaggedDays(days)).toEqual([
      { day: "2026-10-03", copies: 100, why: "cap" },
      { day: "2026-10-05", copies: 45, why: "spike" },
    ]);
    // A few copies a day never read as a spike, however uneven.
    expect(flaggedDays(new Map([["2026-10-01", 1], ["2026-10-02", 12]]))).toEqual([]);
    expect(flaggedDays(new Map())).toEqual([]);
    const text = formatFeedbackPull({ ...summarizeFeedback(new Map(), days), copies: 1, records: 1 }, { env: "preview", months: 1 }, []);
    expect(text).toContain("Days to check (a flood of forged copies crowds out at most its own day: Phase 6 drops or down-weights these days):");
    expect(text).toContain("  2026-10-03     100  at the day's cap: its oldest copies were let go");
    expect(text).toContain("  2026-10-05      45  over 3 times a usual day's");
  });

  it("writes each month under data-local/feedback-server/<env>/", () => {
    const root = path.join("D:", "project", "data-local");
    expect(feedbackPullFile(root, "production", "2026-10")).toBe(path.join(root, "feedback-server", "production", "2026-10.json"));
  });

  it("a stored copy reads back exactly as it was stored", async () => {
    const redis = new FakeRedis(() => T0);
    const e = copyOf(A, [{ outcome: "countered" }]);
    await storeFeedback(redis, e, { now: T0, env: PREVIEW });
    const [entries] = [...(await readFeedbackMonths(redis, "os:preview:", ["2026-10"], T0)).byMonth.values()];
    const stored: StoredFeedbackEvent = { ...e, day: "2026-10-04" };
    expect(parseFeedbackEntries(entries ?? [])).toEqual({ events: [stored], invalid: 0 });
  });
});

describe("downloaded copies follow the store's own rule (review FB-R2)", () => {
  const DAY = 24 * 60 * 60_000;
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  /** A temporary data-local/ with month files: [env, month, its copies' days] (null: text that isn't a pull's file). */
  function dataLocalWith(files: Array<[string, string, string[] | null]>): string {
    const root = mkdtempSync(path.join(tmpdir(), "offersheet-feedback-pull-"));
    dirs.push(root);
    const dataLocal = path.join(root, "data-local");
    for (const [env, month, days] of files) {
      const dir = path.join(dataLocal, "feedback-server", env);
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, `${month}.json`), days ? JSON.stringify({ kind: "offersheet-feedback-server", version: 1, env, month, events: days.map((day) => ({ day })) }) : "{not json");
    }
    return dataLocal;
  }

  it("a month's copies are due a year after its newest copy's day began (never after the store drops the month's list); an unreadable file, a year after its month began", () => {
    expect(feedbackLimits.retainDays).toBe(365);
    expect(feedbackFileDueAt("2026-10", "2026-10-04")).toBe(Date.UTC(2026, 9, 4) + 365 * DAY);
    expect(feedbackFileDueAt("2026-10", null)).toBe(Date.UTC(2026, 9, 1) + 365 * DAY);
    const text = JSON.stringify({ events: [{ day: "2026-10-02" }, { day: "2026-10-19" }, { day: "2026-10-07" }, { day: "2026-11-30" }, { day: 7 }, {}] });
    expect(newestDayIn(text, "2026-10")).toBe("2026-10-19");
    for (const bad of ["{not json", "null", "[]", JSON.stringify({ events: "x" }), JSON.stringify({ events: [] })]) expect(newestDayIn(bad, "2026-10"), bad).toBeNull();
  });

  it("every run deletes the month files that are due, in both folders, and says when the next one is due; other files stay", () => {
    const dataLocal = dataLocalWith([
      ["preview", "2025-09", ["2025-09-03", "2025-09-20"]],
      ["preview", "2025-10", ["2025-10-02"]],
      ["production", "2025-08", null],
      ["production", "2026-10", ["2026-10-04"]],
    ]);
    writeFileSync(path.join(dataLocal, "feedback-server", "preview", "notes.txt"), "kept");
    const now = Date.UTC(2026, 8, 25); // 2026-09-25: September 2025's newest copy (Sep 20) is past its year, October's isn't
    const result = pruneFeedbackFiles(dataLocal, now);
    expect(result.deleted).toEqual(["data-local/feedback-server/preview/2025-09.json", "data-local/feedback-server/production/2025-08.json"]);
    expect(result.kept).toBe(2);
    expect(new Date(result.nextDueAt ?? 0).toISOString().slice(0, 10)).toBe("2026-10-02");
    expect(readdirSync(path.join(dataLocal, "feedback-server", "preview")).sort()).toEqual(["2025-10.json", "notes.txt"]);
    expect(formatPruned(result)).toBe(
      "Deleted 2 downloaded month file(s) whose year was up (the store's own rule): data-local/feedback-server/preview/2025-09.json, data-local/feedback-server/production/2025-08.json.\n" +
        "Downloaded month files kept: 2. The next is due for deletion on 2026-10-02 (UTC): run npm run feedback:pull again on or after that day.",
    );
    // Nothing downloaded yet: nothing to say but that.
    const empty = pruneFeedbackFiles(path.join(dirs[0] as string, "nowhere"), now);
    expect(empty).toEqual({ deleted: [], kept: 0, nextDueAt: null });
    expect(formatPruned(empty)).toBe("No downloaded month file was due for deletion.");
  });
});
