/**
 * Fantrax public "fxea" API (CLAUDE.md §2.7): URLs, response shapes and the error convention.
 *
 * Endpoints and parameters follow Fantrax's beta API docs as mirrored by pmurley/go-fantrax
 * (README + Go structs, "current as of April 2025"). Observed live on 2026-09-29: responses are
 * JSON served as text/plain, so parse the body regardless of Content-Type.
 */
import { z } from "zod";
import type { HttpResult } from "../http";

export const FANTRAX_BASE = "https://www.fantrax.com/fxea/general/";

export function fantraxUrl(endpoint: string, params: Record<string, string>): string {
  return `${FANTRAX_BASE}${endpoint}?${new URLSearchParams(params).toString()}`;
}

/** getPlayerIds?sport=NFL: an object keyed by fantraxId. Team units carry teamName/teamShortName instead of team. */
export const PlayerIdRecord = z.object({
  fantraxId: z.string(),
  name: z.string(),
  position: z.string(),
  team: z.string().optional(),
  teamName: z.string().optional(),
  teamShortName: z.string().optional(),
  shortName: z.string().optional(),
  sportRadarId: z.string().optional(),
  rotowireId: z.number().optional(),
  statsIncId: z.number().optional(),
});
export type FantraxPlayer = z.infer<typeof PlayerIdRecord>;
export const PlayerIdsResponse = z.record(z.string(), PlayerIdRecord);

/** getAdp?sport=NFL: an array. Team defenses have tmId ("TM_<teamId>") and no pos. 999 means "no ADP". */
export const AdpEntry = z.object({
  id: z.string(),
  name: z.string(),
  pos: z.string().optional(),
  ADP: z.number().optional(),
  ADP_PPR: z.number().optional(),
  tmId: z.string().optional(),
});
export type FantraxAdp = z.infer<typeof AdpEntry>;
export const AdpResponse = z.array(AdpEntry);

/** ADP value Fantrax uses for "no ADP". */
export const NO_ADP = 999;

export type IdFormat = "player" | "teamUnit" | "other";

/** Player ids are 5 lowercase base-36 chars ("04ca6"); team units are "<teamId>#<unitCode>" ("20180#1090"). */
export function idFormat(id: string): IdFormat {
  if (/^[0-9a-z]{5}$/.test(id)) return "player";
  if (/^\d+#\d+$/.test(id)) return "teamUnit";
  return "other";
}

/**
 * Team-level pseudo-players that nevertheless use 5-char player ids: "Team K, <city>" (TK) and
 * "Team QB, <city>" (TQB). Observed 2026-09-29: 64 records, none with a vendor ID.
 */
export const TEAM_PLAYER_FORMAT_POSITIONS: ReadonlySet<string> = new Set(["TK", "TQB"]);

/**
 * What a getPlayerIds record is: a real player, a '#' team unit (DST, ST…), a team unit with a
 * player-format id (TK/TQB), or an unknown id format. Classify by position as well as by id.
 */
export type RecordKind = "player" | "teamUnit" | "teamPlayerFormat" | "other";

export function recordKind(key: string, p: Pick<FantraxPlayer, "position">): RecordKind {
  const f = idFormat(key);
  if (f === "teamUnit") return "teamUnit";
  if (f === "player") return TEAM_PLAYER_FORMAT_POSITIONS.has(p.position) ? "teamPlayerFormat" : "player";
  return "other";
}

/**
 * Cache predicate for Fantrax data calls (RequestOptions.cacheIf): errors arrive as HTTP 200 with an
 * error object (§2.7), so only cache a parsed JSON body without one. A transient error must not be
 * served from cache for the next 24 h (player lists) or 10 min (league calls).
 */
export function fantraxCacheable(res: Pick<HttpResult, "status" | "isHtml" | "json">): boolean {
  return res.status === 200 && !res.isHtml && res.json !== undefined && fantraxError(res.json) === null;
}

/** Players without an NFL team have team "(N/A)". */
export function nflTeamOf(p: Pick<FantraxPlayer, "team" | "teamShortName">): string | null {
  const t = p.team ?? p.teamShortName;
  return t && t !== "(N/A)" ? t : null;
}

export interface FantraxErrorInfo {
  /** JSON path of the error object/value. */
  path: string;
  /** Top-level keys of the error object (or the value's type). */
  keys: string[];
  /** Human-readable message, if the error carries one. */
  message?: string;
  code?: string;
}

/**
 * §2.7: Fantrax reports errors as HTTP 200 with an `error` object in the body. Returns what the
 * error looks like, or null when the body has no top-level error field.
 */
export function fantraxError(json: unknown): FantraxErrorInfo | null {
  if (!isRecord(json)) return null;
  const key = Object.keys(json).find((k) => /^errors?$/i.test(k));
  if (key === undefined) return null;
  const err = json[key];
  if (isRecord(err)) {
    const message = ["message", "msg", "description", "errorMessage", "detail"].map((k) => err[k]).find((v): v is string => typeof v === "string");
    const code = ["code", "errorCode", "type", "status"].map((k) => err[k]).find((v): v is string | number => typeof v === "string" || typeof v === "number");
    return { path: key, keys: Object.keys(err), message, code: code === undefined ? undefined : String(code) };
  }
  if (typeof err === "string") return { path: key, keys: ["(string)"], message: err };
  if (err === null || err === false || err === undefined) return null;
  return { path: key, keys: [Array.isArray(err) ? "(array)" : typeof err] };
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
