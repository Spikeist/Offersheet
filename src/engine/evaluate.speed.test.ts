/**
 * Screening's roster legality priced fast (Phase 4 addendum, lead decision N6), against a fresh solve: after a trade's
 * drops and adds, the side's EV lineups (and so its EV ROS and the partner's look) are those of the final roster solved
 * from scratch, bit for bit. A drop re-solves only from the lineups before it (the weeks the dropped player started);
 * position counts are kept as players come and go.
 */
import { describe, expect, it } from "vitest";
import { buildTradeContext, legalSide, tradeInternals, type TeamState } from "./evaluate";
import { mulberry32 } from "./rng";
import { rosValue, solveEvWeeks, teamEval, type TableRow } from "./teamValue";
import { TEST_NOW } from "./testLeague";
import { smallLeague } from "./trade.testing";

describe("screening's legality in EV lineups (legalSide)", () => {
  it("the final roster's lineups equal a fresh solve, bit for bit, and its EV ROS to float noise: 300 random 2-for-1s and 1-for-2s", () => {
    const rand = mulberry32(31337);
    let drops = 0;
    let adds = 0;
    for (const seed of [3, 5, 8]) {
      const league = smallLeague(seed, { maxRosterSize: 12, rosterMinimums: seed === 5 ? { QB: 1, TE: 1 } : undefined });
      const I = tradeInternals(buildTradeContext(league.snapshot, league.inputs, { now: TEST_NOW, scenarios: 0 }));
      const me = I.me as TeamState;
      const others = I.teams.filter((t) => t !== me);
      // Trades hold active-roster players (never a free agent a V* picked up); screening applies them to V*(T).
      const skill = (t: TeamState) => t.roster.filter((id) => I.league.table.rows.has(id) && !["K", "DEF"].includes(I.league.posOf(id) as string));
      for (let trial = 0; trial < 100; trial++) {
        const partner = others[Math.floor(rand() * others.length)] as TeamState;
        const mine = skill(me);
        const theirs = skill(partner);
        const pick = (xs: string[], k: number) => [...xs].sort(() => rand() - 0.5).slice(0, k);
        const twoForOne = rand() < 0.5;
        const give = pick(mine, twoForOne ? 2 : 1);
        const get = pick(theirs, twoForOne ? 1 : 2);
        for (const [side, before, given, received] of [
          [me, me.vstar.roster, give, get],
          [partner, partner.vstar.roster, get, give],
        ] as [TeamState, readonly string[], string[], string[]][]) {
          const out = legalSide(I, side, before, given, received, "ev", "Team", "look");
          if ("illegal" in out) continue;
          drops += out.change.drops.length;
          adds += out.change.adds.length;
          const look = out.look as NonNullable<typeof out.look>;
          const rows = out.roster.flatMap((id) => I.league.table.rows.get(id) ?? []);
          const fresh = solveEvWeeks(teamEval([...rows, ...side.stream.rows] as TableRow[], I.league.slots), I.W);
          expect(Array.from(look.lv), `seed ${seed} trial ${trial} ${side.id}`).toEqual(Array.from(fresh.lv));
          expect(out.ros as number).toBeCloseTo(rosValue(fresh.lv, I.weights), 9);
          // My side needs only its EV ROS: the same number.
          const ros = legalSide(I, side, before, given, received, "ev", "Team", "ros");
          if (!("illegal" in ros)) expect(ros.ros as number).toBeCloseTo(rosValue(fresh.lv, I.weights), 9);
        }
      }
    }
    expect(drops).toBeGreaterThan(100);
    expect(adds).toBeGreaterThan(100);
  });
});
