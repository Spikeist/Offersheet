/**
 * The League model (CLAUDE.md §6, §7, §9, §14 "League"): what src/engine/league.ts computes from a
 * LeagueSnapshot and its ModelInputs, and what the League page and the checkpoint report show.
 * Pure types only. Arrays marked "per week" are aligned with LeagueModel.weeks.
 */
import type { FantasyCalcFormat } from "./inputs";

export type BaseRateSource = "espn+sleeper" | "sleeper" | "espn" | "season" | "actual" | "none";
export type ValueSource = "fantasycalc" | "estimate" | "floor";

export interface LeagueModel {
  /** Remaining NFL weeks, currentWeek..lastWeek, in order. */
  weeks: number[];
  /** The remaining regular-season and playoff weeks (subsets of `weeks`). */
  regularWeeks: number[];
  playoffWeeks: number[];
  /** Availability scenarios per exact evaluation (§7), 0 when scenarios were skipped. */
  scenarios: number;
  /**
   * The current week when any of its games has already kicked off (null otherwise). Team-level numbers
   * (ROS(T), PPW, strength, needs, lineup costs, the waiver move, "would start for", partner fit) then
   * skip it: lineups are locking and its points are being scored, so it no longer says how good a team
   * is. Its per-week LV is still reported (a partial week). Players' own ROS points count the games
   * that haven't started.
   */
  inProgressWeek: number | null;
  /** Every rostered player (IR and taxi included) and every snapshot free agent with inputs. */
  players: Record<string, PlayerModel>;
  /** Same order as snapshot.teams. */
  teams: TeamModel[];
  myTeamId: string | null;
  /** Heatmap columns: the league's starting slots, one per instance (QB1, RB1, RB2, …, FLEX1, K1). */
  slots: SlotInstance[];
  /** Best trade partners for my team (§7), best first; empty without a team. */
  partners: TradePartner[];
  market: MarketSummary;
  projection: ProjectionSummary;
  /** Milliseconds per stage, when the caller passed a clock. */
  timings: Record<string, number>;
  /** Plain-English notes about gaps (a source missing, a player without projections). */
  warnings: string[];
}

export interface PlayerModel {
  id: string;
  base: {
    /** b_i: points per game played in this league's scoring (§6 step 1). */
    b: number;
    /** proj_now_i and the week it came from (null when no weekly projection exists). */
    projNow: number | null;
    projWeek: number | null;
    /** m_{i,now}: the week shape of projWeek (1 when unknown). */
    mNow: number;
    /** Season-to-date points per game played, and games played. */
    actualPpg: number | null;
    games: number;
    alpha: number;
    source: BaseRateSource;
  };
  /** Per week. */
  weekly: WeekProjection[];
  ros: RosSummary;
  /** Market value (§9); null when the player has no value and no estimate could be made. */
  value: { value: number; source: ValueSource } | null;
}

export interface WeekProjection {
  /** p_{i,w} = b × m × a (§6 step 4). */
  p: number;
  /** a_{i,w}: expected availability, including byes and future injury risk. */
  a: number;
  /** m_{i,w}: week shape. */
  m: number;
  bye: boolean;
  /** σ_{i,w} = c_pos × p + d_pos (§6 step 5). */
  sd: number;
}

export interface RosSummary {
  /** Σ p over the remaining weeks, and split into regular-season and playoff weeks (§6 step 7). */
  total: number;
  regular: number;
  playoffs: number;
  /** Remaining weeks his NFL team plays (a game already kicked off this week doesn't count). */
  gamesLeft: number;
  gamesLeftRegular: number;
  gamesLeftPlayoffs: number;
  /** "bye done" / "bye wk 9" (§6 step 7); unknown when the NFL schedule has no bye for his team. */
  bye: { status: "done" | "upcoming" | "unknown"; week?: number };
}

export interface LineupValues {
  /** LV(T, w) per week. */
  lv: number[];
  /** ROS(T) = Σ ω_w LV(T, w), ω = playoffWeight in playoff weeks (§7). */
  ros: number;
  /** Average LV over the remaining regular-season weeks (0 when none remain). */
  ppw: number;
}

export interface TeamModel {
  id: string;
  /** Expected-value lineups (§7; the fast screening method). */
  ev: LineupValues;
  /** Availability-scenario lineups (§7 exact evaluation); sd = spread of LV across scenarios, per week. Null when skipped. */
  scen: (LineupValues & { sd: number[] }) | null;
  /** Slot instance key → average starter points over the next strengthWeeks and over the rest of the season, with z-scores across teams. */
  strength: Record<string, SlotStrength>;
  needs: Need[];
  surplus: SurplusPlayer[];
  /** Rostered players' marginal values (active roster only; IR and taxi players are absent). */
  players: Record<string, TeamPlayerValue>;
  /**
   * The team's best single free-agent move (add the best free agent, dropping the player whose loss
   * hurts least, or into an open roster spot), when it gains ROS points; null when none does. Chosen by
   * scenario ROS when scenarios ran (the lineup costs shown are scenario costs), else by EV ROS. MV_lose is
   * measured from the team after this move, so a free agent who beats a starter doesn't make every bench
   * player's lineup cost negative.
   */
  waiver: WaiverMove | null;
}

export interface WaiverMove {
  add: string;
  /** null = an open active-roster spot, nobody dropped. */
  drop: string | null;
  /** ROS points gained, EV lineups and scenario lineups (null without scenarios). */
  gainEv: number;
  gainScen: number | null;
}

export interface SlotStrength {
  next: number;
  ros: number;
  zNext: number;
  zRos: number;
}

export interface TeamPlayerValue {
  /**
   * MV_lose(T, i) under expected-value lineups and under scenario lineups (ROS points, §7), measured
   * from the team after its best free-agent move (TeamModel.waiver), so it is never below 0.
   */
  mvLoseEv: number;
  mvLoseScen: number | null;
  /** The free agent T would add after losing him (§7 roster legality), or null. */
  autoAdd: string | null;
  /** z(v) − z(MV_lose) within T's roster (§12's surplus score). */
  surplusScore: number;
  /** How many other teams' lineups he'd improve by at least config.needs.surplusStartMinPpw per week over the next strengthWeeks. */
  startsFor: number;
}

export interface SlotInstance {
  /** Stable key, e.g. "RB2". */
  key: string;
  /** Short label for the heatmap, e.g. "RB2" or "D/ST". */
  label: string;
  /** The lineup slot it belongs to (SlotDef.slot) and its rank within that slot (1 = best starter). */
  slot: string;
  rank: number;
}

export interface Need {
  slot: string;
  z: number;
  /** "ros": weak for the rest of the season; "next": weak only over the next strengthWeeks (injuries, byes). */
  window: "ros" | "next";
}

export interface SurplusPlayer {
  playerId: string;
  score: number;
  startsFor: number;
}

export interface TradePartner {
  teamId: string;
  /**
   * true: their surplus fits my needs and mine fits theirs (§7). false: they have spare players who would
   * start for me, but I have none they need, so a trade would likely cost me a starter. One-sided fits
   * are listed after every mutual one.
   */
  mutual: boolean;
  /**
   * Mutual: sqrt(what their surplus adds to my lineup × what my surplus adds to theirs); one-sided: what
   * theirs adds to mine. Points per week, each side's JOINT gain (all its listed players added at once,
   * so two players competing for one slot count once). The lists below show each player's own gain.
   */
  score: number;
  /** Their surplus players that would help me, and mine that would help them (points per week each adds to the other lineup). */
  theyCanGive: { playerId: string; ppw: number }[];
  youCanGive: { playerId: string; ppw: number }[];
}

export interface MarketSummary {
  format: FantasyCalcFormat | null;
  /** W (§9): the best available free agent's value, at least waiverCreditMin. 0 without values. */
  waiverCredit: number;
  topValue: number;
  /** Players by value source. */
  counts: Record<ValueSource | "none", number>;
}

export interface ProjectionSummary {
  /** ESPN leagues: whether ESPN's and Sleeper's projections were averaged (§6: only when they agree within 10% on average). */
  espnAveraged: boolean;
  /** The agreement measure over rostered players, when both sources exist. */
  agreement: { meanRelDiff: number; players: number; week: number } | null;
  /** Players whose two sources disagree by more than config.projections.sourceDisagreementLog (§6: "log"). */
  disagreements: { playerId: string; espn: number; sleeper: number; week: number }[];
  /** Players by base-rate source. */
  sources: Record<BaseRateSource, number>;
}
