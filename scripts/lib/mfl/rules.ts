/**
 * FROZEN PHASE 0 EVIDENCE: the probes still use this copy; the app uses src/adapters/mfl/rules.ts. A fix here doesn't
 * reach the app (and the reverse); `npm run import:report` is the live check of the shipped adapters.
 *
 * MFL scoring rules (TYPE=rules) → per-position Sleeper-key rates and threshold bonuses (CLAUDE.md §5).
 *
 * Semantics, from MFL's "Scoring Rules Setup" help (read 2026-09-29):
 * - points "*N"   = PTS EACH:  N per unit of the stat, when the game total (or play length) is in range.
 * - points "a/b"  = PTS EVERY: a points for every b units — STEPPED ("1 point for every 10 yards"
 *                   gives 12, not 12.8, for 128 yards). Base 0 is assumed (the help's example can't
 *                   tell 0 from the range low).
 * - points "N"    = PTS: a flat award when the total is in range. Ranges don't stack (100–199 and
 *                   200–999 bands: 250 yards gets only the second).
 * - "a/b" plus thresholdPoints = formula scoring: thresholdPoints for reaching the range low, then a
 *                   for every b beyond it.
 * - "Length of … TD / FG" rules are evaluated per play; everything else per game.
 * - Rules for the same event in two groups that cover a position are ADDED (help FAQ 7).
 *
 * compileFor() evaluates those semantics numerically over a realistic value grid, then expresses the
 * result as a rate per Sleeper key plus "stat ≥ threshold" bonuses. Anything it can't express that
 * way is returned as unmapped (with the reason), or as approximate when close.
 */
import { asArray, at, isRecord, text } from "./json";
import { splitPositions } from "./positions";
import { FG_BUCKETS, MFL_EVENTS, PTS_ALLOWED_BUCKETS, TD_BONUS_BREAKS, YDS_ALLOWED_BUCKETS, keysFor, type EventMap } from "./scoringMap";

export type PointsSpec =
  | { kind: "each"; n: number }
  | { kind: "every"; a: number; b: number }
  | { kind: "flat"; n: number }
  | { kind: "formula"; threshold: number; a: number; b: number }
  | { kind: "unknown" };

export interface MflRule {
  group: number;
  positions: string[];
  event: string;
  lo: number;
  hi: number;
  rangeRaw: string;
  pointsRaw: string;
  points: PointsSpec;
  /** Any other fields on the rule (thresholdPoints, conditional options …). */
  extra: Record<string, string>;
}

const NUM = String.raw`-?(?:\d+\.?\d*|\.\d+)`;

export function parseRange(raw: string | undefined): { lo: number; hi: number } | undefined {
  const m = new RegExp(`^\\s*(${NUM})\\s*-\\s*(${NUM})\\s*$`).exec(raw ?? "") ?? new RegExp(`^\\s*(${NUM})\\s*$`).exec(raw ?? "");
  if (!m) return undefined;
  const lo = Number(m[1]);
  const hi = Number(m[2] ?? m[1]);
  return Number.isFinite(lo) && Number.isFinite(hi) && hi >= lo ? { lo, hi } : undefined;
}

export function parsePoints(raw: string | undefined, thresholdPoints?: string): PointsSpec {
  const s = (raw ?? "").trim();
  let m = new RegExp(`^\\*\\s*(${NUM})$`).exec(s);
  if (m) return { kind: "each", n: Number(m[1]) };
  m = new RegExp(`^(${NUM})\\s*/\\s*(${NUM})$`).exec(s);
  if (m && Number(m[2]) > 0) {
    const t = thresholdPoints === undefined ? undefined : Number(thresholdPoints);
    if (t !== undefined && Number.isFinite(t)) return { kind: "formula", threshold: t, a: Number(m[1]), b: Number(m[2]) };
    return { kind: "every", a: Number(m[1]), b: Number(m[2]) };
  }
  m = new RegExp(`^(${NUM})$`).exec(s);
  if (m) return { kind: "flat", n: Number(m[1]) };
  return { kind: "unknown" };
}

/** Parse TYPE=rules JSON (positionRules one-or-many; rule one-or-many; "$t" text nodes). */
export function parseRules(json: unknown): { rules: MflRule[]; problems: string[] } {
  const rules: MflRule[] = [];
  const problems: string[] = [];
  asArray(at(json, "rules.positionRules") as unknown[]).forEach((g, group) => {
    const positions = splitPositions(text(at(g, "positions")) ?? "");
    for (const r of asArray(at(g, "rule") as unknown[])) {
      if (!isRecord(r)) continue;
      const event = text(r.event) ?? "";
      const rangeRaw = text(r.range) ?? "";
      const pointsRaw = text(r.points) ?? "";
      const extra: Record<string, string> = {};
      for (const [k, v] of Object.entries(r)) if (!["event", "range", "points"].includes(k)) extra[k] = text(v) ?? JSON.stringify(v);
      const range = parseRange(rangeRaw);
      const points = parsePoints(pointsRaw, extra.thresholdPoints);
      if (!range) problems.push(`group ${group} ${event}: unparsed range "${rangeRaw}"`);
      if (points.kind === "unknown") problems.push(`group ${group} ${event}: unparsed points "${pointsRaw}"`);
      rules.push({ group, positions, event, lo: range?.lo ?? NaN, hi: range?.hi ?? NaN, rangeRaw, pointsRaw, points, extra });
    }
  });
  return { rules, problems };
}

/** Points one rule gives for a value (a game total, or one play's length). */
export function ruleValue(r: MflRule, v: number): number {
  if (!(v >= r.lo - 1e-9 && v <= r.hi + 1e-9)) return 0;
  const p = r.points;
  switch (p.kind) {
    case "each":
      return p.n * v;
    case "every":
      return Math.floor(v / p.b + 1e-9) * p.a;
    case "flat":
      return p.n;
    case "formula":
      return p.threshold + Math.floor((v - r.lo) / p.b + 1e-9) * p.a;
    default:
      return NaN;
  }
}

export interface Bonus {
  stat: string;
  threshold: number;
  points: number;
}
export interface RuleNote {
  event: string;
  range: string;
  points: string;
  note: string;
}
export interface Compiled {
  mflPos: string;
  rates: Record<string, number>;
  bonuses: Bonus[];
  mapped: RuleNote[];
  approx: RuleNote[];
  unmapped: RuleNote[];
  /** Contributions to MERGED_KEYS, by MFL event, before folding into rates. */
  shared: Record<string, Record<string, number>>;
}

/**
 * Sleeper keys that count the union of several distinct MFL events (a pick-six and a fumble-return
 * TD are both idp_def_td). Summing their rates would double-count, so the per-play value is used.
 */
export const MERGED_KEYS: ReadonlySet<string> = new Set(["idp_def_td", "def_td", "def_st_td", "idp_blk_kick", "blk_kick"]);

/** MFL events that already count every defensive (and special-teams) TD type. */
const AGGREGATE_EVENTS: ReadonlySet<string> = new Set(["#D", "#T", "DD", "TT"]);

const MERGED_NOTE = " (Sleeper key shared with other event types; checked after all rules)";

const round = (x: number) => Math.round(x * 1e6) / 1e6;
const eq = (a: number, b: number) => Math.abs(a - b) < 1e-6;

function grid(lo: number, hi: number, step: number): number[] {
  const out: number[] = [];
  for (let v = lo; v <= hi + 1e-9; v = round(v + step)) out.push(v);
  return out;
}

/** Constant value of f over [lo, hi] (integers), or undefined if it varies. */
function constantOn(f: (v: number) => number, lo: number, hi: number): number | undefined {
  const first = f(lo);
  for (let v = lo + 1; v <= hi; v++) if (!eq(f(v), first)) return undefined;
  return first;
}

function note(rows: MflRule[], msg: string): RuleNote[] {
  return rows.map((r) => ({ event: r.event, range: r.rangeRaw, points: r.pointsRaw + (r.extra.thresholdPoints ? ` (formula: ${r.extra.thresholdPoints} at range low)` : ""), note: msg }));
}

function addRate(c: Compiled, key: string, rate: number, event: string): void {
  if (eq(rate, 0)) return;
  if (MERGED_KEYS.has(key)) {
    const byEvent = (c.shared[key] ??= {});
    byEvent[event] = round((byEvent[event] ?? 0) + rate);
    return;
  }
  c.rates[key] = round((c.rates[key] ?? 0) + rate);
}

/** Per-game totals: linear part from rules covering the realistic range, flat bands → bonuses. */
function compileTotal(c: Compiled, ev: EventMap, keys: string[], rows: MflRule[], event: string): void {
  const scale = ev.scale ?? 1;
  const min = ev.min ?? 0;
  const max = ev.max ?? 20;
  const step = event === "SK" || event === "SKY" ? 0.5 : 1; // individual sacks come in halves
  const covers = (r: MflRule) => r.lo <= 1 && r.hi >= max;
  const approx: string[] = [];
  let rate = 0;
  let start = min;
  const linearized = rows.map((r): MflRule => {
    const p = r.points;
    if (p.kind === "every" && covers(r)) {
      if (!Number.isInteger(round(step / p.b))) approx.push(`stepped "${r.pointsRaw}" (floor) treated as linear ${round(p.a / p.b)} per unit`);
      rate += p.a / p.b;
      if (r.lo > start) start = r.lo;
      return { ...r, points: { kind: "each", n: p.a / p.b } };
    }
    if (p.kind === "each" && covers(r)) {
      rate += p.n;
      if (r.lo > start) start = r.lo;
    }
    return r;
  });
  if (start > min && min < 0) approx.push("negative totals score 0 on MFL (range starts at ≥ 0)");
  const f = (v: number) => linearized.reduce((s, r) => s + ruleValue(r, v), 0) - rate * v;
  const values = grid(Math.max(min, Math.min(start, 0)), max, step);
  const residual = values.map(f);
  if (residual.some((x) => !Number.isFinite(x))) {
    c.unmapped.push(...note(rows, "unrecognized points format"));
    return;
  }
  // What's left must be a step function (flat awards); each step becomes a "stat ≥ threshold" bonus.
  const bonuses: Bonus[] = [];
  let prev = 0;
  values.forEach((v, i) => {
    const g = residual[i] as number;
    if (!eq(g, prev)) {
      bonuses.push({ stat: keys[0] as string, threshold: round(v / scale), points: round(g - prev) });
      if (i === 0) approx.push(`flat award already at ${v} (players with no stats may differ)`);
    }
    prev = g;
  });
  const partial = rows.some((r) => (r.points.kind === "each" || r.points.kind === "every" || r.points.kind === "formula") && !covers(r));
  if (partial || bonuses.length > rows.length * 2) {
    c.unmapped.push(...note(rows, "per-unit points only inside part of the range (tiered or formula scoring) — needs a range-rule model"));
    return;
  }
  if (bonuses.length && keys.length > 1) {
    c.unmapped.push(...note(rows, `bonus on a sum of stats (${keys.join("+")}) has no single Sleeper key`));
    return;
  }
  for (const k of keys) addRate(c, k, rate * scale, event);
  c.bonuses.push(...bonuses);
  const to = `${keys.join("+")}${rate ? ` ×${round(rate * scale)}` : ""}${bonuses.length ? `, bonuses ${bonuses.map((b) => `≥${b.threshold}: ${b.points > 0 ? "+" : ""}${b.points}`).join(" ")}` : ""}`;
  const why = [...approx, ev.approx].filter(Boolean).join("; ");
  if (why) c.approx.push(...note(rows, `→ ${to}; ${why}`));
  else c.mapped.push(...note(rows, `→ ${to}${ev.merged && keys.some((k) => MERGED_KEYS.has(k)) ? MERGED_NOTE : ""}`));
}

const SIMPLE_FAMILY_KEY: Record<string, { off?: string; idp?: string; def?: string }> = {
  pass_int_td: { off: "pass_int_td" },
  pr_td: { off: "pr_td" },
  kr_td: { off: "kr_td" },
  fum_rec_td: { off: "fum_rec_td" },
  def_td: { idp: "idp_def_td", def: "def_td" },
};

/** Per-play length rules: map onto Sleeper's TD bonus keys or FG distance buckets. */
function compileLength(c: Compiled, ev: EventMap, rows: MflRule[], mflPos: string, event: string): void {
  const f = (len: number) => rows.reduce((s, r) => s + ruleValue(r, len), 0);
  const fam = ev.family as string;
  const kind = mflPos === "Def" ? "def" : ["DT", "DE", "LB", "CB", "S"].includes(mflPos) ? "idp" : "off";
  const done = (to: string) => (ev.approx ? c.approx.push(...note(rows, `→ ${to}; ${ev.approx}`)) : c.mapped.push(...note(rows, `→ ${to}${ev.merged ? MERGED_NOTE : ""}`)));
  if (fam === "pass_td" || fam === "rush_td" || fam === "rec_td") {
    const [b40, b50] = TD_BONUS_BREAKS;
    const base = constantOn(f, 1, b40 - 1);
    const p40 = constantOn(f, b40, b50 - 1);
    const p50 = constantOn(f, b50, 99);
    if (base === undefined || p40 === undefined || p50 === undefined) {
      c.unmapped.push(...note(rows, "points vary inside Sleeper's TD length buckets (1–39, 40–49, 50+)"));
      return;
    }
    addRate(c, fam, base, event);
    addRate(c, `${fam}_40p`, p40 - base, event);
    addRate(c, `${fam}_50p`, p50 - p40, event);
    done(`${fam} ${base} per TD${p40 !== base ? `, ${fam}_40p +${round(p40 - base)}` : ""}${p50 !== p40 ? `, ${fam}_50p +${round(p50 - p40)}` : ""}`);
    return;
  }
  if (fam === "fgm" || fam === "fgmiss") {
    const all = constantOn(f, 18, 70);
    if (all !== undefined) {
      addRate(c, fam, all, event);
      done(`${fam} ${all} (every distance)`);
      return;
    }
    const vals = FG_BUCKETS.map(([lo, hi, suffix]) => ({ suffix, v: constantOn(f, lo, hi) }));
    if (vals.every((x) => x.v !== undefined)) {
      const v5059 = vals[4]?.v as number;
      const v60 = vals[5]?.v as number;
      for (const x of vals.slice(0, 4)) addRate(c, `${fam}_${x.suffix}`, x.v as number, event);
      if (eq(v5059, v60)) addRate(c, `${fam}_50p`, v5059, event);
      else {
        addRate(c, `${fam}_50_59`, v5059, event);
        addRate(c, `${fam}_60p`, v60, event);
      }
      done(`${fam} distance buckets ${vals.map((x) => `${x.suffix}:${x.v}`).join(" ")}`);
      return;
    }
    if (fam === "fgm") {
      const slope = f(41) - f(40);
      const intercept = f(40) - slope * 40;
      if (grid(18, 70, 1).every((len) => eq(f(len), slope * len + intercept))) {
        addRate(c, "fgm_yds", slope, event);
        addRate(c, "fgm", intercept, event);
        done(`fgm_yds ×${round(slope)}${intercept ? ` + fgm ${round(intercept)}` : ""}`);
        return;
      }
    }
    c.unmapped.push(...note(rows, "points vary inside Sleeper's FG distance buckets"));
    return;
  }
  const key = SIMPLE_FAMILY_KEY[fam]?.[kind];
  if (!key) {
    c.unmapped.push(...note(rows, `no Sleeper key for this rule at an ${kind} position`));
    return;
  }
  const v = constantOn(f, 1, 99);
  if (v === undefined) {
    c.unmapped.push(...note(rows, "points depend on the play's length; Sleeper has no per-length key"));
    return;
  }
  addRate(c, key, v, event);
  done(`${key} ${v} per TD`);
}

/** Team DEF points/yards allowed ranges → Sleeper bucket keys. */
function compileAllowed(c: Compiled, ev: EventMap, rows: MflRule[], event: string): void {
  const f = (v: number) => rows.reduce((s, r) => s + ruleValue(r, v), 0);
  const buckets = ev.allowed === "pts" ? PTS_ALLOWED_BUCKETS : YDS_ALLOWED_BUCKETS;
  const vals = buckets.map(([lo, hi, key]) => ({ key, v: constantOn(f, lo, hi) }));
  if (vals.every((x) => x.v !== undefined)) {
    for (const x of vals) addRate(c, x.key, x.v as number, event);
    c.mapped.push(...note(rows, `→ ${vals.map((x) => `${x.key}:${x.v}`).join(" ")}`));
    return;
  }
  c.unmapped.push(...note(rows, `points vary inside Sleeper's ${ev.allowed === "pts" ? "points" : "yards"}-allowed buckets`));
}

/** Compile every rule that applies to one MFL position (e.g. "WR", "DT", "PK", "Def"). */
export function compileFor(rules: MflRule[], mflPos: string): Compiled {
  const c: Compiled = { mflPos, rates: {}, bonuses: [], mapped: [], approx: [], unmapped: [], shared: {} };
  const byEvent = new Map<string, MflRule[]>();
  for (const r of rules.filter((x) => x.positions.includes(mflPos))) byEvent.set(r.event, [...(byEvent.get(r.event) ?? []), r]);
  for (const [event, rows] of byEvent) {
    const ev = MFL_EVENTS[event];
    if (!ev) {
      c.unmapped.push(...note(rows, "no Sleeper stat key for this MFL rule"));
      continue;
    }
    if (rows.some((r) => r.points.kind === "unknown" || !Number.isFinite(r.lo))) {
      c.unmapped.push(...note(rows, "unparsed range or points"));
      continue;
    }
    const options = [...new Set(rows.flatMap((r) => Object.keys(r.extra)))].filter((k) => k !== "thresholdPoints");
    if (options.length) {
      c.unmapped.push(...note(rows, `extra rule options (${options.join(",")}) — conditional scoring?`));
      continue;
    }
    if (ev.kind === "length") compileLength(c, ev, rows, mflPos, event);
    else if (ev.kind === "allowed") {
      if (mflPos !== "Def") c.unmapped.push(...note(rows, "team-only rule on a player position"));
      else compileAllowed(c, ev, rows, event);
    } else {
      const keys = keysFor(ev, mflPos);
      if (!keys?.length) c.unmapped.push(...note(rows, `no Sleeper key for this rule at MFL position ${mflPos}`));
      else compileTotal(c, ev, keys, rows, event);
    }
  }
  // Merged keys: one per-play value. Type-specific rules (pick-six, fumble-return TD, blocked FG …)
  // are exact when they all score the same; an all-TD rule (#D, #T) is added on top, as MFL does.
  for (const [key, byEvent] of Object.entries(c.shared)) {
    const entries = Object.entries(byEvent);
    const agg = entries.filter(([e]) => AGGREGATE_EVENTS.has(e)).map(([, v]) => v);
    const spec = entries.filter(([e]) => !AGGREGATE_EVENTS.has(e)).map(([, v]) => v);
    const aggTop = agg.length ? Math.max(...agg) : 0;
    const specTop = spec.length ? Math.max(...spec) : 0;
    c.rates[key] = round((c.rates[key] ?? 0) + aggTop + specTop);
    const why: string[] = [];
    if (!spec.every((v) => eq(v, specTop))) why.push("the league scores these event types differently but Sleeper merges them (highest used)");
    if (agg.length && spec.length) why.push("an all-TD rule and type-specific rules both apply (MFL adds them); types without a specific rule get only the all-TD points");
    if (why.length) c.approx.push({ event: Object.keys(byEvent).join("+"), range: "", points: JSON.stringify(byEvent), note: `→ ${key} ${round(aggTop + specTop)}; ${why.join("; ")}` });
  }
  return c;
}

/** Points for one player-week from Sleeper stats under a compiled scoring. */
export function scoreStats(c: Compiled, stats: Record<string, number | undefined>): number {
  let pts = 0;
  for (const [k, rate] of Object.entries(c.rates)) pts += rate * (stats[k] ?? 0);
  for (const b of c.bonuses) if ((stats[b.stat] ?? 0) >= b.threshold - 1e-9) pts += b.points;
  return pts;
}
