/**
 * Leaguemates' identities in Fleaflicker responses (CLAUDE.md §0.6).
 *
 * Where identities live: League {id, name, logoUrl, description, chatChannel, inviteUrl …},
 * Division {id, name, teams}, Team {id, name, logoUrl, initials, owners[]} (as team / home / away /
 * owner / ownedBy / originalOwner / eligibleTeams / draftOrder …), User {id, displayName, avatarUrl,
 * initials} (team owners), and free text (trade and activity descriptions, commissioner notes).
 *
 * Two layers:
 * 1. Registration with the platform Redactor (league id, team ids, names, avatars/logos, owner
 *    ids): drives console/report scrubbing and the leak check in saveSanitized.
 * 2. prepare(): key-based replacement before saving a fixture: team/owner/league/division
 *    objects get their placeholder name and id, `initials` and free-text keys are replaced, and
 *    bulky keys the adapters don't need are trimmed.
 *
 * Placeholders follow the standings order: Team N (id 400000N), Owner N (id 200000N),
 * Division N (id 500000N). A division is any object directly inside a `divisions` array (some
 * leagues' single division has no name).
 * Numeric owner ids shorter than 6 digits are NOT registered for global replacement: they could
 * equal a Fleaflicker player id (4–5 digits today) and corrupt player data. They are still replaced
 * by key in prepare().
 */
import { registerScrubber } from "../redact";
import type { JsonPath, Redactor } from "../sanitize";

/** Subtrees of public NFL data: players, pro games/teams, stat categories. Names there are kept. */
const PROTECTED_KEYS = new Set(["proPlayer", "requestedGames", "proTeam", "category", "handcuffTo", "handcuffFor", "viewingActualStats", "viewingProjectedStats", "statsProjected", "stats"]);

export function protectPublic(p: JsonPath): boolean {
  return p.some((k) => typeof k === "string" && PROTECTED_KEYS.has(k));
}

/** Bulky keys adapters don't need; dropped from sanitized fixtures (listed in the fixture note). */
export const TRIM_KEYS: ReadonlySet<string> = new Set([
  "news",
  "headshotUrl",
  "premiumContentAuthSafe",
  "premiumContent",
  "hasLockedPremiumContent",
  "lastX",
  "rankFantasy",
  "rankDraft",
  "ranks",
  "colors",
  "newItemCounts",
  "sortRanges",
  "sortPeriods",
  "sortSeasons",
  "eligibleSorts",
  "eligibleFilterPositions",
  "alwaysAvailablePositions",
  "eligibleLineupPeriods",
  "seasonConsistency",
  "seasonsStandartDeviation",
  "transactionStatus",
  "requestedGames",
  "requestedGamesPeriod",
  "allScoringRuleTypes",
  "swappableWith",
  "proTeam",
  "nameShort",
  "nameFirst",
  "nameLast",
  "percentOwnedRatio",
  "namePlural",
  "summaryLabelIfDiffersFromAbbreviation",
  "viewingFormat",
  "viewingRange",
  "optimumLineup",
  "positionColor",
  "eligibleTeams",
  "eligiblePeriods",
]);

/** Display-stat arrays: only a few stats per position, not used by adapters (dropped when asked). */
const STAT_KEYS: ReadonlySet<string> = new Set(["viewingActualStats", "viewingProjectedStats"]);

/** Free text and links that may contain names; replaced wholesale (outside protected subtrees). */
const FREE_TEXT_KEYS = new Set(["description", "contentsMarkdown", "contentsText", "contentsHtml", "titleText", "chatChannel", "inviteUrl", "draftLiveUrl", "draftBoardUrl", "tiebreakerReason", "invalidationReason", "commentText", "commishNote", "message"]);

/** Values that are data, not identities (position labels, abbreviations): never registered. */
const STRUCTURAL = /^[A-Z0-9/+%-]{1,6}$/;

/**
 * Words of NFL team names. A fantasy team called only by NFL words ("Vegas Raiders") identifies
 * nobody, and registering it would flag ordinary NFL data in other platforms' fixtures. Such names
 * are still replaced by key in prepare().
 */
const NFL_WORDS = new Set(
  (
    "Arizona Cardinals Atlanta Falcons Baltimore Ravens Buffalo Bills Carolina Panthers Chicago Bears Cincinnati Bengals Cleveland Browns " +
    "Dallas Cowboys Denver Broncos Detroit Lions Green Bay Packers Houston Texans Indianapolis Colts Jacksonville Jaguars Kansas City Chiefs " +
    "Las Vegas Raiders Los Angeles Chargers Rams Miami Dolphins Minnesota Vikings New England Patriots Orleans Saints York Giants Jets " +
    "Philadelphia Eagles Pittsburgh Steelers San Francisco 49ers Seattle Seahawks Tampa Buccaneers Tennessee Titans Washington Commanders"
  )
    .toLowerCase()
    .split(/\s+/),
);

export function isNflWordsOnly(value: string): boolean {
  const words = value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return words.length > 0 && words.every((w) => NFL_WORDS.has(w));
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

function isLeagueObj(o: Obj): boolean {
  return "rosterRequirements" in o || "maxKeepers" in o || "capacity" in o || "activeForCurrentSeason" in o || "draftStatus" in o;
}
function divisionKey(o: Obj): string {
  return `${String(o.id ?? "")}|${String(o.name ?? "")}`;
}
/** A division: an object inside a `divisions` array (path …, "divisions", i). Trades also have `teams`. */
function isDivisionAt(o: Obj, path: JsonPath): boolean {
  return path.length >= 2 && path[path.length - 2] === "divisions" && typeof path[path.length - 1] === "number" && !isLeagueObj(o);
}
function isUserObj(o: Obj): boolean {
  return ("displayName" in o || "avatarUrl" in o || "lastSeen" in o || "lastSeenIso" in o) && !("proPlayer" in o) && !("recordOverall" in o);
}
function isTeamObj(o: Obj): boolean {
  return typeof o.id === "number" && typeof o.name === "string" && !isLeagueObj(o) && !Array.isArray(o.teams) && !("abbreviation" in o) && !("nameFull" in o);
}

export class FleaIdentities {
  private readonly teamN = new Map<number, number>();
  private readonly userN = new Map<string, number>();
  private readonly divisionN = new Map<string, number>();
  private readonly leagueN = new Map<number, number>();
  /** Lower-cased values that are public data (NFL player names): never registered as identities. */
  private readonly publicNames = new Set<string>();
  /** Ids of leagues we only screen (no sanitized fixtures): scrubbed from output, kept out of the map. */
  private readonly transientIds = new Set<string>();
  private readonly skipped = new Set<string>();
  private readonly shortIds = new Set<number>();
  /** Distinct names skipped because they look like data (e.g. "TE", an NFL team or player name). */
  get skippedNames(): number {
    return this.skipped.size;
  }
  /** Distinct owner ids too short to replace globally (replaced by key only). */
  get shortUserIds(): number {
    return this.shortIds.size;
  }

  constructor(private readonly r: Redactor) {
    registerScrubber({ scrubText: (t) => this.scrubTransient(t) });
  }

  /** Public names (e.g. every NFL player's full name) that must not be treated as identities. */
  addPublicNames(values: Iterable<string>): void {
    for (const v of values) if (v) this.publicNames.add(v.toLowerCase().trim());
  }

  /** True for public data (an NFL player's name, NFL team words, a position-like label). */
  isPublicName(value: string): boolean {
    const v = value.trim();
    return STRUCTURAL.test(v) || isNflWordsOnly(v) || this.publicNames.has(v.toLowerCase());
  }

  /**
   * A league we only screen or read rules from: its id is scrubbed from console and reports, but
   * not added to the redaction map (short numeric ids collide with unrelated public data there).
   */
  transientLeagueId(id: string | number): void {
    this.transientIds.add(String(id));
  }

  private scrubTransient(text: string): string {
    let out = text;
    for (const id of this.transientIds) if (out.includes(id)) out = out.replace(new RegExp(`(?<!\\d)${id}(?!\\d)`, "g"), "{otherLeagueId}");
    return out;
  }

  get teams(): number {
    return this.teamN.size;
  }
  get owners(): number {
    return this.userN.size;
  }

  private name(value: unknown, category: "team-name" | "owner-name" | "league-name" | "free-text", placeholder: string): void {
    if (typeof value !== "string" || !value.trim()) return;
    if (STRUCTURAL.test(value.trim()) || isNflWordsOnly(value) || this.publicNames.has(value.toLowerCase().trim())) {
      this.skipped.add(value);
      return;
    }
    this.r.register(value, category, placeholder);
  }

  /** Register a league id before any request/print that could include it. */
  leagueId(id: string | number): string {
    const n = Number(id);
    if (!this.leagueN.has(n)) this.leagueN.set(n, this.leagueN.size + 1);
    return this.r.register(String(id), "league-id") ?? String(id);
  }

  league(o: Obj): void {
    if (typeof o.id === "number") this.leagueId(o.id);
    const n = typeof o.id === "number" ? (this.leagueN.get(o.id) ?? 0) : 0;
    this.name(o.name, "league-name", `League ${n || "?"}`);
    if (typeof o.logoUrl === "string") this.r.register(o.logoUrl, "avatar");
  }

  division(o: Obj): number {
    const key = divisionKey(o);
    if (!this.divisionN.has(key)) this.divisionN.set(key, this.divisionN.size + 1);
    const n = this.divisionN.get(key) as number;
    // Division ids are consecutive, league-specific numbers: always replaced by key (prepare), and
    // registered for global replacement when long enough not to equal a 4–5 digit player id.
    if (typeof o.id === "number" && String(o.id).length >= 6) this.r.register(String(o.id), "other-id", String(5000000 + n));
    this.name(o.name, "free-text", `Division ${n}`);
    return n;
  }

  divisionPlaceholderId(o: Obj): number {
    return 5000000 + (this.divisionN.get(divisionKey(o)) ?? 999999);
  }

  team(o: Obj): number {
    const id = o.id as number;
    if (!this.teamN.has(id)) this.teamN.set(id, this.teamN.size + 1);
    const n = this.teamN.get(id) as number;
    this.r.register(String(id), "other-id", String(4000000 + n));
    this.name(o.name, "team-name", `Team ${n}`);
    if (typeof o.logoUrl === "string") this.r.register(o.logoUrl, "avatar");
    return n;
  }

  user(o: Obj): number {
    const key = typeof o.id === "number" ? `id:${o.id}` : `name:${String(o.displayName ?? "")}`;
    if (!this.userN.has(key)) this.userN.set(key, this.userN.size + 1);
    const n = this.userN.get(key) as number;
    if (typeof o.id === "number") {
      if (String(o.id).length >= 6) this.r.register(String(o.id), "user-id", String(2000000 + n));
      else this.shortIds.add(o.id);
    }
    this.name(o.displayName, "owner-name", `Owner ${n}`);
    if (typeof o.avatarUrl === "string") this.r.register(o.avatarUrl, "avatar");
    return n;
  }

  /** Walk any response and register every league/division/team/user object in it. */
  sweep(json: unknown, path: JsonPath = []): void {
    if (Array.isArray(json)) {
      json.forEach((x, i) => this.sweep(x, [...path, i]));
      return;
    }
    if (!isObj(json) || protectPublic(path)) return;
    if (isLeagueObj(json) && typeof json.id === "number") this.league(json);
    else if (isDivisionAt(json, path)) this.division(json);
    else if (isUserObj(json)) this.user(json);
    else if (isTeamObj(json)) this.team(json);
    for (const [k, v] of Object.entries(json)) this.sweep(v, [...path, k]);
  }

  teamPlaceholderId(rawId: number): number | undefined {
    const n = this.teamN.get(rawId);
    return n === undefined ? undefined : 4000000 + n;
  }
  teamLabel(rawId: number | undefined): string {
    const n = rawId === undefined ? undefined : this.teamN.get(rawId);
    return n === undefined ? "Team ?" : `Team ${n}`;
  }

  /**
   * Fixture copy with identities replaced by key (see file comment). `trim` drops TRIM_KEYS.
   * The result still goes through Redactor.apply + leak check in p.saveSanitized.
   */
  prepare(json: unknown, opts: { trim?: boolean; dropStats?: boolean } = {}): unknown {
    const walk = (v: unknown, path: JsonPath): unknown => {
      if (Array.isArray(v)) return v.map((x, i) => walk(x, [...path, i]));
      if (!isObj(v)) return v;
      const prot = protectPublic(path);
      const out: Obj = {};
      const league = !prot && isLeagueObj(v) && typeof v.id === "number";
      const division = !prot && !league && isDivisionAt(v, path);
      const user = !prot && !league && !division && isUserObj(v);
      const team = !prot && !league && !division && !user && isTeamObj(v);
      for (const [k, x] of Object.entries(v)) {
        if (opts.trim && TRIM_KEYS.has(k)) continue;
        if (opts.dropStats && STAT_KEYS.has(k)) continue;
        // A player's owning team: the id is enough (the team object is in the standings).
        if (opts.trim && !prot && k === "owner" && isObj(x) && typeof x.id === "number") {
          out[k] = { id: this.teamPlaceholderId(x.id) ?? 4999999 };
          continue;
        }
        // A lineup slot repeats the whole roster-position rule; label + group identify it.
        if (opts.trim && k === "position" && isObj(x) && "eligibility" in x && ("leaguePlayer" in v || "home" in v || "away" in v)) {
          out[k] = { label: x.label, group: x.group };
          continue;
        }
        if (!prot) {
          if (k === "initials" && typeof x === "string") {
            out[k] = "XX";
            continue;
          }
          if (FREE_TEXT_KEYS.has(k) && x !== null && x !== undefined && !(k === "description" && "category" in v)) {
            out[k] = "[redacted]";
            continue;
          }
          if (league && k === "id") {
            out[k] = Number(this.r.placeholderOf(String(x)) ?? 0);
            continue;
          }
          if (league && k === "name") {
            out[k] = `League ${this.leagueN.get(v.id as number) ?? "?"}`;
            continue;
          }
          if (division && k === "name") {
            out[k] = `Division ${this.divisionN.get(divisionKey(v)) ?? "?"}`;
            continue;
          }
          if (division && k === "id" && typeof x === "number") {
            out[k] = this.divisionPlaceholderId(v);
            continue;
          }
          if (team && k === "id") {
            out[k] = this.teamPlaceholderId(x as number) ?? 4999999;
            continue;
          }
          if (team && k === "name") {
            out[k] = this.teamLabel(v.id as number);
            continue;
          }
          if (user && (k === "lastSeen" || k === "lastSeenIso")) continue; // when a person was last online
          if (user && (k === "id" || k === "displayName")) {
            const key = typeof v.id === "number" ? `id:${v.id}` : `name:${String(v.displayName ?? "")}`;
            const n = this.userN.get(key) ?? 0;
            out[k] = k === "id" ? 2000000 + n : `Owner ${n}`;
            continue;
          }
          if ((k === "teamId" || k === "originalOwnerId") && typeof x === "number" && this.teamN.has(x)) {
            out[k] = this.teamPlaceholderId(x);
            continue;
          }
        }
        out[k] = walk(x, [...path, k]);
      }
      return out;
    };
    return walk(json, []);
  }
}
