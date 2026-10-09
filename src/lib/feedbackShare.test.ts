/**
 * Anonymous feedback, the browser's half (planner reply to Checkpoint 4c, Part B, B2; Checkpoint 7a, track FB): the copy
 * a record makes (every field the privacy page lists, nothing it says is never sent), the league's format, the share id,
 * "Share anonymous feedback" and the one-time note in a stand-in localStorage, and the sender's debounce with fake timers
 * and posts. The fictional league of the trade pages' fixtures (every name made up); no network.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { tradeSnapshot } from "@/components/trades/testFixtures";
import type { LeagueSettings, LeagueSnapshot } from "@/engine/model";
import { TITLE_ONLY, prizePeriods, rewardWith } from "@/engine/reward";
import type { AcceptanceFeatures } from "@/engine/tradeModel";
import { FEEDBACK_EVENT_MAX_PER_SIDE, FEEDBACK_PLAYER_ID } from "./feedbackEvent";
import {
  DEFAULT_SHARE_PREFS,
  FEEDBACK_SHARE_DEBOUNCE_MS,
  FEEDBACK_SHARE_KEY,
  FeedbackSender,
  SHARE_NOTE_TEXT,
  SHARE_SAVE_FAILED,
  feedbackBasisOf,
  feedbackEventOf,
  feedbackFormatOf,
  feedbackRewardOf,
  feedbackShareContext,
  markShareNoted,
  newShareId,
  parseSharePrefs,
  printedChance,
  readSharePrefs,
  resetSharePrefsForTests,
  setSharing,
  shareFeedbackPress,
  shareNoteDue,
  sharingOn,
  shownRewardOf,
  sig,
  slotKey,
  type FeedbackEvent,
  type FeedbackRewardSource,
} from "./feedbackShare";
import { SHARE_ID_PATTERN, applyFeedback, isShareId, parseFeedbackRecord, type FeedbackChange, type FeedbackEvaluation, type FeedbackRecord } from "./feedbackStore";
import type { StorageLike } from "./importStore";

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

afterEach(() => {
  resetSharePrefsForTests();
});

const snapshot = tradeSnapshot();
const LEAGUE_KEY = "espn:1a2b3c4d";
const RID = "Zm9vYmFyYmF6cXV4MTIzNA";
const FEATURES: AcceptanceFeatures = { g: -0.0812345678, n: 0.42, h: 1, c: 1, a: 1, hist: null, ctx: 0, hot: 0.15, urg: 0, z: -0.31 };

/** A card's evaluation: I give Wiggleton Spoons (106) to team 2 for Cornelius Snoot (204). */
function evaluation(over: Partial<FeedbackEvaluation> = {}): FeedbackEvaluation {
  return {
    key: "2|give:106|get:204",
    proposal: { partnerId: "2", give: [{ kind: "player", id: "106" }], get: [{ kind: "player", id: "204" }] },
    features: FEATURES,
    b: 4.212345678,
    b3: 6.0,
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

const at = (n: number) => `2026-10-0${n}T12:00:00.000Z`;

/** The league's record after a series of presses (each carrying RID, as the pages' presses do). */
function recordAfter(...changes: FeedbackChange[]): FeedbackRecord | undefined {
  let list: FeedbackRecord[] = [];
  changes.forEach((change, i) => {
    list = applyFeedback(list, { leagueKey: LEAGUE_KEY, evaluation: evaluation(), change: { ...change, rid: RID }, at: at(i + 1) });
  });
  return list[0];
}

/** The copy's context on screen: a goal alone, or (Checkpoint 7c) the engine's reward. */
const context = (reward: FeedbackRewardSource = "title") => feedbackShareContext(snapshot, reward);

/**
 * "Several prizes" as the engine hands it to the pages (Checkpoint 7c: TradeSearchResult.reward), on amounts no test number
 * shares: $2,468 / $1,357 / $975, nothing for the weekly high score, so the copy's whole percents are 52 / 28 / 20.
 */
const AMOUNTS = { first: 2468, second: 1357, third: 975, weeklyHigh: 0, pointsLeader: null };
const PRIZES = rewardWith({ goal: "prizes", prizes: AMOUNTS }, prizePeriods(snapshot));
const SPLIT = { first: 52, second: 28, third: 20, weeklyHigh: 0, pointsLeader: 0 };

describe("the league's format in a copy", () => {
  it("numTeams, league type, points per catch and passing TD, TE premium, a second QB, starting slots by the positions they take, playoff teams", () => {
    expect(feedbackFormatOf(snapshot.settings)).toEqual({
      numTeams: 4,
      leagueType: "redraft",
      ppr: 0.5,
      passTd: 4,
      tep: 0,
      superflex: false,
      slots: { QB: 1, RB: 2, WR: 1, "RB/WR/TE": 1, DEF: 1 },
      playoffTeams: 2,
    });
  });

  it("names a slot by its positions in a fixed order, so ESPN's OP and Sleeper's SUPER_FLEX read alike; a superflex or two QBs start a second QB; a TE premium", () => {
    expect(slotKey(["TE", "WR", "RB", "QB"])).toBe("QB/RB/WR/TE");
    expect(slotKey(["DEF"])).toBe("DEF");
    expect(slotKey([])).toBeNull();
    const base = snapshot.settings;
    const with_ = (over: Partial<LeagueSettings>): LeagueSettings => ({ ...base, ...over });
    const op = feedbackFormatOf(with_({ lineup: [...base.lineup, { slot: "OP", count: 1, eligible: ["QB", "RB", "WR", "TE"] }] }));
    const sf = feedbackFormatOf(with_({ lineup: [...base.lineup, { slot: "SUPER_FLEX", count: 1, eligible: ["WR", "QB", "TE", "RB"] }] }));
    expect(op.slots).toEqual(sf.slots);
    expect(op.slots["QB/RB/WR/TE"]).toBe(1);
    expect(op.superflex).toBe(true);
    expect(feedbackFormatOf(with_({ lineup: [{ slot: "QB", count: 2, eligible: ["QB"] }] })).superflex).toBe(true);
    // Two slots that take the same positions add up; a slot that takes nothing, or none of them, is left out.
    expect(feedbackFormatOf(with_({ lineup: [{ slot: "RB", count: 1, eligible: ["RB"] }, { slot: "RB2", count: 1, eligible: ["RB"] }, { slot: "BE", count: 0, eligible: ["RB"] }, { slot: "slot 99", count: 1, eligible: [] }] })).slots).toEqual({ RB: 2 });
    const tep = feedbackFormatOf(with_({ scoring: { ...base.scoring, byPosition: { TE: { rec: 1.25 } } } }));
    expect(tep).toMatchObject({ ppr: 0.5, tep: 0.75 });
  });
});

describe("the anonymous copy of a record", () => {
  it("holds exactly the privacy page's fields, rounded to 6 significant digits", () => {
    // A version recorded under "Top finishers too" before Checkpoint 7c keeps its goal (feedbackEvent.ts FEEDBACK_GOALS).
    const record = recordAfter({ outcome: "sent", sent: { version: "full", key: "2|give:106|get:204", pAccept: 0.42, pComplete: 0.42, inputs: { features: FEATURES, gPartner: -0.08, b: 4.212345678, goal: "balanced", b3: 6, helpsReason: null } } });
    const event = feedbackEventOf({ record: record as FeedbackRecord, kind: "outcome", context: context("title") });
    expect(event).toEqual({
      v: 1,
      rid: RID,
      kind: "outcome",
      outcome: "sent",
      version: "full",
      platform: "espn",
      season: 2026,
      week: 12,
      format: feedbackFormatOf(snapshot.settings),
      // The sent version's goal: the one the numbers were computed with.
      goal: "balanced",
      trade: { give: [{ id: "106", pos: "WR" }], get: [{ id: "204", pos: "RB" }] },
      numbers: { helps: 50, chance: 40, overall: 25, b: 4.21235, b3: 6, pAccept: 0.42, pComplete: 0.42, dPO: 0.04, dCH: 0.02, dPPW: 2.6, gMine: -0.03, gPartner: -0.08 },
      features: { ...FEATURES, g: -0.0812346 },
      versionAccept: { pAccept: 0.42, pComplete: 0.42 },
      // A press that passed no basis (a record made before Phase 7a's basis): the version's week is unknown.
      versionInputs: { features: { ...FEATURES, g: -0.0812346 }, gPartner: -0.08, b: 4.21235, b3: 6, helpsReason: null, goal: "balanced", week: null },
    } satisfies FeedbackEvent);
  });

  it("is the same copy, byte for byte, as before Checkpoint 7d: what the card printed (the export's numbers) never reaches it (planner reply to Checkpoint 7c, answer 1: “The anonymous server copies keep everything, as before.”)", () => {
    // A Plan B sent (its players and estimate), a report with a note, under "Only the champion" in week 12. GOLDEN is the
    // copy Checkpoint 7c's code (6de49a0) builds for this record, compared byte for byte when Checkpoint 7d was built.
    const GOLDEN =
      '{"v":1,"rid":"Zm9vYmFyYmF6cXV4MTIzNA","kind":"report","outcome":"sent","reason":"other","version":"planB","platform":"espn","season":2026,"week":12,"format":{"numTeams":4,"leagueType":"redraft","ppr":0.5,"passTd":4,"tep":0,"superflex":false,"slots":{"QB":1,"RB":2,"WR":1,"RB/WR/TE":1,"DEF":1},"playoffTeams":2},"goal":"title","trade":{"give":[{"id":"106","pos":"WR"}],"get":[{"id":"204","pos":"RB"}]},"numbers":{"helps":50,"chance":40,"overall":25,"b":4.21235,"b3":6,"pAccept":0.42,"pComplete":0.42,"dPO":0.04,"dCH":0.02,"dPPW":2.6,"gMine":-0.03,"gPartner":-0.08},"features":{"g":-0.0812346,"n":0.42,"h":1,"c":1,"a":1,"hist":null,"ctx":0,"hot":0.15,"urg":0,"z":-0.31},"versionTrade":{"give":[{"id":"105","pos":"WR"},{"id":"108","pos":"TE"}],"get":[{"id":"205","pos":"WR"}]},"versionAccept":{"pAccept":0.33,"pComplete":0.16},"versionInputs":{"features":{"g":-0.0812346,"n":0.42,"h":1,"c":1,"a":1,"hist":null,"ctx":0,"hot":0.15,"urg":0,"z":-0.31},"gPartner":-0.08,"b":2.5,"b3":6,"helpsReason":null,"goal":"title","week":12}}';
    const sent = { version: "planB" as const, key: "2|give:105,108|get:205", pAccept: 0.33, pComplete: 0.16, inputs: { features: FEATURES, gPartner: -0.08, b: 2.5, goal: "title" as const, b3: 6, helpsReason: null } };
    const basis = { season: 2026, week: 12, goal: "title" as const };
    const shown = {
      helps: "50",
      chance: "40%",
      label: "Decent",
      overall: "25",
      odds: ["Title odds 9.0% → 9.4%", "Playoff odds 62% → 64%"],
      weekly: "Win chance by week: Week 13: 42% → 55%",
      helpsThem: "24",
      theirOdds: ["Their title odds 6.0% → 6.9%", "Their playoff odds 41% → 45%"],
    };
    const plain = recordAfter({ outcome: "sent", sent, basis }, { report: { reason: "other", note: "Asked twice." }, basis }) as FeedbackRecord;
    const printed = recordAfter({ outcome: "sent", sent, basis, shown }, { report: { reason: "other", note: "Asked twice." }, basis, shown }) as FeedbackRecord;
    expect(printed.shown).toEqual(shown);
    expect(plain).not.toHaveProperty("shown");
    const copy = (record: FeedbackRecord) => JSON.stringify(feedbackEventOf({ record, kind: "report", context: context("title") }));
    expect(copy(plain)).toBe(GOLDEN);
    expect(copy(printed)).toBe(GOLDEN);
    // Nothing the card printed rides in it, the note neither.
    for (const text of ["shown", "40%", "Title odds", "Helps them", "helpsThem", "Asked twice"]) expect(copy(printed), text).not.toContain(text);
  });

  it("pairs each set of numbers with the week and goal they were computed for, not the ones on screen at a later press (review FB-R6)", () => {
    // Week 12 under "Only the champion": Report. A week later, the cards searched again under "Several prizes": Sent, with the
    // version's inputs (tradeView.ts writes the goal alone: the press's basis gives them its split, Checkpoint 7c). The
    // record keeps week 12's numbers; the version's inputs are week 13's.
    const week12 = feedbackBasisOf(context("title"));
    const onScreen = { ...context(PRIZES), week: 13 };
    const week13 = feedbackBasisOf(onScreen);
    expect(week13).toEqual({ season: 2026, week: 13, goal: "prizes", prizes: SPLIT });
    const inputs = { features: FEATURES, gPartner: -0.08, b: 5.9, goal: "prizes" as const, b3: 7.1, helpsReason: null };
    const record = recordAfter({ report: { reason: "never-accept" }, basis: week12 }, { outcome: "sent", sent: { version: "full", key: "2|give:106|get:204", pAccept: 0.5, pComplete: 0.5, inputs }, basis: week13 }) as FeedbackRecord;
    expect(record.basis).toEqual({ season: 2026, week: 12, goal: "title" });
    expect(record.versionInputs).toMatchObject({ goal: "prizes", prizes: SPLIT, week: 13 });
    const first = feedbackEventOf({ record: recordAfter({ report: { reason: "never-accept" }, basis: week12 }) as FeedbackRecord, kind: "report", context: context("title") }) as FeedbackEvent;
    const latest = feedbackEventOf({ record, kind: "outcome", context: onScreen }) as FeedbackEvent;
    for (const e of [first, latest]) expect(e).toMatchObject({ season: 2026, week: 12, goal: "title", numbers: { b: 4.21235 } });
    // The record's own goal names no split, so the copy has none at the top (never the split on screen).
    for (const e of [first, latest]) expect(e).not.toHaveProperty("prizes");
    expect(latest.versionInputs).toMatchObject({ b: 5.9, goal: "prizes", prizes: SPLIT, week: 13 });
    // The record reads back with its basis (the league store, an export).
    expect(parseFeedbackRecord(JSON.parse(JSON.stringify(record)))?.basis).toEqual(week12);
    expect(parseFeedbackRecord(JSON.parse(JSON.stringify(record)))?.versionInputs).toEqual(record.versionInputs);
    expect(parseFeedbackRecord(JSON.parse(JSON.stringify({ ...record, basis: { season: 1999, week: 12, goal: "title" } })))).not.toHaveProperty("basis");
    // A record made before (no basis): the league data and cards on screen, as before, the goal with its split.
    const old = recordAfter({ report: { reason: "never-accept" } }) as FeedbackRecord;
    expect(feedbackEventOf({ record: old, kind: "report", context: onScreen })).toMatchObject({ week: 13, goal: "prizes", prizes: SPLIT });
  });

  it("names the sent version's own players when they aren't the card's: a first offer, a throw-in added, a Plan B (review FB-R7)", () => {
    const sentAs = (version: "offerFirst" | "full" | "planB", key: string): FeedbackRecord =>
      recordAfter({ outcome: "accepted", sent: { version, key, pAccept: 0.3, pComplete: 0.3, inputs: { features: FEATURES, gPartner: 0.1, b: 2, goal: "title" } } }) as FeedbackRecord;
    const eventOf = (record: FeedbackRecord, removed = false) => feedbackEventOf({ record, kind: "outcome", removed, context: context() });
    // Plan B, another package with the same team: its players with their positions; the card's trade stays the card's.
    const planB = eventOf(sentAs("planB", "2|give:105,108|get:205")) as FeedbackEvent;
    expect(planB.trade).toEqual({ give: [{ id: "106", pos: "WR" }], get: [{ id: "204", pos: "RB" }] });
    expect(planB.versionTrade).toEqual({ give: [{ id: "105", pos: "WR" }, { id: "108", pos: "TE" }], get: [{ id: "205", pos: "WR" }] });
    expect(eventOf(sentAs("full", "2|give:106,108|get:204"))?.versionTrade).toEqual({ give: [{ id: "106", pos: "WR" }, { id: "108", pos: "TE" }], get: [{ id: "204", pos: "RB" }] });
    // The card's own trade: no versionTrade (the copy's trade is it).
    expect(eventOf(sentAs("full", "2|give:106|get:204"))).not.toHaveProperty("versionTrade");
    expect(eventOf(sentAs("offerFirst", "2|give:106|get:204"))).not.toHaveProperty("versionTrade");
    // Taken back: no version, so no version's players.
    expect(eventOf(sentAs("planB", "2|give:105|get:205"), true)).not.toHaveProperty("versionTrade");
    // A version whose players can't be sent (a pick, or a key that isn't one) sends nothing at all, never the card's trade
    // passed off as the version sent.
    expect(eventOf(sentAs("planB", "2|give:106,pick:2027:1:2|get:204"))).toBeNull();
    expect(eventOf(sentAs("planB", "not a key"))).toBeNull();
    // A version without its key (recorded before keys were kept): nothing to say about its players.
    const keyless = { ...sentAs("planB", "2|give:105|get:205") };
    delete keyless.versionKey;
    expect(eventOf(keyless)).not.toHaveProperty("versionTrade");
  });

  it("sends only player ids of the forms the app makes: Sleeper's digits or team code, else espn:<id> (review FB-R4)", () => {
    for (const id of ["4046", "11564", "BUF", "KC", "espn:4361307", "espn:-16001"]) expect(FEEDBACK_PLAYER_ID.test(id), id).toBe(true);
    for (const id of ["1234567890123456789", "espn:1a2b3c4d", "zorblax_q", "GravelGophers", "ABCDEF12-3456-7890-ABCD-EF1234567890", "mfl:12345", "", "BUFF"]) {
      expect(FEEDBACK_PLAYER_ID.test(id), id).toBe(false);
    }
    const record = recordAfter({ outcome: "sent" }) as FeedbackRecord;
    const withId = (id: string) => ({ ...record, proposal: { ...record.proposal, get: [{ kind: "player" as const, id }] } });
    expect(feedbackEventOf({ record: withId("espn:-16001"), kind: "outcome", context: context() })?.trade.get).toEqual([{ id: "espn:-16001", pos: null }]);
    // A platform added later (Phase 5) sends nothing until the form is widened.
    expect(feedbackEventOf({ record: withId("mfl:12345"), kind: "outcome", context: context() })).toBeNull();
  });

  it("never holds the league's short hash, the record id, the partner's team id, when buttons were pressed, or a note", () => {
    const record = recordAfter({ outcome: "sent" }, { report: { reason: "other", note: "Team 3's manager never answers" } }) as FeedbackRecord;
    const event = feedbackEventOf({ record, kind: "report", context: context() }) as FeedbackEvent;
    const text = JSON.stringify(event);
    for (const secret of [LEAGUE_KEY, record.id, record.savedAt, at(2), "never answers", "Team 3", "partnerId", "leagueKey", "note", "tradeKey", "savedAt"]) expect(text, secret).not.toContain(secret);
    expect(event).toMatchObject({ kind: "report", outcome: "sent", reason: "other" });
    // The keys, all of them.
    expect(Object.keys(event).sort()).toEqual(["features", "format", "goal", "kind", "numbers", "outcome", "platform", "reason", "rid", "season", "trade", "v", "week"]);
  });

  it("says the record as it stands: an outcome cleared but a report kept, a version only with its outcome, the cards' goal when the record names none", () => {
    const reported = recordAfter({ outcome: "rejected" }, { report: { reason: "never-accept" } }, { outcome: null }) as FeedbackRecord;
    const event = feedbackEventOf({ record: reported, kind: "outcome", context: context("playoffs") }) as FeedbackEvent;
    expect(event).toMatchObject({ kind: "outcome", reason: "never-accept", goal: "playoffs" });
    expect(event).not.toHaveProperty("outcome");
    expect(event).not.toHaveProperty("version");
    expect(event).not.toHaveProperty("versionAccept");
    expect(event).not.toHaveProperty("versionInputs");
  });

  it("taking a record back (the press removed it): the record as it was, with no outcome, reason, version or inputs", () => {
    const record = recordAfter({ outcome: "sent", sent: { version: "full", key: "k", pAccept: 0.4, pComplete: 0.4, inputs: { features: null, gPartner: null, b: 1, goal: "title" } } }) as FeedbackRecord;
    const event = feedbackEventOf({ record, kind: "outcome", removed: true, context: context() }) as FeedbackEvent;
    expect(event).toMatchObject({ rid: RID, kind: "outcome", numbers: { helps: 50 } });
    for (const key of ["outcome", "reason", "version", "versionTrade", "versionAccept", "versionInputs"]) expect(event).not.toHaveProperty(key);
  });

  it("sends nothing for a record without a share id, a trade with a draft pick, or more players a side than the Analyzer allows", () => {
    const plain = applyFeedback([], { leagueKey: LEAGUE_KEY, evaluation: evaluation(), change: { outcome: "sent" }, at: at(1) })[0] as FeedbackRecord;
    expect(feedbackEventOf({ record: plain, kind: "outcome", context: context() })).toBeNull();
    const record = recordAfter({ outcome: "sent" }) as FeedbackRecord;
    const pick = { ...record, proposal: { ...record.proposal, get: [{ kind: "pick" as const, season: 2027, round: 1, originalTeamId: "2" }] } };
    expect(feedbackEventOf({ record: pick, kind: "outcome", context: context() })).toBeNull();
    const many = { ...record, proposal: { ...record.proposal, give: Array.from({ length: FEEDBACK_EVENT_MAX_PER_SIDE + 1 }, (_, i) => ({ kind: "player" as const, id: `10${i}` })) } };
    expect(feedbackEventOf({ record: many, kind: "outcome", context: context() })).toBeNull();
    // A player the league data doesn't know: his id, position unknown.
    const stranger = { ...record, proposal: { ...record.proposal, get: [{ kind: "player" as const, id: "espn:99999" }] } };
    expect(feedbackEventOf({ record: stranger, kind: "outcome", context: context() })?.trade.get).toEqual([{ id: "espn:99999", pos: null }]);
  });

  it("prints the chance as the card did: the nearest 5%, 0 for '<5%'; rounds numbers to 6 significant digits", () => {
    expect([0.42, 0.03, 0.049, 0.05, 0.851, 0.2249].map(printedChance)).toEqual([40, 0, 0, 5, 85, 20]);
    expect(printedChance(null)).toBeNull();
    expect(printedChance(Number.NaN)).toBeNull();
    expect([0.123456789, 123456.789, -0.0000123456789, -0, Number.POSITIVE_INFINITY, null].map(sig)).toEqual([0.123457, 123457, -0.0000123457, 0, null, null]);
  });
});

describe("“Several prizes” in a copy (Checkpoint 7c; planner reply to Checkpoint 7b, §6: only the shares, whole percents, never the amounts)", () => {
  const sentUnder = (inputs: Record<string, unknown>, basis?: ReturnType<typeof feedbackBasisOf>): FeedbackRecord =>
    recordAfter({ outcome: "sent", sent: { version: "full", key: "2|give:106|get:204", pAccept: 0.42, pComplete: 0.42, inputs: { features: FEATURES, gPartner: -0.08, b: 4.2, b3: 6, helpsReason: null, ...inputs } as never }, ...(basis ? { basis } : {}) }) as FeedbackRecord;

  it("holds the split as whole percents at the top and in the sent version's inputs, from the cards' reward, never the amounts typed", () => {
    // The press on a card weighed by the split: its basis holds the split, and the version's inputs (the goal alone, as
    // tradeView.ts writes them) take the press's.
    const record = sentUnder({ goal: "prizes" }, feedbackBasisOf(context(PRIZES)));
    expect(record.basis).toEqual({ season: 2026, week: 12, goal: "prizes", prizes: SPLIT });
    expect(record.versionInputs).toMatchObject({ goal: "prizes", prizes: SPLIT });
    const event = feedbackEventOf({ record, kind: "outcome", context: context(PRIZES) }) as FeedbackEvent;
    expect(event).toMatchObject({ goal: "prizes", prizes: SPLIT, versionInputs: { goal: "prizes", prizes: SPLIT } });
    expect(Object.keys(event)).toContain("prizes");
    // Never the amounts (nor their total), anywhere in the copy or the record.
    for (const text of [JSON.stringify(event), JSON.stringify(record)]) for (const amount of ["2468", "1357", "975", "4800"]) expect(text, amount).not.toContain(amount);
  });

  it("takes the goal and its split from one source: the record's basis, else the sent version's, else the cards' on screen; never one's goal with another's split", () => {
    // Parker's $2,000 / $1,600 / $900 an earlier search used, against the 52 / 28 / 20 on screen now.
    const earlier = { first: 44, second: 36, third: 20, weeklyHigh: 0, pointsLeader: 0 };
    // A record made before Phase 7a's basis, its version recorded under the earlier split: the version's goal and split.
    const versionOnly = sentUnder({ goal: "prizes", prizes: earlier });
    expect(versionOnly).not.toHaveProperty("basis");
    expect(feedbackEventOf({ record: versionOnly, kind: "outcome", context: context(PRIZES) })).toMatchObject({ goal: "prizes", prizes: earlier, versionInputs: { prizes: earlier } });
    // Its version names no goal: the cards on screen, goal and split together.
    expect(feedbackEventOf({ record: sentUnder({ goal: null }), kind: "outcome", context: context(PRIZES) })).toMatchObject({ goal: "prizes", prizes: SPLIT });
    // A basis of "Only the champion" under cards now weighed by a split: the basis's goal and no split at all.
    const titled = sentUnder({ goal: "title" }, feedbackBasisOf(context("title")));
    const copy = feedbackEventOf({ record: titled, kind: "outcome", context: context(PRIZES) }) as FeedbackEvent;
    expect(copy.goal).toBe("title");
    expect(copy).not.toHaveProperty("prizes");
    expect(copy.versionInputs).not.toHaveProperty("prizes");
  });

  it("reads “Several prizes” without a readable split as an unknown goal (⚠️ ours), keeps no split with another goal, and an empty split as 1st place everything", () => {
    expect(feedbackRewardOf(PRIZES)).toEqual({ goal: "prizes", prizes: SPLIT });
    expect(feedbackRewardOf({ goal: "title", shares: TITLE_ONLY })).toEqual({ goal: "title", prizes: null });
    // A goal alone (a result that carries no reward): its split isn't known.
    expect(feedbackRewardOf("prizes")).toEqual({ goal: null, prizes: null });
    expect(feedbackRewardOf("playoffs")).toEqual({ goal: "playoffs", prizes: null });
    // "Several prizes" with nothing entered weighs 1st place as everything (reward.ts rewardOf `empty`): that's its split.
    expect(feedbackRewardOf(rewardWith({ goal: "prizes", prizes: { first: null, second: null, third: null, weeklyHigh: null, pointsLeader: null } }, 14))).toEqual({
      goal: "prizes",
      prizes: { first: 100, second: 0, third: 0, weeklyHigh: 0, pointsLeader: 0 },
    });
    // Shares that make no split.
    expect(feedbackRewardOf({ goal: "prizes", shares: { first: 0, second: 0, third: 0, weeklyHigh: 0, pointsLeader: 0 } })).toEqual({ goal: null, prizes: null });
    // A press that names "Several prizes" without its split (an older build's), at the top or in the version: unknown.
    const noSplit = sentUnder({ goal: "prizes" }, { season: 2026, week: 12, goal: "prizes" });
    expect(noSplit.basis).toEqual({ season: 2026, week: 12, goal: null });
    expect(noSplit.versionInputs?.goal).toBeNull();
    const copy = feedbackEventOf({ record: noSplit, kind: "outcome", context: context(PRIZES) }) as FeedbackEvent;
    expect(copy).toMatchObject({ goal: null, versionInputs: { goal: null } });
    expect(copy).not.toHaveProperty("prizes");
    // A split with another goal is dropped (the record keeps the goal).
    const odd = sentUnder({ goal: "playoffs", prizes: SPLIT }, { season: 2026, week: 12, goal: "title", prizes: SPLIT });
    expect(odd.basis).toEqual({ season: 2026, week: 12, goal: "title" });
    expect(odd.versionInputs).not.toHaveProperty("prizes");
  });
});

describe("the share id", () => {
  it("is 16 random bytes in base64url (22 characters): what the record and the server's schema accept", () => {
    const ids = new Set(Array.from({ length: 200 }, () => newShareId()));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(isShareId(id), id).toBe(true);
    expect(newShareId((b) => b.fill(255))).toBe("_____________________w");
    expect(newShareId((b) => b.fill(0))).toBe("AAAAAAAAAAAAAAAAAAAAAA");
    // Exactly 16 bytes (review FB-R4): the last character carries 2 bits, so it is A, Q, g or w; other text of 22
    // characters (a username padded out, say) isn't one.
    for (const last of [0x00, 0x40, 0x80, 0xc0]) expect(newShareId((b) => b.fill(0).fill(last, 15)).at(-1)).toMatch(/[AQgw]/);
    for (const bad of ["zorblaxqzorblaxqzorbla", "AAAAAAAAAAAAAAAAAAAAA", "AAAAAAAAAAAAAAAAAAAAAAA", "AAAAAAAAAAAAAAAAAAAA+A", "fb-1234abcd"]) {
      expect(isShareId(bad), bad).toBe(false);
      expect(SHARE_ID_PATTERN.test(bad), bad).toBe(false);
    }
  });
});

describe("'Share anonymous feedback' and the one-time note (localStorage, per browser)", () => {
  it("is on by default, reads what was saved, and anything else as the default", () => {
    const storage = new MemoryStorage();
    expect(sharingOn(storage)).toBe(true);
    expect(readSharePrefs(storage)).toEqual(DEFAULT_SHARE_PREFS);
    expect(setSharing(false, storage)).toEqual({ ok: true });
    expect(sharingOn(storage)).toBe(false);
    expect(JSON.parse(storage.getItem(FEEDBACK_SHARE_KEY) ?? "{}")).toEqual({ on: false, noted: false });
    expect(setSharing(true, storage)).toEqual({ ok: true });
    expect(sharingOn(storage)).toBe(true);
    for (const raw of [null, "", "nope", "[]", "{\"on\":\"no\"}", "null"]) expect(parseSharePrefs(raw), String(raw)).toEqual(DEFAULT_SHARE_PREFS);
    expect(parseSharePrefs("{\"on\":false,\"noted\":true,\"x\":1}")).toEqual({ on: false, noted: true });
  });

  it("a choice the browser won't keep holds for this page, and says so", () => {
    const blocked = new BlockedStorage();
    expect(sharingOn(blocked)).toBe(true);
    expect(setSharing(false, blocked)).toEqual({ ok: false, message: SHARE_SAVE_FAILED });
    expect(sharingOn(blocked)).toBe(false);
    expect(sharingOn(null)).toBe(false);
  });

  it("shows the note until the first copy has left this browser (remembered; per page when the browser can't), so an undone press never uses it up", () => {
    const storage = new MemoryStorage();
    // Presses before any copy left (one undone at once, or two quick ones) all show it.
    expect(shareNoteDue(storage)).toBe(true);
    expect(shareNoteDue(storage)).toBe(true);
    markShareNoted(storage);
    expect(shareNoteDue(storage)).toBe(false);
    expect(readSharePrefs(storage)).toEqual({ on: true, noted: true });
    resetSharePrefsForTests();
    expect(shareNoteDue(storage)).toBe(false); // remembered by the browser
    resetSharePrefsForTests();
    const blocked = new BlockedStorage();
    expect(shareNoteDue(blocked)).toBe(true);
    markShareNoted(blocked);
    expect(shareNoteDue(blocked)).toBe(false);
    // A choice held in this page's memory keeps its setting when the note is marked.
    resetSharePrefsForTests();
    setSharing(false, blocked);
    markShareNoted(blocked);
    expect(readSharePrefs(blocked)).toEqual({ on: false, noted: true });
    expect(SHARE_NOTE_TEXT).toBe("Sent anonymously to help improve Offer Sheet. You can turn this off in Settings.");
  });
});

/** A sender on fake timers: what it posted, how often it said a copy left, and a clock to move. */
function fakeSender(opts: { sharing?: () => boolean } = {}) {
  const posted: FeedbackEvent[] = [];
  const left = { count: 0 };
  let now = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  let next = 1;
  const sender = new FeedbackSender({
    post: (body) => posted.push(JSON.parse(body) as FeedbackEvent),
    setTimer: (fn, ms) => {
      const id = next++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimer: (id) => timers.delete(id as number),
    sharing: opts.sharing ?? (() => true),
    onSent: () => left.count++,
  });
  const advance = (ms: number) => {
    now += ms;
    for (const [id, t] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
      if (t.at <= now) {
        timers.delete(id);
        t.fn();
      }
    }
  };
  return { sender, posted, advance, left };
}

describe("the sender: one copy per record, 2 s after its last press, once, failures silent", () => {
  const sent = recordAfter({ outcome: "sent" }) as FeedbackRecord;
  const accepted = recordAfter({ outcome: "sent" }, { outcome: "accepted" }) as FeedbackRecord;
  const eventOf = (record: FeedbackRecord, removed = false) => feedbackEventOf({ record, kind: "outcome", removed, context: context() }) as FeedbackEvent;

  it("debounces per record: Sent then Accepted a moment later posts one copy, the later one", () => {
    const { sender, posted, advance } = fakeSender();
    expect(sender.queue(eventOf(sent), true)).toBe(true);
    advance(FEEDBACK_SHARE_DEBOUNCE_MS - 1);
    expect(sender.queue(eventOf(accepted), false)).toBe(true);
    advance(FEEDBACK_SHARE_DEBOUNCE_MS - 1);
    expect(posted).toEqual([]);
    advance(1);
    expect(posted.map((e) => e.outcome)).toEqual(["accepted"]);
    expect(sender.pending).toBe(0);
    // Another record's copy waits on its own.
    const other = { ...eventOf(sent), rid: "AAAAAAAAAAAAAAAAAAAAAA" };
    sender.queue(other, true);
    advance(FEEDBACK_SHARE_DEBOUNCE_MS);
    expect(posted.map((e) => e.rid)).toEqual([RID, "AAAAAAAAAAAAAAAAAAAAAA"]);
  });

  it("a press undone before its copy left sends nothing; undone after, the copy that takes it back goes", () => {
    const { sender, posted, advance, left } = fakeSender();
    sender.queue(eventOf(sent), true);
    expect(sender.queue(eventOf(sent, true), false)).toBe(false);
    advance(10 * FEEDBACK_SHARE_DEBOUNCE_MS);
    expect(posted).toEqual([]);
    // Nothing left this browser: the one-time note isn't used up.
    expect(left.count).toBe(0);
    sender.queue(eventOf(sent), true);
    advance(FEEDBACK_SHARE_DEBOUNCE_MS);
    expect(left.count).toBe(1);
    expect(sender.queue(eventOf(sent, true), false)).toBe(true);
    advance(FEEDBACK_SHARE_DEBOUNCE_MS);
    expect(posted.map((e) => e.outcome ?? "taken back")).toEqual(["sent", "taken back"]);
    expect(left.count).toBe(2);
    // A record made on an earlier visit (not by this page's press): its take-back goes too.
    const fresh = fakeSender();
    expect(fresh.sender.queue(eventOf(sent, true), false)).toBe(true);
    fresh.advance(FEEDBACK_SHARE_DEBOUNCE_MS);
    expect(fresh.posted).toHaveLength(1);
  });

  it("checks sharing again when a copy leaves; flush sends what waits at once (the page hides); cancelAll drops it; a failing post is silent", () => {
    let on = true;
    const a = fakeSender({ sharing: () => on });
    a.sender.queue(eventOf(sent), true);
    on = false;
    a.advance(FEEDBACK_SHARE_DEBOUNCE_MS);
    expect(a.posted).toEqual([]);
    expect(a.left.count).toBe(0);
    on = true;
    a.sender.queue(eventOf(accepted), false);
    a.sender.flush();
    expect(a.posted.map((e) => e.outcome)).toEqual(["accepted"]);
    a.sender.queue(eventOf(sent), false);
    a.sender.cancelAll();
    a.advance(FEEDBACK_SHARE_DEBOUNCE_MS);
    expect(a.posted).toHaveLength(1);
    const failing = new FeedbackSender({
      post: () => {
        throw new Error("offline");
      },
      setTimer: (fn) => {
        fn();
        return 0;
      },
      clearTimer: () => {},
      sharing: () => true,
    });
    expect(() => failing.queue(eventOf(sent), true)).not.toThrow();
  });
});

describe("shareFeedbackPress (after a press the browser kept)", () => {
  it("queues the record's copy while sharing is on, with the press's kind; nothing while it's off", () => {
    const { sender, posted, advance } = fakeSender();
    const before = recordAfter({ outcome: "sent" });
    const after = recordAfter({ outcome: "sent" }, { report: { reason: "doesnt-help" } });
    expect(shareFeedbackPress({ before, after, change: { report: { reason: "doesnt-help" } }, context: context(), sender, sharing: () => false })).toBe(false);
    expect(shareFeedbackPress({ before, after, change: { report: { reason: "doesnt-help" } }, context: context(), sender, sharing: () => true })).toBe(true);
    advance(FEEDBACK_SHARE_DEBOUNCE_MS);
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ kind: "report", outcome: "sent", reason: "doesnt-help" });
  });

  it("a press that removed the record sends the take-back from the record as it was; without a sender or a record, nothing", () => {
    const { sender, posted, advance } = fakeSender();
    const before = recordAfter({ outcome: "rejected" });
    expect(shareFeedbackPress({ before, after: undefined, change: { outcome: null }, context: context(), sender, sharing: () => true })).toBe(true);
    advance(FEEDBACK_SHARE_DEBOUNCE_MS);
    expect(posted[0]).toMatchObject({ rid: RID, kind: "outcome" });
    expect(posted[0]).not.toHaveProperty("outcome");
    expect(shareFeedbackPress({ before: undefined, after: undefined, change: { outcome: null }, context: context(), sender, sharing: () => true })).toBe(false);
    expect(shareFeedbackPress({ before, after: before, change: { outcome: "sent" }, context: context(), sender: null, sharing: () => true })).toBe(false);
  });

  it("builds its context from the league data on screen and what its cards were weighed by: the engine's reward (Checkpoint 7c), or a goal alone", () => {
    const ctx = feedbackShareContext(snapshot as LeagueSnapshot, PRIZES);
    expect(ctx).toMatchObject({ platform: "espn", season: 2026, week: 12, goal: "prizes", prizes: SPLIT, format: feedbackFormatOf(snapshot.settings) });
    expect(ctx.players["106"]?.pos).toBe("WR");
    expect(feedbackShareContext(snapshot as LeagueSnapshot, "playoffs")).toMatchObject({ goal: "playoffs", prizes: null });
    expect(feedbackShareContext(snapshot as LeagueSnapshot, null)).toMatchObject({ goal: null, prizes: null });
  });

  it("both trade pages take the reward from the result they show, never the settings' goal (review FB-R3)", () => {
    const shown = (result: Parameters<typeof shownRewardOf>[0], goal: Parameters<typeof shownRewardOf>[1]) => feedbackShareContext(snapshot as LeagueSnapshot, shownRewardOf(result, goal));
    // A search (the Finder's Done) or an evaluation (the Analyzer's Evaluated) shown under "Several prizes": the engine's
    // reward rides on the result (TradeSearchResult.reward, TradeAnalysis.reward), so the copy holds the goal and its split.
    expect(shown({ reward: PRIZES }, "prizes")).toMatchObject({ goal: "prizes", prizes: SPLIT });
    // The result's reward is what every B read, so it wins over the goal the page ran it under.
    expect(shown({ reward: rewardWith({ goal: "title", prizes: AMOUNTS }, prizePeriods(snapshot)) }, "prizes")).toMatchObject({ goal: "title", prizes: null });
    // A goal alone (a result without a reward) can't say the split: "Several prizes" reads as an unknown goal, the others as they are.
    expect(shown({}, "prizes")).toMatchObject({ goal: null, prizes: null });
    expect(shown({}, "playoffs")).toMatchObject({ goal: "playoffs", prizes: null });
    // Nothing shown yet.
    expect(shownRewardOf(null, null)).toBeNull();
    expect(shownRewardOf(undefined, undefined)).toBeNull();
    // Both pages build their copies' context from it, with the result they show (before, nothing failed if a page went back
    // to the settings' goal, which loses the goal and the split of every record and copy made under "Several prizes").
    const pages = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../components/trades");
    for (const [file, call] of [
      ["TradeFinderPage.tsx", "shownRewardOf(shownOutcome?.result, shownOutcome?.goal)"],
      ["AnalyzerPage.tsx", "shownRewardOf(evaluated?.analysis, evaluated?.goal)"],
    ] as const) {
      const source = readFileSync(path.join(pages, file), "utf8");
      expect(source.match(/feedbackShareContext\(/g), file).toHaveLength(1);
      expect(source, file).toContain("feedbackShareContext(league, shownReward)");
      expect(source, file).toContain(`const shownReward = ${call};`);
    }
  });
});

describe("the league store keeps the share id a press carries (FeedbackChange.rid travels through it untouched)", () => {
  it("in IndexedDB (fake-indexeddb): a new record takes it, a later press keeps it, and it reads back after a reload", async () => {
    const { IDBFactory } = await import("fake-indexeddb");
    const { LeagueStoreClient, savedFeedbackRead } = await import("./leagueStore");
    const factory = new IDBFactory();
    const local = new MemoryStorage();
    let clock = Date.parse("2026-10-04T12:00:00.000Z");
    const tab = () => new LeagueStoreClient({ indexedDB: () => factory, session: () => new MemoryStorage(), local: () => local, channel: () => undefined, now: () => new Date((clock += 1000)).toISOString() });
    const one = tab();
    await one.start();
    expect(await one.saveFeedback({ leagueKey: LEAGUE_KEY, evaluation: evaluation(), change: { outcome: "sent", rid: RID }, at: at(1) })).toEqual({ ok: true });
    expect(await one.saveFeedback({ leagueKey: LEAGUE_KEY, evaluation: evaluation(), change: { outcome: "accepted", rid: "AAAAAAAAAAAAAAAAAAAAAA" }, at: at(2) })).toEqual({ ok: true });
    expect(savedFeedbackRead(one.getState(), LEAGUE_KEY)?.map((r) => [r.rid, r.outcome?.kind])).toEqual([[RID, "accepted"]]);
    one.dispose();
    const two = tab();
    await two.start();
    expect(savedFeedbackRead(two.getState(), LEAGUE_KEY)?.[0]?.rid).toBe(RID);
    two.dispose();
  });
});
