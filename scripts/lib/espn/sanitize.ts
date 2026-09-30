/**
 * ESPN-specific sanitizing (CLAUDE.md §0.5–0.6). Leaguemates' identities live in:
 *   settings.name, teams[].name/abbrev/location/nickname/logo, teams[].owners[]/primaryOwner (SWIDs),
 *   members[].id (SWID)/displayName/firstName/lastName, division names, and SWIDs sprinkled through
 *   transactions, draft picks, pending transactions and status.*Info.source.
 * Player objects are public data: protect them so e.g. an owner called "Zorblax" never turns a
 * player "Zorblax Quintavious" into "Name 3 Quintavious".
 *
 * Purely numeric names (a team abbreviation "123") are NOT registered with the Redactor: its text
 * scrubber would then rewrite that number wherever it appears in report text (counts, stat ids,
 * "100.0%"). They are replaced by field path instead (maskIdentityFields), which every fixture gets.
 */
import { SWID_RE, type JsonPath, type Redactor } from "../sanitize";

/** Player objects (roster entries, free-agent lists, player cards) keep their names. */
export function isPlayerPath(p: JsonPath): boolean {
  return p.includes("player");
}

/** For public, non-league data (pro schedules, player universe): only ID-like values are ever replaced. */
export const protectAll = (): boolean => true;

const HEX32 = /^[0-9A-Fa-f]{32}$/;

interface LooseTeam {
  id?: unknown;
  name?: unknown;
  location?: unknown;
  nickname?: unknown;
  abbrev?: unknown;
  logo?: unknown;
  owners?: unknown;
  primaryOwner?: unknown;
}
interface LooseMember {
  id?: unknown;
  displayName?: unknown;
  firstName?: unknown;
  lastName?: unknown;
}

function asObj(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

const normSwid = (x: string) => x.replace(/^\{|\}$/g, "").toUpperCase();

/** A purely numeric name ("123"): replaced by field path only, never registered (see the file comment). */
export const isNumericName = (v: unknown): v is string => typeof v === "string" && /^\d+$/.test(v.trim());

function looseTeams(root: Record<string, unknown>): LooseTeam[] {
  return (Array.isArray(root.teams) ? root.teams : [])
    .map((t) => asObj(t) as LooseTeam | undefined)
    .filter((t): t is LooseTeam => !!t)
    .sort((a, b) => Number(a.id) - Number(b.id));
}

/**
 * Owner label per member id: the id of the team the member owns ("3"), "3b"/"3c" for co-owners,
 * "x1", "x2"… for members without a team. Placeholders use it: "Owner 3", "First 3", "Last 3".
 */
export function memberLabels(raw: unknown): Map<string, string> {
  const out = new Map<string, string>();
  const root = asObj(raw);
  if (!root) return out;
  const ownerTeam = new Map<string, number>();
  for (const t of looseTeams(root)) {
    const owners = Array.isArray(t.owners) ? t.owners : [];
    for (const o of [...owners, t.primaryOwner]) if (typeof o === "string" && !ownerTeam.has(o)) ownerTeam.set(o, Number(t.id));
  }
  const usedLabels = new Map<string, number>();
  let loose = 0;
  for (const m of Array.isArray(root.members) ? root.members : []) {
    const id = (asObj(m) as LooseMember | undefined)?.id;
    if (typeof id !== "string" || out.has(id)) continue;
    const teamId = ownerTeam.get(id);
    let label = teamId !== undefined ? String(teamId) : `x${++loose}`;
    const seen = usedLabels.get(label) ?? 0;
    usedLabels.set(label, seen + 1);
    if (seen) label += String.fromCharCode(97 + seen); // co-owners: 3, 3b, 3c
    out.set(id, label);
  }
  return out;
}

/**
 * Register every leaguemate identity in one ESPN league response. `mySwid` (Parker's) is registered
 * first so its placeholder is always {00000000-0000-4000-8000-000000000001}. Owner placeholders
 * follow the team they own ("Owner 3" owns Team 3; co-owners "Owner 3b").
 *
 * `keepOwnWords`: the user's OWN name fields equal to one of these words (e.g. "Parker", which every
 * report uses) are not registered, so report text stays readable; fixtures still mask them via
 * maskOwnMember(). Leaguemates' names are always registered, except purely numeric ones, which
 * maskIdentityFields() replaces by field path. Returns the owner label of the user's member record
 * (e.g. "3"), if found.
 */
export function registerLeagueIdentities(r: Redactor, raw: unknown, opts: { mySwid?: string; leagueName?: string; keepOwnWords?: string[] } = {}): { ownLabel?: string; numericNames: number } {
  if (opts.mySwid) r.register(opts.mySwid, "swid");
  const root = asObj(raw);
  if (!root) return { numericNames: 0 };
  let ownLabel: string | undefined;
  let numericNames = 0;
  const reg = (v: unknown, cat: Parameters<Redactor["register"]>[1], ph?: string) => {
    if (isNumericName(v)) numericNames++;
    else r.register(v, cat, ph);
  };
  const keep = new Set((opts.keepOwnWords ?? []).map((w) => w.toLowerCase()));
  const settings = asObj(root.settings);
  if (settings && typeof settings.name === "string") reg(settings.name, "league-name", opts.leagueName);

  for (const t of looseTeams(root)) {
    const id = Number(t.id);
    reg(t.name, "team-name", `Team ${id}`);
    reg(t.location, "team-name", `Team ${id} Location`);
    reg(t.nickname, "team-name", `Team ${id} Nickname`);
    reg(t.abbrev, "team-abbrev", `T${id}`);
    r.register(t.logo, "avatar", `https://example.invalid/logo/${id}.png`);
    const owners = Array.isArray(t.owners) ? t.owners : [];
    for (const o of [...owners, t.primaryOwner]) if (typeof o === "string") r.register(o, "swid");
  }

  const labels = memberLabels(root);
  for (const m of (Array.isArray(root.members) ? root.members : []).map((x) => asObj(x) as LooseMember | undefined)) {
    if (!m || typeof m.id !== "string") continue;
    r.register(m.id, "swid");
    const label = labels.get(m.id) ?? "x";
    const isMe = !!opts.mySwid && normSwid(m.id) === normSwid(opts.mySwid);
    if (isMe) ownLabel = label;
    const regName = (v: unknown, cat: "owner-name" | "real-name", ph: string) => {
      if (isMe && typeof v === "string" && keep.has(v.toLowerCase())) return;
      reg(v, cat, ph);
    };
    regName(m.displayName, "owner-name", `Owner ${label}`);
    regName(m.firstName, "real-name", `First ${label}`);
    regName(m.lastName, "real-name", `Last ${label}`);
  }

  const divisions = asObj(settings?.scheduleSettings)?.divisions;
  if (Array.isArray(divisions))
    for (const d of divisions) {
      const div = asObj(d);
      if (div && typeof div.name === "string") reg(div.name, "free-text", `Division ${String(div.id)}`);
    }

  const status = asObj(root.status);
  for (const k of ["creationInfo", "lastUpdateInfo"]) {
    const src = asObj(status?.[k])?.source;
    if (typeof src === "string") r.register(src, SWID_RE.test(src) ? "swid" : "other-id");
  }
  sweepIds(r, raw);
  return { ownLabel, numericNames };
}

/**
 * Replace the league-level identity fields by path, whatever their value: teams[].name/location/
 * nickname/abbrev/logo, members[].displayName/firstName/lastName, division names, and settings.name
 * when it is purely numeric (other league names go through the Redactor). Placeholders match
 * registerLeagueIdentities(), so registered values end up identical; numeric names, which are never
 * registered, are covered only here. Returns a copy; bodies without these fields come back unchanged.
 */
export function maskIdentityFields<T>(raw: T): T {
  const root = asObj(raw);
  if (!root) return raw;
  const out: Record<string, unknown> = { ...root };
  if (Array.isArray(root.teams))
    out.teams = root.teams.map((x) => {
      const t = asObj(x);
      if (!t || t.id === undefined) return x;
      const id = String(t.id);
      const c: Record<string, unknown> = { ...t };
      const set = (k: string, v: string) => {
        if (typeof c[k] === "string") c[k] = v;
      };
      set("name", `Team ${id}`);
      set("location", `Team ${id} Location`);
      set("nickname", `Team ${id} Nickname`);
      set("abbrev", `T${id}`);
      set("logo", `https://example.invalid/logo/${id}.png`);
      return c;
    });
  if (Array.isArray(root.members)) {
    const labels = memberLabels(root);
    out.members = root.members.map((x) => {
      const m = asObj(x);
      const label = typeof m?.id === "string" ? labels.get(m.id) : undefined;
      if (!m || !label) return x;
      const c: Record<string, unknown> = { ...m };
      if (typeof c.displayName === "string") c.displayName = `Owner ${label}`;
      if (typeof c.firstName === "string") c.firstName = `First ${label}`;
      if (typeof c.lastName === "string") c.lastName = `Last ${label}`;
      return c;
    });
  }
  const settings = asObj(root.settings);
  if (settings) {
    const s: Record<string, unknown> = { ...settings };
    if (isNumericName(s.name)) s.name = "League (numeric name)";
    const sched = asObj(settings.scheduleSettings);
    if (sched && Array.isArray(sched.divisions))
      s.scheduleSettings = {
        ...sched,
        divisions: sched.divisions.map((x) => {
          const d = asObj(x);
          return d && typeof d.name === "string" ? { ...d, name: `Division ${String(d.id)}` } : x;
        }),
      };
    out.settings = s;
  }
  return out as T;
}

/**
 * Replace the user's own member names in a fixture body (any object whose `id` is the user's SWID
 * and that has name fields). Needed because keepOwnWords leaves e.g. "Parker" unregistered.
 */
export function maskOwnMember<T>(raw: T, mySwid: string | undefined, label: string | undefined): T {
  if (!mySwid || !label) return raw;
  const me = normSwid(mySwid);
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(o)) out[k] = walk(x);
      if (typeof o.id === "string" && normSwid(o.id) === me) {
        if ("firstName" in o) out.firstName = `First ${label}`;
        if ("lastName" in o) out.lastName = `Last ${label}`;
        if ("displayName" in o) out.displayName = `Owner ${label}`;
      }
      return out;
    }
    return v;
  };
  return walk(raw) as T;
}

/** Our own SWID placeholders ({00000000-0000-4000-8000-NNNNNNNNNNNN}), in any case. */
export const SWID_PLACEHOLDER_RE = /^\{00000000-0000-4000-8000-[0-9A-Fa-f]{12}\}$/;

/**
 * Any {GUID} anywhere is a SWID/member id; bare 32-hex strings are account ids too. Placeholders
 * are skipped: sweeping an already-sanitized value would register a placeholder as an identity.
 */
export function sweepIds(r: Redactor, raw: unknown): void {
  r.sweep(raw, (v) => (SWID_PLACEHOLDER_RE.test(v) ? null : SWID_RE.test(v) ? "swid" : HEX32.test(v) ? "other-id" : null));
}

/**
 * Replace one public identifier (e.g. the public test league id, which CLAUDE.md itself contains
 * and which therefore must not go into the redaction map) in numbers and inside strings.
 */
export function replaceIdDeep<T>(raw: T, id: string, placeholder: number): T {
  const re = new RegExp(`(?<!\\d)${id}(?!\\d)`, "g");
  const walk = (v: unknown): unknown => {
    if (typeof v === "number") return String(v) === id ? placeholder : v;
    if (typeof v === "string") return v.replace(re, String(placeholder));
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k.replace(re, String(placeholder)), walk(x)]));
    return v;
  };
  return walk(raw) as T;
}

const PLAYER_BULK_KEYS = ["seasonOutlook", "outlooks", "rankings", "draftRanksByRankType"];
/** Objects whose `platform` says which app a member used (espn-fantasy-app-ios, espn-fantasy-web…). */
const ACTION_INFO_KEYS = new Set(["creationInfo", "lastUpdateInfo"]);

/**
 * Drop bulky or personal fields the adapters don't need before saving a sanitized fixture:
 * members[].notificationSettings (per-member settings with their own ids), analyst text / rankings
 * on player objects, and personal usage data: creationInfo/lastUpdateInfo.platform (the app a
 * member used) and clientAddress anywhere. Returns a trimmed deep copy; the raw capture keeps everything.
 */
export function trimForFixture<T>(raw: T): T {
  const walk = (v: unknown, key: string | undefined): unknown => {
    if (Array.isArray(v)) return v.map((x) => walk(x, undefined));
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) {
        if (k === "notificationSettings" || k === "clientAddress") continue;
        if (key !== undefined && ACTION_INFO_KEYS.has(key) && k === "platform") continue;
        if (key === "player" && PLAYER_BULK_KEYS.includes(k)) continue;
        out[k] = walk(x, k);
      }
      return out;
    }
    return v;
  };
  return walk(raw, undefined) as T;
}

export const TRIM_NOTE = "trimmed: members[].notificationSettings; player.seasonOutlook/outlooks/rankings/draftRanksByRankType; creationInfo/lastUpdateInfo.platform and clientAddress (which app a member used)";
