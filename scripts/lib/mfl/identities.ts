/**
 * Register every leaguemate identity found in MFL responses with the Redactor (CLAUDE.md §0.6)
 * before anything is printed or saved. Placeholders follow the franchise ID ("0003" → "Team 3").
 *
 * Where MFL puts identities (seen 2026-09-29 as a guest; owners and commissioners see more — api_info:
 * "If you pass the cookie of a user with commissioner access, it will return otherwise private owner
 * information, like owner names, email addresses, etc."):
 * - league: id, name, history[].url (past league IDs), franchises[] name/abbrev/icon/logo/stadium,
 *   and for owners/commissioners owner_name, email, phone numbers, usernames …;
 *   division/conference names.
 * - free text: draftResults comments, tradeBait inExchangeFor, trade comments, playoff bracket
 *   names and titles, lineup comments.
 * - URLs: league IDs inside homeURL/baseURL/static_url (replaced as whole numbers), and the league's
 *   own wwwNN host (replaced by a placeholder host: with a public search it narrows the league down).
 *
 * MFL franchise fields are an allowlist (review F10): only SAFE_FRANCHISE_KEYS keep their values. Every
 * other field is either a known identity (registered with a typed placeholder) or replaced by path
 * (redactFranchiseFields) — numeric or not, so a ZIP code or a numeric account id can't slip through.
 */
import type { Redactor } from "../sanitize";
import { asArray, at, isRecord, text } from "./json";

/** MFL franchise fields that are settings or numbers, never identities. */
export const SAFE_FRANCHISE_KEYS: ReadonlySet<string> = new Set([
  "id",
  "waiverSortOrder",
  "bbidAvailableBalance",
  "salaryCapAmount",
  "division",
  "conference",
  "lastVisit",
  "time_zone",
  "play_audio",
  "use_advanced_editor",
  "mail_event",
  "future_draft_picks",
  "country",
]);

/** MFL franchise fields registered as identities with their own placeholder kind. */
export const IDENTITY_FRANCHISE_KEYS: ReadonlySet<string> = new Set(["name", "abbrev", "owner_name", "email", "icon", "logo", "username", "twitterUsername"]);

/**
 * League-level fields seen as a guest on 2026-09-29 (settings). With a login cookie, any OTHER league
 * field is treated as possibly personal and replaced by path (redactUnknownLeagueFields).
 */
export const KNOWN_LEAGUE_KEYS: ReadonlySet<string> = new Set([
  "baseURL",
  "bestLineup",
  "currentWaiverType",
  "defaultTradeExpirationDays",
  "divisions",
  "conferences",
  "draftLimitHours",
  "draftPlayerPool",
  "draftTimer",
  "draft_kind",
  "endWeek",
  "franchises",
  "h2h",
  "history",
  "id",
  "injuredReserve",
  "lastRegularSeasonWeek",
  "loadRosters",
  "lockout",
  "maxWaiverRounds",
  "name",
  "nflPoolEndWeek",
  "nflPoolStartWeek",
  "nflPoolType",
  "partialLineupAllowed",
  "playerLimitUnit",
  "precision",
  "rosterLimits",
  "rosterSize",
  "rostersPerPlayer",
  "standingsSort",
  "startWeek",
  "starters",
  "survivorPool",
  "survivorPoolEndWeek",
  "survivorPoolStartWeek",
  "taxiSquad",
  "tiebreaker",
  "usesContractYear",
  "usesSalaries",
  "bbidSeasonLimit",
]);

/** Placeholder for the league's own host in committed fixtures and index URLs (a valid host name). */
export const LEAGUE_HOST_PLACEHOLDER = "www00.myfantasyleague.com";

const LEAGUE_ID_IN_URL = [/\/home\/(\d{4,6})\b/g, /[?&]L=(\d{4,6})\b/g, /\/(\d{4,6})_[A-Za-z]/g];

/** A 4-digit number that is really a season (…/2026/home/…) must never become a "league ID". */
const looksLikeYear = (s: string) => /^(19|20)\d\d$/.test(s);

const isNumeric = (s: string) => /^-?\d+(\.\d+)?$/.test(s);

export function registerLeagueIdsInText(r: Redactor, s: string | undefined): void {
  if (!s) return;
  for (const re of LEAGUE_ID_IN_URL) for (const m of s.matchAll(re)) if (m[1] && !looksLikeYear(m[1])) r.register(m[1], "league-id");
}

/** Register the league's wwwNN host so URLs and bodies carry LEAGUE_HOST_PLACEHOLDER instead. */
export function registerLeagueHost(r: Redactor, host: string | undefined): string | undefined {
  const h = host?.toLowerCase();
  if (!h || h === "api.myfantasyleague.com" || h === LEAGUE_HOST_PLACEHOLDER || !/^[a-z0-9-]+\.myfantasyleague\.com$/.test(h)) return undefined;
  return r.register(h, "other-id", LEAGUE_HOST_PLACEHOLDER);
}

function franchiseNumber(id: string | undefined): number | undefined {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

/** Placeholder for an unknown franchise field, by path: "[stadium 3]". */
export const franchiseFieldPlaceholder = (key: string, id: string | undefined) => `[${key} ${franchiseNumber(id) ?? "?"}]`;

/**
 * Numeric values of unknown fields are registered only when they have 7+ digits (phone-number
 * sized). Shorter numbers (a ZIP code, a small account id, a count) would otherwise be replaced
 * wherever the same digits appear — MFL player IDs are 4–5 digit strings, so a ZIP such as 10001
 * would hit a player — and would become leak-check needles that collide the same way.
 * redactFranchiseFields() / redactUnknownLeagueFields() replace them by path instead.
 */
function registerNumeric(value: string): boolean {
  return value.replace(/\D/g, "").length >= 7;
}

/** Register identities from TYPE=league. Returns the franchise IDs seen. */
export function registerLeagueIdentities(r: Redactor, leagueJson: unknown): string[] {
  const league = at(leagueJson, "league");
  if (!isRecord(league)) return [];
  r.register(text(league.id), "league-id");
  r.register(text(league.name), "league-name", "League 1");
  for (const h of asArray(at(league, "history.league") as unknown[])) registerLeagueIdsInText(r, text(at(h, "url")));
  registerLeagueIdsInText(r, text(league.baseURL));

  const ids: string[] = [];
  const franchises = asArray(at(league, "franchises.franchise") as unknown[]).filter(isRecord);
  // Stable order (MFL shuffles keys and arrays): franchise id, then key name.
  franchises.sort((a, b) => (text(a.id) ?? "").localeCompare(text(b.id) ?? ""));
  for (const f of franchises) {
    const id = text(f.id);
    if (id) ids.push(id);
    const tag = franchiseNumber(id) ?? "?";
    for (const key of Object.keys(f).sort()) {
      const value = text(f[key]);
      if (!value || SAFE_FRANCHISE_KEYS.has(key)) continue;
      switch (key) {
        case "name":
          r.register(value, "team-name", `Team ${tag}`);
          break;
        case "abbrev":
          r.register(value, "team-abbrev", `T${tag}`);
          break;
        case "owner_name":
          r.register(value, "owner-name", `Owner ${tag}`);
          for (const part of value.split(/\s*[,&/]\s*|\s+and\s+/i)) if (part && part !== value) r.register(part, "owner-name");
          break;
        case "email":
          for (const e of value.split(/[,;\s]+/).filter(Boolean)) r.register(e, "email");
          break;
        case "icon":
        case "logo":
          r.register(value, "avatar");
          break;
        case "username":
        case "twitterUsername":
          r.register(value, "username");
          break;
        default:
          // stadium, sounds, phone numbers, notes … anything else a commissioner or owner typed in.
          if (isNumeric(value) && !registerNumeric(value)) break; // redacted by path instead
          r.register(value, "free-text", franchiseFieldPlaceholder(key, id));
      }
    }
  }
  for (const group of ["divisions.division", "conferences.conference"]) {
    const items = asArray(at(league, group) as unknown[]).filter(isRecord);
    items.sort((a, b) => (text(a.id) ?? "").localeCompare(text(b.id) ?? ""));
    items.forEach((d, i) => r.register(text(d.name), "free-text", `${group.startsWith("div") ? "Division" : "Conference"} ${i + 1}`));
  }
  return ids;
}

/**
 * Copy of a TYPE=league body where every franchise field outside SAFE_FRANCHISE_KEYS and
 * IDENTITY_FRANCHISE_KEYS is replaced by path ("[zip 3]"), whatever its value. Returns the keys hit.
 */
export function redactFranchiseFields(leagueJson: unknown): { json: unknown; keys: string[] } {
  const keys = new Set<string>();
  const copy = structuredClone(leagueJson);
  for (const f of asArray(at(copy, "league.franchises.franchise") as unknown[])) {
    if (!isRecord(f)) continue;
    const id = text(f.id);
    for (const key of Object.keys(f)) {
      if (SAFE_FRANCHISE_KEYS.has(key) || IDENTITY_FRANCHISE_KEYS.has(key)) continue;
      if (f[key] === "" || f[key] === null || f[key] === undefined) continue;
      f[key] = franchiseFieldPlaceholder(key, id);
      keys.add(key);
    }
  }
  return { json: copy, keys: [...keys].sort() };
}

/**
 * For logged-in (owner/commissioner) responses: replace every league-level field not in
 * KNOWN_LEAGUE_KEYS by path, registering non-numeric text first so it is scrubbed elsewhere too.
 * Returns the keys hit (names only; safe to print).
 */
export function redactUnknownLeagueFields(r: Redactor, leagueJson: unknown): { json: unknown; keys: string[] } {
  const keys: string[] = [];
  const copy = structuredClone(leagueJson);
  const league = at(copy, "league");
  if (!isRecord(league)) return { json: copy, keys };
  const scrub = (v: unknown, key: string): unknown => {
    if (Array.isArray(v)) return v.map((x) => scrub(x, key));
    if (isRecord(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrub(x, key)]));
    const s = text(v);
    if (s === undefined || s === "") return v;
    if (!isNumeric(s) || registerNumeric(s)) r.register(s, "free-text", `[league ${key}]`);
    return `[league ${key}]`;
  };
  for (const key of Object.keys(league).sort()) {
    if (KNOWN_LEAGUE_KEYS.has(key)) continue;
    const before = JSON.stringify(league[key]);
    league[key] = scrub(league[key], key);
    if (JSON.stringify(league[key]) !== before) keys.push(key);
  }
  return { json: copy, keys };
}

/**
 * Keys whose values are commissioner/owner free text wherever they appear. Not "title": standings
 * column titles ("Overall Winning Percentage") are MFL's own text; pass it per response instead
 * (e.g. the owners-only calendar).
 */
export const FREE_TEXT_KEYS = new Set(["comments", "inExchangeFor", "bracketWinnerTitle", "message", "note", "notes", "contractInfo", "description"]);

/**
 * Register free text and league-ID-bearing URLs from any league response. `extraKeys` adds
 * response-specific fields (e.g. playoff bracket "name").
 */
export function registerFreeText(r: Redactor, json: unknown, extraKeys: string[] = []): number {
  const keys = new Set([...FREE_TEXT_KEYS, ...extraKeys]);
  let n = 0;
  const visit = (v: unknown, key: string | undefined) => {
    if (typeof v === "string") {
      if (key && keys.has(key) && v.trim().length >= 3) {
        r.register(v, "free-text");
        n++;
      }
      if (/myfantasyleague\.com|[?&]L=/i.test(v)) registerLeagueIdsInText(r, v);
      return;
    }
    if (isRecord(v) && "$t" in v && Object.keys(v).length === 1) return visit(v.$t, key);
    if (Array.isArray(v)) v.forEach((x) => visit(x, key));
    else if (isRecord(v)) for (const k of Object.keys(v).sort()) visit(v[k], k);
  };
  visit(json, undefined);
  return n;
}
