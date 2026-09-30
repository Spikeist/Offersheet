/**
 * The Yahoo probe (CLAUDE.md §2.4) with its file and console I/O injected, so tests can run every
 * branch offline. scripts/probe-yahoo.ts wires it to the real .env.local, .cache and console.
 *
 * What it does, by what .env.local holds:
 *   nothing        → unauthenticated game/nfl (expect 401) and the "after approval" setup steps;
 *   client id+secret, no code/token → writes the authorize URL to a git-ignored file (never printed);
 *   YAHOO_AUTH_CODE → exchanges it once (codes are single-use) and saves YAHOO_REFRESH_TOKEN;
 *   YAHOO_REFRESH_TOKEN → 1-hour access token, then game/nfl for the current game key.
 * It never checks items A–M: the Yahoo league checklist is Phase 5 work (see the decision it records).
 */
import { TTL } from "../cache";
import type { Evidence, ItemId } from "../checklist";
import { ENV_VARS } from "../env";
import type { HttpResult } from "../http";
import type { ProbeContext } from "../probe";
import { secrets } from "../redact";
import { YAHOO_AUTH_GUIDE_URL, htmlToText, parseAuthGuide, type AuthGuideFacts } from "./docs";
import {
  YAHOO_API_BASE,
  YAHOO_AUTH_CODE_VAR,
  YAHOO_REDIRECT_URI,
  YAHOO_REFRESH_TOKEN_VAR,
  YAHOO_SCOPE,
  YAHOO_TOKEN_URL,
  authorizeUrl,
  basicAuthHeader,
  codeGrantBody,
  extractAuthCode,
  extractGame,
  parseTokenResponse,
  refreshGrantBody,
  type TokenResult,
} from "./oauth";

export const GAME_NFL_URL = `${YAHOO_API_BASE}/game/nfl?format=json`;
export const AUTH_URL_FILE_REL = ".cache\\yahoo-oauth\\authorize-url.txt";
const LEAGUE = `${YAHOO_API_BASE}/league/{league_key}`;
const ITEM_IDS: readonly ItemId[] = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M"];
const TITLES: Record<ItemId, string> = {
  A: "League basics",
  B: "Lineup",
  C: "Scoring",
  D: "Teams",
  E: "Rosters",
  F: "Schedule",
  G: "Transactions",
  H: "Free agents",
  I: "Draft picks",
  J: "Projections",
  K: "Completed weeks",
  L: "NFL schedule",
  M: "FantasyCalc match rate",
};

/** Where each item should come from once live calls work (§2.4). Plans, not findings. */
const PLANNED: Record<ItemId, { url?: string; path: string }> = {
  A: { url: `${LEAGUE}/settings?format=json`, path: "planned: settings playoff_start_week, num_playoff_teams, trade_end_date, uses_faab; season from game/nfl" },
  B: { url: `${LEAGUE}/settings?format=json`, path: "planned: settings.roster_positions" },
  C: { url: `${LEAGUE}/settings?format=json`, path: "planned: settings.stat_categories + settings.stat_modifiers" },
  D: { url: `${LEAGUE}/teams?format=json`, path: "planned: teams (names, managers); my team via users;use_login=1/games;game_keys={game_key}/leagues" },
  E: { url: `${LEAGUE}/teams/roster?format=json`, path: "planned: team.roster.players" },
  F: { url: `${LEAGUE}/scoreboard;week={n}?format=json`, path: "planned: scoreboard matchups; W-L-T from /standings" },
  G: { url: `${LEAGUE}/transactions;types=trade?format=json`, path: "planned: transactions (plus add/drop types)" },
  H: { url: `${LEAGUE}/players;status=A;start={n};count=25?format=json`, path: "planned: players, paginated" },
  I: { path: "planned: unknown whether Yahoo exposes traded future picks; check once live" },
  J: { path: "planned: §2.4 lists no Yahoo projections resource; Sleeper projections × league scoring (§6)" },
  K: { url: `${LEAGUE}/players;player_keys={player_keys}/stats;type=week;week={n}?format=json`, path: "planned: weekly player stats + league points; verify once live" },
  L: { path: "shared sources" },
  M: { path: "planned: Yahoo player_id → DynastyProcess yahoo_id → sleeper_id → FantasyCalc sleeperId (§2.9)" },
};

export type YahooProbe = Pick<ProbeContext, "cl" | "redactor" | "env" | "request" | "safeUrl" | "saveRaw" | "saveSanitized" | "timed">;

export interface YahooIo {
  /** Write YAHOO_REFRESH_TOKEN into .env.local without printing it. May throw (unsafe characters, file locked). */
  saveRefreshToken(token: string): Promise<void>;
  /** Write the authorize URL (contains the client ID) to the git-ignored file. */
  writeAuthorizeUrl(url: string): Promise<void>;
  /** Operator instructions (console). */
  print(text: string): void;
  /** Random state for the authorize URL. */
  randomState(): string;
  /** reports/probe-output/shared.json parsed, or undefined when probe:shared hasn't run. */
  readSharedOutput(): Promise<unknown>;
  /** .env.example text (committed template with blank values), or undefined. */
  readEnvExample(): Promise<string | undefined>;
}

/**
 * Error text for reports: no values, and absolute local file paths (not URLs) shortened to <path>.
 * Node quotes paths in fs errors ('D:\Source Code\…'), and project paths contain spaces.
 */
export function errorText(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err);
  return m
    .replace(/(['"])(?:[A-Za-z]:[\\/]|\/(?:Users|home|tmp|[a-z])\/)[^'"]*\1/g, "$1<path>$1")
    .replace(/(?<![\w/])[A-Za-z]:[\\/][^\s'"]+/g, "<path>")
    .replace(/(?<![\w:/.])\/(?:Users|home|tmp|[a-z])\/[^\s'"]+/g, "<path>");
}

/** The status line of a check in another probe's output (e.g. probe-shared's XWALK.yahoo), or null. */
export function findCheck(output: unknown, key: string): { status: string; summary: string; generatedAt?: string } | null {
  if (typeof output !== "object" || output === null) return null;
  const o = output as { checks?: unknown; generatedAt?: unknown };
  if (!Array.isArray(o.checks)) return null;
  const c = o.checks.find((x): x is { key: string; status: string; summary: string } => typeof x === "object" && x !== null && (x as { key?: unknown }).key === key);
  if (!c || typeof c.summary !== "string") return null;
  return { status: String(c.status), summary: c.summary, generatedAt: typeof o.generatedAt === "string" ? o.generatedAt : undefined };
}

/** What to do once Yahoo enables Fantasy API access (§2.4 steps 1–5). Instructions, printed and saved as a note. */
export function appSetupSteps(): string[] {
  return [
    "At developer.yahoo.com create a NEW app after Yahoo enables access (apps made earlier can't be switched over)",
    `redirect URI ${YAHOO_REDIRECT_URI}`,
    `API permissions: Fantasy Sports → Read (${YAHOO_SCOPE}); Yahoo sets scopes on the app, not in the authorize URL`,
    "send Yahoo that app's Client ID if they ask for it",
    "fill YAHOO_CLIENT_ID and YAHOO_CLIENT_SECRET in .env.local (never paste them into chat), then run npm run probe:yahoo",
  ];
}

function consentSteps(): string {
  return [
    "",
    "Yahoo: next step (one-time consent, needs a browser)",
    `  0. The app must have redirect URI ${YAHOO_REDIRECT_URI} and the Fantasy Sports: Read permission; a consent error or a later 403 usually means one is missing.`,
    "  1. Open the authorize URL. It contains your Client ID, so it's saved to a git-ignored file instead of printed:",
    `       Start-Process (Get-Content "${AUTH_URL_FILE_REL}")`,
    `  2. Sign in and click Agree. Yahoo sends the browser to ${YAHOO_REDIRECT_URI}?code=...`,
    '     The page may not load until the Phase 5 route exists; that\'s fine. Copy the value after "code=" (stop at "&").',
    `  3. Add a line to .env.local:  ${YAHOO_AUTH_CODE_VAR}=<the code>   (codes expire within minutes; the whole callback URL also works)`,
    "  4. Run again:  npm run probe:yahoo",
    `     The probe exchanges the code once and saves ${YAHOO_REFRESH_TOKEN_VAR} into .env.local without printing it.`,
    "",
  ].join("\n");
}

// -------------------------------------------------------------------------------------------------

async function checkHost(p: YahooProbe): Promise<HttpResult | undefined> {
  const url = p.safeUrl(GAME_NFL_URL);
  let res: HttpResult;
  try {
    // Exactly one request: no retries, no cookies, no Authorization header.
    res = await p.timed("unauthenticated game/nfl", () => p.request(GAME_NFL_URL, { retries: 0, label: "Yahoo game/nfl (no credentials)" }));
  } catch (err) {
    p.cl.fail("API", "API.hostUnauthenticated", "API host answers without credentials", `request failed: ${errorText(err)}`, { url });
    return undefined;
  }
  const evidence: Evidence = { url, status: res.status, path: "HTTP status + Content-Type header", sample: { contentType: res.contentType || "(none)" } };
  if (res.status === 401) p.cl.ok("API", "API.hostUnauthenticated", "API host answers without credentials", "HTTP 401 as expected: the Fantasy API is up and requires OAuth", evidence);
  else p.cl.warn("API", "API.hostUnauthenticated", "API host answers without credentials", `HTTP ${res.status} (expected 401); the host is up but answered differently than documented`, evidence);
  // Keep the unauthenticated error response for Phase 5 adapter error-handling tests (no credentials were sent).
  const body = res.json ?? res.text;
  const ext = res.json === undefined ? (/xml/i.test(res.contentType) ? ".xml" : ".txt") : undefined;
  await p.saveRaw("game/nfl?format=json (no credentials)", body, res, ext);
  await p.saveSanitized("game/nfl?format=json (no credentials)", body, res, undefined, ext);
  return res;
}

/** Yahoo's OAuth guide (7-day docs cache): which authorize parameters it documents (§2.4 "Scope: fspt-r"). */
async function checkGuide(p: YahooProbe): Promise<(AuthGuideFacts & { status: number }) | null> {
  const title = "Yahoo OAuth guide: authorize parameters";
  let res: HttpResult;
  try {
    res = await p.timed("Yahoo OAuth guide", () =>
      p.request(YAHOO_AUTH_GUIDE_URL, { cache: { key: `yahoo-docs:${YAHOO_AUTH_GUIDE_URL}`, ttlMs: TTL.docs, namespace: "docs" }, cacheIf: (r) => r.status === 200, label: "Yahoo OAuth guide" }),
    );
  } catch (err) {
    p.cl.warn("DOCS", "DOCS.oauthGuide", title, `could not read the guide: ${errorText(err)}`, { url: YAHOO_AUTH_GUIDE_URL });
    return null;
  }
  if (res.status !== 200) {
    p.cl.warn("DOCS", "DOCS.oauthGuide", title, `HTTP ${res.status}; guide not read`, { url: YAHOO_AUTH_GUIDE_URL, status: res.status });
    return null;
  }
  const facts = parseAuthGuide(htmlToText(res.text));
  if (!facts || !facts.requestAuthParams.length) {
    p.cl.warn("DOCS", "DOCS.oauthGuide", title, 'HTTP 200 but no "Table 1 Request Authorization URL" parameter table: the page layout changed', { url: YAHOO_AUTH_GUIDE_URL, status: 200 });
    return null;
  }
  const scopeListed = facts.requestAuthParams.includes("scope");
  p.cl.ok(
    "DOCS",
    "DOCS.oauthGuide",
    title,
    `request_auth parameters: ${facts.requestAuthParams.join(", ")}${scopeListed ? "" : " (no scope parameter)"}; Step 1 ${facts.scopesChosenAtAppCreation ? "lists scopes among the settings of the app project" : "doesn't mention scopes"}; ${facts.rotationRevokesOld ? "a newly issued refresh token revokes the old one" : "no statement on refresh-token rotation"}`,
    { url: YAHOO_AUTH_GUIDE_URL, status: 200, path: "Table 1 Request Authorization URL (/request_auth) Call Request; Step 1", sample: facts.requestAuthParams, note: res.fromCache ? "7-day docs cache" : undefined },
  );
  return { ...facts, status: res.status };
}

async function tokenCall(p: YahooProbe, basic: string, body: string, label: string): Promise<{ result: TokenResult; status: number }> {
  // One attempt only: an auth code is single-use, so a blind retry could burn it.
  let res: HttpResult;
  try {
    res = await p.request(YAHOO_TOKEN_URL, { method: "POST", headers: { Authorization: basic, "Content-Type": "application/x-www-form-urlencoded" }, body, retries: 0, label });
  } catch (err) {
    return { result: { ok: false, error: "network error", description: errorText(err) }, status: 0 };
  }
  const result = parseTokenResponse(res.status, res.json);
  if (result.ok) {
    // Register every token with the scrubber before anything else can print.
    secrets.add(result.accessToken, "[REDACTED:yahoo-access-token]");
    if (result.refreshToken) secrets.add(result.refreshToken, `[REDACTED:${YAHOO_REFRESH_TOKEN_VAR}]`);
    if (result.userGuid) p.redactor.register(result.userGuid, "user-id");
  }
  return { result, status: res.status };
}

/** Try to save a refresh token; returns the error text instead of throwing (the code is already spent). */
async function trySave(io: YahooIo, token: string): Promise<string | null> {
  try {
    await io.saveRefreshToken(token);
    return null;
  } catch (err) {
    return errorText(err);
  }
}

/** Runs the OAuth steps; returns the "untested: …" reason recorded on items A–M. */
async function runOAuth(p: YahooProbe, io: YahooIo, clientId: string, clientSecret: string, guide: AuthGuideFacts | null): Promise<string> {
  const basic = basicAuthHeader(clientId, clientSecret);
  const refresh = p.env("YAHOO_REFRESH_TOKEN");
  const code = extractAuthCode(p.env("YAHOO_AUTH_CODE") ?? "");
  if (code) secrets.add(code, `[REDACTED:${YAHOO_AUTH_CODE_VAR}]`);
  const tokenUrl = p.safeUrl(YAHOO_TOKEN_URL);
  let accessToken: string;

  if (refresh) {
    const { result, status } = await p.timed("token refresh", () => tokenCall(p, basic, refreshGrantBody(refresh), "Yahoo token (refresh_token grant)"));
    if (!result.ok) {
      p.cl.fail("AUTH", "AUTH.refresh", "Refresh token → access token", `${result.error}${result.description ? `: ${result.description}` : ""}`, { url: tokenUrl, status, path: "error / error_description" });
      p.cl.issue(`Yahoo refresh failed (HTTP ${status}, ${result.error}) — token endpoint ${tokenUrl} — options: delete ${YAHOO_REFRESH_TOKEN_VAR} from .env.local and redo consent, or check the app's Client ID/Secret.`);
      return "untested: Yahoo OAuth refresh failed; league checks not run";
    }
    accessToken = result.accessToken;
    p.cl.ok("AUTH", "AUTH.refresh", "Refresh token → access token", `access token received (expires_in ${result.expiresIn ?? "?"} s; value never printed)`, { url: tokenUrl, status, path: "access_token, expires_in" });
    if (result.refreshToken && result.refreshToken !== refresh) {
      const err = await trySave(io, result.refreshToken);
      const revokes = guide?.rotationRevokesOld ? "Yahoo's guide says the old one is revoked once a new one is issued, so the next run's refresh will fail" : "the old one may stop working";
      if (err) {
        p.cl.fail("AUTH", "AUTH.rotation", "Rotated refresh token saved", `Yahoo issued a new refresh token but it was not saved (${err}); ${revokes}: redo consent`, { url: tokenUrl, status, path: "refresh_token" });
        p.cl.issue(`Yahoo rotated refresh token not saved (${err}) — token endpoint ${tokenUrl} HTTP ${status} — options: redo consent (open the authorize URL again), or teach upsertEnvLine to quote values if the token has characters it refuses.`);
      } else p.cl.ok("AUTH", "AUTH.rotation", "Rotated refresh token saved", `Yahoo issued a new refresh token; ${YAHOO_REFRESH_TOKEN_VAR} updated in .env.local (not printed)`, { url: tokenUrl, status, path: "refresh_token" });
    }
  } else if (code) {
    const { result, status } = await p.timed("code exchange", () => tokenCall(p, basic, codeGrantBody(code), "Yahoo token (authorization_code grant)"));
    if (!result.ok) {
      p.cl.fail("AUTH", "AUTH.codeExchange", "Auth code → tokens", `${result.error}${result.description ? `: ${result.description}` : ""}`, { url: tokenUrl, status, path: "error / error_description" });
      p.cl.issue(`Yahoo code exchange failed (HTTP ${status}, ${result.error}) — codes are single-use and expire within minutes — option: get a fresh code (open the authorize URL again) and rerun right away.`);
      await io.writeAuthorizeUrl(authorizeUrl(clientId, io.randomState()));
      io.print(consentSteps());
      return "untested: awaiting Yahoo OAuth consent (code exchange failed)";
    }
    accessToken = result.accessToken;
    const ev: Evidence = { url: tokenUrl, status, path: "access_token, refresh_token, expires_in" };
    if (!result.refreshToken) p.cl.warn("AUTH", "AUTH.codeExchange", "Auth code → tokens", "access token received but no refresh_token in the response: every run will need a new code", ev);
    else {
      const err = await trySave(io, result.refreshToken);
      if (err) {
        p.cl.fail("AUTH", "AUTH.codeExchange", "Auth code → tokens", `tokens received, but ${YAHOO_REFRESH_TOKEN_VAR} was not saved (${err}); this run continues with the 1-hour access token; redo consent for a new code`, ev);
        p.cl.issue(`Yahoo refresh token not saved (${err}) — token endpoint ${tokenUrl} HTTP ${status} — options: redo consent (open the authorize URL again), or teach upsertEnvLine to quote values if the token has characters it refuses.`);
      } else p.cl.ok("AUTH", "AUTH.codeExchange", "Auth code → tokens", `tokens received; ${YAHOO_REFRESH_TOKEN_VAR} written to .env.local (not printed). You can delete the ${YAHOO_AUTH_CODE_VAR} line.`, ev);
    }
  } else {
    // State isn't verified in this manual flow (Parker copies only the code); the Phase 5 callback route will check it.
    await io.writeAuthorizeUrl(authorizeUrl(clientId, io.randomState()));
    p.cl.warn("AUTH", "AUTH.consent", "OAuth consent", `authorize URL written to ${AUTH_URL_FILE_REL} (git-ignored; not printed because it contains YAHOO_CLIENT_ID)`, {
      url: p.safeUrl(authorizeUrl("{clientId}", "{state}")).replace(/%7B/g, "{").replace(/%7D/g, "}"),
      note: `redirect_uri ${YAHOO_REDIRECT_URI}; app permission Fantasy Sports: Read (${YAHOO_SCOPE})`,
    });
    io.print(consentSteps());
    return "untested: awaiting Yahoo OAuth consent (see the next step printed above)";
  }

  // One authenticated call: is the app enabled, and what is this season's NFL game key?
  const url = p.safeUrl(GAME_NFL_URL);
  let res: HttpResult;
  try {
    res = await p.timed("authenticated game/nfl", () => p.request(GAME_NFL_URL, { headers: { Authorization: `Bearer ${accessToken}` }, retries: 1, label: "Yahoo game/nfl (OAuth)" }));
  } catch (err) {
    p.cl.fail("API", "API.gameKey", "Current NFL game key", `request failed: ${errorText(err)}`, { url });
    return "untested: Yahoo API unreachable; league checks not run";
  }
  if (res.status === 200) {
    const game = extractGame(res.json);
    if (game) p.cl.ok("API", "API.gameKey", "Current NFL game key", `game_key ${game.gameKey}, season ${game.season ?? "?"} (look it up every time; never hardcode)`, { url, status: 200, path: "fantasy_content.game[0].game_key", sample: game });
    else p.cl.warn("API", "API.gameKey", "Current NFL game key", "HTTP 200 but no game_key found", { url, status: 200, path: "fantasy_content.game[0].game_key" });
    await p.saveRaw("game/nfl?format=json (OAuth)", res.json ?? res.text, res);
    await p.saveSanitized("game/nfl?format=json (OAuth)", res.json ?? res.text, res);
    io.print("\nYahoo access works. This probe stops at the game key: the Yahoo A–M league checks are Phase 5 work and aren't written yet.\n");
    return "untested: Yahoo access is live, but the A–M league checks aren't written yet (Phase 5 work; this probe verifies OAuth and the game key only)";
  }
  if (res.status === 403) {
    p.cl.warn(
      "API",
      "API.approval",
      "App enabled for the Fantasy API",
      "HTTP 403 with a valid token: Yahoo hasn't enabled this app for the Fantasy API yet (probe once a day; §2.4 says access went live a few days after the approval email for others), or the app lacks the Fantasy Sports: Read permission or was created before access was enabled (§2.4 step 3)",
      { url, status: 403, path: "HTTP status + Content-Type header", sample: { contentType: res.contentType || "(none)" } },
    );
    return "untested: awaiting Yahoo approval (OAuth works; the Fantasy API answers 403)";
  }
  p.cl.fail("API", "API.gameKey", "Current NFL game key", `HTTP ${res.status} with a valid token`, { url, status: res.status, sample: { contentType: res.contentType || "(none)" } });
  return `untested: Yahoo API answered HTTP ${res.status}; league checks not run`;
}

function markItems(p: YahooProbe, reason: string, shared: ReturnType<typeof findCheck>): void {
  for (const id of ITEM_IDS) {
    const plan = PLANNED[id];
    if (id === "L") {
      p.cl.na("L", "L.status", TITLES.L, "not applicable: the NFL schedule and byes come from the shared sources (probe-shared), not from Yahoo", { path: plan.path });
      continue;
    }
    let note: string | undefined;
    if (id === "M") {
      const xw = shared
        ? `Yahoo id coverage from probe-shared XWALK.yahoo (${shared.status}${shared.generatedAt ? `, run ${shared.generatedAt.slice(0, 10)}` : ""}): ${shared.summary}`
        : "Yahoo id coverage: run npm run probe:shared (check XWALK.yahoo)";
      note = `${xw}. Fallback for players without a Yahoo id: match on name + position + NFL team, then the user confirms (like manual import, §2.8)`;
    }
    p.cl.na(id, `${id}.status`, TITLES[id], reason, { url: plan.url, path: plan.path, note });
  }
}

export async function runYahoo(p: YahooProbe, io: YahooIo): Promise<void> {
  const clientId = p.env("YAHOO_CLIENT_ID");
  const clientSecret = p.env("YAHOO_CLIENT_SECRET");
  const haveApp = Boolean(clientId && clientSecret);
  p.cl.meta.leagues = [
    haveApp
      ? { label: "Parker's Yahoo account (league not chosen yet)", access: `OAuth 2.0 (app permission ${YAHOO_SCOPE})`, source: "YAHOO_CLIENT_ID / YAHOO_CLIENT_SECRET set" }
      : { label: "none: awaiting Yahoo approval", access: "unauthenticated host check only", source: "YAHOO_CLIENT_ID / YAHOO_CLIENT_SECRET blank" },
  ];
  p.cl.meta.env = {
    YAHOO_CLIENT_ID: clientId ? "set" : "blank",
    YAHOO_CLIENT_SECRET: clientSecret ? "set" : "blank",
    [YAHOO_AUTH_CODE_VAR]: p.env("YAHOO_AUTH_CODE") ? "set" : "blank",
    [YAHOO_REFRESH_TOKEN_VAR]: p.env("YAHOO_REFRESH_TOKEN") ? "set" : "blank",
  };

  const host = await checkHost(p);
  const guide = await checkGuide(p);
  let sharedOutput: unknown;
  try {
    sharedOutput = await io.readSharedOutput();
  } catch {
    sharedOutput = undefined;
  }
  const shared = findCheck(sharedOutput, "XWALK.yahoo");

  // Decisions
  p.cl.decision(
    "Yahoo OAuth plan once YAHOO_CLIENT_ID / YAHOO_CLIENT_SECRET exist: 3-legged OAuth needs a browser and an HTTPS redirect, " +
      `${YAHOO_REDIRECT_URI} (served by \`npm run dev -- --experimental-https\` once the Phase 5 route exists). Until then the probe does the browser-free steps: ` +
      `it writes the authorize URL to ${AUTH_URL_FILE_REL} (git-ignored; not printed because it contains the client ID), takes the code Parker copies from the redirect via ${YAHOO_AUTH_CODE_VAR}, ` +
      `exchanges it once (no retries: codes are single-use) and writes ${YAHOO_REFRESH_TOKEN_VAR} straight into .env.local without printing it. Later runs use the stored refresh token for a 1-hour access token, ` +
      "then look up the current NFL game key with game/nfl (never hardcoded): 200 = access is live, 403 = not enabled yet (probe once a day).",
  );
  p.cl.decision(
    "Scope of this probe after approval: it verifies OAuth (consent → code → refresh token) and the current NFL game key only, and does not check items A–M. " +
      "The Yahoo league checklist (league list via users;use_login=1/games;game_keys={game_key}/leagues, then league settings, teams/roster, standings, scoreboard;week={n}, transactions and players;status=A, " +
      "with the Redactor registering team names, manager nicknames, guids, emails and image URLs) is Phase 5 work and still has to be written.",
  );
  if (guide) {
    const scopeListed = guide.requestAuthParams.includes("scope");
    p.cl.decision(
      scopeListed
        ? `Yahoo's guide lists a scope parameter for request_auth (DOCS.oauthGuide), but the authorize URL doesn't send one yet: add scope=${YAHOO_SCOPE} if consent fails.`
        : `The authorize URL sends only the parameters Yahoo's guide documents for request_auth (${guide.requestAuthParams.join(", ")}; DOCS.oauthGuide): no scope parameter. ${YAHOO_SCOPE} ("Fantasy Sports: Read") is the API permission chosen when the app is created.`,
    );
    if (!scopeListed && guide.scopesChosenAtAppCreation) {
      p.cl.issue(
        `§2.4 lists "Scope: ${YAHOO_SCOPE}" under OAuth 2.0, but Yahoo's guide documents no scope parameter for request_auth — ${YAHOO_AUTH_GUIDE_URL} HTTP ${guide.status}, "Table 1 Request Authorization URL": ${guide.requestAuthParams.join(", ")}; Step 1 has scopes chosen on the app project — ` +
          `options: (a) reword §2.4: ${YAHOO_SCOPE} ("Fantasy Sports: Read") is the API permission to tick when creating the app, and the authorize URL sends no scope (what the probe does); (b) also send scope=${YAHOO_SCOPE} (undocumented; Yahoo may ignore or reject it).`,
      );
    }
  } else p.cl.decision("The authorize URL sends client_id, redirect_uri, response_type=code, state and language (Yahoo's guide couldn't be read this run to re-check that list; see DOCS.oauthGuide).");

  const extra = [YAHOO_AUTH_CODE_VAR, YAHOO_REFRESH_TOKEN_VAR];
  const listed = (ENV_VARS as readonly string[]).filter((v) => extra.includes(v));
  let example: string | undefined;
  try {
    example = await io.readEnvExample();
  } catch {
    example = undefined;
  }
  const exampleKeys = new Set([...(example ?? "").matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*=/gm)].map((m) => m[1]));
  const inExample = extra.filter((v) => exampleKeys.has(v));
  p.cl.decision(
    `Added ${extra.join(" and ")} for the manual OAuth steps; they are not in CLAUDE.md §0.5's variable list. In scripts/lib/env.ts (so every output scrubber hides them): ${listed.length === extra.length ? "both" : listed.join(", ") || "neither"}; in .env.example: ${
      example === undefined ? "file not readable" : inExample.length === extra.length ? "both" : inExample.join(", ") || "neither"
    }. The code is single-use; the refresh token is written into .env.local by the probe and never printed.`,
  );

  let reason: string;
  if (!clientId || !clientSecret) {
    const steps = appSetupSteps();
    p.cl.na("AUTH", "AUTH.credentials", "OAuth app credentials", "untested: awaiting Yahoo approval (YAHOO_CLIENT_ID / YAHOO_CLIENT_SECRET blank); OAuth steps skipped", {
      path: ".env.local YAHOO_CLIENT_ID / YAHOO_CLIENT_SECRET (set/blank only)",
      note: `after approval: ${steps.map((s, i) => `${i + 1}) ${s}`).join("; ")}`,
    });
    io.print(["", "Yahoo: after Yahoo enables Fantasy API access for your account (§2.4 steps 1–5):", ...steps.map((s, i) => `  ${i + 1}. ${s}`), ""].join("\n"));
    p.cl.question("Has Yahoo replied to your API application yet (DocuSign agreement or a request for a Client ID)?");
    reason = "untested: awaiting Yahoo approval (YAHOO_CLIENT_ID / YAHOO_CLIENT_SECRET blank)";
  } else {
    p.cl.ok("AUTH", "AUTH.credentials", "OAuth app credentials", "YAHOO_CLIENT_ID and YAHOO_CLIENT_SECRET set (values not shown)", { path: ".env.local YAHOO_CLIENT_ID / YAHOO_CLIENT_SECRET (set/blank only)" });
    reason = await runOAuth(p, io, clientId, clientSecret, guide);
  }
  markItems(p, reason, shared);

  p.cl.issue(
    `Yahoo items A–M are unverified; state: ${reason.replace(/^untested: /, "")} — ${p.safeUrl(GAME_NFL_URL)} without credentials: ${host ? `HTTP ${host.status}` : "no answer"} — even after approval this probe checks OAuth and the game key only; the A–M league checks are Phase 5 work — ` +
      "options: (a) write the Yahoo A–M checks together with the Phase 5 adapter (behind FEATURE_YAHOO); (b) extend probe-yahoo with them as soon as approval lands, before Phase 5.",
  );
}
