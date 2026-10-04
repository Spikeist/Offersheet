/**
 * The feedback summary (scripts/feedback-summary.ts; CLAUDE.md §11 "A script summarizes reports by reason and by
 * model part"): counts by outcome and by reason with the features behind them, the model parts, the acceptance
 * calibration on the card's own bins, refit readiness, and the notes kept out unless asked for. Offline, on
 * made-up feedback built the way the trade cards save it (src/lib/feedbackStore.ts).
 */
import { describe, expect, it } from "vitest";
import { config } from "@/engine/config";
import type { AcceptanceFeatures } from "@/engine/tradeModel";
import { applyFeedback, feedbackExportText, type FeedbackChange, type FeedbackRecord } from "@/lib/feedbackStore";
import { calibrationBins, feedbackNotes, formatSummary, parseArgs, predictedAccept, runSummary, sentCardTrade, summarizeFeedback } from "./feedback-summary";

const AT = "2026-10-01T18:00:00.000Z";
const BASE_FEATURES: AcceptanceFeatures = { g: 0, n: 0, h: 0, c: 0, a: 0, hist: null, ctx: 0, hot: 0, urg: 0, z: -0.6 };

/** One trade idea with a predicted P_accept and some presses. */
function idea(list: FeedbackRecord[], key: string, pAccept: number, changes: FeedbackChange[], over: { league?: string; features?: Partial<AcceptanceFeatures>; b?: number } = {}): FeedbackRecord[] {
  let out = list;
  for (const change of changes) {
    out = applyFeedback(out, {
      leagueKey: over.league ?? "espn:00c0ffee",
      evaluation: {
        key,
        proposal: { partnerId: "2", give: [{ kind: "player", id: "101" }], get: [{ kind: "player", id: "201" }] },
        features: { ...BASE_FEATURES, ...over.features },
        b: over.b ?? 3,
        tradeScore: 39,
        pAccept,
        pComplete: pAccept,
        overall: 20,
        dPO: 0.03,
        dCH: 0.01,
        dPPW: 1.5,
        gMine: 0.02,
        gPartner: -0.05,
      },
      change,
      at: AT,
    });
  }
  return out;
}

function sample(): FeedbackRecord[] {
  let r: FeedbackRecord[] = [];
  // Long shot (< 15%): one rejected with a "never accept" report, one sent and waiting.
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
  // Reports without an outcome.
  r = idea(r, "h", 0.45, [{ report: { reason: "doesnt-help" } }], { b: 0.4 });
  r = idea(r, "i", 0.45, [{ report: { reason: "doesnt-help", note: "He's hurt." } }], { b: 0.8 });
  r = idea(r, "j", 0.45, [{ report: { reason: "player-info" } }]);
  r = idea(r, "k", 0.45, [{ report: { reason: "settings" } }]);
  r = idea(r, "l", 0.45, [{ report: { reason: "other" } }]);
  return r;
}

describe("summarizeFeedback", () => {
  const s = summarizeFeedback(sample());

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

  it("averages the numbers and features each reason was given for (null when there's nothing to average)", () => {
    const help = s.byReason.find((r) => r.reason === "doesnt-help");
    expect(help?.averages.b).toBeCloseTo(0.6, 12);
    expect(help?.averages.pAccept).toBeCloseTo(0.45, 12);
    const never = s.byReason.find((r) => r.reason === "never-accept");
    expect(never?.averages).toMatchObject({ g: -0.2, a: -2, pAccept: 0.08, hist: null });
  });

  it("sends each report to its part of the model, and Rejected outcomes to the acceptance refit", () => {
    expect(s.byModelPart.map((p) => [p.part, p.reports, p.rejected])).toEqual([
      ["acceptance", 1, 3],
      ["benefit", 2, 0],
      ["adapters", 2, 0],
      ["review", 1, 0],
    ]);
  });

  it("bins predictions on the card's own labels and compares them with what happened", () => {
    expect(calibrationBins()).toEqual([
      { label: "Long shot", from: 0, to: 0.15 },
      { label: "Possible", from: 0.15, to: 0.35 },
      { label: "Decent", from: 0.35, to: 0.55 },
      { label: "Likely", from: 0.55, to: null },
    ]);
    expect(calibrationBins().map((b) => b.label)).toEqual(config.acceptance.labels.map((l) => l.label));
    const [long, possible, decent, likely] = s.calibration;
    expect(long).toMatchObject({ decided: 1, accepted: 0, rejected: 1, pending: 1, neverAccept: 1, observed: 0, meanPredicted: 0.08 });
    expect(possible).toMatchObject({ decided: 1, accepted: 1, countered: 1, observed: 1, meanPredicted: 0.3 });
    expect(decent).toMatchObject({ decided: 2, rejected: 2, observed: 0 });
    expect(decent?.meanPredicted).toBeCloseTo(0.45, 12);
    expect(likely).toMatchObject({ decided: 1, accepted: 1, observed: 1, meanPredicted: 0.8 });
    expect(s.unpredicted).toBe(0);
  });

  it("says whether there are enough decided outcomes for the refit", () => {
    expect(s.refit).toEqual({ decided: 5, needed: config.acceptance.refitMinOutcomes, ready: false });
    let many: FeedbackRecord[] = [];
    for (let i = 0; i < config.acceptance.refitMinOutcomes; i++) many = idea(many, `x${i}`, 0.4, [{ outcome: i % 2 ? "accepted" : "rejected" }]);
    expect(summarizeFeedback(many).refit.ready).toBe(true);
  });

  it("handles no feedback at all", () => {
    const empty = summarizeFeedback([]);
    expect(empty).toMatchObject({ total: 0, leagues: 0, refit: { decided: 0, ready: false } });
    expect(empty.calibration.every((b) => b.observed === null && b.meanPredicted === null)).toBe(true);
    expect(formatSummary(empty)).toContain("0 trade ideas with feedback from 0 leagues");
  });
});

describe("by version sent (planner reply to Checkpoint 4, change 6 and answer 8)", () => {
  /** The sample, plus ideas sent as the first offer, the full trade and Plan B (Plan B's estimate 0.6: Likely). */
  function withVersions(): FeedbackRecord[] {
    let r = sample();
    r = idea(r, "v1", 0.2, [{ outcome: "sent", sent: { version: "offerFirst", key: "v1-lean", pAccept: 0.1, pComplete: 0.1 } }, { outcome: "rejected" }]);
    r = idea(r, "v2", 0.3, [{ outcome: "accepted", sent: { version: "full", key: "v2", pAccept: 0.3, pComplete: 0.3 } }]);
    r = idea(r, "v3", 0.3, [{ outcome: "sent", sent: { version: "planB", key: "v3-b", pAccept: 0.6, pComplete: 0.6 } }, { outcome: "accepted" }]);
    return r;
  }

  it("counts each latest outcome by the version sent, records without one as unknown", () => {
    const s = summarizeFeedback(withVersions());
    expect(s.byVersion.map((v) => [v.version, v.total, v.outcomes])).toEqual([
      ["offerFirst", 1, { sent: 0, accepted: 0, rejected: 1, countered: 0 }],
      ["full", 1, { sent: 0, accepted: 1, rejected: 0, countered: 0 }],
      ["planB", 1, { sent: 0, accepted: 1, rejected: 0, countered: 0 }],
      ["unknown", 7, { sent: 1, accepted: 2, rejected: 3, countered: 1 }],
    ]);
    const text = formatSummary(s);
    expect(text).toContain("## By version sent");
    expect(text).toContain("| If they say no (Plan B) | 1 | 0 | 1 | 0 | 0 | 0 |");
    expect(text).toContain("| Unknown (not recorded) | 7 | 1 | 2 | 3 | 1 | 7 |");
  });

  it("says per version how many sent the card's own trade, the one the record's numbers and features describe (review of track F)", () => {
    // "full" is the card's own trade on a plain card (v2) but the card plus its throw-in when the card is the first offer
    // (v4: its key isn't the card's); a first offer that leaves out the card's throw-in (v1) and a Plan B (v3) never are.
    const records = idea(withVersions(), "v4", 0.35, [{ outcome: "sent", sent: { version: "full", key: "v4-plus-throw-in", pAccept: 0.5, pComplete: 0.5 } }]);
    const s = summarizeFeedback(records);
    expect(s.byVersion.map((v) => [v.version, v.total, v.cardOwn])).toEqual([
      ["offerFirst", 1, 0],
      ["full", 2, 1],
      ["planB", 1, 0],
      ["unknown", 7, 7],
    ]);
    expect(sentCardTrade(records.find((r) => r.tradeKey === "v2") as FeedbackRecord)).toBe(true);
    expect(sentCardTrade(records.find((r) => r.tradeKey === "v4") as FeedbackRecord)).toBe(false);
    expect(sentCardTrade(records.find((r) => r.tradeKey === "a") as FeedbackRecord)).toBe(true); // no version recorded
    const text = formatSummary(s);
    expect(text).toContain("| Version | Trade ideas | Sent | Accepted | Rejected | Countered | The card's own trade |");
    expect(text).toContain("| Full trade | 2 | 1 | 1 | 0 | 0 | 1 |");
  });

  it("calibrates on the sent version's estimate when the record has one (the prediction acted on), else the card's", () => {
    const records = withVersions();
    const v1 = records.find((r) => r.tradeKey === "v1") as FeedbackRecord;
    const v3 = records.find((r) => r.tradeKey === "v3") as FeedbackRecord;
    expect(predictedAccept(v1)).toBe(0.1);
    expect(predictedAccept(v3)).toBe(0.6);
    expect(predictedAccept(records.find((r) => r.tradeKey === "a") as FeedbackRecord)).toBe(0.08);
    const [long, , , likely] = summarizeFeedback(records).calibration;
    // v1 (a card at 20%, its first offer at 10%) lands in Long shot; v3 (a card at 30%, Plan B at 60%) in Likely.
    expect(long).toMatchObject({ decided: 2, rejected: 2 });
    expect(likely).toMatchObject({ decided: 2, accepted: 2, meanPredicted: 0.7 });
  });
});

describe("the text and the command line", () => {
  const records = sample();

  it("prints every section, and leaves the notes out unless asked", () => {
    const text = formatSummary(summarizeFeedback(records));
    for (const heading of ["# Trade feedback summary", "## By outcome", "## By reason", "## By model part", "## Acceptance calibration", "## Refit"]) expect(text).toContain(heading);
    expect(text).toContain("12 trade ideas with feedback from 2 leagues: 7 with an outcome, 6 with a report, 2 notes.");
    expect(text).toContain("| Long shot (0%–15%) | 1 | 0 | 1 | 0% | 8% | 0 | 1 | 1 |");
    expect(text).toContain("| Likely (55%+) | 1 | 1 | 0 | 100% | 80% | 0 | 0 | 0 |");
    expect(text).toContain("5 decided outcomes of the 30 the acceptance refit needs");
    expect(text).not.toContain("Team 2 never trades with me.");
    const withNotes = formatSummary(summarizeFeedback(records), feedbackNotes(records));
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
  });

  it("parses its arguments: the file, then --json and --notes in any order", () => {
    expect(parseArgs(["feedback.json"])).toEqual({ file: "feedback.json", json: false, notes: false });
    expect(parseArgs(["--notes", "C:\\Users\\me\\Downloads\\offersheet feedback.json", "--json"])).toEqual({ file: "C:\\Users\\me\\Downloads\\offersheet feedback.json", json: true, notes: true });
    expect(parseArgs([])).toEqual({ file: null, json: false, notes: false });
  });
});
