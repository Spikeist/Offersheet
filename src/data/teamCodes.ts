/**
 * NFL team codes across sources → Sleeper's convention (CLAUDE.md §2.9). Pure.
 *
 * Sleeper's team-defense player id IS its team code ("DAL", "LAR", "WAS"), so the same lookup gives
 * the canonical DEF id and a normalized nflTeam. Codes differ by source: ESPN writes WSH, nflverse
 * LA, and DynastyProcess (which uses MFL's codes) GBP, JAC, KCC, LVR, NEP, NOS, SFO and TBB.
 *
 * Aliases are derived from the data wherever a source carries both a team code and a Sleeper player
 * id: a code's Sleeper team is the one most of its players are on in Sleeper (the Phase 0
 * pairTeamCodes vote). Only the codes no loaded source carries are hand-typed (STATIC_TEAM_ALIASES).
 */

/** Values that mean "no team" (free agents, blanks). DynastyProcess also writes "FA*". */
const NOT_A_TEAM = new Set(["", "FA", "FA*", "NA", "N/A", "NULL", "NONE", "UNK", "UNKNOWN"]);

/**
 * Hand-typed aliases, kept to the codes that no crosswalk source carries (each checked in
 * teamCodes.test.ts against committed data):
 * - WSH: ESPN's Washington code. ESPN isn't a crosswalk source; Phase 0 derived WSH → WAS (nflverse)
 *   by joining ESPN's proTeamSchedules games with nflverse games on the ESPN event id (NFL.teamMap).
 * - LA: nflverse's Rams code (the same join).
 * - OAK: the Raiders before their 2020 move to Las Vegas; old DynastyProcess rows still carry it.
 * An alias is used only when its target is one of the loaded Sleeper codes.
 */
export const STATIC_TEAM_ALIASES: Readonly<Record<string, string>> = { WSH: "WAS", LA: "LAR", OAK: "LV" };

/**
 * Sleeper's 32 team codes (its team-defense ids are the same codes). Used only when neither the
 * Sleeper DB nor FantasyCalc loaded, so ESPN's and nflverse's codes still resolve through the aliases
 * above (DATA-6). teamCodes.test.ts checks the list against the committed Sleeper fixtures.
 */
export const SLEEPER_TEAM_CODES: readonly string[] = [
  "ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE", "DAL", "DEN", "DET", "GB", "HOU", "IND", "JAX", "KC",
  "LAC", "LAR", "LV", "MIA", "MIN", "NE", "NO", "NYG", "NYJ", "PHI", "PIT", "SEA", "SF", "TB", "TEN", "WAS",
];

/**
 * A derived alias needs at least this many players voting for the same Sleeper team, and a strict
 * majority of the code's voters (Phase 0: every real alias had 10–16 votes; stale codes have none).
 */
export const TEAM_ALIAS_MIN_SUPPORT = 3;

/** A team code seen next to a Sleeper player id in some source (e.g. a DynastyProcess row). */
export interface TeamCodeObservation {
  source: string;
  code: string | null | undefined;
  sleeperId: string;
}

export interface DerivedTeamAlias {
  code: string;
  to: string;
  /** Players whose Sleeper team is `to`. */
  support: number;
  /** Players with a known Sleeper team. */
  voters: number;
  sources: string[];
}

/** Team name parts, e.g. Sleeper DEF rows: first_name "Minnesota", last_name "Vikings". */
export interface TeamName {
  code: string;
  location?: string | null;
  nickname?: string | null;
}

export interface TeamCodeIndex {
  /** Sleeper code for a team code in any source's convention, or a team nickname ("Vikings", "Vikings D/ST"). */
  toSleeper(codeOrName: string): string | undefined;
  /** The Sleeper codes this index knows (from the loaded data). */
  readonly codes: ReadonlySet<string>;
  readonly derived: readonly DerivedTeamAlias[];
}

/** Upper-cased, trimmed code; null for "no team". */
export function cleanTeamCode(code: string | null | undefined): string | null {
  if (typeof code !== "string") return null;
  const c = code.trim().toUpperCase();
  return NOT_A_TEAM.has(c) ? null : c;
}

function nameKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+(d\/st|dst|d\/st defense|defense|def)$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Derive aliases for codes outside `reference`: each code maps to the Sleeper team most of its
 * players are on (strict majority, at least TEAM_ALIAS_MIN_SUPPORT votes). Codes in `reference`
 * are never aliased.
 */
export function deriveTeamAliases(observations: Iterable<TeamCodeObservation>, reference: ReadonlySet<string>, teamOfPlayer: ReadonlyMap<string, string>): DerivedTeamAlias[] {
  const byCode = new Map<string, { players: Set<string>; sources: Set<string> }>();
  for (const o of observations) {
    const code = cleanTeamCode(o.code);
    if (!code || reference.has(code)) continue;
    const entry = byCode.get(code) ?? { players: new Set<string>(), sources: new Set<string>() };
    entry.players.add(o.sleeperId);
    entry.sources.add(o.source);
    byCode.set(code, entry);
  }
  const out: DerivedTeamAlias[] = [];
  for (const [code, { players, sources }] of [...byCode].sort(([a], [b]) => a.localeCompare(b))) {
    const votes = new Map<string, number>();
    for (const id of players) {
      const team = teamOfPlayer.get(id);
      if (team && reference.has(team)) votes.set(team, (votes.get(team) ?? 0) + 1);
    }
    const voters = [...votes.values()].reduce((a, b) => a + b, 0);
    const [to, support] = [...votes].sort(([ta, x], [tb, y]) => y - x || ta.localeCompare(tb))[0] ?? ["", 0];
    if (to && support >= TEAM_ALIAS_MIN_SUPPORT && support * 2 > voters) out.push({ code, to, support, voters, sources: [...sources].sort() });
  }
  return out;
}

export function buildTeamCodeIndex(input: {
  /** Sleeper team codes (Sleeper DEF ids and the teams of Sleeper players). */
  sleeperCodes: Iterable<string>;
  /** Names for matching by nickname (Sleeper DEF rows). */
  teamNames?: Iterable<TeamName>;
  observations?: Iterable<TeamCodeObservation>;
  /** Sleeper id → Sleeper team code, for the alias vote. */
  teamOfPlayer?: ReadonlyMap<string, string>;
}): TeamCodeIndex {
  const codes = new Set<string>();
  for (const c of input.sleeperCodes) {
    const clean = cleanTeamCode(c);
    if (clean) codes.add(clean);
  }
  const derived = deriveTeamAliases(input.observations ?? [], codes, input.teamOfPlayer ?? new Map());
  const derivedBy = new Map(derived.map((d) => [d.code, d.to]));
  const byName = new Map<string, string>();
  for (const t of input.teamNames ?? []) {
    const code = cleanTeamCode(t.code);
    if (!code || !codes.has(code)) continue;
    const nick = t.nickname?.trim();
    if (!nick) continue;
    byName.set(nameKey(nick), code);
    const loc = t.location?.trim();
    if (loc) byName.set(nameKey(`${loc} ${nick}`), code);
  }
  return {
    codes,
    derived,
    toSleeper(codeOrName: string): string | undefined {
      const code = cleanTeamCode(codeOrName);
      if (!code) return undefined;
      if (codes.has(code)) return code;
      const alias = STATIC_TEAM_ALIASES[code];
      if (alias && codes.has(alias)) return alias;
      const fromData = derivedBy.get(code);
      if (fromData) return fromData;
      return byName.get(nameKey(codeOrName));
    },
  };
}
