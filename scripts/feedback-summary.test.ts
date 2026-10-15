/**
 * The feedback summary (scripts/feedback-summary.ts; CLAUDE.md §11 "A script summarizes reports by reason and by
 * model part"): counts by outcome, by version sent and by reason with the numbers the cards printed, the model parts, the
 * acceptance calibration on the card's own bins, refit readiness, and the notes kept out unless asked for. Since Checkpoint 7d
 * it reads what an export of version 3 holds (src/lib/feedbackStore.ts feedbackExport: what the user saw and entered), and
 * older files and bare lists of records as version 3 holds them. Offline, on made-up feedback built the way the trade cards
 * save it.
 */
import { describe, expect, it } from "vitest";
import { acceptanceLabel } from "@/engine/acceptance";
import { config } from "@/engine/config";
import type { AcceptanceFeatures } from "@/engine/tradeModel";
import { FEEDBACK_EXPORT_KIND, applyFeedback, feedbackExport, feedbackExportText, type FeedbackChange, type FeedbackExportEntry, type FeedbackRecord, type FeedbackShown } from "@/lib/feedbackStore";
import { acceptText } from "@/lib/printed";
import { calibrationBins, feedbackNotes, formatSummary, parseArgs, predictedAccept, printedChance, printedScore, runSummary, sentCardTrade, summarizeFeedback } from "./feedback-summary";

const AT = "2026-10-01T18:00:00.000Z";
const BASE_FEATURES: AcceptanceFeatures = { g: 0, n: 0, h: 0, c: 0, a: 0, hist: null, ctx: 0, hot: 0, urg: 0, z: -0.6 };

/** What a card printed for an estimate (tradeView.ts TradeCardView.shown): Helps you, the chance with its label, Overall, my odds. */
function printed(pAccept: number, helps: number, helpsThem: number | null): FeedbackShown {
  return {
    helps: String(helps),
    chance: acceptText(pAccept),
    label: acceptanceLabel(pAccept),
    overall: "20",
    odds: ["Title odds 9.0% → 9.4%", "Playoff odds 62% → 64%"],
    ...(helpsThem !== null ? { helpsThem: String(helpsThem), theirOdds: ["Their title odds 6.0% → 6.9%", "Their playoff odds 41% → 45%"] } : {}),
  };
}

/** One trade idea with a predicted P_accept and some presses, each carrying what its card printed (unless `shown` is false: a record made before 7d). */
function idea(
  list: FeedbackRecord[],
  key: string,
  pAccept: number,
  changes: FeedbackChange[],
  over: { league?: string; features?: Partial<AcceptanceFeatures>; helps?: number; helpsThem?: number | null; give?: string[]; shown?: boolean } = {},
): FeedbackRecord[] {
  let out = list;
  const shown = over.shown === false ? undefined : printed(pAccept, over.helps ?? 39, over.helpsThem ?? null);
  for (const change of changes) {
    out = applyFeedback(out, {
      leagueKey: over.league ?? "espn:00c0ffee",
      evaluation: {
        key,
        proposal: { partnerId: "2", give: (over.give ?? ["101"]).map((id) => ({ kind: "player" as const, id })), get: [{ kind: "player", id: "201" }] },
        features: { ...BASE_FEATURES, ...over.features },
        b: 3,
        tradeScore: over.helps ?? 39,
        pAccept,
        pComplete: pAccept,
        overall: 20,
        dPO: 0.03,
        dCH: 0.01,
        dPPW: 1.5,
        gMine: 0.02,
        gPartner: -0.05,
      },
      change: shown ? { ...change, shown } : change,
      at: AT,
    });
  }
  return out;
}

/** The records as an export of version 3 holds them. */
const entriesOf = (records: readonly FeedbackRecord[]): FeedbackExportEntry[] => feedbackExport(records, AT).records;

function sample(): FeedbackRecord[] {
  let r: FeedbackRecord[] = [];
  // Long shot (< 15%): one rejected with a "never accept" report (printed 10%), one sent and waiting.
  r = idea(r, "a", 0.08, [{ outcome: "rejected" }, { report: { reason: "never-accept", note: "Team 2 never trades with me." } }], { features: { g: -0.2, a: -2 } });
  r = idea(r, "b", 0.1, [{ outcome: "sent" }]);
  // Possible (15–35%): one accepted, one countered.
  r = idea(r, "c", 0.3, [{ outcome: "accepted" }], { features: { g: 0.1, a: 1 } });
  r = idea(r, "d", 0.25, [{ outcome: "countered" }]);
  // Decent (35–55%): two rejected.
  r = idea(r, "e", 0.4, [{ outcome: "rejected" }]);
  r = idea(r, "f", 0.5, [{ outcome: "rejected" }], { league: "sleeper:0badf00d" });
  // Likely (55%+): one accepted.
  r = idea(r, "g", 0.8, [{ outcome: "accepted" }], { features: { g: 0.3, n: 0.5 } });
  // Reports without an outcome; one card showed the partner's line (Helps them 30).
  r = idea(r, "h", 0.45, [{ report: { reason: "doesnt-help" } }], { helps: 12, helpsThem: 30 });
  r = idea(r, "i", 0.45, [{ report: { reason: "doesnt-help", note: "He's hurt." } }], { helps: 24 });
  r = idea(r, "j", 0.45, [{ report: { reason: "player-info" } }]);
  r = idea(r, "k", 0.45, [{ report: { reason: "settings" } }]);
  r = idea(r, "l", 0.45, [{ report: { reason: "other" } }]);
  return r;
}

describe("summarizeFeedback", () => {
  const s = summarizeFeedback(entriesOf(sample()));

  it("counts trade ideas, leagues, outcomes and reports", () => {
    expect(s).toMatchObject({ total: 12, leagues: 2, withOutcome: 7, withReport: 6, withNote: 2 });
    expect(s.byOutcome).toEqual({ sent: 1, accepted: 2, rejected: 3, countered: 1 });
    expect(s.byReason.map((r) => [r.reason, r.count])).toEqual([
      ["doesnt-help", 2],
      ["never-accept", 1],
      ["player-info", 1],
      ["settings", 1],
      ["other", 1],
    ]);
  });

  it("averages the numbers each reason's cards printed (Helps them where the card showed it; null when there's nothing to average)", () => {
    const help = s.byReason.find((r) => r.reason === "doesnt-help");
    expect(help?.averages).toEqual({ helps: 18, helpsThem: 30, chance: 0.45, overall: 20 });
    const never = s.byReason.find((r) => r.reason === "never-accept");
    // 8% printed as "10%" on its card: the number the user saw.
    expect(never?.averages).toEqual({ helps: 39, helpsThem: null, chance: 0.1, overall: 20 });
    // No model number at all: none is in a version-3 file (planner reply to Checkpoint 7c, answer 1).
    for (const key of ["b", "pAccept", "n", "a", "g", "gMine", "gPartner", "hist", "z"]) expect(never?.averages, key).not.toHaveProperty(key);
    expect(formatSummary(s)).toContain("| Reason | Reports | Helps you | Helps them | Chance they accept | Overall |");
    expect(formatSummary(s)).toContain("| Doesn't help me | 2 | 18 | 30 | 45% | 20 |");
    expect(formatSummary(s)).toContain("| They'd never accept | 1 | 39 | – | 10% | 20 |");
  });

  it("reads the printed numbers: whole scores and percents, “<5%” as half of 5%, anything else as unknown", () => {
    expect([printedScore("39"), printedScore("0"), printedScore("—"), printedScore(undefined), printedScore("3.5")]).toEqual([39, 0, null, null, null]);
    expect([printedChance("45%"), printedChance("<5%"), printedChance("—"), printedChance(undefined), printedChance("about 20%")]).toEqual([0.45, 0.025, null, null, null]);
  });

  it("summarizes the Settings page's export the same as the records it was made from, and older files the same too", () => {
    const records = sample();
    const fromExport = runSummary(feedbackExportText(records, AT), { json: true, notes: false });
    const fromRecords = runSummary(JSON.stringify(records), { json: true, notes: false });
    const fromV1 = runSummary(JSON.stringify({ kind: FEEDBACK_EXPORT_KIND, version: 1, exportedAt: AT, count: records.length, records }), { json: true, notes: false });
    expect(fromExport.ok && fromRecords.ok && fromV1.ok).toBe(true);
    // The leagues are numbered in the export (league-1, league-2): the count is the same; every other number too.
    const out = (r: typeof fromExport) => (r.ok ? (JSON.parse(r.output) as unknown) : null);
    expect(out(fromExport)).toEqual(out(fromRecords));
    expect(out(fromExport)).toEqual(out(fromV1));
  });

  it("prints a record made before Checkpoint 7d (its card's numbers not kept) as its card did, from the record's own numbers", () => {
    const old = idea([], "o", 0.08, [{ outcome: "rejected" }], { shown: false });
    expect(old[0]).not.toHaveProperty("shown");
    const [entry] = entriesOf(old);
    expect(entry?.shown).toEqual({ helps: "39", chance: "10%", label: "Long shot", overall: "20" });
    expect(predictedAccept(entry as FeedbackExportEntry)).toBe(0.1);
  });

  it("sends each report to its part of the model, and Rejected outcomes to the acceptance refit", () => {
    expect(s.byModelPart.map((p) => [p.part, p.reports, p.rejected])).toEqual([
      ["acceptance", 1, 3],
      ["benefit", 2, 0],
      ["adapters", 2, 0],
      ["review", 1, 0],
    ]);
  });

  it("bins the printed chances on the card's own labels and compares them with what happened", () => {
    expect(calibrationBins()).toEqual([
      { label: "Long shot", from: 0, to: 0.15 },
      { label: "Possible", from: 0.15, to: 0.35 },
      { label: "Decent", from: 0.35, to: 0.55 },
      { label: "Likely", from: 0.55, to: null },
    ]);
    expect(calibrationBins().map((b) => b.label)).toEqual(config.acceptance.labels.map((l) => l.label));
    const [long, possible, decent, likely] = s.calibration;
    expect(long).toMatchObject({ decided: 1, accepted: 0, rejected: 1, pending: 1, neverAccept: 1, observed: 0, meanPredicted: 0.1 });
    expect(possible).toMatchObject({ decided: 1, accepted: 1, countered: 1, observed: 1, meanPredicted: 0.3 });
    expect(decent).toMatchObject({ decided: 2, rejected: 2, observed: 0 });
    expect(decent?.meanPredicted).toBeCloseTo(0.45, 12);
    expect(likely).toMatchObject({ decided: 1, accepted: 1, observed: 1, meanPredicted: 0.8 });
    expect(s.unpredicted).toBe(0);
    // A card that printed no chance ("—") is left out of the calibration.
    const blank = entriesOf(sample()).map((e, i) => (i === 0 ? { ...e, shown: { ...e.shown, chance: "—" } } : e));
    expect(summarizeFeedback(blank).unpredicted).toBe(1);
  });

  it("says whether there are enough decided outcomes for the refit", () => {
    expect(s.refit).toEqual({ decided: 5, needed: config.acceptance.refitMinOutcomes, ready: false });
    let many: FeedbackRecord[] = [];
    for (let i = 0; i < config.acceptance.refitMinOutcomes; i++) many = idea(many, `x${i}`, 0.4, [{ outcome: i % 2 ? "accepted" : "rejected" }]);
    expect(summarizeFeedback(entriesOf(many)).refit.ready).toBe(true);
  });

  it("handles no feedback at all", () => {
    const empty = summarizeFeedback([]);
    expect(empty).toMatchObject({ total: 0, leagues: 0, refit: { decided: 0, ready: false } });
    expect(empty.calibration.every((b) => b.observed === null && b.meanPredicted === null)).toBe(true);
    expect(formatSummary(empty)).toContain("0 trade ideas with feedback from 0 leagues");
  });
});

describe("by version sent (planner reply to Checkpoint 4, change 6 and answer 8)", () => {
  /**
   * The sample, plus a card holding a throw-in whose first offer (without him, 10%) was sent, a plain card's own trade, and a
   * Plan B (60%: Likely), each version's key the engine's form (the export reads its players from it).
   */
  function withVersions(): FeedbackRecord[] {
    let r = sample();
    r = idea(r, "v1", 0.2, [{ outcome: "sent", sent: { version: "offerFirst", key: "2|give:101|get:201", pAccept: 0.1, pComplete: 0.1 } }, { outcome: "rejected" }], { give: ["101", "108"] });
    r = idea(r, "v2", 0.3, [{ outcome: "accepted", sent: { version: "full", key: "2|give:101|get:201", pAccept: 0.3, pComplete: 0.3 } }]);
    r = idea(r, "v3", 0.3, [{ outcome: "sent", sent: { version: "planB", key: "2|give:105|get:205", pAccept: 0.6, pComplete: 0.6 } }, { outcome: "accepted" }]);
    return r;
  }

  it("counts each latest outcome by the version sent, records without one as unknown", () => {
    const s = summarizeFeedback(entriesOf(withVersions()));
    const none = { sent: 0, accepted: 0, rejected: 0, countered: 0 };
    // Checkpoint 7e (planner reply to Checkpoint 7d, item 4.1): the steps of "How to offer it" first, then Plan B, then an
    // older card's kinds, each a row whether or not a record names it.
    expect(s.byVersion.map((v) => [v.version, v.total, v.outcomes])).toEqual([
      ["open", 0, none],
      ["then", 0, none],
      ["suggested", 0, none],
      ["last", 0, none],
      ["planB", 1, { sent: 0, accepted: 1, rejected: 0, countered: 0 }],
      ["offerFirst", 1, { sent: 0, accepted: 0, rejected: 1, countered: 0 }],
      ["full", 1, { sent: 0, accepted: 1, rejected: 0, countered: 0 }],
      ["unknown", 7, { sent: 1, accepted: 2, rejected: 3, countered: 1 }],
    ]);
    const text = formatSummary(s);
    expect(text).toContain("## By version sent");
    expect(text).toContain("| If they won't move (Plan B) | 1 | 0 | 1 | 0 | 0 | 0 |");
    expect(text).toContain("| First offer (older cards) | 1 | 0 | 0 | 1 | 0 | 0 |");
    expect(text).toContain("| Unknown (not recorded) | 7 | 1 | 2 | 3 | 1 | 7 |");
  });

  it("Checkpoint 7e: counts the step of “How to offer it” that was sent, the suggested trade as the card's own (planner reply to Checkpoint 7d, item 4.1)", () => {
    let r = sample();
    r = idea(r, "o1", 0.25, [{ outcome: "sent", sent: { version: "open", key: "2|give:101|get:202,203", pAccept: 0.15, pComplete: 0.15 } }, { outcome: "rejected" }]);
    r = idea(r, "o2", 0.25, [{ outcome: "sent", sent: { version: "then", key: "2|give:101|get:203", pAccept: 0.2, pComplete: 0.2 } }, { outcome: "countered" }]);
    r = idea(r, "o3", 0.25, [{ outcome: "accepted", sent: { version: "suggested", key: "2|give:101|get:201", pAccept: 0.25, pComplete: 0.25 } }]);
    r = idea(r, "o4", 0.25, [{ outcome: "sent", sent: { version: "last", key: "2|give:101,108|get:201", pAccept: 0.35, pComplete: 0.35 } }]);
    const entries = entriesOf(r);
    const s = summarizeFeedback(entries);
    expect(s.byVersion.slice(0, 4).map((v) => [v.version, v.total, v.cardOwn])).toEqual([
      ["open", 1, 0],
      ["then", 1, 0],
      ["suggested", 1, 1],
      ["last", 1, 0],
    ]);
    // Each calibrates on the chance its own line printed.
    expect(entries.filter((e) => e.version).map((e) => predictedAccept(e))).toEqual([0.15, 0.2, 0.25, 0.35]);
    const text = formatSummary(s);
    for (const row of ["| Open with | 1 | 0 | 0 | 1 | 0 | 0 |", "| Then | 1 | 0 | 0 | 0 | 1 | 0 |", "| The suggested trade | 1 | 0 | 1 | 0 | 0 | 1 |", "| Last offer | 1 | 1 | 0 | 0 | 0 | 0 |"]) expect(text).toContain(row);
  });

  it("says per version how many sent the card's own trade, the one whose numbers the card printed (review of track F)", () => {
    // "full" is the card's own trade on a plain card (v2) but the card plus its throw-in when the card is the first offer
    // (v4: its players aren't the card's); a first offer that leaves out the card's throw-in (v1) and a Plan B (v3) never are.
    const records = idea(withVersions(), "v4", 0.35, [{ outcome: "sent", sent: { version: "full", key: "2|give:101,108|get:201", pAccept: 0.5, pComplete: 0.5 } }]);
    const entries = entriesOf(records);
    const s = summarizeFeedback(entries);
    expect(s.byVersion.filter((v) => v.total > 0).map((v) => [v.version, v.total, v.cardOwn])).toEqual([
      ["planB", 1, 0],
      ["offerFirst", 1, 0],
      ["full", 2, 1],
      ["unknown", 7, 7],
    ]);
    const at = (i: number) => entries[records.findIndex((r) => r.tradeKey === `v${i}`)] as FeedbackExportEntry;
    expect(sentCardTrade(at(2))).toBe(true);
    expect(sentCardTrade(at(4))).toBe(false);
    expect(sentCardTrade(entries[0] as FeedbackExportEntry)).toBe(true); // no version recorded
    // The same players in another order are the same trade.
    expect(sentCardTrade({ trade: { partnerId: "2", give: [{ kind: "player", id: "108" }, { kind: "player", id: "101" }], get: [] }, version: { kind: "full", give: [{ kind: "player", id: "101" }, { kind: "player", id: "108" }], get: [] } })).toBe(true);
    const text = formatSummary(s);
    expect(text).toContain("| Version | Trade ideas | Sent | Accepted | Rejected | Countered | The card's own trade |");
    expect(text).toContain("| Full trade (older cards) | 2 | 1 | 1 | 0 | 0 | 1 |");
  });

  it("calibrates on the sent version's printed chance when the record has one (the prediction acted on), else the card's", () => {
    const entries = entriesOf(withVersions());
    const records = withVersions();
    const at = (key: string) => entries[records.findIndex((r) => r.tradeKey === key)] as FeedbackExportEntry;
    expect(predictedAccept(at("v1"))).toBe(0.1);
    expect(predictedAccept(at("v3"))).toBe(0.6);
    expect(predictedAccept(at("a"))).toBe(0.1);
    const [long, , , likely] = summarizeFeedback(entries).calibration;
    // v1 (a card at 20%, its first offer at 10%) lands in Long shot; v3 (a card at 30%, Plan B at 60%) in Likely.
    expect(long).toMatchObject({ decided: 2, rejected: 2 });
    expect(likely).toMatchObject({ decided: 2, accepted: 2, meanPredicted: 0.7 });
  });
});

describe("the text and the command line", () => {
  const records = sample();

  it("prints every section, and leaves the notes out unless asked", () => {
    const entries = entriesOf(records);
    const text = formatSummary(summarizeFeedback(entries));
    for (const heading of ["# Trade feedback summary", "## By outcome", "## By reason", "## By model part", "## Acceptance calibration", "## Refit"]) expect(text).toContain(heading);
    expect(text).toContain("12 trade ideas with feedback from 2 leagues: 7 with an outcome, 6 with a report, 2 notes.");
    expect(text).toContain("| Long shot (0%–15%) | 1 | 0 | 1 | 0% | 10% | 0 | 1 | 1 |");
    expect(text).toContain("| Likely (55%+) | 1 | 1 | 0 | 100% | 80% | 0 | 0 | 0 |");
    expect(text).toContain("“<5%” counts as half of 5%.");
    expect(text).toContain("5 decided outcomes of the 30 the acceptance refit needs");
    expect(text).not.toContain("Team 2 never trades with me.");
    const withNotes = formatSummary(summarizeFeedback(entries), feedbackNotes(entries));
    expect(withNotes).toContain("- They'd never accept: Team 2 never trades with me.");
    expect(withNotes).toContain("- Doesn't help me: He's hurt.");
  });

  it("reads the Settings page's export (or a bare list) and says when a file isn't one", () => {
    const exported = feedbackExportText(records, AT);
    const text = runSummary(exported, { json: false, notes: false });
    expect(text.ok && text.output.startsWith("# Trade feedback summary")).toBe(true);
    // The export numbers the leagues (league-1, league-2): the count is the same as from the stored keys.
    expect(text.ok && text.output).toContain("12 trade ideas with feedback from 2 leagues");
    const fromExport = runSummary(exported, { json: true, notes: false });
    expect(fromExport.ok ? (JSON.parse(fromExport.output) as { leagues: number }).leagues : null).toBe(2);
    const json = runSummary(JSON.stringify(records), { json: true, notes: true });
    expect(json.ok).toBe(true);
    const parsed = json.ok ? (JSON.parse(json.output) as { total: number; notes: unknown[] }) : null;
    expect(parsed?.total).toBe(12);
    expect(parsed?.notes).toHaveLength(2);
    expect(runSummary("{}", { json: false, notes: false })).toEqual({ ok: false, error: expect.stringContaining("isn't an Offer Sheet feedback export") });
    expect(runSummary("oops", { json: false, notes: false }).ok).toBe(false);
    // A file of a version this script doesn't know isn't read as one.
    expect(runSummary(JSON.stringify({ kind: FEEDBACK_EXPORT_KIND, version: 9, records: [] }), { json: false, notes: false }).ok).toBe(false);
  });

  it("an export round-trips: the file, read back, summarizes as the records it was made from (planner reply to Checkpoint 7c, answer 1)", () => {
    const file = feedbackExportText(records, AT);
    const again = feedbackExportText(records, AT);
    expect(again).toBe(file);
    const fromFile = runSummary(file, { json: true, notes: true });
    const direct = summarizeFeedback(entriesOf(records));
    expect(fromFile.ok ? JSON.parse(fromFile.output) : null).toEqual({ ...JSON.parse(JSON.stringify(direct)), notes: feedbackNotes(entriesOf(records)) });
  });

  it("parses its arguments: the file, then --json and --notes in any order", () => {
    expect(parseArgs(["feedback.json"])).toEqual({ file: "feedback.json", json: false, notes: false });
    expect(parseArgs(["--notes", "C:\\Users\\me\\Downloads\\offersheet feedback.json", "--json"])).toEqual({ file: "C:\\Users\\me\\Downloads\\offersheet feedback.json", json: true, notes: true });
    expect(parseArgs([])).toEqual({ file: null, json: false, notes: false });
  });
});
