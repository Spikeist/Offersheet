/**
 * Sleeper projection stat keys vs league scoring keys (CLAUDE.md §5). Pure; unit-tested.
 *
 * /stats uses the same keys as league scoring_settings (the scoring oracle confirms it), but
 * /projections spells special-teams and return stats differently. Phase 0 evidence (counted by
 * probe:sleeper from live data each run):
 *   DEF rows    project the unit's special-teams TD as st_td, never def_st_td; /stats records it
 *               on the DEF row as def_st_td.
 *   player rows project return TDs as def_kr_td / pr_td and kick-return yards as def_kr_yd; /stats
 *               records a returner's TD as st_td and his yards as kr_yd / pr_yd.
 * DEF rows also project return components (def_kr_td, def_pr_td, pr_td, pr_yd) that /stats never
 * puts on a DEF row; scoring them as well would double count the same touchdown.
 */

export type RowKind = "DEF" | "player";

export interface KeyAlias {
  kind: RowKind;
  /** Key in /projections. */
  from: string;
  /** Scoring key(s) the value counts toward (the key /stats uses for the same event). */
  to: string[];
}

export const PROJECTION_ALIASES: readonly KeyAlias[] = [
  { kind: "DEF", from: "st_td", to: ["def_st_td"] },
  { kind: "player", from: "def_kr_td", to: ["st_td"] },
  { kind: "player", from: "pr_td", to: ["st_td"] },
  { kind: "player", from: "def_kr_yd", to: ["kr_yd"] },
];

/** Projection keys on DEF rows that /stats never carries for a DEF (return components of st_td). */
export const DEF_PROJECTION_DROPPED: ReadonlySet<string> = new Set(["def_kr_td", "def_pr_td", "pr_td", "pr_yd"]);

/**
 * A projection row's stats rewritten into scoring keys: aliases applied (values added to the target
 * key, the source key removed) and DEF-only duplicates dropped. Other keys pass through unchanged.
 */
export function toScoringStats(stats: Record<string, number> | null | undefined, kind: RowKind): Record<string, number> {
  const out: Record<string, number> = { ...(stats ?? {}) };
  for (const a of PROJECTION_ALIASES) {
    if (a.kind !== kind || typeof out[a.from] !== "number") continue;
    const v = out[a.from] as number;
    delete out[a.from];
    for (const t of a.to) out[t] = (out[t] ?? 0) + v;
  }
  if (kind === "DEF") for (const k of DEF_PROJECTION_DROPPED) delete out[k];
  return out;
}

export type ProposalKind = "projected" | "alias" | "derive" | "expected-value" | "rate-model" | "zero-rare";

export interface Derivation {
  test: RegExp;
  kind: Exclude<ProposalKind, "projected" | "alias">;
  how: string;
}

/**
 * Proposed treatment for scoring keys Sleeper doesn't project (platform knowledge + §5/§6 rules,
 * applied only after the data shows the key is missing from /projections).
 */
export const DERIVATIONS: readonly Derivation[] = [
  { test: /^fgmiss$/, kind: "derive", how: "fga − fgm" },
  { test: /^fgmiss_(0_19|20_29)$/, kind: "derive", how: "(fga − fgm) minus the projected fgmiss_30_39/40_49/50p" },
  { test: /^fgmiss_(50_59|60p)$/, kind: "derive", how: "split the projected fgmiss_50p (60+ yard tries are rare)" },
  { test: /^fgm_(50_59|60p)$/, kind: "derive", how: "split the projected fgm_50p (60+ yard makes are rare)" },
  { test: /^fgm_yds_over_30$/, kind: "derive", how: "Σ projected fgm_<range> × (range midpoint − 30)⁺ (or fgm_yds − 30 × fgm)" },
  { test: /^(pts_allow|yds_allow)_\d/, kind: "expected-value", how: "P(bracket) under Normal(mean = projected pts_allow / yds_allow) × points (the projection flags only the bracket of floor(mean))" },
  {
    test: /^bonus_(pass|rush|rec|rush_rec)_yd_\d+p?$|^bonus_pass_cmp_\d+|^bonus_rush_att_\d+|^bonus_(sack_2p|tkl_10p)$|^idp_pass_def_3p$/,
    kind: "expected-value",
    how: "§5 threshold bonus: P(stat ≥ threshold) × points under the stat's distribution (yardage: Normal(mean = projected stat, measured SD model), floored at 0; counts: Poisson(mean = projected stat))",
  },
  { test: /^bonus_fd_(qb|rb|wr|te)$/, kind: "derive", how: "projected rush_fd + rec_fd (+ pass_fd for QBs) of players at that position" },
  { test: /^bonus_rec_(qb|rb|wr|te)$/, kind: "derive", how: "projected rec of players at that position" },
  { test: /^(pass|rush|rec)_td_(40p|50p)$|^bonus_(def_int|def_fum)_td_50p$/, kind: "rate-model", how: "projected TDs × a historical long-TD share (Phase 6 backtest), else 0" },
];

/** Position group whose games a scoring key's frequency is judged on. */
export type StatGroup = "DEF" | "K" | "IDP" | "OFF";

export const GROUP_GAMES: Record<StatGroup, string> = { DEF: "DEF team-games", K: "kicker games", IDP: "IDP player-games", OFF: "QB/RB/WR/TE games" };

const DEF_KEYS = new Set(["sack", "int", "fum_rec", "safe", "ff", "blk_kick", "qb_hit", "tkl", "tkl_loss", "tkl_solo", "tkl_ast", "sack_yd", "int_ret_yd", "fum_ret_yd", "blk_kick_ret_yd", "fg_ret_yd"]);

/** The position group a scoring key applies to (by Sleeper's key naming). */
export function keyGroup(key: string): StatGroup {
  if (key.startsWith("idp_") || /^bonus_(sack_2p|tkl_10p)$/.test(key)) return "IDP";
  if (/^(fgm|fga|fgmiss|xpm|xpa|xpmiss)(_|$)/.test(key)) return "K";
  if (/^(pts_allow|yds_allow|def_|bonus_def_)/.test(key) || DEF_KEYS.has(key)) return "DEF";
  return "OFF";
}

/** Games per position group in the sampled /stats weeks, and on how many each key was non-zero. */
export interface StatsFrequency {
  weeks: number;
  rows: Record<StatGroup, number>;
  nonZero: Map<string, Record<StatGroup, number>>;
}

export function statsFrequency(weeks: Array<Array<{ player_id: string; stats?: Record<string, number> | null }>>, groupOf: (playerId: string) => StatGroup | null): StatsFrequency {
  const f: StatsFrequency = { weeks: weeks.length, rows: { DEF: 0, K: 0, IDP: 0, OFF: 0 }, nonZero: new Map() };
  for (const rows of weeks) {
    for (const r of rows) {
      const group = groupOf(r.player_id);
      if (!group || !r.stats) continue;
      // Players count only in weeks they played (gp); a DEF row always is a game.
      if (group !== "DEF" && !(r.stats.gp && r.stats.gp > 0)) continue;
      f.rows[group]++;
      for (const [k, v] of Object.entries(r.stats)) {
        if (!v) continue;
        const e = f.nonZero.get(k) ?? { DEF: 0, K: 0, IDP: 0, OFF: 0 };
        e[group]++;
        f.nonZero.set(k, e);
      }
    }
  }
  return f;
}

/** Keys non-zero on at least this share of their group's games get a rate model; rarer ones 0. */
export const RATE_MODEL_MIN_SHARE = 0.02;

export interface CoverageRow {
  key: string;
  /** Crawled leagues scoring the key (non-zero), when known. */
  leagues?: number;
  group: StatGroup;
  /** "projected" (key present in /projections), "alias" (via PROJECTION_ALIASES), else a proposal. */
  kind: ProposalKind;
  how: string;
  /** Share of the group's games on which the key was non-zero in the sampled /stats weeks. */
  statsShare: number;
}

/**
 * How each scoring key can get a projected value: projected directly, via an alias, or a proposal
 * (derive / expected value / rate model / 0 for rare events, judged by its frequency in /stats).
 */
export function projectionCoverage(keys: Array<{ key: string; leagues?: number }>, projectedKeys: ReadonlySet<string>, aliasSources: ReadonlyMap<string, string[]>, freq: StatsFrequency | null): CoverageRow[] {
  return keys.map(({ key, leagues }) => {
    const group = keyGroup(key);
    const share = shareOf(key, group, freq);
    const base = { key, ...(leagues !== undefined ? { leagues } : {}), group, statsShare: Math.round(share * 1e4) / 1e4 };
    if (projectedKeys.has(key)) return { ...base, kind: "projected" as const, how: "in /projections" };
    const via = aliasSources.get(key);
    if (via?.length) return { ...base, kind: "alias" as const, how: `projected as ${via.join(" / ")}` };
    const rule = DERIVATIONS.find((d) => d.test.test(key));
    if (rule) return { ...base, kind: rule.kind, how: rule.how };
    if (freq && share >= RATE_MODEL_MIN_SHARE) return { ...base, kind: "rate-model" as const, how: `league-average rate from /stats (non-zero on ${pctText(share)} of ${GROUP_GAMES[group]})` };
    return { ...base, kind: "zero-rare" as const, how: freq ? `0: non-zero on ${pctText(share)} of ${GROUP_GAMES[group]} in the sampled /stats weeks` : "0 (no /stats sample to judge frequency)" };
  });
}

function shareOf(key: string, group: StatGroup, freq: StatsFrequency | null): number {
  if (!freq || !freq.rows[group]) return 0;
  return (freq.nonZero.get(key)?.[group] ?? 0) / freq.rows[group];
}

function pctText(x: number): string {
  return `${(x * 100).toFixed(x < 0.01 ? 2 : 1)}%`;
}

/**
 * Keys seen in /projections per row kind, and the keys that count as projected directly: seen and
 * neither an alias source for that row kind nor a DEF-row duplicate.
 */
export function projectedKeySets<T extends { stats?: Record<string, number> | null }>(rows: Iterable<T>, kindOf: (row: T) => RowKind | null): { seen: Record<RowKind, Set<string>>; direct: Set<string> } {
  const seen: Record<RowKind, Set<string>> = { DEF: new Set(), player: new Set() };
  const direct = new Set<string>();
  for (const r of rows) {
    const kind = kindOf(r);
    if (!kind || !r.stats) continue;
    for (const k of Object.keys(r.stats)) {
      seen[kind].add(k);
      const aliasSource = PROJECTION_ALIASES.some((a) => a.kind === kind && a.from === k);
      const dropped = kind === "DEF" && DEF_PROJECTION_DROPPED.has(k);
      if (!aliasSource && !dropped) direct.add(k);
    }
  }
  return { seen, direct };
}

/** Scoring key → "from (kind)" labels, for the aliases whose source key was actually seen in /projections. */
export function aliasSourcesSeen(seen: Record<RowKind, ReadonlySet<string>>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const a of PROJECTION_ALIASES) {
    if (!seen[a.kind].has(a.from)) continue;
    for (const t of a.to) out.set(t, [...(out.get(t) ?? []), `${a.from} (${a.kind} rows)`]);
  }
  return out;
}
