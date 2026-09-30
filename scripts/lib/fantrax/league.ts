/**
 * Fantrax league responses (getLeagueInfo, getTeamRosters, getStandings, getDraftPicks): identity
 * registration for the sanitizer and defensive extractors for the Data Checklist.
 *
 * Shapes follow pmurley/go-fantrax's structs (April 2025). They have NOT been checked against a
 * live NFL league yet (Phase 0 had no public Fantrax league ID), so every extractor returns
 * null/empty instead of throwing, and the sanitizer sweeps by key name as well as by known path.
 */
import type { JsonPath, Redactor } from "../sanitize";
import { isRecord } from "./api";

/** League endpoints the probe reads when FANTRAX_LEAGUE_ID is set (public leagues only). */
export const LEAGUE_ENDPOINTS = ["getLeagueInfo", "getTeamRosters", "getStandings", "getDraftPicks"] as const;
export type LeagueEndpoint = (typeof LEAGUE_ENDPOINTS)[number];

/**
 * Sections that describe players or scoring, not people: there, names of stats, positions and
 * players are kept and only ID-like values are replaced. draftSettings / poolSettings are NOT
 * protected: they are league configuration and could name teams or owners (e.g. a draft order).
 */
const PROTECTED_SECTIONS = new Set(["scoringSystem", "playerInfo", "rosterItems", "positionConstraints"]);

const PERSON_KEY = /(owner|manager|commissioner|nick|realname|firstname|lastname|displayname|username|^user$|^userid$|email)/i;
const TEAM_ID_KEY = /^(teamid|ownerteamid|originalteamid|originalownerteamid|currentownerteamid|ownerid|fromteamid|toteamid|tradedfromteamid|tradedtoteamid)$/i;
/** Fantasy-team names; never protected, wherever they appear. */
const TEAM_NAME_KEY = /^(teamName|longName)$/;

/** Keys that hold a person's or fantasy team's identity: sanitized even inside protected sections. */
function isIdentityKey(k: string | number | undefined): boolean {
  return typeof k === "string" && (PERSON_KEY.test(k) || TEAM_ID_KEY.test(k) || TEAM_NAME_KEY.test(k));
}

export function protectLeaguePath(path: JsonPath): boolean {
  if (!path.some((k) => typeof k === "string" && PROTECTED_SECTIONS.has(k))) return false;
  return !isIdentityKey(path[path.length - 1]);
}
const TEAM_CONTAINERS = new Set(["teamInfo", "rosters"]);

function looksLikePlayerId(v: string): boolean {
  return /^[0-9a-z]{5}$/.test(v) || /^\d+#\d+$/.test(v);
}

function isTeamObject(o: Record<string, unknown>): boolean {
  return "teamId" in o || "teamName" in o || ("name" in o && ("id" in o || "shortName" in o));
}

type Visit = (value: unknown, key: string | number | undefined, path: JsonPath, parent: Record<string, unknown> | unknown[] | undefined) => void;

function walk(v: unknown, visit: Visit, path: JsonPath = [], key?: string | number, parent?: Record<string, unknown> | unknown[]): void {
  visit(v, key, path, parent);
  if (Array.isArray(v)) v.forEach((x, i) => walk(x, visit, [...path, i], i, v));
  else if (isRecord(v)) for (const [k, x] of Object.entries(v)) walk(x, visit, [...path, k], k, v);
}

/**
 * Register every leaguemate identity in the league responses: league ID and name, team IDs, team
 * names and abbreviations, division names, and anything under owner/manager/user-like keys —
 * including such keys inside player/scoring sections (protectLeaguePath leaves them unprotected).
 */
export function registerLeagueIdentities(r: Redactor, leagueId: string, docs: unknown[]): void {
  r.register(leagueId, "league-id", (n) => `league-${n}`);
  const teamId = (v: unknown) => {
    if (typeof v === "string" && v.length >= 4 && !looksLikePlayerId(v)) r.register(v, "other-id", (n) => `team-id-${n}`);
  };
  for (const doc of docs) {
    walk(doc, (value, key, path, parent) => {
      if (protectLeaguePath(path)) return;
      const k = typeof key === "string" ? key : "";
      // Object keys of teamInfo / rosters are team IDs.
      const container = path[path.length - 2];
      if (typeof container === "string" && TEAM_CONTAINERS.has(container) && isRecord(value)) teamId(k);
      if (typeof value !== "string" && typeof value !== "number") return;
      const s = String(value);
      if (k === "leagueName") r.register(s, "league-name");
      else if (k === "teamName" || k === "longName") r.register(s, "team-name");
      else if (/^division(name)?$/i.test(k)) r.register(s, "free-text", (n) => `Division ${n}`);
      else if (TEAM_ID_KEY.test(k)) teamId(s);
      else if (PERSON_KEY.test(k) && typeof value === "string") {
        r.register(s, /@/.test(s) ? "email" : /^[A-Za-z0-9_-]{6,}$/.test(s) && /\d/.test(s) ? "user-id" : "owner-name");
      } else if (isRecord(parent) && isTeamObject(parent)) {
        if (k === "name") r.register(s, "team-name");
        else if (k === "shortName") r.register(s, "team-abbrev");
        else if (k === "id") teamId(s);
      }
    });
  }
}

/** A JSON path with array indices and ID-like object keys collapsed: rosters.{id}.rosterItems[].status */
export function collapsedPath(path: JsonPath): string {
  return path
    .map((k) => (typeof k === "number" ? "[]" : looksLikePlayerId(k) ? ".{playerId}" : /^[0-9a-z]{10,}$/i.test(k) && /\d/.test(k) ? ".{id}" : `.${k}`))
    .join("")
    .replace(/^\./, "");
}

/** Collapsed JSON paths whose key matches `re` (e.g. /playoff/i), for "is it exposed?" evidence. */
export function keyPaths(json: unknown, re: RegExp, limit = 12): string[] {
  const out = new Set<string>();
  walk(json, (_v, key, path) => {
    if (typeof key === "string" && re.test(key)) out.add(collapsedPath(path));
  });
  return [...out].slice(0, limit);
}

export interface ScoringRule {
  group?: string;
  position?: string;
  category: string;
  categoryName?: string;
  points: number;
}

const code = (o: unknown): string | undefined => {
  if (!isRecord(o)) return undefined;
  const v = o.code ?? o.shortName ?? o.id ?? o.name;
  return typeof v === "string" || typeof v === "number" ? String(v) : undefined;
};

/** scoringSystem.scoringCategorySettings[].configs[] → rules. Null when the league info has no scoring system. */
export function scoringRules(info: unknown): { type?: string; rules: ScoringRule[] } | null {
  const sys = isRecord(info) ? info.scoringSystem : undefined;
  if (!isRecord(sys)) return null;
  const rules: ScoringRule[] = [];
  const settings = Array.isArray(sys.scoringCategorySettings) ? sys.scoringCategorySettings : [];
  for (const group of settings) {
    if (!isRecord(group)) continue;
    const configs = Array.isArray(group.configs) ? group.configs : [];
    for (const c of configs) {
      if (!isRecord(c)) continue;
      const category = code(c.scoringCategory);
      const points = typeof c.points === "number" ? c.points : Number(c.points);
      if (!category || !Number.isFinite(points)) continue;
      const catName = isRecord(c.scoringCategory) && typeof c.scoringCategory.name === "string" ? c.scoringCategory.name : undefined;
      rules.push({ group: code(group.group), position: code(c.position), category, categoryName: catName, points });
    }
  }
  return { type: typeof sys.type === "string" ? sys.type : undefined, rules };
}

export interface RosterLimits {
  maxActiveByPos: Record<string, number>;
  maxTotalPlayers?: number;
  maxTotalActivePlayers?: number;
  maxTotalReservePlayers?: number;
}

export function rosterLimits(info: unknown): RosterLimits | null {
  const ri = isRecord(info) ? info.rosterInfo : undefined;
  if (!isRecord(ri)) return null;
  const maxActiveByPos: Record<string, number> = {};
  if (isRecord(ri.positionConstraints)) {
    for (const [pos, c] of Object.entries(ri.positionConstraints)) if (isRecord(c) && typeof c.maxActive === "number") maxActiveByPos[pos] = c.maxActive;
  }
  const num = (v: unknown) => (typeof v === "number" ? v : undefined);
  return { maxActiveByPos, maxTotalPlayers: num(ri.maxTotalPlayers), maxTotalActivePlayers: num(ri.maxTotalActivePlayers), maxTotalReservePlayers: num(ri.maxTotalReservePlayers) };
}

export interface FantraxTeam {
  id: string;
  name?: string;
  division?: string;
}

export function teamsOf(info: unknown): FantraxTeam[] {
  const ti = isRecord(info) ? info.teamInfo : undefined;
  if (!isRecord(ti)) return [];
  return Object.entries(ti).map(([key, t]) => ({
    id: isRecord(t) && typeof t.id === "string" ? t.id : key,
    name: isRecord(t) && typeof t.name === "string" ? t.name : undefined,
    division: isRecord(t) && typeof t.division === "string" ? t.division : undefined,
  }));
}

/** matchups[] → the scoring periods that have head-to-head games, and the number of games. */
export function matchupPeriods(info: unknown): { periods: number[]; games: number } {
  const m = isRecord(info) && Array.isArray(info.matchups) ? info.matchups : [];
  const periods: number[] = [];
  let games = 0;
  for (const p of m) {
    if (!isRecord(p)) continue;
    if (typeof p.period === "number") periods.push(p.period);
    if (Array.isArray(p.matchupList)) games += p.matchupList.length;
  }
  return { periods: periods.sort((a, b) => a - b), games };
}

export interface RosterItem {
  teamId: string;
  id: string;
  position?: string;
  status?: string;
}

/** getTeamRosters → rosters.{teamId}.rosterItems[] {id, position, status}. */
export function rosterItems(rosters: unknown): { period?: number; items: RosterItem[]; teams: number } {
  const r = isRecord(rosters) ? rosters.rosters : undefined;
  const items: RosterItem[] = [];
  let teams = 0;
  if (isRecord(r)) {
    for (const [teamId, t] of Object.entries(r)) {
      teams++;
      const list = isRecord(t) && Array.isArray(t.rosterItems) ? t.rosterItems : [];
      for (const it of list) {
        if (isRecord(it) && typeof it.id === "string") items.push({ teamId, id: it.id, position: typeof it.position === "string" ? it.position : undefined, status: typeof it.status === "string" ? it.status : undefined });
      }
    }
  }
  const period = isRecord(rosters) && typeof rosters.period === "number" ? rosters.period : undefined;
  return { period, items, teams };
}

export function countBy<T>(xs: T[], f: (x: T) => string | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const x of xs) {
    const k = f(x) ?? "(none)";
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}
