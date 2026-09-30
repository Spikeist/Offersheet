/**
 * MFL position and NFL-team codes → the normalized model (CLAUDE.md §4). Seen 2026-09-29 in
 * TYPE=players DETAILS=1: positions QB RB WR TE PK PN DT DE LB CB S Def ST Off Coach XX and team
 * positions TMQB…TMPN; team codes are MFL's own 3-letter codes (SFO, GBP, KCC, …) plus "FA".
 */

export type Pos = "QB" | "RB" | "WR" | "TE" | "K" | "DEF" | "DL" | "LB" | "DB";

/** MFL player position → Pos. Everything else (PN, ST, Off, Coach, TM*, XX) is unsupported. */
export const MFL_POS: Readonly<Record<string, Pos>> = {
  QB: "QB",
  RB: "RB",
  WR: "WR",
  TE: "TE",
  PK: "K",
  Def: "DEF",
  DT: "DL",
  DE: "DL",
  LB: "LB",
  CB: "DB",
  S: "DB",
};

export const IDP_POS: ReadonlySet<Pos> = new Set(["DL", "LB", "DB"]);

export function toPos(mflPos: string | undefined): Pos | undefined {
  return mflPos ? MFL_POS[mflPos] : undefined;
}

/**
 * A starter/roster-limit entry name can combine positions ("DT+DE", "CB+S"); a scoring rule group
 * uses "|" ("QB|RB|WR|TE"). Returns the MFL positions it covers.
 */
export function splitPositions(name: string): string[] {
  return name
    .split(/[+|]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** MFL team code → the abbreviation Sleeper uses (the canonical ID source). "FA" → null. */
export const MFL_TEAM: Readonly<Record<string, string>> = {
  ARI: "ARI",
  ATL: "ATL",
  BAL: "BAL",
  BUF: "BUF",
  CAR: "CAR",
  CHI: "CHI",
  CIN: "CIN",
  CLE: "CLE",
  DAL: "DAL",
  DEN: "DEN",
  DET: "DET",
  GBP: "GB",
  HOU: "HOU",
  IND: "IND",
  JAC: "JAX",
  KCC: "KC",
  LAC: "LAC",
  LAR: "LAR",
  LVR: "LV",
  MIA: "MIA",
  MIN: "MIN",
  NEP: "NE",
  NOS: "NO",
  NYG: "NYG",
  NYJ: "NYJ",
  PHI: "PHI",
  PIT: "PIT",
  SEA: "SEA",
  SFO: "SF",
  TBB: "TB",
  TEN: "TEN",
  WAS: "WAS",
};

export function toNflTeam(mflTeam: string | undefined): string | null | undefined {
  if (!mflTeam || mflTeam === "FA" || mflTeam === "FA*") return null;
  return MFL_TEAM[mflTeam];
}

/** MFL injury report status → the normalized injury enum (CLAUDE.md §4 PlayerInfo.injury). */
export function toInjury(status: string | undefined): "ACTIVE" | "QUESTIONABLE" | "DOUBTFUL" | "OUT" | "IR" | "PUP" | "SUSPENDED" | "NA" | undefined {
  if (!status) return "ACTIVE";
  const s = status.trim().toUpperCase();
  if (s === "QUESTIONABLE") return "QUESTIONABLE";
  if (s === "DOUBTFUL") return "DOUBTFUL";
  if (s === "OUT") return "OUT";
  if (s === "IR-PUP" || s === "PUP") return "PUP";
  if (s === "IR" || s === "IR-R" || s === "IR-NFI" || s === "IR-NON FOOTBALL") return "IR";
  if (s === "SUSPENDED") return "SUSPENDED";
  if (s === "RETIRED" || s === "HOLDOUT" || s === "INACTIVE") return "NA";
  return undefined;
}
