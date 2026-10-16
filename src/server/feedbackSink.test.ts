/**
 * The anonymous feedback store (planner reply to Checkpoint 4c, Part B, B2; Checkpoint 7a, track FB): the strict schema
 * against the browser's types and every copy the browser builds, what it refuses (review FB-R4: text that isn't an id's
 * form), the codes a refusal is logged with (FB-R8), and the store on FakeRedis (the month's list, the day, the cap, the
 * expiry set in the same transaction as the push (FB-R5), the commands each copy costs, failures). Fictional league; no
 * network.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import { tradeSnapshot } from "@/components/trades/testFixtures";
import { POSITIONS } from "@/engine/model";
import { prizePeriods, prizeShares, rewardWith } from "@/engine/reward";
import type { AcceptanceFeatures } from "@/engine/tradeModel";
import type { FeedbackEvent, StoredFeedbackEvent } from "@/lib/feedbackEvent";
import { feedbackBasisOf, feedbackEventOf, feedbackShareContext, newShareId, sig } from "@/lib/feedbackShare";
import { FEEDBACK_OUTCOMES, FEEDBACK_REASONS, FEEDBACK_VERSIONS, applyFeedback, type FeedbackChange, type FeedbackEvaluation, type FeedbackRecord } from "@/lib/feedbackStore";
import { FeedbackEventSchema, StoredFeedbackEventSchema, feedbackDayKey, feedbackDayTtlMs, feedbackStoreFor, fitsFeedbackStore, refusedCopyCode, resetFeedbackSinkForTests, storeFeedback, storedFeedbackEvent, storedFeedbackText } from "./feedbackSink";
import { feedbackLimits } from "./limits";
import { FakeRedis, type RedisLike } from "./redis";

// The schema's type and the browser's are the same both ways (a compile-time check: tsc fails if they drift apart).
type Schema = z.infer<typeof FeedbackEventSchema>;
const toSchema = (e: FeedbackEvent): Schema => e;
const toEvent = (e: Schema): FeedbackEvent => e;
type Stored = z.infer<typeof StoredFeedbackEventSchema>;
const toStoredSchema = (e: StoredFeedbackEvent): Stored => e;
const toStored = (e: Stored): StoredFeedbackEvent => e;
void [toSchema, toEvent, toStoredSchema, toStored];

const DAY = 24 * 60 * 60_000;
const T0 = Date.UTC(2026, 9, 4, 18, 30, 0);
const PREVIEW = { VERCEL: "1", VERCEL_ENV: "preview" };

const FEATURES: AcceptanceFeatures = { g: -0.08, n: 0.42, h: 1, c: 1, a: 1, hist: null, ctx: 0, hot: 0.15, urg: 0, z: -0.31 };

/** "Several prizes" as Parker entered it (Checkpoint 7c): $2,000 / $1,600 / $900, nothing for the weekly high score. */
const PARKER_AMOUNTS = { first: 2000, second: 1600, third: 900, weeklyHigh: 0, pointsLeader: null };
/** …as a copy holds it: whole percents of the season's prizes (reward.ts prizePercents). */
const SPLIT = { first: 44, second: 36, third: 20, weeklyHigh: 0, pointsLeader: 0 };

function evaluation(key = "2|give:106|get:204", over: Partial<FeedbackEvaluation> = {}): FeedbackEvaluation {
  return {
    key,
    proposal: { partnerId: "2", give: [{ kind: "player", id: "106" }, { kind: "player", id: "108" }], get: [{ kind: "player", id: "204" }] },
    features: FEATURES,
    b: 4.2,
    b3: 6.1,
    tradeScore: 50,
    pAccept: 0.42,
    pComplete: 0.21,
    overall: 25,
    dPO: 0.04,
    dCH: -0.02,
    dPPW: 2.6,
    gMine: -0.03,
    gPartner: -0.35,
    ...over,
  };
}

/**
 * Every kind of copy the browser builds: each outcome and version (the card's own trade, another package, a throw-in added),
 * each reason, cleared, taken back, odd numbers, with and without the numbers' basis; Checkpoint 7c: under "Only the
 * champion", an unknown goal and "Several prizes" (Parker's split: the record's basis, a version's inputs, the cards on
 * screen), a version naming "Several prizes" under a basis that doesn't.
 */
function events(): FeedbackEvent[] {
  const snapshot = tradeSnapshot();
  const prizes = rewardWith({ goal: "prizes", prizes: PARKER_AMOUNTS }, prizePeriods(snapshot));
  const out: FeedbackEvent[] = [];
  // "SELF": the card's own trade (its key, k<i>, below), which sends no versionTrade.
  const keys = ["2|give:106,108|get:204", "2|give:105|get:205,204", "SELF"];
  const presses: FeedbackChange[][] = [
    ...FEEDBACK_OUTCOMES.flatMap((outcome, o) =>
      FEEDBACK_VERSIONS.map((version, v) => [
        {
          outcome,
          sent: { version, key: keys[(o + v) % keys.length] as string, pAccept: 0.3, pComplete: 0.3, inputs: { features: FEATURES, gPartner: -0.1, b: 2, goal: (o + v) % 2 ? ("prizes" as const) : ("playoffs" as const), b3: 0.5, helpsReason: "odds" as const } },
        },
      ]),
    ),
    ...FEEDBACK_REASONS.map((reason) => [{ report: { reason, note: "Team 4 said no" } }]),
    [{ outcome: "sent" }, { outcome: null }, { report: { reason: "settings" } }],
    [{ outcome: "rejected", sent: { version: "planB", key: "2|give:105|get:205", pAccept: null, pComplete: null } }],
  ];
  presses.forEach((changes, i) => {
    const rid = newShareId();
    let list: FeedbackRecord[] = [];
    const ev = evaluation(`k${i}`, i % 3 ? {} : { b: null, b3: null, tradeScore: null, overall: null, dPO: null, dCH: null, features: { ...FEATURES, hist: 0.15, z: Number.NaN } });
    const week = 5 + (i % 9);
    const basis = i % 2 ? (i % 3 ? { season: 2026, week, goal: i % 4 ? ("title" as const) : null } : feedbackBasisOf({ ...feedbackShareContext(snapshot, prizes), week })) : undefined;
    for (const press of changes) {
      const change = "sent" in press && press.sent?.key === "SELF" ? { ...press, sent: { ...press.sent, key: ev.key } } : press;
      list = applyFeedback(list, { leagueKey: "sleeper:12345678", evaluation: ev, change: { ...change, rid, ...(basis ? { basis } : {}) }, at: "2026-10-04T12:00:00.000Z" });
    }
    const record = list[0] as FeedbackRecord;
    for (const reward of ["title", null, prizes] as const) {
      const context = feedbackShareContext(snapshot, reward);
      out.push(feedbackEventOf({ record, kind: "outcome", context }) as FeedbackEvent);
      out.push(feedbackEventOf({ record, kind: "report", removed: true, context }) as FeedbackEvent);
    }
  });
  return out;
}

afterEach(() => {
  resetFeedbackSinkForTests();
  vi.restoreAllMocks();
});

describe("FeedbackEventSchema: every copy the browser builds, and nothing else", () => {
  it("accepts every copy feedbackShare.ts builds, as it is (nothing stripped, nothing added)", () => {
    const all = events();
    expect(all.length).toBeGreaterThan(40);
    for (const e of all) {
      const parsed = FeedbackEventSchema.safeParse(JSON.parse(JSON.stringify(e)));
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
      expect(parsed.data).toEqual(e);
    }
  });

  it("Checkpoint 7g: a Last offer that asks for fewer of their players records kind “last” with its key, and its copy names the shorter get side and passes the schema", () => {
    // The card: 106 and 108 for 204 and 205. Its Last offer since Checkpoint 7g can be a smaller ask (offers.ts smallerAsks):
    // the same players of mine for 205 alone. The page records it as any Last offer (FEEDBACK_VERSIONS has no new kind).
    const snapshot = tradeSnapshot();
    const card = evaluation("2|give:106,108|get:204,205", { proposal: { partnerId: "2", give: [{ kind: "player", id: "106" }, { kind: "player", id: "108" }], get: [{ kind: "player", id: "204" }, { kind: "player", id: "205" }] } });
    const smaller = "2|give:106,108|get:205";
    const record = applyFeedback([], {
      leagueKey: "sleeper:12345678",
      evaluation: card,
      change: { outcome: "sent", sent: { version: "last", key: smaller, pAccept: 0.55, pComplete: 0.55, inputs: { features: FEATURES, gPartner: 0.05, b: 2.4, goal: "title", b3: 6.1, helpsReason: null } }, rid: newShareId() },
      at: "2026-10-04T12:00:00.000Z",
    })[0] as FeedbackRecord;
    expect(record).toMatchObject({ version: "last", versionKey: smaller });
    const e = feedbackEventOf({ record, kind: "outcome", context: feedbackShareContext(snapshot, "title") }) as FeedbackEvent;
    expect(e.trade.get.map((p) => p.id)).toEqual(["204", "205"]);
    expect(e.versionTrade).toEqual({ give: [{ id: "106", pos: "WR" }, { id: "108", pos: "TE" }], get: [{ id: "205", pos: "WR" }] });
    const parsed = FeedbackEventSchema.safeParse(JSON.parse(JSON.stringify(e)));
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(parsed.data).toEqual(e);
  });

  it("accepts a copy made under an older version's “Top finishers too” (“balanced”), its goal kept, at the top and in the version's inputs (Checkpoint 7c: feedbackEvent.ts FEEDBACK_GOALS); “Several prizes” with its split too", () => {
    const e = events().find((x) => x.versionInputs && x.goal !== "prizes" && x.versionInputs.goal !== "prizes") as FeedbackEvent;
    for (const [goal, split] of [
      ["balanced", null],
      ["prizes", SPLIT],
    ] as const) {
      const withSplit = split ? { prizes: split } : {};
      const copy = { ...e, goal, ...withSplit, versionInputs: { ...(e.versionInputs as NonNullable<FeedbackEvent["versionInputs"]>), goal, ...withSplit } };
      const parsed = FeedbackEventSchema.safeParse(JSON.parse(JSON.stringify(copy)));
      expect(parsed.success, `${goal}: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
      expect(parsed.data?.goal).toBe(goal);
      expect(parsed.data?.prizes).toEqual(split ?? undefined);
      // The stored form (what feedback:report reads) too.
      expect(StoredFeedbackEventSchema.safeParse({ ...copy, day: "2026-10-04" }).success, goal).toBe(true);
    }
  });

  it("Checkpoint 7c: a prize split goes exactly with “Several prizes”, at the top and in the version's inputs, as whole percents adding up to 100, never amounts; a refusal names where", () => {
    const all = events();
    const e = all.find((x) => x.goal === "prizes" && x.versionInputs?.goal === "prizes") as FeedbackEvent;
    expect(e).toBeTruthy();
    // Parker's $2,000 / $1,600 / $900, as the browser sends them (reward.ts prizePercents), at both levels.
    expect(prizeShares(PARKER_AMOUNTS, 14)).toEqual({ first: 4 / 9, second: 16 / 45, third: 1 / 5, weeklyHigh: 0, pointsLeader: 0 });
    expect(e.prizes).toEqual(SPLIT);
    expect(e.versionInputs?.prizes).toEqual(SPLIT);
    // Every copy the browser builds keeps the rule; copies under another goal (an older version's among them) have no split.
    for (const x of all) {
      expect("prizes" in x, `${x.goal}`).toBe(x.goal === "prizes");
      if (x.versionInputs) expect("prizes" in x.versionInputs, `${x.versionInputs.goal}`).toBe(x.versionInputs.goal === "prizes");
    }
    const codeOf = (x: unknown) => {
      const r = FeedbackEventSchema.safeParse(x);
      return r.success ? "accepted" : refusedCopyCode(r.error);
    };
    const vi = e.versionInputs as NonNullable<FeedbackEvent["versionInputs"]>;
    for (const ok of [SPLIT, { first: 100, second: 0, third: 0, weeklyHigh: 0, pointsLeader: 0 }, { first: 20, second: 20, third: 20, weeklyHigh: 20, pointsLeader: 20 }]) {
      expect(codeOf({ ...e, prizes: ok, versionInputs: { ...vi, prizes: ok } }), JSON.stringify(ok)).toBe("accepted");
    }
    const { prizes: _p, ...noSplit } = e;
    void _p;
    const { prizes: _vp, ...viNoSplit } = vi;
    void _vp;
    const refused: Array<[unknown, string]> = [
      // Amounts as typed, finer shares, a total that isn't 100, a share below 0, a field it doesn't list, one left out.
      [{ ...e, prizes: { first: 2000, second: 1600, third: 900, weeklyHigh: 0, pointsLeader: 0 } }, "INVALID_PRIZES"],
      [{ ...e, prizes: { ...SPLIT, first: 44.4, second: 35.6 } }, "INVALID_PRIZES"],
      [{ ...e, prizes: { ...SPLIT, third: 19 } }, "INVALID_PRIZES"],
      [{ ...e, prizes: { ...SPLIT, first: 64, weeklyHigh: -20 } }, "INVALID_PRIZES"],
      [{ ...e, prizes: { ...SPLIT, amount: 4500 } }, "INVALID_PRIZES_EXTRA_FIELD"],
      [{ ...e, prizes: { first: 44, second: 36, third: 20, weeklyHigh: 0 } }, "INVALID_PRIZES"],
      [{ ...e, prizes: "44/36/20" }, "INVALID_PRIZES"],
      // "Several prizes" without its split; a split with another goal (or none).
      [noSplit, "INVALID_PRIZES"],
      [{ ...e, goal: "title" }, "INVALID_PRIZES"],
      [{ ...e, goal: null }, "INVALID_PRIZES"],
      [{ ...e, goal: "balanced" }, "INVALID_PRIZES"],
      // The same in the sent version's inputs.
      [{ ...e, versionInputs: viNoSplit }, "INVALID_VERSIONINPUTS"],
      [{ ...e, versionInputs: { ...vi, goal: "playoffs" } }, "INVALID_VERSIONINPUTS"],
      [{ ...e, versionInputs: { ...vi, prizes: { ...SPLIT, first: 2000 } } }, "INVALID_VERSIONINPUTS"],
    ];
    for (const [copy, code] of refused) expect(codeOf(JSON.parse(JSON.stringify(copy))), JSON.stringify(copy).slice(0, 160)).toBe(code);
    // The stored form keeps the rule (feedback:report counts such an entry unreadable).
    expect(StoredFeedbackEventSchema.safeParse({ ...noSplit, day: "2026-10-04" }).success).toBe(false);
    expect(StoredFeedbackEventSchema.safeParse({ ...e, day: "2026-10-04" }).success).toBe(true);
  });

  it("refuses a copy with any field it doesn't list, at any level: the league's key, a note, the partner's team id, a time, an address", () => {
    const e = events()[0] as FeedbackEvent;
    const extras: Array<(x: Record<string, unknown>) => void> = [
      (x) => (x.leagueKey = "sleeper:12345678"),
      (x) => (x.leagueId = "12345678"),
      (x) => (x.note = "Team 4 said no"),
      (x) => (x.at = "2026-10-04T12:00:00.000Z"),
      (x) => (x.ip = "203.0.113.9"),
      (x) => ((x.trade as Record<string, unknown>).partnerId = "2"),
      (x) => (((x.trade as { give: Array<Record<string, unknown>> }).give[0] as Record<string, unknown>).name = "Wiggleton Spoons"),
      (x) => ((x.format as Record<string, unknown>).name = "The Gloopdorf Invitational"),
      (x) => ((x.numbers as Record<string, unknown>).owner = "Zorblax"),
      (x) => ((x.features as Record<string, unknown>).team = "Team 3"),
      (x) => ((x.versionInputs as Record<string, unknown>).username = "zorblax_q"),
      (x) => ((x.versionTrade as Record<string, unknown>).partnerId = "2"),
    ];
    expect(e.versionTrade).toBeTruthy();
    for (const add of extras) {
      const copy = JSON.parse(JSON.stringify(e)) as Record<string, unknown>;
      add(copy);
      expect(FeedbackEventSchema.safeParse(copy).success, add.toString()).toBe(false);
    }
  });

  it("refuses values outside their narrow shapes, and a version without its outcome or inputs without a version", () => {
    const e = events()[0] as FeedbackEvent;
    const bad: Array<Partial<Record<keyof FeedbackEvent, unknown>> | ((x: FeedbackEvent) => unknown)> = [
      { v: 2 },
      { rid: "fb-1234abcd" },
      { rid: "{00000000-0000-4000-8000-000000000000}" },
      { kind: "note" },
      { outcome: "maybe" },
      { reason: "my leaguemate Zorblax is a jerk" },
      { platform: "nfl" },
      { season: 1999 },
      { week: 2.5 },
      { goal: "fun" },
      (x) => ({ ...x, format: { ...x.format, slots: { "SUPER FLEX": 1 } } }),
      (x) => ({ ...x, format: { ...x.format, slots: { "QB/QB": 1 } } }),
      (x) => ({ ...x, format: { ...x.format, numTeams: 1000 } }),
      (x) => ({ ...x, trade: { ...x.trade, give: [{ id: "a username with spaces", pos: "QB" }] } }),
      (x) => ({ ...x, trade: { ...x.trade, give: [{ id: "1", pos: "HC" }] } }),
      (x) => ({ ...x, trade: { ...x.trade, get: Array.from({ length: 5 }, (_, i) => ({ id: String(i), pos: "RB" })) } }),
      // Review FB-R4: text that isn't a player id's form, in either trade: a Sleeper league id (19 digits), the league's
      // short code, a username, a team name, a SWID without its braces, another platform's id (until Phase 5 widens it).
      ...["1234567890123456789", "espn:1a2b3c4d", "zorblax_q", "GravelGophers", "ABCDEF12-3456-7890-ABCD-EF1234567890", "mfl:12345", "espn:"].flatMap((id) => [
        (x: FeedbackEvent) => ({ ...x, trade: { ...x.trade, give: [{ id, pos: null }] } }),
        (x: FeedbackEvent) => ({ ...x, versionTrade: { give: [], get: [{ id, pos: null }] } }),
      ]),
      // A share id must be 16 bytes' worth: not 21 or 23 characters, nor 22 whose last can't end 16 bytes.
      { rid: "zorblaxqzorblaxqzorbla" },
      { rid: "AAAAAAAAAAAAAAAAAAAAA" },
      { rid: "AAAAAAAAAAAAAAAAAAAAAAA" },
      (x) => ({ ...x, versionTrade: { ...x.versionTrade, give: Array.from({ length: 5 }, (_, i) => ({ id: String(i), pos: "RB" })) } }),
      (x) => ({ ...x, versionInputs: { ...x.versionInputs, week: 31 } }),
      (x) => ({ ...x, versionInputs: { ...x.versionInputs, week: 2.5 } }),
      (x) => {
        const { week: _w, ...inputs } = x.versionInputs as NonNullable<FeedbackEvent["versionInputs"]>;
        void _w;
        return { ...x, versionInputs: inputs }; // every version input present
      },
      (x) => ({ ...x, numbers: { ...x.numbers, pAccept: 1.5 } }),
      (x) => ({ ...x, numbers: { ...x.numbers, helps: 101 } }),
      (x) => ({ ...x, numbers: { ...x.numbers, b3: 0 } }),
      (x) => ({ ...x, numbers: { ...x.numbers, b: 1e12 } }),
      (x) => ({ ...x, numbers: { ...x.numbers, dPO: "0.04" } }),
      (x) => ({ ...x, versionInputs: { ...x.versionInputs, helpsReason: "vibes" } }),
      (x) => ({ ...x, versionAccept: { pAccept: 2, pComplete: 0.3 } }),
      (x) => ({ ...x, versionAccept: { pAccept: 0.3, pComplete: 0.3, key: "2|give:106|get:204" } }),
      (x) => {
        const { outcome: _o, ...rest } = x;
        void _o;
        return rest; // a version (and inputs) without an outcome
      },
      (x) => {
        const { version: _v, ...rest } = x;
        void _v;
        return rest; // inputs (and the version's players) without a version
      },
      (x) => {
        const { version: _v, versionAccept: _a, versionInputs: _i, ...rest } = x;
        void [_v, _a, _i];
        return rest; // the version's players alone, without a version
      },
    ];
    expect(e.outcome && e.version && e.versionAccept && e.versionInputs && e.versionTrade).toBeTruthy();
    for (const b of bad) {
      const copy = typeof b === "function" ? b(JSON.parse(JSON.stringify(e)) as FeedbackEvent) : { ...e, ...b };
      expect(FeedbackEventSchema.safeParse(copy).success, JSON.stringify(copy).slice(0, 200)).toBe(false);
    }
  });

  it("names what a refused copy got wrong by the schema's own top-level field, never by a value or a name the client chose (review FB-R8)", () => {
    const e = events()[0] as FeedbackEvent;
    const codeOf = (x: unknown) => {
      const r = FeedbackEventSchema.safeParse(x);
      return r.success ? "accepted" : refusedCopyCode(r.error);
    };
    expect(codeOf(e)).toBe("accepted");
    expect(codeOf({ ...e, leagueId: "12345678" })).toBe("INVALID_EXTRA_FIELD");
    expect(codeOf({ ...e, trade: { ...e.trade, partnerId: "2" } })).toBe("INVALID_TRADE_EXTRA_FIELD");
    expect(codeOf({ ...e, trade: { ...e.trade, give: [{ id: "zorblax_q", pos: null }] } })).toBe("INVALID_TRADE");
    expect(codeOf({ ...e, rid: "short" })).toBe("INVALID_RID");
    expect(codeOf({ ...e, versionInputs: { ...e.versionInputs, week: 31 } })).toBe("INVALID_VERSIONINPUTS");
    const { outcome: _o, ...noOutcome } = e;
    void _o;
    expect(codeOf(noOutcome)).toBe("INVALID_VERSION");
    for (const x of [null, [], "a copy", 7]) expect(codeOf(x)).toBe("INVALID_REQUEST");
  });

  it("the stored form adds the UTC day it arrived and nothing else", () => {
    const e = events()[1] as FeedbackEvent;
    const stored = storedFeedbackEvent(e, T0);
    expect(stored).toEqual({ ...e, day: "2026-10-04" });
    expect(StoredFeedbackEventSchema.parse(JSON.parse(JSON.stringify(stored)))).toEqual(stored);
    expect(StoredFeedbackEventSchema.safeParse({ ...stored, day: "2026-10-04T18:30:00Z" }).success).toBe(false);
    expect(StoredFeedbackEventSchema.safeParse({ ...stored, at: T0 }).success).toBe(false);
  });
});

describe("storeFeedback (Redis on Vercel; FakeRedis here)", () => {
  it("LPUSHes the copy and its day to this UTC day's list and keeps the list a year from the day's start: one transaction, 3 commands a copy (final review SEC-3)", async () => {
    let now = T0;
    const redis = new FakeRedis(() => now);
    const e = events()[0] as FeedbackEvent;
    expect(await storeFeedback(redis, e, { now, env: PREVIEW })).toBe(true);
    const key = "os:preview:fb:2026-10-04";
    expect(feedbackDayKey(now, PREVIEW)).toBe(key);
    expect(redis.keys()).toEqual([key]);
    expect(await redis.lrange(key, 0, -1)).toEqual([JSON.stringify({ ...e, day: "2026-10-04" })]);
    expect(storedFeedbackText(e, now)).toBe(JSON.stringify({ ...e, day: "2026-10-04" }));
    // Checkpoint 7b: the year runs from the UTC day's start (00:00), not from the copy, so no copy outlives 12 months.
    const dayStart = Date.UTC(2026, 9, 4);
    expect(redis.ttlMs(key)).toBe(feedbackLimits.retainDays * DAY - (T0 - dayStart));
    expect(feedbackDayTtlMs(T0)).toBe(feedbackLimits.retainDays * DAY - (T0 - dayStart));
    expect(redis.stats.commands).toBe(3 + 1); // LPUSH, LTRIM, PEXPIRE in one transaction (+ the LRANGE above)
    // A later copy the same day leaves the list's end where it was: a year after the day began.
    now = Date.UTC(2026, 9, 4, 23, 59, 59);
    expect(await storeFeedback(redis, e, { now, env: PREVIEW })).toBe(true);
    expect(redis.ttlMs(key)).toBe(feedbackLimits.retainDays * DAY - (now - dayStart));
    // The next day: a new list with its own year; the old one still ends a year after its own day began.
    now = Date.UTC(2026, 9, 5, 0, 0, 1);
    expect(await storeFeedback(redis, e, { now, env: PREVIEW })).toBe(true);
    expect(redis.keys().sort()).toEqual([key, "os:preview:fb:2026-10-05"]);
    expect(redis.ttlMs(key)).toBe(feedbackLimits.retainDays * DAY - (now - dayStart));
    expect(redis.ttlMs("os:preview:fb:2026-10-05")).toBe(feedbackLimits.retainDays * DAY - 1_000);
    // Production's lists are apart from previews'; off Vercel the prefix is "local".
    expect(feedbackDayKey(T0, { VERCEL: "1", VERCEL_ENV: "production" })).toBe("os:production:fb:2026-10-04");
    expect(feedbackDayKey(T0, {})).toBe("os:local:fb:2026-10-04");
  });

  it("keeps the newest feedbackLimits.maxPerDay a day (the transaction's LTRIM): a flood crowds out its own day only (final review SEC-3)", async () => {
    let now = T0 - DAY;
    const redis = new FakeRedis(() => now);
    // A real copy the day before, then a full day of forged ones.
    const real = events()[1] as FeedbackEvent;
    expect(await storeFeedback(redis, real, { now, env: PREVIEW })).toBe(true);
    now = T0;
    const key = feedbackDayKey(T0, PREVIEW);
    const filler = Array.from({ length: feedbackLimits.maxPerDay }, (_, i) => `old-${i}`);
    await redis.lpush(key, ...filler);
    const before = redis.stats.commands;
    const e = events()[2] as FeedbackEvent;
    expect(await storeFeedback(redis, e, { now: T0, env: PREVIEW })).toBe(true);
    expect(redis.stats.commands - before).toBe(3);
    const list = await redis.lrange(key, 0, -1);
    expect(list).toHaveLength(feedbackLimits.maxPerDay);
    expect(list[0]).toBe(JSON.stringify({ ...e, day: "2026-10-04" }));
    // LPUSH puts the newest first: the oldest filler copy is the one let go.
    expect(list[1]).toBe(`old-${feedbackLimits.maxPerDay - 1}`);
    expect(list.at(-1)).toBe("old-1");
    // The day before keeps its real copy whatever this day holds.
    expect(await redis.lrange(feedbackDayKey(T0 - DAY, PREVIEW), 0, -1)).toEqual([JSON.stringify({ ...real, day: "2026-10-03" })]);
  });

  it("bounds the store (final review F4): every copy the browser builds fits feedbackLimits.maxStoredBytes; the biggest the schema takes doesn't", () => {
    expect(feedbackLimits.maxStoredBytes).toBe(2_048);
    // Every kind of copy feedbackShare.ts builds, and each made as big as a real trade makes it: the Analyzer's 4 players a
    // side with ESPN ids, a version of 4 a side, a league that starts many kinds of slots, every number at its longest, and
    // (Checkpoint 7c) "Several prizes" with a split of two digits each, at the top and in the version's inputs. ⚠️ "At its
    // longest" as the browser writes it: every number of a copy goes through feedbackShare.ts sig (6 significant digits),
    // whose longest form within the schema's bounds (±1e9) is 14 characters ("-0.00000123457"; smaller ones turn
    // exponential, "-1.23457e-7"). Until Checkpoint 7c this test used full precision (20 characters), which no copy holds:
    // with the split at both levels that made 2,096 bytes, against about 1,950 for the biggest copy the browser can build.
    const all = events();
    const long = sig(-0.0000012345678912) as number;
    expect(JSON.stringify(long)).toBe("-0.00000123457");
    expect([sig(-0.00000012345678912), sig(-123456789.12345)].map((x) => JSON.stringify(x).length)).toEqual([11, 10]);
    const split = { first: 20, second: 20, third: 20, weeklyHigh: 20, pointsLeader: 20 };
    const four = (n: number) => Array.from({ length: 4 }, (_, i) => ({ id: `espn:${4_000_000 + n * 10 + i}`, pos: "WR" as const }));
    const features = { g: long, n: long, h: 1, c: 6, a: -2, hist: long, ctx: -0.8, hot: -0.15, urg: 0.2, z: long };
    const big = (x: FeedbackEvent): FeedbackEvent => ({
      ...x,
      format: { ...x.format, slots: { QB: 1, RB: 2, WR: 3, TE: 1, "RB/WR/TE": 2, "QB/RB/WR/TE": 1, K: 1, DEF: 1, "DL/LB/DB": 2, DL: 1, LB: 1, DB: 1 } },
      goal: "prizes",
      prizes: split,
      trade: { give: four(1), get: four(2) },
      numbers: { helps: 100, chance: 85, overall: 100, b: long, b3: -long, pAccept: -long, pComplete: -long, dPO: long, dCH: long, dPPW: long, gMine: long, gPartner: long },
      features,
      ...(x.version
        ? {
            versionTrade: { give: four(3), get: four(4) },
            versionAccept: { pAccept: -long, pComplete: -long },
            versionInputs: { features, gPartner: long, b: long, b3: -long, helpsReason: "odds" as const, goal: "prizes" as const, prizes: split, week: 17 },
          }
        : {}),
    });
    let largest = 0;
    for (const e of [...all, ...all.map(big)]) {
      const parsed = FeedbackEventSchema.safeParse(e);
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
      largest = Math.max(largest, Buffer.byteLength(storedFeedbackText(e, T0)));
      expect(fitsFeedbackStore(e, T0), String(Buffer.byteLength(storedFeedbackText(e, T0)))).toBe(true);
    }
    expect(largest).toBeGreaterThan(1_800);
    // The schema takes bigger ones (32 slots with long keys): those aren't stored.
    const subsets = Array.from({ length: 1 << POSITIONS.length }, (_, m) => POSITIONS.filter((_p, i) => m & (1 << i))).sort((a, b) => b.length - a.length);
    const slots = Object.fromEntries(subsets.slice(0, 32).map((s) => [s.join("/"), 30]));
    const huge: FeedbackEvent = { ...big(all.find((x) => x.version) as FeedbackEvent), format: { ...(all[0] as FeedbackEvent).format, slots } };
    expect(FeedbackEventSchema.safeParse(huge).success).toBe(true);
    expect(fitsFeedbackStore(huge, T0)).toBe(false);
  });

  it("never leaves a list without its expiry (review FB-R5): the push, trim and expiry go in one transaction, all or none", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const e = events()[0] as FeedbackEvent;
    const key = feedbackDayKey(T0, PREVIEW);
    // storeFeedback never sends the three commands one by one: a store whose single commands fail still keeps the copy
    // with its year.
    class SingleCommandsDown extends FakeRedis {
      override lpush(): Promise<number> {
        return Promise.reject(new TypeError("fetch failed"));
      }
      override pexpire(): Promise<number> {
        return Promise.reject(new TypeError("fetch failed"));
      }
    }
    const single = new SingleCommandsDown(() => T0);
    expect(await storeFeedback(single, e, { now: T0, env: PREVIEW })).toBe(true);
    expect(single.ttlMs(key)).toBe(feedbackDayTtlMs(T0));
    // A transaction Upstash refuses or never gets keeps nothing: no list is left behind without its expiry.
    class TransactionDown extends FakeRedis {
      override lpushTrimExpire(): Promise<number> {
        return Promise.reject(Object.assign(new Error("ERR max requests limit exceeded"), { name: "UpstashError" }));
      }
    }
    const down = new TransactionDown(() => T0);
    expect(await storeFeedback(down, e, { now: T0, env: PREVIEW })).toBe(false);
    expect(down.keys()).toEqual([]);
  });

  it("a store that fails or hangs: false, logged by the error's name only, never thrown", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const e = events()[0] as FeedbackEvent;
    const failing = { lpushTrimExpire: () => Promise.reject(Object.assign(new Error("https://user:secret@example.upstash.io down"), { name: "UpstashError" })) } as unknown as RedisLike;
    expect(await storeFeedback(failing, e, { now: T0, env: PREVIEW })).toBe(false);
    const hanging = { lpushTrimExpire: () => new Promise<number>(() => {}) } as unknown as RedisLike;
    expect(await storeFeedback(hanging, e, { now: T0, env: PREVIEW, timeoutMs: 20 })).toBe(false);
    const logged = spy.mock.calls.map((c) => String(c[0]));
    expect(logged).toEqual([
      '{"route":"server","event":"feedback_store_failed","platform":"upstash","errorName":"UpstashError"}',
      '{"route":"server","event":"feedback_store_failed","platform":"upstash","errorName":"TimeoutError"}',
    ]);
    expect(logged.join("\n")).not.toContain("secret");
  });

  it("feedbackStoreFor: Redis on Vercel only; a Redis address that can't be used means no store, said once by the error's name", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const secret = "s".repeat(40);
    const configured = { KV_REST_API_URL: "https://example-12345.upstash.io", KV_REST_API_TOKEN: "FAKE-TOKEN-NOT-REAL", SESSION_SECRET: secret };
    expect(feedbackStoreFor(configured)).toBeNull(); // off Vercel (npm run dev, the stable copy, check:browser, tests)
    expect(feedbackStoreFor({ ...configured, VERCEL: "1" })).not.toBeNull();
    expect(feedbackStoreFor({ VERCEL: "1" })).toBeNull(); // on Vercel before Upstash is connected
    const bad = { ...configured, VERCEL: "1", KV_REST_API_URL: "rediss://default:FAKE-PASSWORD-NOT-REAL@example-12345.upstash.io:6379" };
    expect(feedbackStoreFor(bad)).toBeNull();
    expect(feedbackStoreFor(bad)).toBeNull();
    const logged = spy.mock.calls.map((c) => String(c[0]));
    expect(logged).toEqual(['{"route":"server","event":"redis_config_invalid","platform":"upstash","errorName":"UrlError"}']);
    expect(logged.join("\n")).not.toContain("FAKE-PASSWORD");
  });
});
