/**
 * CLAUDE.md §2.3 "Browser fetching (check in Phase 1)": can a web page on another origin read
 * api.sleeper.app responses? If so, production can fetch Sleeper from the user's browser, so each
 * user's requests count against their own IP rather than our server's shared limit.
 *
 * Sends ONE plain GET (a "simple request": no custom headers, so no preflight) per endpoint, with an
 * Origin header (what a browser adds to a cross-origin fetch), and records the CORS response
 * headers. Endpoints: two league-independent ones (/v1/state/nfl and the undocumented /projections
 * host path, one position) and two league endpoints a browser import needs (/v1/league/{leagueId}
 * and /v1/league/{leagueId}/rosters) for the PINNED public test league (its ID is read from the
 * git-ignored fixtures/raw/sleeper/fallback-league.json and never printed or written). That is 4
 * requests; the other league endpoints (users, matchups, transactions, traded_picks, drafts) and the
 * /user lookups share the same host and API and are NOT checked (inferred, ⚠️).
 *
 * `--preflight` also sends an OPTIONS preflight for an endpoint whose GET allows no other origin, to
 * tell "no CORS at all" from "CORS on preflight only". Without it, the run makes exactly 4 requests.
 *
 * Writes reports/probe-output/sleeper-cors.md (placeholders only: the league ID appears as
 * {leagueId}; no bodies).
 *
 *   npm run check:sleeper-cors -- --live
 *
 * It needs --live (planner reply to Checkpoint 4c, A5: scripts touch the network only when asked; scripts/lib/runMode.ts):
 * without it, it says so and exits 1 before any request.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { refuseIfNetworkOff } from "@/server/http";
import { isMainModule, requireLive } from "./lib/runMode";

const ROOT = process.cwd();
const PINNED_LEAGUE_FILE = path.join(ROOT, "fixtures", "raw", "sleeper", "fallback-league.json");
const REPORT_FILE = path.join(ROOT, "reports", "probe-output", "sleeper-cors.md");
/** A made-up origin: the check is whether ANY other site may read the response. */
const ORIGIN = "https://offersheet.example";
const USER_AGENT = "OfferSheet/0.1 (non-commercial fantasy trade helper; read-only; CORS check)";
const LEAGUE_PLACEHOLDER = "{leagueId}";

const CORS_HEADERS = ["access-control-allow-origin", "access-control-allow-credentials", "access-control-allow-methods", "access-control-allow-headers", "access-control-expose-headers", "access-control-max-age", "vary"];

interface Endpoint {
  /** What the browser would use it for. */
  purpose: string;
  /** The URL as shown (league ID as {leagueId}). */
  shown: string;
  /** The URL requested. */
  url: string;
}

interface Result {
  endpoint: Endpoint;
  status: number | null;
  contentType: string | null;
  bytes: number;
  headers: Record<string, string>;
  allowed: boolean;
  preflight?: { status: number; headers: Record<string, string>; allowed: boolean };
  error?: string;
}

function corsHeaders(res: Response): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of CORS_HEADERS) {
    const v = res.headers.get(h);
    if (v !== null) out[h] = v;
  }
  return out;
}

export function allowsOrigin(allowOrigin: string | null, origin: string): boolean {
  if (!allowOrigin) return false;
  return allowOrigin.trim() === "*" || allowOrigin.split(",").some((o) => o.trim() === origin);
}

/** The pinned public test league's ID (digits only), or undefined when the git-ignored file isn't there. */
export function pinnedLeagueId(file: string = PINNED_LEAGUE_FILE): string | undefined {
  if (!existsSync(file)) return undefined;
  const id = (JSON.parse(readFileSync(file, "utf8")) as { leagueId?: unknown }).leagueId;
  return typeof id === "string" && /^\d{5,25}$/.test(id) ? id : undefined;
}

export function endpointsToCheck(leagueId: string | undefined): Endpoint[] {
  const list: Endpoint[] = [
    { purpose: "NFL season calendar (league-independent)", shown: "https://api.sleeper.app/v1/state/nfl", url: "https://api.sleeper.app/v1/state/nfl" },
    { purpose: "weekly projections (undocumented host path, league-independent)", shown: "https://api.sleeper.app/projections/nfl/2026/4?season_type=regular&position[]=K", url: "https://api.sleeper.app/projections/nfl/2026/4?season_type=regular&position[]=K" },
  ];
  if (leagueId) {
    for (const [purpose, suffix] of [
      ["league settings and scoring", ""],
      ["rosters", "/rosters"],
    ] as const)
      list.push({ purpose: `${purpose} (pinned public test league)`, shown: `https://api.sleeper.app/v1/league/${LEAGUE_PLACEHOLDER}${suffix}`, url: `https://api.sleeper.app/v1/league/${leagueId}${suffix}` });
  }
  return list;
}

/** Never show the real league ID, even inside an error message. */
function scrub(text: string, leagueId: string | undefined): string {
  return leagueId ? text.split(leagueId).join(LEAGUE_PLACEHOLDER) : text;
}

async function check(endpoint: Endpoint, preflight: boolean, leagueId: string | undefined): Promise<Result> {
  refuseIfNetworkOff(new URL(endpoint.url).host); // the offline guard (scripts/lib/runMode.ts): never without --live
  try {
    const get = await fetch(endpoint.url, { headers: { Origin: ORIGIN, "User-Agent": USER_AGENT, Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
    const body = await get.text();
    const result: Result = { endpoint, status: get.status, contentType: get.headers.get("content-type"), bytes: body.length, headers: corsHeaders(get), allowed: allowsOrigin(get.headers.get("access-control-allow-origin"), ORIGIN) };
    if (!result.allowed && preflight) {
      const pre = await fetch(endpoint.url, { method: "OPTIONS", headers: { Origin: ORIGIN, "Access-Control-Request-Method": "GET", "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(20_000) });
      await pre.text();
      result.preflight = { status: pre.status, headers: corsHeaders(pre), allowed: allowsOrigin(pre.headers.get("access-control-allow-origin"), ORIGIN) };
    }
    return result;
  } catch (err) {
    return { endpoint, status: null, contentType: null, bytes: 0, headers: {}, allowed: false, error: scrub(err instanceof Error ? err.message : String(err), leagueId) };
  }
}

function verdict(r: Result): string {
  if (r.error) return `❌ request failed (${r.error})`;
  if (r.allowed) return `✅ readable from any origin (Access-Control-Allow-Origin: ${r.headers["access-control-allow-origin"]})${r.headers["access-control-allow-credentials"] ? `; allow-credentials: ${r.headers["access-control-allow-credentials"]}` : ""}`;
  if (r.preflight?.allowed) return "⚠️ only the preflight allows other origins; browsers still can't read the GET";
  return "❌ no CORS permission on the GET: browsers block other sites from reading it";
}

export function renderReport(results: Result[], checkedAt: string, pinned: boolean): string {
  const allAllowed = results.length > 0 && results.every((r) => r.allowed);
  const lines = [
    "# Sleeper CORS check",
    "",
    "Generated by `npm run check:sleeper-cors -- --live` (CLAUDE.md §2.3 \"Browser fetching\"). Placeholders only: the pinned public test league's ID is shown as `{leagueId}`; no response bodies.",
    "",
    `Checked ${checkedAt} (UTC): one plain GET per endpoint with \`Origin: ${ORIGIN}\` (a made-up origin: can ANY other site read the response?). A GET without custom headers is a "simple request", so a browser sends no preflight for it.`,
    "",
    "| | Endpoint | Used for | HTTP | CORS headers on the GET |",
    "|---|---|---|---|---|",
    ...results.map((r) => `| ${r.allowed ? "✅" : r.preflight?.allowed ? "⚠️" : "❌"} | \`${r.endpoint.shown}\` | ${r.endpoint.purpose} | ${r.status ?? "—"} | ${Object.keys(r.headers).length ? Object.entries(r.headers).map(([k, v]) => `\`${k}: ${v}\``).join("<br>") : "(none)"} |`),
    "",
    "## Result",
    "",
    ...results.map((r) => `- \`${r.endpoint.shown}\`: ${verdict(r)}`),
    "",
    allAllowed
      ? `- ✅ Every checked endpoint answers a cross-origin GET with \`Access-Control-Allow-Origin: *\`${pinned ? ", the league endpoints included" : ""}.`
      : "- ❌/⚠️ Not every checked endpoint allows other origins: keep Sleeper fetching on the server.",
    "- ⚠️ Not checked (inferred from the same host and API): `/v1/league/{leagueId}/users`, `/matchups/{week}`, `/transactions/{leg}`, `/traded_picks`, `/drafts`, `/v1/user/{username}`, `/v1/user/{userId}/leagues/nfl/{season}` and `/stats`.",
    "- Browser fetching is NOT built: the app fetches Sleeper on the server (src/adapters/sleeper/fetch.ts). A browser path would also need a slim player lookup, because the 15 MB players DB must never reach the browser (§2.3). Decision for Checkpoint 1: browser fetching deferred to Phase 7 (public launch), where it would move Sleeper's rate-limit load onto each user's own IP.",
    "",
  ];
  return lines.join("\n");
}

async function main(): Promise<void> {
  const preflight = process.argv.includes("--preflight");
  const leagueId = pinnedLeagueId();
  if (!leagueId) console.log("No pinned test league (fixtures/raw/sleeper/fallback-league.json); checking the league-independent endpoints only.");
  const results: Result[] = [];
  for (const endpoint of endpointsToCheck(leagueId)) {
    const r = await check(endpoint, preflight, leagueId);
    results.push(r);
    console.log(`GET ${r.endpoint.shown} with Origin: ${ORIGIN} → HTTP ${r.status ?? "—"}, ${r.bytes} bytes, content-type ${r.contentType ?? "?"}`);
    console.log(`  CORS headers: ${Object.keys(r.headers).length ? JSON.stringify(r.headers) : "(none)"}${r.preflight ? `; OPTIONS → HTTP ${r.preflight.status} ${JSON.stringify(r.preflight.headers)}` : ""}`);
    console.log(`  ${verdict(r)}`);
  }
  const report = renderReport(results, new Date().toISOString().slice(0, 10), !!leagueId);
  if (leagueId && report.includes(leagueId)) throw new Error("report would contain the league ID; not written");
  writeFileSync(REPORT_FILE, report, "utf8");
  console.log(`wrote ${path.relative(ROOT, REPORT_FILE).replace(/\\/g, "/")}`);
}

// Run only as a script (an exact path: scripts/lib/runMode.ts isMainModule), and only with --live.
if (isMainModule(import.meta.url)) {
  requireLive({ script: "check:sleeper-cors", what: "sends 4 requests to Sleeper" });
  main().catch((err: unknown) => {
    const leagueId = (() => {
      try {
        return pinnedLeagueId();
      } catch {
        return undefined;
      }
    })();
    console.error(`CORS check failed: ${scrub(err instanceof Error ? err.message : String(err), leagueId)}`);
    process.exit(2);
  });
}
