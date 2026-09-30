/**
 * Test support (not app code): which canonical (Sleeper) stat keys committed Sleeper rows actually
 * carry, by position class. A scoring map must read keys Sleeper fills for that class (Phase 1 review
 * ENG-5: the MFL map read pr_td / kr_td / ff / fum_rec, which Sleeper never puts on a player row, so
 * return TDs and forced fumbles were dropped silently).
 *
 * Committed sources only (no network):
 * - fixtures/sanitized/shared: Sleeper /stats (weeks 1–3) and /projections (weeks 4, 5, 10, 15, 17,
 *   18; season QB), whole rows for the top 150 QB/RB/WR/TE plus 6 per K/DEF/IDP. Projection rows are
 *   read the way the engine sees them, after the Sleeper adapter's normalizeProjectionStats (a
 *   player's projected pr_td / def_kr_td become st_td): a raw projection key isn't evidence, since
 *   the old MFL map's pr_td would have passed on raw projection rows.
 * - the committed MFL and Fleaflicker oracle fixtures: Sleeper /stats lines trimmed to the keys each
 *   league scores (they add punters and more defensive players).
 */
import { normalizeProjectionStats } from "@/adapters/sleeper/scoringMap";
import type { Pos, StatLine } from "@/engine/model";
import { fixtureLabels, readMinFixture, readSanitizedFixture } from "@/test-utils/fixtures";

export type EvidenceClass = "off" | "idp" | "def";

/** Model positions of each class: offense, kickers and punters; individual defenders; team defense. */
export const CLASS_POSITIONS: Readonly<Record<EvidenceClass, readonly Pos[]>> = {
  off: ["QB", "RB", "WR", "TE", "K", "P"],
  idp: ["DL", "LB", "DB"],
  def: ["DEF"],
};

/** Sleeper's own position labels (players DB) for individual defenders. */
const SLEEPER_IDP = new Set(["DL", "DE", "DT", "NT", "LB", "ILB", "OLB", "DB", "CB", "S", "SS", "FS"]);

function classOfSleeperPos(position: string | undefined): EvidenceClass | undefined {
  if (!position) return undefined;
  if (position === "DEF") return "def";
  if (SLEEPER_IDP.has(position)) return "idp";
  return (CLASS_POSITIONS.off as readonly string[]).includes(position) ? "off" : undefined;
}

interface SleeperRow {
  player?: { position?: string };
  stats?: Record<string, unknown>;
}

interface OracleFixtureLike {
  cases: Array<{ pos: Pos; stats: StatLine }>;
}

/** Committed oracle fixtures whose stat lines are Sleeper /stats rows (platform, group, label). */
const ORACLE_FIXTURES: ReadonlyArray<readonly [string, string, string]> = [
  ["mfl", "oracle", "test-league"],
  ["fleaflicker", "oracle", "conventional-league"],
  ["fleaflicker", "oracle", "keeper-league"],
];

export interface KeyEvidence {
  /** Rows (or oracle player-weeks) with a non-zero value, by class and key. */
  rows: Record<EvidenceClass, Map<string, number>>;
  /** Sources read, for the test's description. */
  sources: string[];
}

export function sleeperKeyEvidence(): KeyEvidence {
  const rows: KeyEvidence["rows"] = { off: new Map(), idp: new Map(), def: new Map() };
  const add = (cls: EvidenceClass | undefined, stats: Record<string, unknown> | undefined) => {
    if (!cls || !stats) return;
    for (const [k, v] of Object.entries(stats)) if (typeof v === "number" && v !== 0) rows[cls].set(k, (rows[cls].get(k) ?? 0) + 1);
  };
  const sources: string[] = [];
  for (const label of fixtureLabels("fixtures/sanitized/shared").filter((l) => /^sleeper\/(stats|projections)\//.test(l)).sort()) {
    const projections = label.startsWith("sleeper/projections/");
    for (const r of readSanitizedFixture<SleeperRow[]>("shared", label)) {
      const position = r.player?.position;
      add(classOfSleeperPos(position), projections ? normalizeProjectionStats(r.stats, position) : r.stats);
    }
    sources.push(`shared ${label}`);
  }
  for (const [platform, group, label] of ORACLE_FIXTURES) {
    const posClass = (pos: Pos) => (Object.keys(CLASS_POSITIONS) as EvidenceClass[]).find((c) => CLASS_POSITIONS[c].includes(pos));
    for (const c of readMinFixture<OracleFixtureLike>(platform, group, label).cases) add(posClass(c.pos), c.stats);
    sources.push(`min ${platform}/${group}/${label}`);
  }
  return { rows, sources };
}
