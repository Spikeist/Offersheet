/**
 * MFL scoring rules export (TYPE=rules) → parsed rules with MFL's own semantics (CLAUDE.md §2.6, §5).
 *
 * From MFL's "Scoring Rules Setup" help (read 2026-09-29; Phase 0 oracle 604/604):
 * - points "*N"  = PTS EACH:  N per unit of the stat, when the game total (or play length) is in range.
 * - points "a/b" = PTS EVERY: a points for every b units, STEPPED ("1 point for every 10 yards"
 *                  gives 12, not 12.8, for 128 yards), counted from 0.
 * - points "N"   = PTS: a flat award when the total is in range. Ranges don't stack (100–199 and
 *                  200–999 bands: 250 yards gets only the second).
 * - "a/b" plus thresholdPoints = formula scoring: thresholdPoints for reaching the range low, then a
 *                  for every b beyond it.
 * - "Length of … TD / FG" rules are evaluated per play; everything else per game.
 * - Rules for the same event in two groups that cover a position are ADDED (help FAQ 7).
 */
import { z } from "zod";
import { LeagueImportError } from "@/adapters/types";
import { asArray, isRecord, mflError, parseAt, text, textNode } from "./json";
import { splitPositions } from "./positions";

export type PointsSpec =
  | { kind: "each"; n: number }
  | { kind: "every"; a: number; b: number }
  | { kind: "flat"; n: number }
  | { kind: "formula"; threshold: number; a: number; b: number }
  | { kind: "unknown" };

export interface MflRule {
  /** Index in rules.positionRules (after one-or-many normalization). */
  group: number;
  /** Index in that group's rule list. */
  index: number;
  /** JSON path of the rule in the TYPE=rules body (for Import Report warnings). */
  path: string;
  /** MFL positions of the group ("QB|RB|WR|TE" → QB, RB, WR, TE). */
  positions: string[];
  event: string;
  /** Range bounds; NaN when the range text couldn't be parsed. */
  lo: number;
  hi: number;
  rangeRaw: string;
  pointsRaw: string;
  points: PointsSpec;
  /** Other fields on the rule besides event/range/points/thresholdPoints (conditional options …). */
  extra: Record<string, string>;
  thresholdPoints?: string;
}

const NUM = String.raw`-?(?:\d+\.?\d*|\.\d+)`;
const RANGE_RE = new RegExp(`^\\s*(${NUM})\\s*-\\s*(${NUM})\\s*$`);
const SINGLE_RE = new RegExp(`^\\s*(${NUM})\\s*$`);
const EACH_RE = new RegExp(`^\\*\\s*(${NUM})$`);
const EVERY_RE = new RegExp(`^(${NUM})\\s*/\\s*(${NUM})$`);

/** "0-99", "-50-999", "0.5-20.0" or a single value "5". */
export function parseRange(raw: string | undefined): { lo: number; hi: number } | undefined {
  const m = RANGE_RE.exec(raw ?? "") ?? SINGLE_RE.exec(raw ?? "");
  if (!m) return undefined;
  const lo = Number(m[1]);
  const hi = Number(m[2] ?? m[1]);
  return Number.isFinite(lo) && Number.isFinite(hi) && hi >= lo ? { lo, hi } : undefined;
}

export function parsePoints(raw: string | undefined, thresholdPoints?: string): PointsSpec {
  const s = (raw ?? "").trim();
  let m = EACH_RE.exec(s);
  if (m) return { kind: "each", n: Number(m[1]) };
  m = EVERY_RE.exec(s);
  if (m && Number(m[2]) > 0) {
    const t = thresholdPoints === undefined ? undefined : Number(thresholdPoints);
    if (t !== undefined && Number.isFinite(t)) return { kind: "formula", threshold: t, a: Number(m[1]), b: Number(m[2]) };
    return { kind: "every", a: Number(m[1]), b: Number(m[2]) };
  }
  m = SINGLE_RE.exec(s);
  if (m) return { kind: "flat", n: Number(m[1]) };
  return { kind: "unknown" };
}

const oneOrMany = z.union([z.array(z.unknown()), z.looseObject({})]);
const ruleSchema = z.looseObject({ event: textNode, range: textNode, points: textNode, thresholdPoints: textNode.optional() });
const groupSchema = z.looseObject({ positions: textNode, rule: oneOrMany.optional() });
const rootSchema = z.looseObject({ rules: z.looseObject({ positionRules: oneOrMany }) });

/** Path of the i-th element of a one-or-many value (no index when MFL sent a single object). */
const itemPath = (base: string, value: unknown, i: number) => (Array.isArray(value) ? `${base}[${i}]` : base);

/**
 * Parse a TYPE=rules body. Throws LeagueImportError BAD_RESPONSE (with the JSON path) when a required
 * field is missing; unparseable ranges or points are kept (lo/hi NaN, kind "unknown") so the scoring
 * map reports them as unmapped instead of failing the import.
 */
export function parseMflRules(json: unknown): MflRule[] {
  const err = mflError(json);
  if (err !== undefined) throw new LeagueImportError("BAD_RESPONSE", `MFL rules: the server returned an error instead of rules`, { platform: "mfl", path: "error" });
  const root = parseAt(rootSchema, json, "", "rules");
  const rules: MflRule[] = [];
  asArray(root.rules.positionRules).forEach((g, group) => {
    const gPath = itemPath("rules.positionRules", root.rules.positionRules, group);
    const parsedGroup = parseAt(groupSchema, g, gPath, "rules");
    const positions = splitPositions(text(parsedGroup.positions) ?? "");
    asArray(parsedGroup.rule).forEach((r, index) => {
      const rPath = itemPath(`${gPath}.rule`, parsedGroup.rule, index);
      const parsed = parseAt(ruleSchema, r, rPath, "rules");
      const extra: Record<string, string> = {};
      if (isRecord(r)) for (const [k, v] of Object.entries(r)) if (!["event", "range", "points", "thresholdPoints"].includes(k)) extra[k] = text(v) ?? JSON.stringify(v);
      const rangeRaw = text(parsed.range) ?? "";
      const pointsRaw = text(parsed.points) ?? "";
      const thresholdPoints = text(parsed.thresholdPoints);
      const range = parseRange(rangeRaw);
      rules.push({
        group,
        index,
        path: rPath,
        positions,
        event: text(parsed.event) ?? "",
        lo: range?.lo ?? Number.NaN,
        hi: range?.hi ?? Number.NaN,
        rangeRaw,
        pointsRaw,
        points: parsePoints(pointsRaw, thresholdPoints),
        extra,
        ...(thresholdPoints !== undefined ? { thresholdPoints } : {}),
      });
    });
  });
  return rules;
}

/** Points one MFL rule gives for a value (a game total, or one play's length), per MFL's semantics. */
export function mflRuleValue(r: MflRule, v: number): number {
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
      return Number.NaN;
  }
}

/** Human-readable rule text for mappings and warnings: "QB|RB: PY -50-999 *.04". */
export function describeRule(r: MflRule): string {
  return `${r.positions.join("|")}: ${r.event} ${r.rangeRaw} ${r.pointsRaw}${r.thresholdPoints !== undefined ? ` (thresholdPoints ${r.thresholdPoints})` : ""}`;
}
