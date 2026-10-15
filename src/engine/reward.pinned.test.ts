/**
 * "Only the champion" and "Making the playoffs" stay bit for bit through the reward engine (Checkpoint 7c; planner reply to
 * Checkpoint 7b, §6: "“Only the champion” is this formula with 1st = 100%, so today's numbers don't change", and "Making the
 * playoffs" stays 0.70 × ΔPO + 0.30 × ΔCH). The numbers below were stored from HEAD 7a1ac38, before src/engine/reward.ts
 * existed, by running these very builds: the League model's automatic playoff weight ω and its B per point in each run, its
 * "Helps you" calibration run, my headline odds, the search's B₃ and every card it shows (key, B, Helps you, P_complete,
 * Overall, in order; since Checkpoint 7d the cards of the search without the helps-both lane, TradeSearchOptions
 * .helpsBothLane false: the lane changes which trades are cards, not the reward's numbers). They are values, not formulas:
 * a change that moves any of them, by however little, fails here.
 * Synthetic leagues (trade.testing.ts: made-up players, placeholder teams), EV lineups, the app's default seasons as they were
 * at HEAD: one block of config.simulation.finalSims (5,000) seasons for the League model, the search's final simulation and the
 * cards alike. Checkpoint 7e (planner reply to Checkpoint 7d, item 1.1) shows every number on a shown block of 20,000 seasons
 * (config.simulation.shownSims), which moves these values by the extra seasons alone; so this file runs with the shown block
 * set to the ranking block's seasons (shownSims = finalSims: the League model, ω, B₃ and the cards on the first 5,000 seasons,
 * as at HEAD), where the engine is Checkpoint 7d's bit for bit (evaluate.baseline.test.ts and search.shown.test.ts check the
 * two blocks; on Parker's week-6 dump the whole search matched checkpoint-7d's at shownSims 5,000), and its purpose, the reward
 * engine's equivalence, is what it pins.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config } from "./config";
import { buildTradeContext } from "./evaluate";
import type { ModelInputs } from "./inputs";
import { buildLeagueModel } from "./league";
import type { LeagueSnapshot } from "./model";
import { runTradeSearch } from "./search";
import { defaultTradeSettings, type TradeSettings } from "./settings";
import { TEST_NOW } from "./testLeague";
import { handLeague, smallLeague } from "./trade.testing";

type Card = [key: string, b: number, helpsYou: number, pComplete: number, overall: number];
interface Pinned {
  omega: number;
  /** PlayoffWeightAuto's B per point: the regular-season run's, the playoff run's. */
  perPoint: [number, number];
  calibration: { dPO: number; dCH: number };
  headline: { pPlayoffs: number; pTitle: number };
  b3: number;
  cards: Card[];
}

/** Stored from HEAD 7a1ac38 (Checkpoint 7c wave 3), before the reward engine. */
const HEAD: Record<"small11ev" | "hand", Record<"title" | "playoffs", Pinned>> = {
  small11ev: {
    title: {
      omega: 2.51,
      perPoint: [0.12834936825980978, 0.3222666836737568],
      calibration: { dPO: 0.0524, dCH: 0.029431852109065737 },
      headline: { pPlayoffs: 0.7482, pTitle: 0.1096632755621123 },
      b3: 3.287707429270588,
      cards: [
        ["4|give:1011,1012|get:1038", 6.350041809888275, 86, 0.3543457177344628, 50],
        ["4|give:1011|get:1038", 6.4813207357628055, 86, 0.3334068976148933, 48],
        ["3|give:1011,1012|get:1028,1031", 3.159475974743239, 62, 0.5995266488044152, 44],
        ["5|give:1001,1008|get:1060", 3.7619319640034385, 68, 0.4647230173051891, 41],
        ["4|give:1001|get:1039", 2.4347412736711855, 52, 0.6620984384665635, 39],
        ["5|give:1001,1002|get:1052,1060", 3.826234338651986, 69, 0.3758668586806908, 35],
        ["5|give:1007|get:1051,1060", 4.063563529132996, 71, 0.10330283016624658, 12],
      ],
    },
    playoffs: {
      omega: 0.5,
      perPoint: [0.33144356788254764, 0.11374118247309066],
      calibration: { dPO: 0.05779999999999996, dCH: 0.030348378219651764 },
      headline: { pPlayoffs: 0.7168, pTitle: 0.1114072372630485 },
      b3: 4.9564513465895494,
      cards: [
        ["3|give:1011,1012|get:1028,1031", 6.22337094857234, 72, 0.48722149517419655, 46],
        ["3|give:1011|get:1030,1031", 5.864055267497773, 69, 0.4903575918375215, 44],
        ["4|give:1011,1012|get:1038", 7.432916584179428, 78, 0.3543457177344628, 41],
        ["2|give:1001,1012|get:1014", 5.702455386511552, 68, 0.31090829629730854, 30],
        ["2|give:1001|get:1014", 6.190820881678595, 71, 0.28351455722869995, 30],
        ["4|give:1001,1002|get:1038,1044", 4.308776464885554, 58, 0.3048211575238653, 23],
        ["5|give:1007|get:1051,1060", 4.062401392528091, 56, 0.10330283016624658, 8],
      ],
    },
  },
  hand: {
    title: {
      omega: 2.84,
      perPoint: [0.3188524625845159, 0.9070932187331576],
      calibration: { dPO: 0.05719999999999992, dCH: 0.06927865958895502 },
      headline: { pPlayoffs: 0.781, pTitle: 0.47533527982869744 },
      b3: 6.746686065061175,
      cards: [
        ["2|give:ra1|get:rb2,wb2", 6.022521665868022, 59, 0.2172096344362908, 18],
        ["4|give:wa1|get:rb4,wa4", 4.162623515151429, 46, 0.23399291146457427, 13],
        ["4|give:ra1|get:rb4,wa4", 1.859384353968365, 24, 0.46435508492881306, 12],
        ["2|give:wa1|get:rb2,wb2", 8.667117442857075, 72, 0.09066579058260546, 11],
        ["3|give:wa1|get:rb3,wb3", 1.6588986870711389, 22, 0.4499143715285666, 10],
        ["3|give:rb1|get:rb3,te3", 3.1159944994584796, 37, 0.23459720379567608, 10],
        ["3|give:wb1|get:te3,wb3", 3.041651490210264, 36, 0.23535711392124406, 10],
        ["4|give:wb1|get:rb4,wb4", 3.829375818040203, 43, 0.17670886850775033, 10],
      ],
    },
    playoffs: {
      omega: 0.76,
      perPoint: [0.4209675358141423, 0.32015054778817326],
      calibration: { dPO: 0.05719999999999992, dCH: 0.06927865958895502 },
      headline: { pPlayoffs: 0.781, pTitle: 0.47533527982869744 },
      b3: 6.0823597876686435,
      cards: [
        ["2|give:ra1|get:rb2,wb2", 4.930971886879123, 56, 0.2172096344362908, 16],
        ["4|give:wa1|get:rb4,wa4", 4.372447244698474, 51, 0.23399291146457427, 15],
        ["4|give:ra1|get:rb4,wa4", 2.1043593790807162, 29, 0.46435508492881306, 15],
        ["4|give:wa1|get:wa4,wb4", 1.9652718526865673, 28, 0.41395657506837036, 13],
        ["3|give:wa1|get:rb3,wb3", 1.738373978804013, 25, 0.4499143715285666, 12],
        ["3|give:rb1|get:rb3,te3", 3.2112834616825148, 41, 0.23459720379567608, 12],
        ["3|give:wb1|get:te3,wb3", 3.1468324105575363, 40, 0.23535711392124406, 11],
      ],
    },
  },
};

const LEAGUES: Record<keyof typeof HEAD, () => { snapshot: LeagueSnapshot; inputs: ModelInputs }> = {
  small11ev: () => smallLeague(11),
  hand: () => handLeague(),
};

describe("“Only the champion” and “Making the playoffs”: HEAD's numbers bit for bit (stored values)", { timeout: 120_000 }, () => {
  // HEAD's single block of seasons (the file header): the shown block set to the ranking block's, for this file only.
  const simulation = config.simulation as { shownSims: number };
  const shownSims = simulation.shownSims;
  beforeAll(() => {
    simulation.shownSims = config.simulation.finalSims;
  });
  afterAll(() => {
    simulation.shownSims = shownSims;
  });
  for (const name of Object.keys(HEAD) as (keyof typeof HEAD)[]) {
    for (const goal of ["title", "playoffs"] as const) {
      it(`${name}, ${goal}: ω, the calibration run, my headline odds, B₃ and every card`, () => {
        const want = HEAD[name][goal];
        const { snapshot, inputs } = LEAGUES[name]();
        const settings: TradeSettings = { ...defaultTradeSettings(), goal };
        const model = buildLeagueModel(snapshot, inputs, { now: TEST_NOW, scenarios: 0, settings });
        expect(model.playoffWeight).toBe(want.omega);
        expect([model.playoffWeightAuto?.regularPerPoint, model.playoffWeightAuto?.playoffPerPoint]).toEqual(want.perPoint);
        expect({ dPO: model.helpsCalibration?.dPO, dCH: model.helpsCalibration?.dCH }).toEqual(want.calibration);
        const mine = model.odds?.teams.find((t) => t.teamId === model.myTeamId);
        expect({ pPlayoffs: mine?.pPlayoffs, pTitle: mine?.pTitle }).toEqual(want.headline);
        const ctx = buildTradeContext(snapshot, inputs, { now: TEST_NOW, scenarios: 0, settings });
        // Without Checkpoint 7d's helps-both lane (search.ts), which came after HEAD: its trades go through the same finalist
        // rules as every exact trade, so it moves the cards (smallLeague(11): 10 cards with it under "Only the champion" and 11
        // under "Making the playoffs", 7 without), not the reward's numbers.
        const result = runTradeSearch(ctx, { settings, helpsBothLane: false });
        expect(result.helpsScale?.b3).toBe(want.b3);
        expect(result.trades.map((t): Card => [t.key, t.b as number, t.tradeScore as number, t.pComplete, t.overall as number])).toEqual(want.cards);
      });
    }
  }
});
