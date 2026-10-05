/**
 * Trade feedback kept in the browser (CLAUDE.md §11 "Feedback on every suggestion", Phase 4: local only; lead
 * decision L12): one record per trade idea with the card's numbers from the first press, outcomes and reports
 * set and cleared, the newest 500 kept, tolerance of whatever the storage holds, a blocked or full storage,
 * and the export file. A Map stands in for localStorage (Vitest runs in Node); every id is made up.
 */
import { describe, expect, it } from "vitest";
import type { AcceptanceFeatures } from "@/engine/tradeModel";
import type { StorageLike } from "./importStore";
import {
  FEEDBACK_DELETE_FAILED,
  FEEDBACK_EXPORT_KIND,
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
  feedbackExport,
  feedbackExportFileName,
  feedbackExportText,
  feedbackFor,
  feedbackRecordsFrom,
  feedbackTouchedAt,
  mergeFeedbackRecords,
  parseFeedback,
  parseFeedbackExport,
  saveFeedback,
  type FeedbackEvaluation,
  type FeedbackRecord,
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
    expect(exported.map((r) => r.version ?? "unknown")).toEqual(["planB", "unknown"]);
    expect(exported[0]?.versionKey).toBe(PLAN_B.key);
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

describe("the export file", () => {
  const records = (() => {
    let list = applyFeedback([], { leagueKey: LEAGUE, evaluation: evaluation("a"), change: { outcome: "accepted" }, at: T1 });
    list = applyFeedback(list, { leagueKey: LEAGUE, evaluation: evaluation("b"), change: { report: { reason: "never-accept", note: "Team 2 never trades." } }, at: T2 });
    return list;
  })();

  it("says what it is and when it was exported, and reads back to the same records, the league numbered", () => {
    const text = feedbackExportText(records, T3);
    const data = JSON.parse(text) as { kind: string; version: number; exportedAt: string; count: number };
    expect(data).toMatchObject({ kind: FEEDBACK_EXPORT_KIND, version: 1, exportedAt: T3, count: 2 });
    expect(parseFeedbackExport(text)).toEqual(records.map((r) => ({ ...r, leagueKey: "league-1", id: expect.stringMatching(/^fb-[0-9a-f]{8}$/) })));
    // A bare list (the stored value itself) reads too; anything else doesn't.
    expect(parseFeedbackExport(JSON.stringify(records))).toEqual(records);
    expect(parseFeedbackExport("{}")).toBeNull();
    expect(parseFeedbackExport("not json")).toBeNull();
  });

  it("holds no league id or names: ids, numbers, features and the user's own note", () => {
    const text = feedbackExportText(records, T3);
    expect(text).not.toMatch(/leagueId|teamName|ownerName|swid|espn_s2/i);
    expect(Object.keys(records[0] ?? {}).sort()).toEqual(["features", "id", "leagueKey", "numbers", "outcome", "proposal", "savedAt", "tradeKey"]);
  });

  it("numbers the leagues, so neither a league's key nor a record id made from it leaves the browser (both lead back to an ESPN league id)", () => {
    // Three trade ideas in two leagues: the second league first appears with the second record.
    let list = applyFeedback(records, { leagueKey: "sleeper:0badf00d", evaluation: evaluation("a"), change: { outcome: "sent" }, at: T3 });
    list = applyFeedback(list, { leagueKey: LEAGUE, evaluation: evaluation("c"), change: { outcome: "rejected" }, at: T3 });
    const before = JSON.stringify(list);
    const exported = feedbackExport(list, T3);
    expect(exported.records.map((r) => `${r.leagueKey}/${r.tradeKey}`)).toEqual(["league-1/a", "league-1/b", "league-2/a", "league-1/c"]);
    const text = feedbackExportText(list, T3);
    for (const r of list) {
      expect(text).not.toContain(r.leagueKey);
      expect(text).not.toContain(r.id);
    }
    // Ids stay one per trade idea, in the stored records' format; the stored records themselves are untouched.
    const ids = exported.records.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^fb-[0-9a-f]{8}$/);
    expect(JSON.stringify(list)).toBe(before);
    // Everything else is as stored, and it reads back the same.
    const rest = (r: FeedbackRecord) => ({ ...r, id: "", leagueKey: "" });
    expect(exported.records.map(rest)).toEqual(list.map(rest));
    expect(parseFeedbackExport(text)).toEqual(exported.records);
    expect(feedbackExport([], T3)).toEqual({ kind: FEEDBACK_EXPORT_KIND, version: 1, exportedAt: T3, count: 0, records: [] });
  });

  it("is named by the export's date, with no characters Windows refuses", () => {
    expect(feedbackExportFileName(T3)).toBe("offersheet-feedback-2026-10-03.json");
    expect(feedbackExportFileName("whenever")).toBe("offersheet-feedback-export.json");
    expect(feedbackExportFileName(T3)).not.toMatch(/[<>:"/\\|?*]/);
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

  it("round-trips through the storage and the export; one that isn't an object, or without a version, is left out", () => {
    const [r] = applyFeedback([], { leagueKey: LEAGUE, evaluation: evaluation(), change: { outcome: "sent", sent: sent("full", INPUTS) }, at: T1 });
    expect(parseFeedback(JSON.stringify([r]))).toEqual([r]);
    expect(parseFeedbackExport(feedbackExportText([r as FeedbackRecord], T3))?.[0]?.versionInputs).toEqual(STORED);
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
    // Storage and the export read it back; a basis that isn't one is left out (season, week), a goal that isn't one reads null.
    expect(parseFeedback(JSON.stringify(list))[0]?.basis).toEqual(week5);
    expect(parseFeedbackExport(feedbackExportText(list, T3))?.[0]?.basis).toEqual(week5);
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

  it("reads the share id back (storage and export alike), and leaves out one that isn't one", () => {
    const [r] = applyFeedback([], { leagueKey: LEAGUE, evaluation: evaluation(), change: { outcome: "sent", rid: RID }, at: T1 });
    expect(parseFeedback(JSON.stringify([r]))[0]?.rid).toBe(RID);
    // The export renumbers leagues and record ids, and keeps the random share id (it identifies nothing).
    expect(feedbackExport([r as FeedbackRecord], T3).records[0]?.rid).toBe(RID);
    expect(parseFeedbackExport(feedbackExportText([r as FeedbackRecord], T3))?.[0]?.rid).toBe(RID);
    expect(parseFeedback(JSON.stringify([{ ...r, rid: "x" }]))[0]).not.toHaveProperty("rid");
    expect(parseFeedback(JSON.stringify([{ ...r, rid: 42 }]))[0]).not.toHaveProperty("rid");
  });
});
