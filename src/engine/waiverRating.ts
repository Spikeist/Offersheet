/**
 * "Rest of season" rated by Helps you (Checkpoint 7e; planner reply to Checkpoint 7d, item 3.4: "rate each rest-of-season row
 * with the season simulation under the league's reward setting, as for trades. Pick the drop with the best Helps you,
 * following 3.2 and 3.3"; the lead's decisions for wave C). Pure and deterministic: no I/O, no clock of its own (an optional
 * one only marks the stages), and no randomness but the common-random-numbers matrix it's handed. waivers.ts asks it to rate
 * the season list's rows (WaiverRater); league.ts step 10b builds it from the League model's own pieces (waiverRaterOf).
 *
 * The runs (one season simulation per move, as a trade's "after" run):
 * - Before: my active roster as it stands (TeamModel.score: priced as a final evaluation, my IR returners back with their
 *   roster spot from their return week, my streaming rows, no modeled pickup of mine: the planner's "Leave out the user's
 *   own modeled pickups, or the model's own pickup would always score 0"), every other team as in the League page's
 *   headline (TeamModel.scoreWithPickups: after its modeled pickups). WaiverRaterInputs.built is that season's setup.
 * - After: the same with one move, the pickup in and the drop out (WaiverRaterInputs.scoreAfter: league.ts prices it as it
 *   prices my roster as it stands, the week under way held at its score as it stands, as every trade holds it). ⚠️ Ours, the
 *   list's known approximation: a pickup another team is modeled to claim doesn't change that team's modeled pickups (one
 *   free agent, one team isn't run again per row).
 * - Both on the same seasons (common random numbers: the change is the move's alone): the first config.waivers.
 *   ratingScreenSims seasons of the shown block to screen (the planner: "screen with 1,000 seasons"), the whole shown block
 *   (config.simulation.shownSims, item 1.1's count) to finish (below). ⚠️ Ours (Checkpoint 7f; sim.ts, "Continuing a run"):
 *   a finishing run continues the same score's screening run, its first seasons, so it plays only the seasons screening
 *   didn't; its numbers are the full run's, bit for bit.
 *
 * B (WaiverRaterInputs.benefitOf, league.ts: benefit.benefit, as for trades): B_win from my P(playoffs) and prize components'
 * changes under the league's reward ("What does your league reward?" with its prizes), plus in a redraft league the market
 * term (B₃ / 3) × κ × clamp(g_mkt(me)) for receiving him and giving the drop (each at max(v, W), market.packageValues' neutral
 * rules; an open spot: receiving him for a roster spot), ⚠️ only when it's a loss: the trade value the move gives up (the
 * lead's call, the final review of Checkpoint 7e, ENG-7E-2; league.ts waiverRaterOf); a dynasty or keeper league's mix with
 * ΔDyn either way (a long-term value gained is next season's roster too). Helps you =
 * benefit.tradeScore(B, B₃) on the League model's B₃ (LeagueModel.helpsCalibration under the same reward), the trade cards'
 * scale: +3 points a week reads 63.
 *
 * The rating (WaiverRater.rate), for every row the season list holds (a free agent and every drop the rules allow:
 * waivers.ts, "Drop from the same position" and the untouchables included; an open roster spot is the one option when
 * there's one):
 * 1. Screening: every option of every row on the screening seasons; each row takes the option with the best B (ties: the
 *    lower keep value, then the smaller drop id). The planner: "Pick the drop with the best Helps you".
 * 2. Finishing: the config.waivers.ratingFinishRows rows with the best screened B (ties: more points, then the smaller id)
 *    simulated again, their chosen option only, on the shown block; ⚠️ ours, the drop stays the one screening chose, and
 *    ⚠️ ours (review of wave C, RC-ENG-5) a row screened below config.waivers.ratingFinishFloor × B₃ isn't finished: it
 *    prints "No gain" either way (on Parker's week-6 leagues a screened B lay at most 0.04 × B₃ from its B on the shown
 *    block), and on his second league 9 of the 10 finished rows were such rows, most of the rating's time. Rows not finished
 *    keep their screened B and Helps you (⚠️ the lead's reading: "rows past the top 10 keep their screened Helps you"), each
 *    row saying how many seasons are behind it (WaiverRowRating.sims). Each row keeps B_win too, B's odds part
 *    (WaiverRowRating.bWin), so the page can say when the trade value a move gives up is why it prints no gain.
 * Moves whose after-score is the same, number for number on the weeks the simulator reads, share one run (memoized per
 * block; the before score's own entry is the before run, so a move that changes nothing has B_win 0 exactly): on Parker's
 * league (week 6) 228 options of 48 rows are 62 distinct scores, most of them depth receivers who never start for him.
 */
import type { Benefit } from "./benefit";
import { tradeScore } from "./benefit";
import type { WaiverListRating, WaiverRowRating } from "./leagueModel";
import { runPrizeDeltas, type PrizeDeltas, type PrizeOdds } from "./reward";
import type { SimSetupResult } from "./season";
import { simulateSeason, type SimNormals, type SimProgress } from "./sim";
import type { WeeklyScore } from "./teamValue";
import type { WaiverRater, WaiverRatingResult, WaiverRatingRow } from "./waivers";

/** B's closer than this are a tie (float noise, not a tunable). */
const EPS = 1e-12;

const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The config keys the rating reads (config.waivers), widened for tests (ratingFinishFloor absent: every row may be finished). */
export interface WaiverRaterConfig {
  readonly waivers: { readonly ratingScreenSims: number; readonly ratingFinishRows: number; readonly ratingFinishFloor?: number };
}

/** My odds' changes from the before run to a move's run on the same seasons (what B reads). */
export interface WaiverRunChange {
  dPO: number;
  /** P(title)'s change; null when either side's title odds are unknown. */
  dCH: number | null;
  /** Every prize component's change (reward.ts runPrizeDeltas: the weekly high scores' null unless the setup lists them). */
  dPrizes: PrizeDeltas;
}

/** What the rating reads (league.ts step 10b fills it from the League model's build: the file header). */
export interface WaiverRaterInputs {
  /**
   * The before season's setup (season.ts buildSimSetup): every team after its modeled pickups (TeamModel.scoreWithPickups),
   * mine as my roster stands (TeamModel.score), the weekly high scores listed when the reward pays them.
   */
  built: SimSetupResult;
  /** My team's index in built.setup.teams. */
  myIndex: number;
  /** The shown block's seasons (sim.simNormals of the League model's seed and run count): the screening reads its first ones. */
  normals: SimNormals;
  seed: number;
  /** Whether the setup lists the weekly high scores (reward.paysWeekly), so their change is known (reward.runPrizeDeltas). */
  highScores: boolean;
  /**
   * My weekly score after one move, the pickup in and the drop out (null: into an open roster spot), priced as my roster as
   * it stands is (the file header); null when it can't be priced (then the option is left out).
   */
  scoreAfter: (add: string, drop: string | null) => WeeklyScore | null;
  /**
   * B for a move from my odds' changes (the file header; league.ts builds it on benefit.benefit), with B_win, its odds part
   * (absent: unknown), so the page can tell a move whose odds gain the trade value it gives up outweighs (review of wave C,
   * UI-C-2).
   */
  benefitOf: (add: string, drop: string | null, change: WaiverRunChange) => Pick<Benefit, "b"> & Partial<Pick<Benefit, "bWin">>;
  /** "Helps you"'s scale, B₃ (benefit.helpsScale on LeagueModel.helpsCalibration under the reward). */
  b3: number;
  /** What B weighs besides the odds (WaiverListRating.weighs). */
  weighs: WaiverListRating["weighs"];
  /** Called as the rating starts ("start") and as each of its stages ends ("screen", "finish"): league.ts marks the build's timings with it. */
  onStage?: (stage: "start" | "screen" | "finish") => void;
}

/** My odds from one run (evaluate.ts runSim's reading: P(playoffs) and the prize components, season.ts's rules for unknown ones). */
interface MyRun {
  pPlayoffs: number;
  prizes: PrizeOdds;
}

/** A score as the simulator reads it: my row's mean and SD per drawn week, and a key that is the same exactly when they are. */
interface SimRow {
  mean: Float64Array;
  sd: Float64Array;
  key: string;
}

/** A row's best option so far in screening: its index, its B and B_win (null: not a number), the keep value and drop its ties read, and its score. */
interface Screened {
  option: number;
  b: number | null;
  bWin: number | null;
  keep: number;
  drop: string | null;
  row: SimRow;
}

/** A whole number ≥ 0 from a config value (else 0). */
function count(x: number): number {
  return Number.isFinite(x) ? Math.max(0, Math.floor(x)) : 0;
}

/** A finite number, else null. */
const finite = (b: number | null | undefined): number | null => (typeof b === "number" && Number.isFinite(b) ? b : null);

/** Whether option `a` is better than `cur` (the file header, screening): the higher B (none lowest), then the lower keep value, then the smaller drop id. */
function beats(a: Pick<Screened, "b" | "keep" | "drop">, cur: Pick<Screened, "b" | "keep" | "drop">): boolean {
  const av = a.b ?? Number.NEGATIVE_INFINITY;
  const cv = cur.b ?? Number.NEGATIVE_INFINITY;
  if (av > cv + EPS) return true;
  if (av < cv - EPS) return false;
  return a.keep < cur.keep || (a.keep === cur.keep && byId(a.drop ?? "", cur.drop ?? "") < 0);
}

/**
 * The rating (the file header) for one League model build's season list. Throws only what the simulator throws for a
 * move's season it can't decide (a RangeError: a score that isn't a number), which league.ts rateWaiverUpgrades catches:
 * the list then stays in points; the setup is the one the League model's own runs already accepted, with other scores.
 */
export function createWaiverRater(x: WaiverRaterInputs, cfg: WaiverRaterConfig): WaiverRater {
  const { setup, simWeekToModelWeek } = x.built;
  const per = setup.weeks.length * setup.teams.length;
  const shown = x.normals;
  const screenSims = Math.min(count(cfg.waivers.ratingScreenSims), shown.sims);
  const screen: SimNormals = screenSims === shown.sims ? shown : { sims: screenSims, weeks: shown.weeks, teams: shown.teams, z: shown.z.subarray(0, screenSims * per) };
  const finishRows = count(cfg.waivers.ratingFinishRows);
  // The lowest screened B a row is finished from (config.waivers.ratingFinishFloor × B₃; the file header, step 2).
  const floorShare = cfg.waivers.ratingFinishFloor;
  const finishFrom = typeof floorShare === "number" && Number.isFinite(floorShare) && Number.isFinite(x.b3) ? floorShare * x.b3 : Number.NEGATIVE_INFINITY;

  const rowOf = (score: WeeklyScore): SimRow => {
    const mean = Float64Array.from(simWeekToModelWeek, (k) => score.mean[k] as number);
    const sd = Float64Array.from(simWeekToModelWeek, (k) => score.sd[k] as number);
    return { mean, sd, key: `${mean.join(",")}|${sd.join(",")}` };
  };
  /**
   * My odds from the setup with my row replaced (`row`; null: the setup's own, the before), on `normals`, with the run's
   * progress when `prefix` keeps it, or continuing one (Checkpoint 7f: below).
   */
  const runOn = (row: SimRow | null, normals: SimNormals, prefix: { keep?: boolean; resume?: SimProgress }): { run: MyRun; progress?: SimProgress } => {
    const mean = [...setup.mean];
    const sd = [...setup.sd];
    if (row) {
      mean[x.myIndex] = row.mean;
      sd[x.myIndex] = row.sd;
    }
    const res = simulateSeason({ ...setup, mean, sd }, { sims: normals.sims, seed: x.seed, normals, ...prefix });
    const o = res.teams[x.myIndex];
    const playoffsKnown = x.built.playoffsKnown && res.playoffsKnown;
    const known = (v: number | undefined, ok: boolean): number | null => (ok && v !== undefined && Number.isFinite(v) ? v : null);
    const run: MyRun = {
      pPlayoffs: o?.pPlayoffs ?? 0,
      prizes: {
        first: known(o?.pTitle, playoffsKnown),
        second: known(o?.pSecond, playoffsKnown),
        third: known(o?.pThird, playoffsKnown && res.thirdKnown),
        weeklyHigh: o?.expHighScores ?? 0,
        pointsLeader: o?.pPointsLeader ?? 0,
      },
    };
    return { run, ...(res.progress ? { progress: res.progress } : {}) };
  };
  // ⚠️ Ours (Checkpoint 7f; sim.ts, "Continuing a run"): the screening seasons are the shown block's first ones (the same matrix
  // from its season 0), so each finishing run continues the same row's screening run, playing only the seasons screening
  // didn't (its numbers are the full run's, bit for bit).
  const resumes = screen !== shown && screen.z.buffer === shown.z.buffer && screen.z.byteOffset === shown.z.byteOffset;
  // The before score's own row (the setup's): its key is the before run's in both memos, so a move that changes nothing reads it.
  const beforeRow: SimRow = {
    mean: setup.mean[x.myIndex] as Float64Array,
    sd: setup.sd[x.myIndex] as Float64Array,
    key: `${(setup.mean[x.myIndex] as Float64Array).join(",")}|${(setup.sd[x.myIndex] as Float64Array).join(",")}`,
  };
  /**
   * A block's runs by row key, the before run first (made when first asked). The screening block's keep their progress
   * (`keep`), and the shown block's continue the same row's (`prior`: the screening block's) when there is one.
   */
  type Block = { of: (row: SimRow) => MyRun; before: () => MyRun; runs: () => number; progressOf: (key: string) => SimProgress | undefined };
  const block = (normals: SimNormals, keep: boolean, prior: Block | null): Block => {
    const memo = new Map<string, { run: MyRun; progress?: SimProgress }>();
    const of = (row: SimRow): MyRun => {
      let r = memo.get(row.key);
      if (!r) {
        const from = prior?.progressOf(row.key);
        r = runOn(row === beforeRow ? null : row, normals, from ? { resume: from } : { keep });
        memo.set(row.key, r);
      }
      return r.run;
    };
    return { of, before: () => of(beforeRow), runs: () => memo.size, progressOf: (key) => memo.get(key)?.progress };
  };
  const change = (before: MyRun, after: MyRun): WaiverRunChange => ({
    dPO: after.pPlayoffs - before.pPlayoffs,
    dCH: after.prizes.first !== null && before.prizes.first !== null ? after.prizes.first - before.prizes.first : null,
    dPrizes: runPrizeDeltas(before.prizes, after.prizes, x.highScores),
  });

  return {
    rate(rows: readonly WaiverRatingRow[]): WaiverRatingResult {
      x.onStage?.("start");
      const onScreen = block(screen, resumes, null);
      const onShown = block(shown, false, resumes ? onScreen : null);
      // Each option's score as the simulator reads it, once (screening and finishing share it).
      const rowsByMove = new Map<string, SimRow | null>();
      const simRowOf = (add: string, drop: string | null): SimRow | null => {
        const key = `${add}\u0000${drop ?? ""}`;
        if (rowsByMove.has(key)) return rowsByMove.get(key) ?? null;
        const score = x.scoreAfter(add, drop);
        const row = score ? rowOf(score) : null;
        rowsByMove.set(key, row);
        return row;
      };
      // 1. Screening: every option of every row; the best B per row (ties: the lower keep value, then the smaller drop id).
      const screened = rows.map((r): Screened | null => {
        let best: Screened | null = null;
        r.options.forEach((o, j) => {
          const row = simRowOf(r.playerId, o.drop);
          if (!row) return;
          const got = x.benefitOf(r.playerId, o.drop, change(onScreen.before(), onScreen.of(row)));
          const cand: Screened = { option: j, b: finite(got.b), bWin: finite(got.bWin), keep: o.keep, drop: o.drop, row };
          if (best === null || beats(cand, best)) best = cand;
        });
        return best;
      });
      x.onStage?.("screen");
      // 2. Finishing: the rows with the best screened B (ties: more points, then the smaller id) on the shown block, none
      // screened below the floor (config.waivers.ratingFinishFloor × B₃: it prints no gain either way).
      const order = rows
        .map((r, i) => ({ r, i, s: screened[i] ?? null }))
        .filter((e): e is { r: WaiverRatingRow; i: number; s: Screened } => e.s !== null && e.s.b !== null && e.s.b >= finishFrom - EPS)
        .sort((a, b) => (b.s.b as number) - (a.s.b as number) || b.r.points - a.r.points || byId(a.r.playerId, b.r.playerId));
      const finished = new Map<number, { b: number | null; bWin: number | null }>();
      for (const e of order.slice(0, finishRows)) {
        const got = x.benefitOf(e.r.playerId, e.s.drop, change(onShown.before(), onShown.of(e.s.row)));
        finished.set(e.i, { b: finite(got.b), bWin: finite(got.bWin) });
      }
      x.onStage?.("finish");
      const ratings = screened.map((s, i): { option: number; rating: WaiverRowRating } | null => {
        if (!s) return null;
        const done = finished.get(i);
        const b = done ? done.b : s.b;
        return { option: s.option, rating: { b, bWin: done ? done.bWin : s.bWin, helps: tradeScore(b, x.b3), sims: done ? shown.sims : screen.sims } };
      });
      return { rows: ratings, info: { b3: x.b3, screenSims: screen.sims, shownSims: shown.sims, finished: finished.size, weighs: x.weighs }, runs: { screen: onScreen.runs(), shown: onShown.runs() } };
    },
  };
}
