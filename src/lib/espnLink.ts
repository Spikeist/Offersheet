/**
 * Reads what a user pastes into the ESPN field on the Connect page (pure, client-safe):
 *   - a league link:   https://fantasy.espn.com/football/league?leagueId=123456&seasonId=2026
 *   - a team link:     https://fantasy.espn.com/football/team?leagueId=123456&teamId=3&seasonId=2026
 *   - any other page:  .../football/league/standings?leagueId=123456, .../scoreboard?..., no scheme, http
 *   - an API URL:      https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leagues/123456
 *   - a bare ID:       123456 (also "League ID: 123456", "123456." or "(123456)")
 *   - shared text:     "Join my league https://fantasy.espn.com/…?leagueId=123456 (my league)", "our league id is 123456"
 * A team link names the team whose page it is (usually the user's own), so its teamId is a hint for
 * "my team" that the user confirms on the Import Report. Messages never echo the input back.
 */

export type EspnLinkResult =
  | { ok: true; leagueId: string; season?: number; teamId?: string }
  | { ok: false; reason: "empty" | "other-platform" | "not-espn" | "other-sport" | "no-league-id"; message: string };

type EspnLinkError = Extract<EspnLinkResult, { ok: false }>;

const MAX_ID_DIGITS = 12;
const BARE_ID = new RegExp(`^(?:league\\s*id\\s*[:#]?\\s*)?(\\d{1,${MAX_ID_DIGITS}})$`, "i");
/** "League ID: 123456", "league id is 123456" or "leagueId=123456" anywhere in pasted text. */
const LEAGUE_ID_IN_TEXT = new RegExp(`\\bleague\\s*id\\s*(?:is\\s+|[:#=]\\s*)?(\\d{1,${MAX_ID_DIGITS}})(?!\\d)`, "i");
/** Link-shaped pieces of pasted text: anything with a scheme, or a dotted host followed by a path or query. */
const LINK_IN_TEXT = /https?:\/\/[^\s<>"'`]+|(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?[/?#][^\s<>"'`]*/gi;
/** Quotes, brackets and sentence punctuation around a pasted value: "(123456)." → "123456". */
const LEADING_WRAP = /^[\s"'`“”‘’(<[{]+/;
const TRAILING_WRAP = /[\s"'`“”‘’)>\]}.,;:!?]+$/;
const OTHER_SPORTS = /^\/(basketball|baseball|hockey|wbasketball|womens-basketball)(\/|$)/i;
const API_PATH = /\/games\/(\w+)\/seasons\/(\d{4})\/segments\/\d+\/leagues\/(\d+)/i;

const OTHER_PLATFORMS: Array<{ host: RegExp; name: string; hint: string }> = [
  { host: /(^|\.)sleeper\.(app|com)$/i, name: "Sleeper", hint: "Pick Sleeper above instead." },
  { host: /(^|\.)yahoo\.com$/i, name: "Yahoo", hint: "Yahoo support is coming soon." },
  { host: /(^|\.)fleaflicker\.com$/i, name: "Fleaflicker", hint: "Fleaflicker support is coming later." },
  { host: /(^|\.)myfantasyleague\.com$/i, name: "MyFantasyLeague", hint: "MyFantasyLeague support is coming later." },
  { host: /(^|\.)fantrax\.com$/i, name: "Fantrax", hint: "Fantrax support is coming later." },
  { host: /(^|\.)(nfl\.com|cbssports\.com)$/i, name: "that site", hint: "Manual entry for other sites is coming later." },
];

const NO_LEAGUE_ID =
  "We couldn't find a league ID in that link. Open your league on fantasy.espn.com and copy the address from the address bar (it contains leagueId=…), or type just the number.";

const noLeagueId = (): EspnLinkError => ({ ok: false, reason: "no-league-id", message: NO_LEAGUE_ID });

function stripWrapping(text: string): string {
  return text.replace(LEADING_WRAP, "").replace(TRAILING_WRAP, "");
}

function toUrl(text: string): URL | undefined {
  const candidates = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? [text] : [`https://${text}`];
  for (const c of candidates) {
    try {
      const url = new URL(c);
      if (url.hostname.includes(".")) return url;
    } catch {
      // not a URL
    }
  }
  return undefined;
}

/** Case-insensitive query parameter lookup (ESPN links use leagueId, some shares leagueid). */
function param(url: URL, name: string): string | undefined {
  const want = name.toLowerCase();
  for (const [k, v] of url.searchParams) if (k.toLowerCase() === want) return v.trim();
  // Some single-page links carry the query after the hash: ...#/league?leagueId=...
  const hashQuery = url.hash.includes("?") ? url.hash.slice(url.hash.indexOf("?") + 1) : "";
  for (const [k, v] of new URLSearchParams(hashQuery)) if (k.toLowerCase() === want) return v.trim();
  return undefined;
}

function seasonFrom(text: string | undefined): number | undefined {
  if (!text || !/^\d{4}$/.test(text)) return undefined;
  const n = Number(text);
  return n >= 2000 && n <= 2100 ? n : undefined;
}

function idFrom(text: string | undefined, maxDigits = MAX_ID_DIGITS): string | undefined {
  if (!text) return undefined;
  const m = new RegExp(`^(\\d{1,${maxDigits}})$`).exec(text);
  return m?.[1];
}

/** One link (no surrounding text). */
function parseLink(text: string): EspnLinkResult {
  const url = toUrl(text);
  if (!url) return noLeagueId();

  const host = url.hostname.toLowerCase();
  if (!/(^|\.)espn\.(com|go\.com)$/.test(host)) {
    const other = OTHER_PLATFORMS.find((p) => p.host.test(host));
    if (other) return { ok: false, reason: "other-platform", message: `That looks like a ${other.name} link, not ESPN. ${other.hint}` };
    return { ok: false, reason: "not-espn", message: "That doesn't look like an ESPN fantasy link. It should start with https://fantasy.espn.com/football/…" };
  }

  const api = API_PATH.exec(url.pathname);
  if (api) {
    if (api[1]?.toLowerCase() !== "ffl") return { ok: false, reason: "other-sport", message: "That's not an ESPN fantasy football league. Offer Sheet works with football leagues only." };
    const leagueId = idFrom(api[3]);
    if (!leagueId) return noLeagueId();
    const season = seasonFrom(api[2]);
    return { ok: true, leagueId, ...(season ? { season } : {}) };
  }

  // fantasy.espn.com/basketball/..., or www.espn.com/fantasy/basketball/...
  const sportPath = url.pathname.replace(/^\/fantasy(?=\/)/i, "");
  if (OTHER_SPORTS.test(sportPath)) {
    return { ok: false, reason: "other-sport", message: "That's an ESPN league for a different sport. Offer Sheet works with fantasy football leagues only." };
  }

  const leagueId = idFrom(param(url, "leagueId"));
  if (!leagueId) return noLeagueId();
  const season = seasonFrom(param(url, "seasonId"));
  const teamId = idFrom(param(url, "teamId"), 3);
  return { ok: true, leagueId, ...(season ? { season } : {}), ...(teamId ? { teamId } : {}) };
}

/** "League ID: 123456" or "leagueId=123456" somewhere in the text. */
function leagueIdInText(text: string): EspnLinkResult | undefined {
  const m = LEAGUE_ID_IN_TEXT.exec(text);
  return m?.[1] ? { ok: true, leagueId: m[1] } : undefined;
}

export function parseEspnLeagueInput(input: string): EspnLinkResult {
  const text = stripWrapping(input.trim());
  if (!text) return { ok: false, reason: "empty", message: "Paste your ESPN league link or type the league ID." };

  const bare = BARE_ID.exec(text);
  if (bare?.[1]) return { ok: true, leagueId: bare[1] };

  if (!/\s/.test(text)) {
    const one = parseLink(text);
    // Another site's or sport's ID is never read as an ESPN league ID.
    if (one.ok || one.reason !== "no-league-id") return one;
    return leagueIdInText(text) ?? one;
  }

  // Text around a link (a phone's share sheet, a chat message): read the first link that works.
  const links = [...text.matchAll(LINK_IN_TEXT)].map((m) => parseLink(stripWrapping(m[0])));
  const hit = links.find((r) => r.ok);
  if (hit) return hit;
  const blocking = links.find((r) => !r.ok && r.reason !== "no-league-id");
  if (blocking) return blocking;
  return leagueIdInText(text) ?? links[0] ?? noLeagueId();
}
