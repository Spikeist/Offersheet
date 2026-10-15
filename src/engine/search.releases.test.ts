/**
 * Checkpoint 7f (planner reply to Checkpoint 7e, answer 4: "keep the rule, but the card must say why"; the lead's R3): releases
 * at IR returns through whole searches. Made-up leagues (trade.testing.ts smallLeague) with one more player on each team's IR,
 * every roster full, so each return releases someone: every exact trade's list names each release the trade changes with why
 * when the near-tie rule decided it (returners.Displacement.keptInstead, lockable only for my players as imported), and each
 * release made with or without the trade exactly (RosterMoves.assumedLater), both through moves.testing.ts movesMismatch.
 */
import { describe, expect, it } from "vitest";
import { buildTradeContext, tradeInternals } from "./evaluate";
import type { ModelInputs } from "./inputs";
import type { LeagueSnapshot, Pos } from "./model";
import { movesMismatch } from "./moves.testing";
import { runTradeSearch, searchStateOf } from "./search";
import { TEST_NOW } from "./testLeague";
import { smallLeague } from "./trade.testing";

/**
 * `league` with one more player on each team's IR, an RB, WR or TE of 4 to 7 points a week (worth 25 × points², as
 * randomLeague's), back 1 to 3 weeks from now: bench-level players, so the rule and the lineup both decide some releases.
 */
function withReturners(league: { snapshot: LeagueSnapshot; inputs: ModelInputs }): { snapshot: LeagueSnapshot; inputs: ModelInputs } {
  const { snapshot, inputs } = league;
  const market = inputs.market;
  if (!market) throw new Error("withReturners: no market values");
  const positions: Pos[] = ["RB", "WR", "TE"];
  const players = { ...snapshot.players };
  const projections = { ...inputs.players };
  const values = { ...market.values };
  const ids: string[] = [];
  const teams = snapshot.teams.map((t, i) => {
    const id = `ret-${t.id}`;
    const pos = positions[i % positions.length] as Pos;
    const points = 4 + (i % 4);
    players[id] = { id, name: `Testy Returner ${t.id}`, pos, eligible: [pos], nflTeam: "AAA", injury: "IR", injuryReturnWeek: snapshot.currentWeek + 1 + (i % 3), ids: { sleeper: id } };
    const sleeper: Record<number, number | null> = {};
    for (let w = 1; w <= inputs.lastWeek; w++) sleeper[w] = points;
    projections[id] = { sleeper, actual: {} };
    values[id] = 25 * points * points;
    ids.push(id);
    return { ...t, ir: [...t.ir, id] };
  });
  return { snapshot: { ...snapshot, players, teams }, inputs: { ...inputs, players: projections, market: { ...market, values, knownIds: [...market.knownIds, ...ids] } } };
}

describe("releases at IR returns through whole searches (Checkpoint 7f; planner reply to Checkpoint 7e, answer 4)", { timeout: 300_000 }, () => {
  it("every exact trade names each changed release with why when the near-tie rule decided it, and each release made either way, exactly", () => {
    const count = { trades: 0, changed: 0, reasons: 0, notLockable: 0, alike: 0, alikeReasons: 0 };
    for (const seed of [11, 12]) {
      const l = withReturners(smallLeague(seed));
      const ctx = buildTradeContext(l.snapshot, l.inputs, { now: TEST_NOW });
      const I = tradeInternals(ctx);
      const state = searchStateOf(runTradeSearch(ctx));
      if (!state) throw new Error("no search state");
      for (const [key, x] of state.exactByKey) {
        count.trades++;
        expect(movesMismatch(I, x), `seed ${seed}, ${key}`).toEqual([]);
        for (const r of x.evaluation.myMoves?.assumedLater ?? []) {
          count.alike++;
          if (r.nearTie) count.alikeReasons++;
        }
        for (const m of x.evaluation.myMoves?.moves ?? []) {
          if (m.kind !== "release") continue;
          count.changed++;
          if (!m.nearTie) continue;
          count.reasons++;
          if (!m.nearTie.lockable) count.notLockable++;
        }
      }
    }
    // Every kind happens (seeds 11 and 12: about 360 exact trades, 170 changed releases, 22 of them with a reason, 15 not
    // lockable, 150 made either way, 70 of them with a reason).
    expect(count.trades).toBeGreaterThan(300);
    expect(count.reasons).toBeGreaterThan(10);
    expect(count.notLockable).toBeGreaterThan(5);
    expect(count.changed).toBeGreaterThan(count.reasons);
    expect(count.alikeReasons).toBeGreaterThan(20);
    expect(count.alike).toBeGreaterThan(count.alikeReasons);
  });
});
