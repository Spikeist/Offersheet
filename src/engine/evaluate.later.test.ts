/**
 * Checkpoint 7e (planner reply to Checkpoint 7d, item 4.2, "Now or after this week": "run the simulation once more with the
 * trade starting next week. Show it as 'Helps you 37 now · 41 if done after this week's games.'"): evaluate.ts laterNumbers,
 * laterApplies and weeksToDeadline, and the Trade Analyzer's TradeEvaluation.later. The later run holds the current week as in
 * the trade's "before" for both teams and is measured from that "before"'s own run on the shown block: holding no week is the
 * card's own run bit for bit, holding every week leaves only the trade's market term; no line while a week is under way, with
 * no week after this one, or with fewer than config.explain.nowOrLaterWeeks weeks before the deadline. Seeded synthetic
 * leagues (trade.testing.ts); teams are placeholders, players made up.
 */
import { describe, expect, it } from "vitest";
import { tradeScore } from "./benefit";
import { config } from "./config";
import { analyzeTrade, buildTradeContext, evaluateExact, laterApplies, laterNumbers, simulateTrade, tradeInternals, weeksToDeadline, type ExactTrade, type TradeContext } from "./evaluate";
import type { ModelInputs } from "./inputs";
import type { LeagueSnapshot } from "./model";
import { defaultTradeSettings, type TradeSettings } from "./settings";
import { TEST_NOW } from "./testLeague";
import { smallLeague, type SeasonSpec } from "./trade.testing";
import type { TradeAsset, TradeProposal } from "./tradeModel";

const p = (...ids: string[]): TradeAsset[] => ids.map((id) => ({ kind: "player", id }));
const DAY = 86_400_000;
const settings: TradeSettings = defaultTradeSettings();

function contextOf(season: SeasonSpec = {}, edit: (league: { snapshot: LeagueSnapshot; inputs: ModelInputs }) => void = () => undefined): TradeContext {
  const league = smallLeague(11, season);
  edit(league);
  return buildTradeContext(league.snapshot, league.inputs, { now: TEST_NOW, settings });
}

/** The first legal 1-for-1s between my team and the next teams (my players in roster order, theirs too), with a B. */
function trades(ctx: TradeContext, n: number): ExactTrade[] {
  const I = tradeInternals(ctx);
  const me = I.me;
  if (!me) throw new Error("no team picked");
  const out: ExactTrade[] = [];
  for (const partner of I.teams.filter((t) => t !== me)) {
    for (const give of me.roster.slice(0, 6)) {
      for (const get of partner.roster.slice(0, 6)) {
        const proposal: TradeProposal = { partnerId: partner.id, give: p(give), get: p(get) };
        const x = evaluateExact(I, proposal, 2);
        if ("illegal" in x) continue;
        out.push(x);
        if (out.length >= n) return out;
        break;
      }
    }
  }
  return out;
}

describe("now or after this week (Checkpoint 7e, item 4.2)", () => {
  const ctx = contextOf();
  const I = tradeInternals(ctx);
  const xs = trades(ctx, 6);

  it("holding no week is the card's own run on the shown block, bit for bit; this week's games make the difference", () => {
    expect(xs.length).toBeGreaterThan(3);
    expect(laterApplies(I)).toBe(true);
    let differs = 0;
    for (const x of xs) {
      const card = simulateTrade(I, x, "shown", settings.lambda, settings.protectValue);
      expect(laterNumbers(I, x, settings, 0), x.evaluation.key).toEqual({ b: card.b, tradeScore: card.tradeScore });
      const later = laterNumbers(I, x, settings);
      if (!later || later.b === null) throw new Error(`no later numbers for ${x.evaluation.key}`);
      // Scored on the card's own scale (the shown block's B₃).
      expect(later.tradeScore).toBe(tradeScore(later.b, card.b3));
      if (Math.abs(later.b - (card.b as number)) > 1e-9) differs++;
    }
    expect(differs).toBeGreaterThan(0);
  });

  it("holds the week for both teams, from the trade's own \"before\": every week held leaves only the trade's market term", () => {
    const weeks = I.league.lp.weeks.weeks.length;
    for (const x of xs.slice(0, 3)) {
      const card = simulateTrade(I, x, "shown", settings.lambda, settings.protectValue);
      const held = laterNumbers(I, x, settings, weeks);
      // A redraft league: B = B_win + the market term, and with both rows as before every week no odds move (B_win 0).
      expect(held?.b, x.evaluation.key).toBeCloseTo((card.b as number) - (card.bWin as number), 12);
      // The same through the path of a trade with its own "before" (item 2.1): here my baseline itself, so the same numbers.
      const me = I.me;
      if (!me) throw new Error("no team");
      const own = { ...x, before: me.base };
      expect(laterNumbers(I, own, settings, weeks)?.b).toBeCloseTo((card.b as number) - (card.bWin as number), 12);
      expect(laterNumbers(I, own, settings, 0)).toEqual({ b: card.b, tradeScore: card.tradeScore });
    }
  });

  it("is memoized per exact trade and settings", () => {
    const x = xs[0] as ExactTrade;
    const a = laterNumbers(I, x, settings);
    expect(laterNumbers(I, x, settings)).toBe(a);
    const high = laterNumbers(I, x, { ...settings, protectValue: "high" });
    expect(high).not.toBe(a);
    expect(laterNumbers(I, x, { ...settings, protectValue: "high" })).toBe(high);
  });

  it("comes with every Analyzer evaluation (AnalyzeOptions.later false skips it)", () => {
    const x = xs[0] as ExactTrade;
    const analysis = analyzeTrade(ctx, x.evaluation.proposal, { settings });
    expect(analysis.evaluation?.later).toEqual(laterNumbers(I, x, settings));
    expect(analysis.evaluation?.tradeScore).toBe(simulateTrade(I, x, "shown", settings.lambda, settings.protectValue).tradeScore);
    const without = analyzeTrade(ctx, x.evaluation.proposal, { settings, later: false });
    expect(without.evaluation && "later" in without.evaluation).toBe(false);
    // Everything else is the same evaluation.
    const { later: _later, ...rest } = analysis.evaluation ?? {};
    void _later;
    expect(rest).toEqual(without.evaluation);
  });
});

describe("when there's no later line (Checkpoint 7e, item 4.2)", () => {
  it("weeksToDeadline: a date's whole days ÷ 7, else the deadline week less the platform's week, null without one", () => {
    const now = new Date("2026-10-14T20:55:00.000Z");
    expect(weeksToDeadline(null, now, 6)).toBeNull();
    expect(weeksToDeadline({}, now, 6)).toBeNull();
    expect(weeksToDeadline({ week: 13 }, now, 6)).toBe(7);
    expect(weeksToDeadline({ week: 7 }, now, 6)).toBe(1);
    // The date wins over the week (acceptance.ts tradeDeadlinePassed reads it first): whole days only.
    expect(weeksToDeadline({ week: 13, date: new Date(now.getTime() + 14 * DAY).toISOString() }, now, 6)).toBe(2);
    expect(weeksToDeadline({ date: new Date(now.getTime() + 14 * DAY - 1).toISOString() }, now, 6)).toBeCloseTo(13 / 7, 12);
    expect(weeksToDeadline({ date: "2026-12-02T17:00:00.000Z" }, now, 6)).toBe(48 / 7);
    // A date that doesn't parse: the week.
    expect(weeksToDeadline({ week: 9, date: "soon" }, now, 6)).toBe(3);
    expect(weeksToDeadline({ date: "2026-10-01T00:00:00.000Z" }, now, 6)).toBeLessThan(0);
  });

  it("only while at least nowOrLaterWeeks weeks remain before the trade deadline", () => {
    expect(config.explain.nowOrLaterWeeks).toBe(2);
    const at = (days: number) => new Date(TEST_NOW.getTime() + days * DAY).toISOString();
    for (const [deadline, applies] of [
      [null, true],
      [{ date: at(14) }, true],
      [{ date: at(20) }, true],
      [{ date: new Date(TEST_NOW.getTime() + 14 * DAY - 60_000).toISOString() }, false],
      [{ date: at(7) }, false],
      [{ week: 8 }, true], // week 6 now: 2 weeks
      [{ week: 7 }, false],
      [{ week: 5 }, false], // passed
    ] as const) {
      const ctx = contextOf({ tradeDeadline: deadline as SeasonSpec["tradeDeadline"] });
      expect(laterApplies(tradeInternals(ctx)), JSON.stringify(deadline)).toBe(applies);
    }
  });

  it("none while a week is under way: its games already play as rosters stand, so 'now' starts next week", () => {
    const ctx = contextOf({}, (league) => {
      const nfl = league.inputs.nfl as NonNullable<ModelInputs["nfl"]>;
      nfl.kickoffs = { 6: { T01: new Date(TEST_NOW.getTime() - 3_600_000).toISOString() } };
    });
    const I = tradeInternals(ctx);
    expect(I.inProgress).toBe(true);
    expect(laterApplies(I)).toBe(false);
    const x = trades(ctx, 1)[0] as ExactTrade;
    expect(laterNumbers(I, x, settings)).toBeNull();
    const analysis = analyzeTrade(ctx, x.evaluation.proposal, { settings });
    expect(analysis.evaluation).not.toBeNull();
    expect(analysis.evaluation && "later" in analysis.evaluation).toBe(false);
  });

  it("none when no week after this one counts, and none without odds", () => {
    // Week 6 is the final (2 playoff teams): nothing after it.
    const last = contextOf({ regular: [1, 2, 3, 4, 5], playoff: [6], playoffTeams: 2, pastWinnersOrder: ["1", "2", "3", "4", "5", "6"] });
    expect(laterApplies(tradeInternals(last))).toBe(false);
    // Week 6 the last regular-season week, a playoff week after it: that one counts.
    const next = contextOf({ regular: [1, 2, 3, 4, 5, 6], playoff: [7], playoffTeams: 2, pastWinnersOrder: ["1", "2", "3", "4", "5", "6"] });
    expect(laterApplies(tradeInternals(next))).toBe(true);
    // No team picked: no odds of mine.
    const noTeam = contextOf({}, (league) => {
      league.snapshot.myTeamId = null;
    });
    expect(laterApplies(tradeInternals(noTeam))).toBe(false);
  });
});
