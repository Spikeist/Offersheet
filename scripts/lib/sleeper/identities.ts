/**
 * Leaguemates' identities in Sleeper responses (CLAUDE.md §0.6) and how to protect player data.
 *
 * Placeholders follow the roster: the owner of roster N is user "2000…0N", "Owner N" and "Team N".
 * Co-owners, users without a roster and other user IDs (transaction creators, draft pickers) get
 * numbers after the last roster. A placeholder is never reused for a different raw value.
 *
 * Free text (league/user/roster/transaction metadata, draft names, chat previews) is registered as
 * "free-text", except values that are clearly not identifying: numbers, on/off-style flags, W/L
 * record strings, notification settings, lowercase enum tokens under unknown keys, and strings that
 * also appear as ordinary data (positions, statuses, player names). Registering those would corrupt
 * unrelated fields, because the sanitizer replaces exact matches everywhere.
 */
import { defaultPlaceholder, type Category, type JsonPath, type Redactor } from "../sanitize";
import type { SleeperDraft, SleeperDraftPick, SleeperLeague, SleeperRoster, SleeperTransaction, SleeperUser } from "./types";

/** 15–20 digit IDs (users, leagues, drafts, transactions, messages): Sleeper's snowflake IDs. */
export const LONG_ID = /^\d{15,20}$/;

const ENUM_WORDS = [
  "on", "off", "yes", "no", "true", "false", "null", "none", "default", "enabled", "disabled",
  "complete", "failed", "pending", "trade", "waiver", "free_agent", "commissioner",
  "snake", "linear", "auction", "offline", "regular", "pre", "post", "in_season", "pre_draft", "drafting",
  "nfl", "ppr", "half_ppr", "std", "standard", "dynasty", "keeper", "redraft", "2qb", "idp", "superflex",
];

/** Metadata keys that hold settings/flags, never identities (notification toggles, mascot item types…). */
const FLAG_KEY = /(_pn$|_pn_|^allow_|^show_|_update$|^transaction_|^archived$|^restrict_|^mascot_item_type_id|^mascot_message_emotion|^auto_continue$|^matchup_challenges$|^keeper_deadline$|_deadline$)/;
/** Metadata keys known to hold user-written text. */
const TEXT_KEY = /(name|nick|message|text|desc|bio|note|title|motto|division_\d+$|trophy)/i;
/** A lowercase token such as "cowboy_hat" (an enum value, not text a person typed). */
const ENUM_TOKEN = /^[a-z0-9_\-.]+$/;

/** Keys whose values (or whose subtree) are player IDs or player objects: public data, never names. */
const PLAYER_KEYS = new Set(["players", "starters", "reserve", "taxi", "keepers", "players_points", "starters_points", "adds", "drops", "player_id", "player", "player_map"]);

/** Protect player IDs/objects inside league responses (rosters, matchups, transactions…). */
export function protectLeagueData(p: JsonPath): boolean {
  return p.some((k) => typeof k === "string" && PLAYER_KEYS.has(k));
}

/** Draft picks: `metadata` is the drafted player's info (first/last name, team). */
export function protectDraftPicks(p: JsonPath): boolean {
  return (p.length >= 2 && p[1] === "metadata") || protectLeagueData(p);
}

/** Public data (players DB, projections, stats): only ID-like values could ever be replaced. */
export function protectAll(): boolean {
  return true;
}

/**
 * Values that are data, not identity: never registered as names or free text.
 *
 * Names (display names, team/league names, usernames) are identities whatever their length: an
 * initials-style "JD" or a short number is registered too, and the Redactor replaces short values
 * on exact match only. A name is skipped only when it equals ordinary data (a slot name such as
 * "QB", an enum word, a player's own name). Free text keeps the length and number shortcuts.
 */
export function isNonIdentifying(value: string, structural: ReadonlySet<string>, isName = false): boolean {
  const v = value.trim();
  if (!v) return true;
  const lower = v.toLowerCase();
  if (isName) return ENUM_WORDS.includes(lower) || structural.has(lower);
  if (v.length < 3) return true;
  if (/^-?\d+(\.\d+)?$/.test(v)) return !LONG_ID.test(v); // numbers (long ones are IDs)
  if (/^[WLT]+$/.test(v) || /^\d+[WLT]$/.test(v)) return true; // record "WLLW", streak "2W"
  return ENUM_WORDS.includes(lower) || structural.has(lower);
}

export class SleeperIdentities {
  private readonly userNum = new Map<string, number>();
  /**
   * Numbers already used per namespace ("user", "league"). Every explicitly numbered placeholder
   * (user 2000…0N / Owner N / Team N, league 1000…0N / League N) is allocated here, never from the
   * Redactor's own per-category sequence, so two raw values can't end up with the same placeholder.
   */
  private readonly used = new Map<string, Set<number>>();
  /** Names/free text not registered because they equal ordinary data (reported as a count only). */
  skipped = 0;

  constructor(
    readonly r: Redactor,
    /** Lower-cased strings that appear as ordinary data (positions, statuses, player names…). */
    readonly structural: ReadonlySet<string>,
    /** Roster count: users without a roster are numbered from numTeams + 1. */
    private readonly numTeams: number,
    /** Offset for every number (discovery uses 900 so its placeholders never look like the league's). */
    private readonly base = 0,
  ) {}

  /** Next free number in a namespace; `preferred` is used when still free. */
  allocate(ns: string, preferred?: number, floor = 1): number {
    let set = this.used.get(ns);
    if (!set) {
      set = new Set<number>();
      this.used.set(ns, set);
    }
    let n = preferred !== undefined && !set.has(preferred) ? preferred : this.base + floor;
    while (set.has(n)) n++;
    set.add(n);
    return n;
  }

  /** Placeholder number for a user: their roster ID if they own one, else the next number after the rosters. */
  numberFor(userId: string, rosterId?: number): number {
    const known = this.userNum.get(userId);
    if (known !== undefined) return known;
    const n = this.allocate("user", rosterId === undefined ? undefined : this.base + rosterId, this.numTeams + 1);
    this.userNum.set(userId, n);
    return n;
  }

  user(userId: string | null | undefined, rosterId?: number): string | undefined {
    if (!userId) return undefined;
    const existing = this.r.placeholderOf(userId);
    if (existing) return existing;
    const n = this.numberFor(userId, rosterId);
    return this.r.register(userId, "user-id", LONG_ID.test(userId) ? defaultPlaceholder("user-id", userId, n) : `user-${n}`);
  }

  /**
   * Register a name/free-text value unless it's ordinary data. `knownText` = the key is known to
   * hold typed text; values under unknown keys that look like enum tokens are left alone.
   */
  text(value: unknown, category: Category, placeholder?: string, knownText = true): void {
    if (typeof value !== "string" || !value.trim()) return;
    const isName = category !== "free-text";
    if (isNonIdentifying(value, this.structural, isName) || (!knownText && ENUM_TOKEN.test(value.trim()))) {
      if (value.trim().length >= 3 && !/^-?\d+(\.\d+)?$/.test(value.trim())) this.skipped++;
      return;
    }
    // Free text shorter than 20 chars is replaced only on exact match, so a common word can't
    // corrupt longer strings elsewhere; longer text is distinctive enough to replace inside strings.
    this.r.register(value, category, placeholder, category === "free-text" ? { token: value.length >= 20 } : {});
  }

  id(value: unknown, category: Category): void {
    if (typeof value === "string" || typeof value === "number") this.r.register(String(value), category);
  }

  /** Register a league ID with the next league number ("League n" ↔ 1000…0n). Returns that number. */
  leagueId(id: string | null | undefined, preferred?: number): number | undefined {
    if (!id || this.r.placeholderOf(id)) return undefined;
    const n = this.allocate("league", preferred);
    this.r.register(id, "league-id", LONG_ID.test(id) ? defaultPlaceholder("league-id", id, n) : `league-${n}`);
    return n;
  }

  /**
   * League object (also the entries of /user/{id}/leagues). `n` asks for a placeholder number
   * ("League n", ID 1000…0n); it is honoured when still free.
   */
  league(l: SleeperLeague, n?: number): void {
    const rec = l as Record<string, unknown>;
    const num = this.leagueId(l.league_id, n);
    this.leagueId(l.previous_league_id);
    if (l.draft_id) this.r.register(l.draft_id, "draft-id");
    if (num !== undefined) this.text(l.name, "league-name", `League ${num}`);
    else this.leagueName(l.name);
    this.id(rec.avatar, "avatar");
    for (const k of ["bracket_id", "loser_bracket_id", "bracket_overrides_id", "loser_bracket_overrides_id", "group_id", "company_id", "last_read_id", "last_pinned_message_id", "last_message_id"]) {
      if (rec[k] !== null && rec[k] !== undefined) this.id(rec[k], "other-id");
    }
  }

  /** A league name seen without its league (e.g. a draft's metadata.name): its own league number. */
  leagueName(name: unknown): void {
    if (typeof name !== "string" || !name.trim() || this.r.placeholderOf(name)) return;
    if (isNonIdentifying(name, this.structural, true)) {
      this.text(name, "league-name"); // counted as skipped
      return;
    }
    this.text(name, "league-name", `League ${this.allocate("league")}`);
  }

  /**
   * The league's chat preview (last author, message text) and metadata. Call after members() so the
   * last author, usually a member, keeps their roster-based number.
   */
  leagueExtras(l: SleeperLeague): void {
    const rec = l as Record<string, unknown>;
    const author = typeof rec.last_author_id === "string" ? rec.last_author_id : null;
    if (author) this.user(author);
    // Sleeper's own bot often posts last; its display name is a product word, not a leaguemate.
    if (rec.last_author_is_bot !== true) this.text(rec.last_author_display_name, "owner-name", `Owner ${author ? this.numberFor(author) : this.allocate("user", undefined, this.numTeams + 1)}`);
    this.id(rec.last_author_avatar, "avatar");
    this.freeTextTree(rec.last_message_text_map);
    this.freeTextTree(rec.last_message_attachment);
    this.metadata(l.metadata);
  }

  /** users[] joined to rosters[]: roster owners get the roster's number. */
  members(users: SleeperUser[], rosters: SleeperRoster[]): void {
    for (const ro of [...rosters].sort((a, b) => a.roster_id - b.roster_id)) this.user(ro.owner_id, ro.roster_id);
    for (const ro of rosters) for (const co of ro.co_owners ?? []) this.user(co);
    for (const u of users) this.userObject(u);
    for (const ro of rosters) {
      const lid = (ro as Record<string, unknown>).league_id;
      if (typeof lid === "string") this.leagueId(lid);
      this.metadata(ro.metadata);
    }
  }

  /** One user object (league member, or /user/{username}). */
  userObject(u: SleeperUser, rosterId?: number): void {
    this.user(u.user_id, rosterId);
    const n = this.userNum.get(u.user_id) ?? this.numberFor(u.user_id);
    const rec = u as Record<string, unknown>;
    this.text(u.display_name, "owner-name", `Owner ${n}`);
    if (u.username) this.r.register(u.username, "username", `user${n}`);
    this.text(rec.real_name, "real-name");
    this.id(u.avatar, "avatar");
    this.id(rec.email, "email");
    this.id(rec.phone, "other-id");
    this.leagueId(typeof rec.league_id === "string" ? rec.league_id : undefined);
    const md = u.metadata ?? {};
    for (const [k, v] of Object.entries(md)) {
      if (typeof v !== "string") continue;
      if (k === "team_name") this.text(v, "team-name", `Team ${n}`);
      else this.metaValue(k, v);
    }
  }

  transactions(txs: SleeperTransaction[]): void {
    for (const t of txs) {
      this.id(t.transaction_id, "other-id");
      this.user(t.creator ?? undefined);
      this.freeTextTree(t.metadata);
    }
  }

  drafts(drafts: SleeperDraft[]): void {
    for (const d of drafts) {
      this.r.register(d.draft_id, "draft-id");
      this.leagueId(d.league_id);
      for (const c of d.creators ?? []) this.user(c);
      for (const uid of Object.keys(d.draft_order ?? {})) this.user(uid);
      const md = d.metadata ?? {};
      this.leagueName(md.name);
      this.text(md.description, "free-text");
      const rec = d as Record<string, unknown>;
      if (rec.last_message_id) this.id(rec.last_message_id, "other-id");
    }
  }

  draftPicks(picks: SleeperDraftPick[]): void {
    for (const pk of picks) {
      this.user(pk.picked_by || undefined);
      const rec = pk as Record<string, unknown>;
      this.id(rec.draft_id, "draft-id");
    }
  }

  /** Every string in a free-text container (e.g. transaction metadata notes). */
  freeTextTree(v: unknown): void {
    if (typeof v === "string") {
      if (LONG_ID.test(v)) this.id(v, "other-id");
      else this.text(v, "free-text");
    } else if (Array.isArray(v)) v.forEach((x) => this.freeTextTree(x));
    else if (v && typeof v === "object") for (const x of Object.values(v)) this.freeTextTree(x);
  }

  /** League/roster metadata: division names, nicknames, notes… plus avatar URLs and IDs. */
  metadata(md: Record<string, unknown> | null | undefined): void {
    for (const [k, v] of Object.entries(md ?? {})) {
      if (typeof v === "string") this.metaValue(k, v);
      else this.freeTextTree(v);
    }
  }

  private metaValue(key: string, v: string): void {
    if (/avatar|logo|image|url/i.test(key)) this.id(v, "avatar");
    else if (LONG_ID.test(v)) {
      if (/league/i.test(key)) this.leagueId(v);
      else this.id(v, "other-id");
    }
    else if (/_id$/.test(key) && !/^\d{1,3}$/.test(v)) this.id(v, "other-id");
    else if (FLAG_KEY.test(key)) return;
    else if (key.startsWith("p_nick_")) this.text(v, "free-text");
    else this.text(v, "free-text", undefined, TEXT_KEY.test(key));
  }

  /** Catch-all: any snowflake-style ID left anywhere outside player data. */
  sweepLongIds(json: unknown, protect: (p: JsonPath) => boolean = protectLeagueData): void {
    this.r.sweep(json, (value, _key, path) => (LONG_ID.test(value) && !protect(path) ? "other-id" : null));
  }
}

/**
 * Placeholders that stand for more than one raw value (a sanitizer bug: two different leaguemates
 * would look like one person in the fixtures). Returns "category placeholder ×n" only, never values.
 */
export function placeholderCollisions(r: Redactor): string[] {
  const byPlaceholder = new Map<string, Set<string>>();
  for (const e of r.entries()) {
    // SWID spelling variants (case, braces, URL-encoding) share a placeholder on purpose.
    const key = e.category === "swid" ? e.raw.replace(/[{}]/g, "").toLowerCase() : e.raw;
    const set = byPlaceholder.get(`${e.category} ${e.placeholder}`) ?? new Set<string>();
    set.add(key);
    byPlaceholder.set(`${e.category} ${e.placeholder}`, set);
  }
  return [...byPlaceholder].filter(([, raws]) => raws.size > 1).map(([ph, raws]) => `${ph} ×${raws.size}`);
}

/** Lower-cased strings found in ordinary (non-identity) fields: never treated as names. */
export function structuralStrings(sources: {
  league?: SleeperLeague | null;
  rosters?: SleeperRoster[];
  transactions?: SleeperTransaction[];
  drafts?: SleeperDraft[];
  playerNames?: Iterable<string>;
  extra?: Iterable<string>;
}): Set<string> {
  const out = new Set<string>();
  const add = (v: unknown) => {
    if (typeof v === "string" && v.trim()) out.add(v.trim().toLowerCase());
  };
  const l = sources.league;
  if (l) {
    l.roster_positions.forEach(add);
    Object.keys(l.settings).forEach(add);
    Object.keys(l.scoring_settings).forEach(add);
    [l.status, l.season_type, l.sport].forEach(add);
  }
  for (const r of sources.rosters ?? []) [...(r.players ?? []), ...(r.reserve ?? []), ...(r.taxi ?? [])].forEach(add);
  for (const t of sources.transactions ?? []) [t.type, t.status].forEach(add);
  for (const d of sources.drafts ?? []) [d.type, d.status, d.season].forEach(add);
  for (const n of sources.playerNames ?? []) add(n);
  for (const x of sources.extra ?? []) add(x);
  return out;
}

/**
 * Placeholders for values seen only while choosing a league (a separate Redactor that scrubs the
 * console): numbered from 901 so they can never be confused with the chosen league's "1…N".
 */
const DISCOVERY_BASE = 900;
const discoveryIds = new WeakMap<Redactor, SleeperIdentities>();

function discoveryIdentities(r: Redactor): SleeperIdentities {
  let ids = discoveryIds.get(r);
  if (!ids) {
    ids = new SleeperIdentities(r, new Set(), 0, DISCOVERY_BASE);
    discoveryIds.set(r, ids);
  }
  return ids;
}

/**
 * Register the IDs in a list of leagues (e.g. /user/{id}/leagues) seen while choosing. Only IDs:
 * these leagues' names and texts are never printed or saved (the kept ones are registered in full
 * by the main Redactor), and registering strangers' common-word league names would only flood the
 * repo leak check with false "soft" hits.
 */
export function registerLeagueListIdentities(r: Redactor, leagues: SleeperLeague[]): void {
  const ids = discoveryIdentities(r);
  for (const l of leagues) {
    if (!l || typeof l.league_id !== "string") continue;
    ids.leagueId(l.league_id);
    ids.leagueId(l.previous_league_id);
    if (typeof l.draft_id === "string") ids.id(l.draft_id, "draft-id");
    const author = (l as Record<string, unknown>).last_author_id;
    if (typeof author === "string") ids.user(author);
  }
}

/** Register a user's ID seen while choosing (their names are registered by the main Redactor). */
export function registerUserIdentity(r: Redactor, u: SleeperUser): void {
  discoveryIdentities(r).user(u.user_id);
}

/** Register a bare ID seen while choosing a league. */
export function registerDiscoveryId(r: Redactor, value: string, kind: "league" | "user"): void {
  if (r.placeholderOf(value)) return;
  if (kind === "user") discoveryIdentities(r).user(value);
  else discoveryIdentities(r).leagueId(value);
}
