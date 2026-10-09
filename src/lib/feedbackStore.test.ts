/**
 * Trade feedback kept in the browser (CLAUDE.md §11 "Feedback on every suggestion", Phase 4: local only; lead
 * decision L12): one record per trade idea with the card's numbers from the first press, outcomes and reports
 * set and cleared, the newest 500 kept, tolerance of whatever the storage holds, a blocked or full storage,
 * what the card printed (Checkpoint 7d), and the export file (version 3 since Checkpoint 7d: what the user saw and entered).
 * A Map stands in for localStorage (Vitest runs in Node); every id is made up.
 */
import { describe, expect, it } from "vitest";
import { acceptance, acceptanceLabel, partnerProfile } from "@/engine/acceptance";
import { benefit, protectValueWeight } from "@/engine/benefit";
import { config } from "@/engine/config";
import type { AcceptanceFeatures } from "@/engine/tradeModel";
import type { StorageLike } from "./importStore";
import {
  EXPORT_LEAGUE_PREFIX,
  FEEDBACK_DELETE_FAILED,
  FEEDBACK_EXPORT_KIND,
  FEEDBACK_EXPORT_VERSION,
  FEEDBACK_MAX_RECORDS,
  FEEDBACK_NOTE_MAX,
  FEEDBACK_OUTCOMES,
  FEEDBACK_REASONS,
  FEEDBACK_SAVE_FAILED,
  FEEDBACK_STORAGE_KEY,
  FEEDBACK_VERSIONS,
  OUTCOME_LABEL,
  REASON_LABEL,
  REASON_MODEL_PART,
  applyFeedback,
  clearFeedback,
  dayOf,
  exportedShownOf,
  exportedVersionOf,
  feedbackExport,
  feedbackExportFileName,
  feedbackExportText,
  feedbackFor,
  feedbackRecordsFrom,
  feedbackTouchedAt,
  isFeedbackPrizes,
  mergeFeedbackRecords,
  parseFeedback,
  parseFeedbackExport,
  parseFeedbackExportEntry,
  parseFeedbackShown,
  proposalFromKey,
  recordReward,
  saveFeedback,
  type FeedbackEvaluation,
  type FeedbackExportEntry,
  type FeedbackRecord,
  type FeedbackShown,
} from "./feedbackStore";

class MemoryStorage implements StorageLike {
  values = new Map<string, string>();
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
  removeItem(key: string): void {
    this.values.delete(key);
  }
}

class BlockedStorage implements StorageLike {
  getItem(): string | null {
    throw new DOMException("The operation is insecure.", "SecurityError");
  }
  setItem(): void {
    throw new DOMException("The operation is insecure.", "SecurityError");
  }
  removeItem(): void {
    throw new DOMException("The operation is insecure.", "SecurityError");
  }
}

class FullStorage extends MemoryStorage {
  override setItem(): void {
    throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
  }
}

const LEAGUE = "espn:1a2b3c4d";
const FEATURES: AcceptanceFeatures = { g: -0.08, n: 0.42, h: 1, c: 1, a: 1, hist: null, ctx: 0, hot: 0.15, urg: 0, z: -0.31 };

/** A trade idea as a card holds it: I give player 101, get 202 and 203 from team 2. */
function evaluation(key = "2|give:101|get:202,203", over: Partial<FeedbackEvaluation> = {}): FeedbackEvaluation {
  return {
    key,
    proposal: {
      partnerId: "2",
      give: [{ kind: "player", id: "101" }],
      get: [
        { kind: "player", id: "202" },
        { kind: "player", id: "203" },
      ],
    },
    features: FEATURES,
    b: 4.2,
    tradeScore: 50,
    pAccept: 0.42,
    pComplete: 0.42,
    overall: 25,
    dPO: 0.04,
    dCH: 0.02,
    dPPW: 2.6,
    gMine: -0.03,
    gPartner: -0.08,
    ...over,
  };
}

const T1 = "2026-10-01T18:00:00.000Z";
const T2 = "2026-10-02T09:30:00.000Z";
const T3 = "2026-10-03T12:00:00.000Z";

/**
 * What a card printed (Checkpoint 7d; tradeView.ts TradeCardView.shown), every form a card prints: my title, top-3 and playoff
 * odds, the weekly line, the chance it goes through, and the partner's line.
 */
const SHOWN: FeedbackShown = {
  helps: "50",
  chance: "40%",
  label: "Decent",
  through: "about 20%",
  overall: "25",
  odds: ["Title odds 12.1% → 13.4%", "Top 3 odds 30% → 32%", "Playoff odds 65% → 69%"],
  weekly: "Win chance by week: Week 9: 68% → 64% · Week 13: 42% → 55%",
  helpsThem: "24",
  theirOdds: ["Their title odds 6.0% → 6.9%", "Their top 3 odds 33% → 36%", "Their playoff odds 41% → 45%"],
};

/** Every key anywhere in a JSON value, each once, sorted. */
function keysOf(x: unknown, out = new Set<string>()): string[] {
  if (Array.isArray(x)) for (const v of x) keysOf(v, out);
  else if (x && typeof x === "object") {
    for (const [k, v] of Object.entries(x)) {
      out.add(k);
      keysOf(v, out);
    }
  }
  return [...out].sort();
}

/** Every number anywhere in a JSON value (a version-3 file holds only a pick's season and round). */
function numbersOf(x: unknown, out: number[] = []): number[] {
  if (typeof x === "number") out.push(x);
  else if (Array.isArray(x)) for (const v of x) numbersOf(v, out);
  else if (x && typeof x === "object") for (const v of Object.values(x)) numbersOf(v, out);
  return out;
}

describe("applyFeedback: one record per trade idea", () => {
  it("makes a record on the first press, with the card's numbers, features and trade", () => {
    const [r, ...rest] = applyFeedback([], { leagueKey: LEAGUE, evaluation: evaluation(), change: { outcome: "sent" }, at: T1 });
    expect(rest).toEqual([]);
    expect(r).toEqual({
      id: expect.stringMatching(/^fb-[0-9a-f]{8}$/),
      savedAt: T1,
      leagueKey: LEAGUE,
      tradeKey: "2|give:101|get:202,203",
      proposal: evaluation().proposal,
      // B₃ is null here: an evaluation from before Phase 7a has none (the scale's tests below).
      numbers: { b: 4.2, tradeScore: 50, pAccept: 0.42, pComplete: 0.42, overall: 25, dPO: 0.04, dCH: 0.02, dPPW: 2.6, gMine: -0.03, gPartner: -0.08, b3: null },
      features: FEATURES,
      outcome: { kind: "sent", at: T1 },
    });
  });

  it("keeps the first press's numbers (the prediction acted on); later presses change only the outcome or report", () => {
    let list = applyFeedback([], { leagueKey: LEAGUE, evaluation: evaluation(), change: { outcome: "sent" }, at: T1 });
    const later = evaluation(undefined, { pAccept: 0.7, b: 9, features: { ...FEATURES, z: 0.9 } });
    list = applyFeedback(list, { leagueKey: LEAGUE, evaluation: later, change: { outcome: "accepted" }, at: T2 });
    list = applyFeedback(list, { leagueKey: LEAGUE, evaluation: later, change: { report: { reason: "player-info", note: "  He was traded to Team 5.  " } }, at: T3 });
    expect(list).toHaveLength(1);
    const [r] = list;
    expect(r?.savedAt).toBe(T1);
    expect(r?.numbers.pAccept).toBe(0.42);
    expect(r?.numbers.b).toBe(4.2);
    expect(r?.features.z).toBe(-0.31);
    expect(r?.outcome).toEqual({ kind: "accepted", at: T2 });
    expect(r?.report).toEqual({ reason: "player-info", note: "He was traded to Team 5.", at: T3 });
  });

  it("clears an outcome or a report with null, and drops a record left with neither", () => {
    let list = applyFeedback([], { leagueKey: LEAGUE, evaluation: evaluation(), change: { outcome: "rejected" }, at: T1 });
    list = applyFeedback(list, { leagueKey: LEAGUE, evaluation: evaluation(), change: { report: { reason: "never-accept" } }, at: T2 });
    list = applyFeedback(list, { leagueKey: LEAGUE, evaluation: evaluation(), change: { outcome: null }, at: T3 });
    expect(list).toHaveLength(1);
    expect(list[0]?.outcome).toBeUndefined();
    expect(list[0]?.report).toEqual({ reason: "never-accept", at: T2 });
    list = applyFeedback(list, { leagueKey: LEAGUE, evaluation: evaluation(), change: { report: null }, at: T3 });
    expect(list).toEqual([]);
    // Clearing what isn't there changes nothing.
    expect(applyFeedback([], { leagueKey: LEAGUE, evaluation: evaluation(), change: { outcome: null }, at: T1 })).toEqual([]);
  });

  it("keeps a note trimmed and short, and leaves an empty note out", () => {
    const long = "x".repeat(FEEDBACK_NOTE_MAX + 50);
    const [withLong] = applyFeedback([], { leagueKey: LEAGUE, evaluation: evaluation(), change: { report: { reason: "other", note: long } }, at: T1 });
    expect(withLong?.report?.note).toHaveLength(FEEDBACK_NOTE_MAX);
    const [blank] = applyFeedback([], { leagueKey: LEAGUE, evaluation: evaluation(), change: { report: { reason: "other", note: "   " } }, at: T1 });
    expect(blank?.report).toEqual({ reason: "other", at: T1 });
  });

  it("tells trade ideas and leagues apart, and moves the one just touched to the newest end", () => {
    let list = applyFeedback([], { leagueKey: LEAGUE, evaluation: evaluation("a"), change: { outcome: "sent" }, at: T1 });
    list = applyFeedback(list, { leagueKey: LEAGUE, evaluation: evaluation("b"), change: { outcome: "sent" }, at: T1 });
    list = applyFeedback(list, { leagueKey: "sleeper:00000001", evaluation: evaluation("a"), change: { outcome: "sent" }, at: T1 });
    list = applyFeedback(list, { leagueKey: LEAGUE, evaluation: evaluation("a"), change: { outcome: "countered" }, at: T2 });
    expect(list.map((r) => `${r.leagueKey}/${r.tradeKey}/${r.outcome?.kind}`)).toEqual([`${LEAGUE}/b/sent`, "sleeper:00000001/a/sent", `${LEAGUE}/a/countered`]);
    expect(feedbackFor(list, LEAGUE, "a")?.outcome?.kind).toBe("countered");
    expect(feedbackFor(list, LEAGUE, "zzz")).toBeUndefined();
  });

  it("keeps the newest FEEDBACK_MAX_RECORDS (500) touched", () => {
    let list: FeedbackRecord[] = [];
    for (let i = 0; i < FEEDBACK_MAX_RECORDS + 5; i++) list = applyFeedback(list, { leagueKey: LEAGUE, evaluation: evaluation(`t${i}`), change: { outcome: "sent" }, at: T1 });
    expect(list).toHaveLength(FEEDBACK_MAX_RECORDS);
    expect(list[0]?.tradeKey).toBe("t5");
    expect(list.at(-1)?.tradeKey).toBe(`t${FEEDBACK_MAX_RECORDS + 4}`);
  });

  it("keeps numbers and features that weren't finite as null (B before a simulation, say)", () => {
    const [r] = applyFeedback([], {
      leagueKey: LEAGUE,
      evaluation: evaluation(undefined, { b: null, tradeScore: null, overall: null, dPO: null, dCH: null, dPPW: Number.NaN, features: { ...FEATURES, z: Number.POSITIVE_INFINITY } }),
      change: { outcome: "sent" },
      at: T1,
    });
    expect(r?.numbers).toMatchObject({ b: null, tradeScore: null, overall: null, dPO: null, dCH: null, dPPW: null, pAccept: 0.42 });
    expect(r?.features.z).toBeNull();
    expect(r?.features.hist).toBeNull();
    // And it survives a round trip through JSON, which would turn them into null anyway.
    expect(parseFeedback(JSON.stringify([r]))).toEqual([r]);
  });

  it("copies the trade, picks included, so later changes to the card's objects don't reach the record", () => {
    const ev = evaluation("p", { proposal: { partnerId: "4", give: [{ kind: "pick", season: 2027, round: 1, originalTeamId: "3" }], get: [{ kind: "player", id: "404" }] } });
    const [r] = applyFeedback([], { leagueKey: LEAGUE, evaluation: ev, change: { outcome: "sent" }, at: T1 });
    ev.proposal.give.push({ kind: "player", id: "999" });
    expect(r?.proposal).toEqual({ partnerId: "4", give: [{ kind: "pick", season: 2027, round: 1, originalTeamId: "3" }], get: [{ kind: "player", id: "404" }] });
  });
});

describe("which version was sent (planner reply to Checkpoint 4, change 6 and answer 8)", () => {
  const PLAN_B = { version: "planB" as const, key: "2|give:101|get:204", pAccept: 0.3, pComplete: 0.15 };

  it("keeps the version sent with the outcome: which one, its key and its estimate as its line showed it", () => {
    const [r] = applyFeedback([], { leagueKey: LEAGUE, evaluation: evaluation(), change: { outcome: "sent", sent: PLAN_B }, at: T1 });
    expect(r).toMatchObject({ outcome: { kind: "sent", at: T1 }, version: "planB", versionKey: PLAN_B.key, versionAccept: { pAccept: 0.3, pComplete: 0.15 } });
    // The record's numbers stay the card's (the trade idea), the version's estimate beside them.
    expect(r?.numbers.pAccept).toBe(0.42);
    expect(FEEDBACK_VERSIONS).toEqual(["offerFirst", "full", "planB"]);
  });

  it("later outcomes keep it; clearing the outcome clears it (it belongs to the sending); a report alone never has one", () => {
    let list = applyFeedback([], { leagueKey: LEAGUE, evaluation: evaluation(), change: { outcome: "sent", sent: PLAN_B }, at: T1 });
    list = applyFeedback(list, { leagueKey: LEAGUE, evaluation: evaluation(), change: { outcome: "accepted" }, at: T2 });
    expect(list[0]).toMatchObject({ outcome: { kind: "accepted" }, version: "planB", versionKey: PLAN_B.key });
    list = applyFeedback(list, { leagueKey: LEAGUE, evaluation: evaluation(), change: { report: { reason: "other" } }, at: T2 });
    list = applyFeedback(list, { leagueKey: LEAGUE, evaluation: evaluation(), change: { outcome: null }, at: T3 });
    expect(list[0]?.version).toBeUndefined();
    expect(list[0]?.versionKey).toBeUndefined();
    expect(list[0]?.versionAccept).toBeUndefined();
    expect(list[0]?.report?.reason).toBe("other");
    // A newer version given with a later outcome replaces it; an unknown one is ignored; a non-finite estimate is kept as null.
    let again = applyFeedback([], { leagueKey: LEAGUE, evaluation: evaluation(), change: { outcome: "sent", sent: PLAN_B }, at: T1 });
    again = applyFeedback(again, { leagueKey: LEAGUE, evaluation: evaluation(), change: { outcome: "countered", sent: { version: "full", key: "k", pAccept: Number.NaN, pComplete: 0.4 } }, at: T2 });
    expect(again[0]).toMatchObject({ version: "full", versionKey: "k", versionAccept: { pAccept: null, pComplete: 0.4 } });
    const odd = applyFeedback([], { leagueKey: LEAGUE, evaluation: evaluation(), change: { outcome: "sent", sent: { ...PLAN_B, version: "other" as never } }, at: T1 });
    expect(odd[0]?.version).toBeUndefined();
  });

  it("round-trips through the storage and the export; older records (no version) still read, as unknown", () => {
    const [withVersion] = applyFeedback([], { leagueKey: LEAGUE, evaluation: evaluation("a"), change: { outcome: "sent", sent: PLAN_B }, at: T1 });
    const [old] = applyFeedback([], { leagueKey: LEAGUE, evaluation: evaluation("b"), change: { outcome: "rejected" }, at: T1 });
    const list = [withVersion, old] as FeedbackRecord[];
    expect(parseFeedback(JSON.stringify(list))).toEqual(list);
    const exported = parseFeedbackExport(feedbackExportText(list, T3)) ?? [];
    expect(exported.map((r) => r.version?.kind ?? "unknown")).toEqual(["planB", "unknown"]);
    // Checkpoint 7d: the version's players from its key and its chance as its line printed it (30%, about 15% through a
    // veto), never the key itself.
    expect(exported[0]?.version).toEqual({ kind: "planB", give: [{ kind: "player", id: "101" }], get: [{ kind: "player", id: "204" }], chance: "30%", through: "about 15%" });
    expect(feedbackExportText(list, T3)).not.toContain(PLAN_B.key);
    // A version that isn't readable is left out; the record stays.
    const broken = { ...withVersion, version: "sideways", versionKey: 7, versionAccept: "x" };
    expect(parseFeedback(JSON.stringify([broken]))[0]).toMatchObject({ tradeKey: "a", outcome: { kind: "sent" } });
    expect(parseFeedback(JSON.stringify([broken]))[0]?.version).toBeUndefined();
    // A version without an outcome (hand-edited) is left out too.
    const { outcome: _o, ...noOutcome } = { ...(withVersion as FeedbackRecord), report: { reason: "other", at: T1 } };
    void _o;
    expect(parseFeedback(JSON.stringify([noOutcome]))[0]?.version).toBeUndefined();
  });
});

describe("the labels and model parts (§11)", () => {
  it("names every outcome and reason as the card does, and sends each reason to its part of the model", () => {
    expect(FEEDBACK_OUTCOMES.map((o) => OUTCOME_LABEL[o])).toEqual(["Sent", "Accepted", "Rejected", "Countered"]);
    expect(FEEDBACK_REASONS.map((r) => REASON_LABEL[r])).toEqual([
      "Doesn't help me",
      "They'd never accept",
      "Player info is wrong (injured, traded, wrong position)",
      "League settings look wrong",
      "Other",
    ]);
    expect(REASON_MODEL_PART).toEqual({ "doesnt-help": "benefit", "never-accept": "acceptance", "player-info": "adapters", settings: "adapters", other: "review" });
  });
});

describe("saving to and reading from the browser's storage", () => {
  it("round-trips presses through the storage, and removes the value when nothing is left", () => {
    const storage = new MemoryStorage();
    expect(saveFeedback(storage, { leagueKey: LEAGUE, evaluation: evaluation(), change: { outcome: "sent" }, at: T1 })).toEqual({ ok: true });
    expect(saveFeedback(storage, { leagueKey: LEAGUE, evaluation: evaluation(), change: { report: { reason: "doesnt-help" } }, at: T2 })).toEqual({ ok: true });
    const stored = parseFeedback(storage.getItem(FEEDBACK_STORAGE_KEY));
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ outcome: { kind: "sent", at: T1 }, report: { reason: "doesnt-help", at: T2 } });
    saveFeedback(storage, { leagueKey: LEAGUE, evaluation: evaluation(), change: { outcome: null }, at: T3 });
    saveFeedback(storage, { leagueKey: LEAGUE, evaluation: evaluation(), change: { report: null }, at: T3 });
    expect(storage.getItem(FEEDBACK_STORAGE_KEY)).toBeNull();
  });

  it("reads bad JSON or another shape as no feedback, and skips malformed records", () => {
    for (const raw of [undefined, null, "", "[", "{}", '"x"', "42", "null"]) expect(parseFeedback(raw), String(raw)).toEqual([]);
    const [good] = applyFeedback([], { leagueKey: LEAGUE, evaluation: evaluation(), change: { outcome: "sent" }, at: T1 });
    const bad = [
      null,
      { ...good, id: "" },
      { ...good, proposal: { partnerId: "2", give: [{ kind: "player" }], get: [] } },
      { ...good, numbers: "lots" },
      { ...good, features: null },
      { ...good, outcome: { kind: "maybe", at: T1 } },
      { ...good, report: { reason: "bored", at: T1 } },
      { ...good, outcome: undefined, report: undefined },
    ];
    expect(parseFeedback(JSON.stringify([...bad, good]))).toEqual([good]);
  });

  it("keeps only the later copy of a trade idea stored twice, at its own place", () => {
    const [a] = applyFeedback([], { leagueKey: LEAGUE, evaluation: evaluation("a"), change: { outcome: "sent" }, at: T1 });
    const [b] = applyFeedback([], { leagueKey: LEAGUE, evaluation: evaluation("b"), change: { outcome: "sent" }, at: T1 });
    const a2 = { ...a, outcome: { kind: "accepted", at: T2 } };
    expect(parseFeedback(JSON.stringify([a, b, a2]))).toEqual([b, a2]);
  });

  it("says a save failed when storage is blocked or full, and keeps what was there", () => {
    expect(saveFeedback(new BlockedStorage(), { leagueKey: LEAGUE, evaluation: evaluation(), change: { outcome: "sent" }, at: T1 })).toEqual({ ok: false, message: FEEDBACK_SAVE_FAILED });
    const full = new FullStorage();
    const before = JSON.stringify(applyFeedback([], { leagueKey: LEAGUE, evaluation: evaluation("old"), change: { outcome: "sent" }, at: T1 }));
    full.values.set(FEEDBACK_STORAGE_KEY, before);
    expect(saveFeedback(full, { leagueKey: LEAGUE, evaluation: evaluation(), change: { outcome: "sent" }, at: T2 })).toEqual({ ok: false, message: FEEDBACK_SAVE_FAILED });
    expect(full.getItem(FEEDBACK_STORAGE_KEY)).toBe(before);
  });

  it("deletes every record on request (and says so when storage is blocked)", () => {
    const storage = new MemoryStorage();
    saveFeedback(storage, { leagueKey: LEAGUE, evaluation: evaluation(), change: { outcome: "sent" }, at: T1 });
    expect(clearFeedback(storage)).toEqual({ ok: true });
    expect(storage.getItem(FEEDBACK_STORAGE_KEY)).toBeNull();
    expect(clearFeedback(new BlockedStorage())).toEqual({ ok: false, message: FEEDBACK_DELETE_FAILED });
  });
});

describe("the export file (version 3 since Checkpoint 7d: what the user saw and entered; planner reply to Checkpoint 7c, answer 1)", () => {
  /** One record made by a card's press (its printed numbers carried), one by a press that carried none (made before 7d). */
  const records = (() => {
    let list = applyFeedback([], { leagueKey: LEAGUE, evaluation: evaluation("a"), change: { outcome: "accepted", shown: SHOWN }, at: T1 });
    list = applyFeedback(list, { leagueKey: LEAGUE, evaluation: evaluation("b"), change: { report: { reason: "never-accept", note: "Team 2 never trades." } }, at: T2 });
    return list;
  })();
  const TRADE = evaluation().proposal;

  it("says what it is and when it was exported, and reads back to the same records", () => {
    const text = feedbackExportText(records, T3);
    const data = JSON.parse(text) as { kind: string; version: number; exportedAt: string; count: number };
    expect(FEEDBACK_EXPORT_VERSION).toBe(3);
    expect(data).toMatchObject({ kind: FEEDBACK_EXPORT_KIND, version: 3, exportedAt: T3, count: 2 });
    expect(parseFeedbackExport(text)).toEqual(feedbackExport(records, T3).records);
    // Anything else isn't one: no records, not JSON, a version this code doesn't know.
    expect(parseFeedbackExport("{}")).toBeNull();
    expect(parseFeedbackExport("not json")).toBeNull();
    expect(parseFeedbackExport(JSON.stringify({ ...data, version: 4 }))).toBeNull();
    expect(feedbackExport([], T3)).toEqual({ kind: FEEDBACK_EXPORT_KIND, version: 3, exportedAt: T3, count: 0, records: [] });
  });

  it("holds each record as what the user saw and entered: the league numbered, the trade, the card's numbers and lines as printed, the outcome, the report with its note, and the days the user acted", () => {
    const [a, b] = feedbackExport(records, T3).records;
    expect(a).toEqual({ league: "league-1", madeOn: "2026-10-01", trade: TRADE, shown: SHOWN, outcome: { kind: "accepted", on: "2026-10-01" } });
    // A record whose press carried no printed numbers (made before 7d): its three numbers as its card printed them (50, 42% →
    // "40%" and its label, 25), no lines.
    expect(b).toEqual({
      league: "league-1",
      madeOn: "2026-10-02",
      trade: TRADE,
      shown: { helps: "50", chance: "40%", label: "Decent", overall: "25" },
      report: { reason: "never-accept", note: "Team 2 never trades.", on: "2026-10-02" },
    });
    // The days of the presses, never their times (the file's own export time stays, as before).
    const text = feedbackExportText(records, T3);
    for (const at of [T1, T2]) expect(text).not.toContain(at);
    expect(JSON.stringify((JSON.parse(text) as { records: unknown }).records)).not.toMatch(/T\d\d:\d\d/);
    expect([dayOf(T1), dayOf("2026-10-01T23:59:59.999-05:00"), dayOf("whenever"), dayOf(undefined)]).toEqual(["2026-10-01", "2026-10-02", undefined, undefined]);
  });

  it("holds the days the Settings page names: the day the record was first marked or reported and those of its latest outcome and report, never an earlier outcome's (review of track cards, cards-4)", () => {
    // Report on Oct 1, Sent on Oct 2, Accepted on Oct 4: a record keeps only its latest outcome's time.
    const T4 = "2026-10-04T15:00:00.000Z";
    let list = applyFeedback([], { leagueKey: LEAGUE, evaluation: evaluation("a"), change: { report: { reason: "other", note: "x" }, shown: SHOWN }, at: T1 });
    list = applyFeedback(list, { leagueKey: LEAGUE, evaluation: evaluation("a"), change: { outcome: "sent" }, at: T2 });
    list = applyFeedback(list, { leagueKey: LEAGUE, evaluation: evaluation("a"), change: { outcome: "accepted" }, at: T4 });
    const [entry] = feedbackExport(list, T3).records;
    expect(entry).toMatchObject({ madeOn: "2026-10-01", outcome: { kind: "accepted", on: "2026-10-04" }, report: { reason: "other", note: "x", on: "2026-10-01" } });
    // The Sent press's day is in no field (the file's own export time is Oct 3).
    expect(dayOf(T2)).toBe("2026-10-02");
    expect(feedbackExportText(list, T3)).not.toContain("2026-10-02");
  });

  it("holds exactly these fields (an allowlist): never a model number, the basis, the version's inputs, a share id, a trade key or a record id", () => {
    const inputs = { features: { ...FEATURES, hist: 0.07 }, gPartner: -0.1, b: 4.2, goal: "title" as const, b3: 6, helpsReason: null };
    let list = applyFeedback([], {
      leagueKey: LEAGUE,
      evaluation: evaluation("a", { b3: 6.2 }),
      change: { outcome: "sent", sent: { version: "planB", key: "2|give:105|get:204", pAccept: 0.33, pComplete: 0.16, inputs }, rid: "AAAAAAAAAAAAAAAAAAAAAA", basis: { season: 2026, week: 5, goal: "title" }, shown: SHOWN },
      at: T1,
    });
    list = applyFeedback(list, { leagueKey: LEAGUE, evaluation: evaluation("a"), change: { report: { reason: "other", note: "Asked twice." } }, at: T2 });
    const record = list[0] as FeedbackRecord;
    // The record in this browser keeps everything (the anonymous copies are made from it: src/lib/feedbackShare.ts).
    for (const key of ["numbers", "features", "basis", "versionInputs", "versionAccept", "versionKey", "rid", "tradeKey", "id", "savedAt", "leagueKey"]) expect(record, key).toHaveProperty(key);
    const entry = feedbackExport(list, T3).records[0] as FeedbackExportEntry;
    expect(entry).toEqual({
      league: "league-1",
      madeOn: "2026-10-01",
      trade: TRADE,
      shown: SHOWN,
      outcome: { kind: "sent", on: "2026-10-01" },
      version: { kind: "planB", give: [{ kind: "player", id: "105" }], get: [{ kind: "player", id: "204" }], chance: "35%", through: "about 15%" },
      report: { reason: "other", note: "Asked twice.", on: "2026-10-02" },
    });
    // Every key in the file is one of these: the trade's (partnerId, give, get, kind, id), the printed numbers' and lines', the
    // outcome's, the version's, the report's and the days.
    expect(keysOf(entry)).toEqual(
      ["chance", "get", "give", "helps", "helpsThem", "id", "kind", "label", "league", "madeOn", "note", "odds", "on", "outcome", "overall", "partnerId", "reason", "report", "shown", "theirOdds", "through", "trade", "version", "weekly"].sort(),
    );
    const text = feedbackExportText(list, T3);
    for (const key of ["b", "b3", "pAccept", "pComplete", "numbers", "features", "g", "gMine", "gPartner", "hist", "z", "dPO", "dCH", "dPPW", "basis", "versionInputs", "versionAccept", "versionKey", "rid", "tradeKey", "savedAt", "leagueKey"]) {
      expect(text, key).not.toContain(`"${key}"`);
    }
    for (const secret of ["AAAAAAAAAAAAAAAAAAAAAA", "2|give:105|get:204", record.id, LEAGUE]) expect(text, secret).not.toContain(secret);
    // No record id at all (one made from the trade key and the first press's time would give that time back).
    expect(text).not.toMatch(/"fb-[0-9a-f]{8}"/);
  });

  it("no field can give a value ratio back: only printed texts and the trade leave, so two records whose model numbers differ but print the same export the same, byte for byte (planner reply to Checkpoint 7c, answer 1)", () => {
    // Real numbers: the acceptance model for a partner with no valued past trades, and B in a redraft league. Until 7d the file
    // kept the raw P_accept with the features (z less their terms gave the partner's perceived g back) and B with ΔPO, ΔCH and
    // the goal (B less B_win gave g_mkt(me) back to anyone who knows κ): Checkpoint 7c's test worked both routes.
    const league = { leagueType: "redraft" as const, tradeReview: "league_vote" as const };
    const partner = partnerProfile({ teamId: "2", transactions: [], week: 5, values: {}, W: 500, pPlayoffs: 0.7 });
    const accept = (gPerceived: number) => acceptance(league, partner, { gPartner: gPerceived + 0.04, gPerceived, deltaLineup: 3.1, h: 1, assets: 3, partnerReceives: [{ pos: "WR" }], hot: 0.15 });
    const kappa = protectValueWeight("high");
    const recordOf = (gPerceived: number, gMine: number, over: { dPO: number; dCH: number; b3: number; week: number }, shown?: FeedbackShown): FeedbackRecord => {
      const a = accept(gPerceived);
      const mine = { leagueType: "redraft" as const, dPO: over.dPO, dCH: over.dCH, gMine, dynasty: null, myPPlayoffs: 0.6, kappa, b3: over.b3, goal: "title" as const };
      const b = benefit(mine).b;
      const ev = evaluation("r", { features: a.features, pAccept: a.pAccept, pComplete: a.pComplete, b, dPO: over.dPO, dCH: over.dCH, gMine, gPartner: gPerceived + 0.04, b3: over.b3 });
      const sent = { version: "full" as const, key: "r", pAccept: a.pAccept, pComplete: a.pComplete, inputs: { features: a.features, gPartner: gPerceived + 0.04, b, goal: "title" as const } };
      const change = { outcome: "sent" as const, sent, basis: { season: 2026, week: over.week, goal: "title" as const }, ...(shown ? { shown } : {}) };
      return applyFeedback([], { leagueKey: LEAGUE, evaluation: ev, change, at: T1 })[0] as FeedbackRecord;
    };
    const one = recordOf(-0.13, 0.17, { dPO: 0.05, dCH: 0.021, b3: 4.94, week: 5 }, SHOWN);
    const two = recordOf(-0.12, -0.04, { dPO: 0.061, dCH: 0.017, b3: 5.31, week: 6 }, SHOWN);
    // The model's numbers differ: every value ratio and every number they'd be worked back from.
    expect(one.features.g).not.toBe(two.features.g);
    expect(one.numbers.pAccept).not.toBe(two.numbers.pAccept);
    expect(one.numbers.b).not.toBe(two.numbers.b);
    // What the cards printed is the same, so the files are too.
    expect(feedbackExportText([two], T3)).toBe(feedbackExportText([one], T3));
    // Records made before 7d (no printed numbers kept): the same, as long as their numbers print the same.
    const before = [recordOf(-0.13, 0.17, { dPO: 0.05, dCH: 0.021, b3: 4.94, week: 5 }), recordOf(-0.12, -0.04, { dPO: 0.061, dCH: 0.017, b3: 5.31, week: 6 })];
    const [oldOne, oldTwo] = before as [FeedbackRecord, FeedbackRecord];
    expect(exportedShownOf(oldOne)).toEqual(exportedShownOf(oldTwo)); // the prerequisite: they print alike
    expect(feedbackExportText([oldTwo], T3)).toBe(feedbackExportText([oldOne], T3));
    // The only numbers in the records are a pick's season and round (none here): every other is a printed text.
    for (const r of [one, oldOne]) {
      const file = JSON.parse(feedbackExportText([r], T3)) as { records: unknown[] };
      expect(numbersOf(file.records)).toEqual([]);
      for (const raw of [r.numbers.pAccept, r.numbers.b, r.numbers.dPO, r.numbers.dCH, r.numbers.b3, r.features.n, r.features.z]) expect(feedbackExportText([r], T3), String(raw)).not.toContain(String(raw));
    }
    const picked = { ...one, proposal: { ...one.proposal, get: [{ kind: "pick" as const, season: 2027, round: 1, originalTeamId: "2" }] } };
    expect(numbersOf((JSON.parse(feedbackExportText([picked], T3)) as { records: unknown[] }).records)).toEqual([2027, 1]);
  });

  it("prints a record made before Checkpoint 7d (no `shown`) as its card did: Helps you and Overall as scored, the chance with its label, the chance it goes through; no lines", () => {
    const shownOf = (over: Partial<FeedbackEvaluation>) => exportedShownOf(applyFeedback([], { leagueKey: LEAGUE, evaluation: evaluation("o", over), change: { outcome: "sent" }, at: T1 })[0] as FeedbackRecord);
    // A veto cuts the chance it goes through: said when it prints differently.
    expect(shownOf({ pAccept: 0.4, pComplete: 0.2 })).toEqual({ helps: "50", chance: "40%", label: acceptanceLabel(0.4), through: "about 20%", overall: "25" });
    // Under 5%: "<5%"; a trade that doesn't help me scores 0; one never scored "—".
    expect(shownOf({ pAccept: 0.03, pComplete: 0.03, tradeScore: null, overall: null, b: -0.4 })).toEqual({ helps: "0", chance: "<5%", label: "Long shot", overall: "0" });
    expect(shownOf({ tradeScore: null, overall: null, b: null })).toMatchObject({ helps: "—", overall: "—" });
    expect(shownOf({ pAccept: 0.08, pComplete: 0.04 })).toMatchObject({ chance: "10%", through: "under 5%" });
    // No chance kept at all: "—" and no label.
    const r = applyFeedback([], { leagueKey: LEAGUE, evaluation: evaluation("x"), change: { outcome: "sent" }, at: T1 })[0] as FeedbackRecord;
    expect(exportedShownOf({ ...r, numbers: { ...r.numbers, pAccept: null } })).toEqual({ helps: "50", chance: "—", overall: "25" });
    // A record with its card's printed numbers: those, whatever its own numbers say.
    expect(exportedShownOf({ ...r, shown: SHOWN })).toEqual(SHOWN);
  });

  it("says the version sent with its players and its chance as its line printed it; none without an outcome", () => {
    const sentAs = (key: string | undefined, pAccept: number | null, pComplete: number | null) =>
      exportedVersionOf({ outcome: { kind: "sent", at: T1 }, version: "offerFirst", ...(key ? { versionKey: key } : {}), versionAccept: { pAccept, pComplete } });
    expect(sentAs("2|give:101|get:202", 0.33, 0.33)).toEqual({ kind: "offerFirst", give: [{ kind: "player", id: "101" }], get: [{ kind: "player", id: "202" }], chance: "35%" });
    expect(sentAs("2|give:101,pick:2027:1:4|get:202", 0.03, 0.01)).toEqual({ kind: "offerFirst", give: [{ kind: "player", id: "101" }, { kind: "pick", season: 2027, round: 1, originalTeamId: "4" }], get: [{ kind: "player", id: "202" }], chance: "<5%" });
    expect(sentAs("2|give:101|get:202", 0.4, 0.04)).toMatchObject({ chance: "40%", through: "under 5%" });
    // No key (recorded before keys were kept), or one that isn't one: no players; no estimate: no chance.
    expect(sentAs(undefined, 0.33, 0.33)).toEqual({ kind: "offerFirst", chance: "35%" });
    expect(sentAs("not a key", null, null)).toEqual({ kind: "offerFirst" });
    expect(exportedVersionOf({ version: "planB", versionKey: "2|give:101|get:202" })).toBeUndefined();
    expect(proposalFromKey("2|give:101|get:202,203")).toEqual({ partnerId: "2", give: [{ kind: "player", id: "101" }], get: [{ kind: "player", id: "202" }, { kind: "player", id: "203" }] });
  });

  it("holds no league id or names: ids, the printed numbers and the user's own note", () => {
    const text = feedbackExportText(records, T3);
    expect(text).not.toMatch(/leagueId|teamName|ownerName|swid|espn_s2/i);
    expect(Object.keys(records[0] ?? {}).sort()).toEqual(["features", "id", "leagueKey", "numbers", "outcome", "proposal", "savedAt", "shown", "tradeKey"]);
  });

  it("numbers the leagues, so neither a league's key nor a record id made from it leaves the browser (both lead back to an ESPN league id)", () => {
    // Three trade ideas in two leagues: the second league first appears with the second record.
    let list = applyFeedback(records, { leagueKey: "sleeper:0badf00d", evaluation: evaluation("a"), change: { outcome: "sent" }, at: T3 });
    list = applyFeedback(list, { leagueKey: LEAGUE, evaluation: evaluation("c"), change: { outcome: "rejected" }, at: T3 });
    const before = JSON.stringify(list);
    const exported = feedbackExport(list, T3);
    expect(exported.records.map((r) => r.league)).toEqual(["league-1", "league-1", "league-2", "league-1"]);
    expect(exported.records.every((r) => r.league.startsWith(EXPORT_LEAGUE_PREFIX))).toBe(true);
    const text = feedbackExportText(list, T3);
    for (const r of list) {
      expect(text).not.toContain(r.leagueKey);
      expect(text).not.toContain(r.id);
    }
    // The stored records themselves are untouched, and the file reads back the same.
    expect(JSON.stringify(list)).toBe(before);
    expect(parseFeedbackExport(text)).toEqual(exported.records);
  });

  it("reads files of versions 1 and 2, and a bare list of records, as version 3 holds them", () => {
    const inputs = { features: FEATURES, gPartner: -0.1, b: 4.2, goal: "title" as const, b3: 6, helpsReason: null };
    let list = applyFeedback(records, { leagueKey: "sleeper:0badf00d", evaluation: evaluation("v"), change: { outcome: "countered", sent: { version: "full", key: "v", pAccept: 0.5, pComplete: 0.5, inputs } }, at: T3 });
    list = applyFeedback(list, { leagueKey: LEAGUE, evaluation: evaluation("w"), change: { outcome: "rejected" }, at: T3 });
    const want = feedbackExport(list, T3).records;
    // Version 1: every record as stored.
    expect(parseFeedbackExport(JSON.stringify({ kind: FEEDBACK_EXPORT_KIND, version: 1, exportedAt: T3, count: list.length, records: list }))).toEqual(want);
    // Version 2: the leagues numbered, ids made again, the value ratios' fields left out.
    const v2 = list.map((r, i) => {
      const copy = JSON.parse(JSON.stringify(r)) as Record<string, Record<string, unknown> | string>;
      for (const k of ["gMine", "gPartner"]) delete (copy.numbers as Record<string, unknown>)[k];
      for (const k of ["g", "hist", "z"]) delete (copy.features as Record<string, unknown>)[k];
      return { ...copy, leagueKey: r.leagueKey === LEAGUE ? "league-1" : "league-2", id: `fb-0000000${i}` };
    });
    expect(parseFeedbackExport(JSON.stringify({ kind: FEEDBACK_EXPORT_KIND, version: 2, exportedAt: T3, count: v2.length, records: v2 }))).toEqual(want);
    // A bare list (the stored value itself).
    expect(parseFeedbackExport(JSON.stringify(list))).toEqual(want);
  });

  it("checks a version-3 file's records field by field: a printed number in another form, an unknown outcome or a record with neither an outcome nor a report isn't kept", () => {
    const entry = feedbackExport(records, T3).records[0] as FeedbackExportEntry;
    const file = (rs: unknown[]) => JSON.stringify({ kind: FEEDBACK_EXPORT_KIND, version: 3, exportedAt: T3, count: rs.length, records: rs });
    expect(parseFeedbackExport(file([entry]))).toEqual([entry]);
    const bad: unknown[] = [
      null,
      { ...entry, league: "espn:1a2b3c4d" },
      { ...entry, trade: { partnerId: "2", give: [{ kind: "player" }], get: [] } },
      { ...entry, shown: { ...entry.shown, helps: "0.4237" } },
      { ...entry, shown: { ...entry.shown, chance: 0.42 } },
      { ...entry, outcome: { kind: "maybe" } },
    ];
    expect(parseFeedbackExport(file([...bad, entry]))).toEqual([entry]);
    // Parts that aren't in their form are left out; the record stays.
    const odd = { ...entry, madeOn: T1, outcome: { kind: "accepted", on: "yesterday" }, version: { kind: "planB", chance: 0.35, through: "about 0.2", give: [{ kind: "player", id: "105" }] }, extra: 1 };
    expect(parseFeedbackExportEntry(odd)).toEqual({ league: "league-1", trade: TRADE, shown: SHOWN, outcome: { kind: "accepted" }, version: { kind: "planB" } });
    // A note is cut as a record's is.
    const long = { ...entry, report: { reason: "other", note: `  ${"x".repeat(FEEDBACK_NOTE_MAX + 9)} ` } };
    expect(parseFeedbackExportEntry(long)?.report?.note).toHaveLength(FEEDBACK_NOTE_MAX);
  });

  it("is named by the export's date, with no characters Windows refuses", () => {
    expect(feedbackExportFileName(T3)).toBe("offersheet-feedback-2026-10-03.json");
    expect(feedbackExportFileName("whenever")).toBe("offersheet-feedback-export.json");
    expect(feedbackExportFileName(T3)).not.toMatch(/[<>:"/\\|?*]/);
  });
});

describe("what the card printed (Checkpoint 7d; planner reply to Checkpoint 7c, answer 1)", () => {
  it("keeps the press's printed numbers on a new record (its first press's, like its numbers), and reads them back from storage", () => {
    let list = applyFeedback([], { leagueKey: LEAGUE, evaluation: evaluation(), change: { outcome: "sent", shown: SHOWN }, at: T1 });
    expect(list[0]?.shown).toEqual(SHOWN);
    // A later press, from a card that prints otherwise now, changes nothing.
    list = applyFeedback(list, { leagueKey: LEAGUE, evaluation: evaluation(), change: { outcome: "accepted", shown: { ...SHOWN, helps: "61" } }, at: T2 });
    expect(list[0]?.shown?.helps).toBe("50");
    expect(parseFeedback(JSON.stringify(list))).toEqual(list);
    // A record made without them doesn't get them from a later press (its numbers are its first press's).
    let old = applyFeedback([], { leagueKey: LEAGUE, evaluation: evaluation("b"), change: { outcome: "sent" }, at: T1 });
    old = applyFeedback(old, { leagueKey: LEAGUE, evaluation: evaluation("b"), change: { report: { reason: "other" }, shown: SHOWN }, at: T2 });
    expect(old[0]).not.toHaveProperty("shown");
  });

  it("keeps only texts in the card's printed forms: a raw number never rides in them", () => {
    expect(parseFeedbackShown(SHOWN)).toEqual(SHOWN);
    expect(parseFeedbackShown({ helps: "—", chance: "<5%", overall: "0" })).toEqual({ helps: "—", chance: "<5%", overall: "0" });
    // Helps you, the chance or Overall not as printed: nothing kept.
    for (const bad of [{ ...SHOWN, helps: "0.42" }, { ...SHOWN, helps: 50 }, { ...SHOWN, chance: "0.4237" }, { ...SHOWN, chance: "42.37%" }, { ...SHOWN, overall: "1234" }, null, "50 · 40% · 25"]) {
      expect(parseFeedbackShown(bad), JSON.stringify(bad)).toBeUndefined();
    }
    // Any other part not as printed is left out, the rest kept (Helps them and their odds together).
    const odd = {
      ...SHOWN,
      label: "Maybe",
      through: "about 0.2",
      odds: ["Title odds 0.121 → 0.134"],
      weekly: "Win chance by week: Week 9: 0.68 → 0.64",
      theirOdds: ["Their title odds 6.0% → 6.9%", "Their gMine -0.08"],
      extra: "-0.0813",
    };
    expect(parseFeedbackShown(odd)).toEqual({ helps: "50", chance: "40%", overall: "25" });
    expect(parseFeedbackShown({ ...SHOWN, theirOdds: undefined })).not.toHaveProperty("helpsThem");
    expect(parseFeedbackShown({ ...SHOWN, odds: [...(SHOWN.odds ?? []), "Title odds 1% → 2%"] })).not.toHaveProperty("odds");
    // Every form a card prints.
    for (const line of ["Title odds <0.1% → >99.9%", "Top 2 odds 18% → 20%", "Playoff odds +4.1 percentage points", "Title odds −1 percentage point", "Playoff odds no change", "Title odds unknown", "Playoff odds <1% → >99%"]) {
      expect(parseFeedbackShown({ ...SHOWN, odds: [line] })?.odds, line).toEqual([line]);
    }
    for (const chance of ["0%", "85%", "<5%"]) expect(parseFeedbackShown({ ...SHOWN, chance })?.chance).toBe(chance);
    expect(config.acceptance.labels.map((l) => parseFeedbackShown({ ...SHOWN, label: l.label })?.label)).toEqual(config.acceptance.labels.map((l) => l.label));
  });
});

describe("the sent version's model inputs (planner reply to Checkpoint 4b, change 7)", () => {
  const INPUTS = { features: FEATURES, gPartner: -0.1, b: 4.2, goal: "title" as const };
  /**
   * INPUTS as a record keeps them: Phase 7a's B₃, the scale's reason and the week are null when the press didn't carry them
   * (a press without a basis).
   */
  const STORED = { ...INPUTS, b3: null, helpsReason: null, week: null };
  const sent = (version: "offerFirst" | "full" | "planB", inputs?: unknown) => ({ version, key: `${version}-key`, pAccept: 0.3, pComplete: 0.3, ...(inputs !== undefined ? { inputs: inputs as typeof INPUTS } : {}) });

  it("keeps them with the version sent, and they follow it: a later version without inputs drops them, clearing the outcome clears them", () => {
    let list = applyFeedback([], { leagueKey: LEAGUE, evaluation: evaluation(), change: { outcome: "sent", sent: sent("offerFirst", INPUTS) }, at: T1 });
    expect(list[0]?.versionInputs).toEqual(STORED);
    // A later outcome without a version keeps them (the same sending).
    list = applyFeedback(list, { leagueKey: LEAGUE, evaluation: evaluation(), change: { outcome: "accepted" }, at: T2 });
    expect(list[0]?.versionInputs).toEqual(STORED);
    // Another version named without inputs: the earlier version's never stay with it.
    list = applyFeedback(list, { leagueKey: LEAGUE, evaluation: evaluation(), change: { outcome: "countered", sent: sent("planB") }, at: T2 });
    expect(list[0]).toMatchObject({ version: "planB" });
    expect(list[0]?.versionInputs).toBeUndefined();
    list = applyFeedback(list, { leagueKey: LEAGUE, evaluation: evaluation(), change: { outcome: "sent", sent: sent("full", INPUTS) }, at: T3 });
    list = applyFeedback(list, { leagueKey: LEAGUE, evaluation: evaluation(), change: { report: { reason: "other" } }, at: T3 });
    list = applyFeedback(list, { leagueKey: LEAGUE, evaluation: evaluation(), change: { outcome: null }, at: T3 });
    expect(list[0]?.versionInputs).toBeUndefined();
  });

  it("keeps only the known fields, numbers that weren't finite and goals that aren't one as null", () => {
    const odd = { features: { ...FEATURES, z: Number.NaN, extra: 1 }, gPartner: Number.POSITIVE_INFINITY, b: "4", goal: "fun", junk: true };
    const [r] = applyFeedback([], { leagueKey: LEAGUE, evaluation: evaluation(), change: { outcome: "sent", sent: sent("full", odd) }, at: T1 });
    expect(r?.versionInputs).toEqual({ features: { ...FEATURES, z: null }, gPartner: null, b: null, goal: null, b3: null, helpsReason: null, week: null });
    const [noFeatures] = applyFeedback([], { leagueKey: LEAGUE, evaluation: evaluation(), change: { outcome: "sent", sent: sent("full", { b: 1, goal: "playoffs" }) }, at: T1 });
    expect(noFeatures?.versionInputs).toEqual({ features: null, gPartner: null, b: 1, goal: "playoffs", b3: null, helpsReason: null, week: null });
  });

  it("round-trips through the storage; the export holds none of them; one that isn't an object, or without a version, is left out", () => {
    const [r] = applyFeedback([], { leagueKey: LEAGUE, evaluation: evaluation(), change: { outcome: "sent", sent: sent("full", INPUTS) }, at: T1 });
    expect(parseFeedback(JSON.stringify([r]))).toEqual([r]);
    // Checkpoint 7d (planner reply to Checkpoint 7c, answer 1): the export holds the version sent, never its model inputs.
    const exported = parseFeedbackExport(feedbackExportText([r as FeedbackRecord], T3))?.[0];
    expect(exported?.version).toEqual({ kind: "full", chance: "30%" });
    expect(exported).not.toHaveProperty("versionInputs");
    expect(parseFeedback(JSON.stringify([{ ...r, versionInputs: "lots" }]))[0]?.versionInputs).toBeUndefined();
    const { version: _v, ...noVersion } = r as FeedbackRecord;
    void _v;
    expect(parseFeedback(JSON.stringify([noVersion]))[0]?.versionInputs).toBeUndefined();
  });
});

describe("the pieces the league store uses (Phase 4c: one list per league in IndexedDB)", () => {
  const at = (key: string, when: string) => applyFeedback([], { leagueKey: LEAGUE, evaluation: evaluation(key), change: { outcome: "sent" }, at: when })[0] as FeedbackRecord;

  it("reads a stored list already parsed as parseFeedback reads its text", () => {
    const list = [at("a", T1), at("b", T2)];
    for (const data of [list, [null, ...list], [...list, list[0]], {}, "x", null]) expect(feedbackRecordsFrom(data), JSON.stringify(data)).toEqual(parseFeedback(JSON.stringify(data)));
    expect(feedbackRecordsFrom(Array.from({ length: FEEDBACK_MAX_RECORDS + 3 }, (_, i) => at(`t${i}`, T1)))).toHaveLength(FEEDBACK_MAX_RECORDS);
  });

  it("knows when a record was last pressed (made, outcome, report)", () => {
    let list = [at("a", T1)];
    expect(feedbackTouchedAt(list[0] as FeedbackRecord)).toBe(Date.parse(T1));
    list = applyFeedback(list, { leagueKey: LEAGUE, evaluation: evaluation("a"), change: { report: { reason: "other" } }, at: T3 });
    expect(feedbackTouchedAt(list[0] as FeedbackRecord)).toBe(Date.parse(T3));
    expect(feedbackTouchedAt({ ...(list[0] as FeedbackRecord), savedAt: "?", outcome: { kind: "sent", at: "?" }, report: { reason: "other", at: "?" } })).toBe(0);
  });

  it("merges the localStorage list into a stored one: one record per trade idea, the later-pressed copy in its place, the added ones first", () => {
    const stored = [at("a", T2), at("b", T2)];
    const newerA = applyFeedback([at("a", T1)], { leagueKey: LEAGUE, evaluation: evaluation("a"), change: { outcome: "rejected" }, at: T3 })[0] as FeedbackRecord;
    const merged = mergeFeedbackRecords(stored, [at("c", T1), newerA, at("b", T1)]);
    expect(merged.map((r) => `${r.tradeKey}/${r.outcome?.kind}`)).toEqual(["c/sent", "a/rejected", "b/sent"]);
    expect(merged[2]).toBe(stored[1]); // the stored copy wins a tie or a later press
    expect(mergeFeedbackRecords([], [at("x", T1), at("x", T2)]).map((r) => r.outcome?.at)).toEqual([T2]);
    // Other leagues' records stay apart (one per league AND trade idea).
    const other = { ...at("a", T1), leagueKey: "sleeper:00000001" };
    expect(mergeFeedbackRecords(stored, [other])).toHaveLength(3);
    expect(mergeFeedbackRecords([], Array.from({ length: FEEDBACK_MAX_RECORDS + 2 }, (_, i) => at(`t${i}`, T1)))[0]?.tradeKey).toBe("t2");
  });
});

describe("Phase 7a (track FB): the scale B₃ and the record's share id", () => {
  // Share ids: 16 bytes' worth (the last character A, Q, g or w: review FB-R4).
  const RID = "AAAAAAAAAAAAAAAAAAAAAA";
  const OTHER_RID = "BBBBBBBBBBBBBBBBBBBBBQ";

  it("keeps the card's B₃ with its numbers, null when the evaluation has none or it isn't a number", () => {
    const [r] = applyFeedback([], { leagueKey: LEAGUE, evaluation: evaluation(undefined, { b3: 6.2 }), change: { outcome: "sent" }, at: T1 });
    expect(r?.numbers.b3).toBe(6.2);
    const [nan] = applyFeedback([], { leagueKey: LEAGUE, evaluation: evaluation(undefined, { b3: Number.NaN }), change: { outcome: "sent" }, at: T1 });
    expect(nan?.numbers.b3).toBeNull();
    // A record stored before 7a reads its B₃ as unknown.
    const { b3: _b3, ...oldNumbers } = (r as FeedbackRecord).numbers;
    void _b3;
    expect(parseFeedback(JSON.stringify([{ ...r, numbers: oldNumbers }]))[0]?.numbers.b3).toBeNull();
  });

  it("keeps the sent version's B₃ and the scale's reason; a B₃ not above 0 or a reason that isn't one reads null", () => {
    const sent = (inputs: unknown) => ({ version: "full" as const, key: "k", pAccept: 0.3, pComplete: 0.3, inputs: inputs as never });
    const inputs = { features: FEATURES, gPartner: -0.1, b: 4.2, goal: "title" as const, b3: 0.5, helpsReason: "odds" as const };
    const [r] = applyFeedback([], { leagueKey: LEAGUE, evaluation: evaluation(), change: { outcome: "sent", sent: sent(inputs) }, at: T1 });
    expect(r?.versionInputs).toEqual({ ...inputs, week: null });
    expect(parseFeedback(JSON.stringify([r]))[0]?.versionInputs).toEqual({ ...inputs, week: null });
    for (const [b3, helpsReason] of [
      [0, "floor"],
      [-1, null],
      ["6", 7],
    ] as const) {
      const [odd] = applyFeedback([], { leagueKey: LEAGUE, evaluation: evaluation(), change: { outcome: "sent", sent: sent({ ...inputs, b3, helpsReason }) }, at: T1 });
      expect(odd?.versionInputs).toMatchObject({ b3: null, helpsReason: null });
    }
    const [lambda] = applyFeedback([], { leagueKey: LEAGUE, evaluation: evaluation(), change: { outcome: "sent", sent: sent({ ...inputs, helpsReason: "lambda" }) }, at: T1 });
    expect(lambda?.versionInputs?.helpsReason).toBe("lambda");
  });

  it("a new record takes the press's share id; a record keeps the first it gets; one made before 7a gets one on its next press", () => {
    let list = applyFeedback([], { leagueKey: LEAGUE, evaluation: evaluation(), change: { outcome: "sent", rid: RID }, at: T1 });
    expect(list[0]?.rid).toBe(RID);
    list = applyFeedback(list, { leagueKey: LEAGUE, evaluation: evaluation(), change: { outcome: "accepted", rid: OTHER_RID }, at: T2 });
    expect(list[0]?.rid).toBe(RID);
    // Without one (a caller that passes none, or a record from before 7a), and then a press that carries one.
    let old = applyFeedback([], { leagueKey: LEAGUE, evaluation: evaluation("b"), change: { outcome: "sent" }, at: T1 });
    expect(old[0]).not.toHaveProperty("rid");
    old = applyFeedback(old, { leagueKey: LEAGUE, evaluation: evaluation("b"), change: { report: { reason: "other" }, rid: OTHER_RID }, at: T2 });
    expect(old[0]?.rid).toBe(OTHER_RID);
    // Something that isn't a share id is never taken (22 characters that can't end 16 bytes included).
    for (const rid of ["short", `${RID}x`, "AAAAAAAAAAAAAAAAAAAA+/", "", "BBBBBBBBBBBBBBBBBBBBBB"]) {
      expect(applyFeedback([], { leagueKey: LEAGUE, evaluation: evaluation(), change: { outcome: "sent", rid }, at: T1 })[0]).not.toHaveProperty("rid");
    }
    // Clearing what isn't there makes nothing, share id or not.
    expect(applyFeedback([], { leagueKey: LEAGUE, evaluation: evaluation(), change: { outcome: null, rid: RID }, at: T1 })).toEqual([]);
  });

  it("keeps the numbers' basis from the press that made the record, and the week of the press that recorded a version (review FB-R6)", () => {
    const week5 = { season: 2026, week: 5, goal: "title" as const };
    const week6 = { season: 2026, week: 6, goal: "balanced" as const };
    const inputs = { features: FEATURES, gPartner: -0.1, b: 4.2, goal: "balanced" as const, b3: 6, helpsReason: null };
    let list = applyFeedback([], { leagueKey: LEAGUE, evaluation: evaluation(), change: { report: { reason: "never-accept" }, rid: RID, basis: week5 }, at: T1 });
    expect(list[0]?.basis).toEqual(week5);
    list = applyFeedback(list, { leagueKey: LEAGUE, evaluation: evaluation(), change: { outcome: "sent", sent: { version: "full", key: "k", pAccept: 0.3, pComplete: 0.3, inputs }, rid: RID, basis: week6 }, at: T2 });
    // The record's numbers are still its first press's; the version's inputs are this press's.
    expect(list[0]?.basis).toEqual(week5);
    expect(list[0]?.versionInputs).toEqual({ ...inputs, week: 6 });
    // A later outcome naming no version keeps the version's inputs and their week.
    list = applyFeedback(list, { leagueKey: LEAGUE, evaluation: evaluation(), change: { outcome: "accepted", rid: RID, basis: { ...week6, week: 7 } }, at: T3 });
    expect(list[0]?.versionInputs?.week).toBe(6);
    // Storage reads it back (the export holds no basis since Checkpoint 7d: its numbers are the card's printed ones); a basis
    // that isn't one is left out (season, week), a goal that isn't one reads null.
    expect(parseFeedback(JSON.stringify(list))[0]?.basis).toEqual(week5);
    expect(parseFeedbackExport(feedbackExportText(list, T3))?.[0]).not.toHaveProperty("basis");
    for (const bad of [{ ...week5, season: 1999 }, { ...week5, week: 2.5 }, { ...week5, week: 31 }, "week 5", null]) {
      expect(parseFeedback(JSON.stringify([{ ...list[0], basis: bad }]))[0]).not.toHaveProperty("basis");
    }
    expect(parseFeedback(JSON.stringify([{ ...list[0], basis: { ...week5, goal: "fun" } }]))[0]?.basis).toEqual({ ...week5, goal: null });
    // A record made before (or by a press without one) has none, and a later press doesn't give it one: its numbers'
    // week is unknown.
    let old = applyFeedback([], { leagueKey: LEAGUE, evaluation: evaluation("b"), change: { outcome: "sent", rid: RID }, at: T1 });
    old = applyFeedback(old, { leagueKey: LEAGUE, evaluation: evaluation("b"), change: { report: { reason: "other" }, rid: RID, basis: week6 }, at: T2 });
    expect(old[0]).not.toHaveProperty("basis");
  });

  it("reads the share id back from storage, leaves out one that isn't one, and never exports it", () => {
    const [r] = applyFeedback([], { leagueKey: LEAGUE, evaluation: evaluation(), change: { outcome: "sent", rid: RID }, at: T1 });
    expect(parseFeedback(JSON.stringify([r]))[0]?.rid).toBe(RID);
    // Checkpoint 7d (planner reply to Checkpoint 7c, answer 1): the export holds what the user saw and entered, never the
    // share id (version 2 kept it).
    expect(feedbackExport([r as FeedbackRecord], T3).records[0]).not.toHaveProperty("rid");
    expect(feedbackExportText([r as FeedbackRecord], T3)).not.toContain(RID);
    expect(parseFeedback(JSON.stringify([{ ...r, rid: "x" }]))[0]).not.toHaveProperty("rid");
    expect(parseFeedback(JSON.stringify([{ ...r, rid: 42 }]))[0]).not.toHaveProperty("rid");
  });
});

describe("Checkpoint 7c: the prize split under “Several prizes” (planner reply to Checkpoint 7b, §6)", () => {
  /** Parker's $2,000 / $1,600 / $900 as a record keeps them: whole percents of the season's prizes. */
  const SPLIT = { first: 44, second: 36, third: 20, weeklyHigh: 0, pointsLeader: 0 };
  const basis = { season: 2026, week: 5, goal: "prizes" as const, prizes: SPLIT };
  const inputs = { features: FEATURES, gPartner: -0.1, b: 4.2, goal: "prizes" as const, b3: 6, helpsReason: null };

  it("isFeedbackPrizes: exactly the five prizes, each a whole percent from 0 to 100, adding up to 100", () => {
    for (const ok of [SPLIT, { first: 100, second: 0, third: 0, weeklyHigh: 0, pointsLeader: 0 }, { first: 20, second: 20, third: 20, weeklyHigh: 20, pointsLeader: 20 }]) expect(isFeedbackPrizes(ok), JSON.stringify(ok)).toBe(true);
    const bad: unknown[] = [
      null,
      "44/36/20",
      [44, 36, 20, 0, 0],
      { first: 2000, second: 1600, third: 900, weeklyHigh: 0, pointsLeader: 0 },
      { ...SPLIT, first: 44.4, second: 35.6 },
      { ...SPLIT, third: 19 },
      { ...SPLIT, first: 64, weeklyHigh: -20 },
      { ...SPLIT, pointsLeader: "0" },
      { first: 44, second: 36, third: 20, weeklyHigh: 0 },
      { ...SPLIT, amount: 4500 },
    ];
    for (const x of bad) expect(isFeedbackPrizes(x), JSON.stringify(x)).toBe(false);
  });

  it("recordReward: a goal with its split, “Several prizes” without one unknown, a split with another goal dropped, an older version's “balanced” kept", () => {
    expect(recordReward("prizes", SPLIT)).toEqual({ goal: "prizes", prizes: SPLIT });
    expect(recordReward("prizes", undefined)).toEqual({ goal: null });
    expect(recordReward("prizes", { ...SPLIT, first: 2000 })).toEqual({ goal: null });
    expect(recordReward("title", SPLIT)).toEqual({ goal: "title" });
    expect(recordReward("balanced", undefined)).toEqual({ goal: "balanced" });
    expect(recordReward("fun", SPLIT)).toEqual({ goal: null });
    // The split comes back in one key order, whatever order it was stored in.
    expect(Object.keys(recordReward("prizes", { pointsLeader: 0, weeklyHigh: 0, third: 20, second: 36, first: 44 }).prizes ?? {})).toEqual(["first", "second", "third", "weeklyHigh", "pointsLeader"]);
  });

  it("keeps the split with the basis and the sent version's inputs (the press's when the card gives none), through storage; the export holds neither", () => {
    let list = applyFeedback([], { leagueKey: LEAGUE, evaluation: evaluation(), change: { outcome: "sent", sent: { version: "full", key: "k", pAccept: 0.3, pComplete: 0.3, inputs }, basis }, at: T1 });
    const r = list[0] as FeedbackRecord;
    expect(r.basis).toEqual(basis);
    expect(r.versionInputs).toEqual({ ...inputs, prizes: SPLIT, week: 5 });
    // A version whose inputs carry their own split keeps it (an earlier search's, say), whatever the press's basis says.
    const own = { first: 60, second: 30, third: 10, weeklyHigh: 0, pointsLeader: 0 };
    list = applyFeedback(list, { leagueKey: LEAGUE, evaluation: evaluation(), change: { outcome: "accepted", sent: { version: "planB", key: "p", pAccept: 0.2, pComplete: 0.2, inputs: { ...inputs, prizes: own } }, basis }, at: T2 });
    expect(list[0]?.versionInputs?.prizes).toEqual(own);
    // Inputs naming "Several prizes" under a press whose basis doesn't: no split to give them, so their goal is unknown.
    const [titled] = applyFeedback([], { leagueKey: LEAGUE, evaluation: evaluation(), change: { outcome: "sent", sent: { version: "full", key: "k", pAccept: 0.3, pComplete: 0.3, inputs }, basis: { season: 2026, week: 5, goal: "title" } }, at: T1 });
    expect(titled?.versionInputs).toMatchObject({ goal: null });
    expect(titled?.versionInputs).not.toHaveProperty("prizes");
    // Storage reads the split back. The export holds neither the basis nor the version's inputs since Checkpoint 7d (what the
    // user saw and entered: planner reply to Checkpoint 7c, answer 1), so no split either.
    expect(parseFeedback(JSON.stringify([r]))).toEqual([r]);
    const exported = feedbackExport([r], T3).records[0];
    expect(exported).not.toHaveProperty("basis");
    expect(exported).not.toHaveProperty("versionInputs");
    expect(feedbackExportText([r], T3)).not.toMatch(/"(?:prizes|first|second|third)"/);
    // A stored split that isn't one makes the goal unknown, and a split under another goal is dropped.
    expect(parseFeedback(JSON.stringify([{ ...r, basis: { ...basis, prizes: { ...SPLIT, first: 2000 } } }]))[0]?.basis).toEqual({ season: 2026, week: 5, goal: null });
    expect(parseFeedback(JSON.stringify([{ ...r, basis: { ...basis, goal: "title" } }]))[0]?.basis).toEqual({ season: 2026, week: 5, goal: "title" });
  });
});
