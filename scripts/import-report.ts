/**
 * Import a league exactly the way the app does (the real adapters, polite HTTP client, server cache
 * and player-ID crosswalk) and write its Import Report ("Here's what we understood", CLAUDE.md §14)
 * as plain text, for checkpoint reports (Checkpoint 1: "the Import Report contents for Parker's
 * leagues").
 *
 *   npm run import:report                 Parker's ESPN league (and Sleeper league, if set) from .env.local,
 *                                         through the public-link path a leaguemate gets ("pick your team")
 *   npm run import:report -- --cookies    use the .env.local ESPN cookies (also the default when
 *                                         USE_ENV_COOKIES=1, like `npm run dev`; CLAUDE.md §0.5)
 *   npm run import:report -- --no-cookies never use the cookies, even with USE_ENV_COOKIES=1
 *   npm run import:report -- --test-leagues   also the pinned public Sleeper test league (no per-team table)
 *   npm run import:report -- --response-out <file>   also save the placeholder-only ESPN import as the
 *                                         sessionStorage record the Import Report page reads (UI checks;
 *                                         the app's current format, lib/importStore IMPORT_FORMAT_VERSION)
 *
 * The report ends with every player ID override in the whole crosswalk (CLAUDE.md §2.9 crosswalk
 * rules: "log every override"), not just the ones on the imported leagues' players, which the
 * leagues' own notes list. It names NFL players only.
 *
 * Privacy (CLAUDE.md §0.5, §0.6): team, owner and league names and the league ID are replaced with
 * placeholders BEFORE the report is built, then everything is scrubbed again with the .env.local
 * secrets and the platforms' redaction maps. Output: reports/import-report.md (committed) and the
 * console. Cookies come only from .env.local and go only to ESPN, via the adapter.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { importEspnLeague } from "@/adapters/espn";
import { dataSourceStamps } from "@/app/api/_lib/respond";
import { importSleeperLeague } from "@/adapters/sleeper";
import type { ImportDeps, ImportResult } from "@/adapters/types";
import { loadPlayerIdResolver } from "@/data";
import type { CrosswalkConflict, CrosswalkSourceKey, IdSource, SleeperPlayerLite } from "@/data/types";
import type { LeagueSnapshot } from "@/engine/model";
import type { ImportResponse } from "@/lib/api";
import { buildImportReport, type ImportReportView } from "@/lib/importReport";
import { toStoredImport } from "@/lib/importStore";
import { FileCache } from "@/server/cache";
import { createHttpClient } from "@/server/http";
import { ROOT, env, loadEnv } from "./lib/env";
import { redactorFromMap } from "./lib/minimize";
import { installConsoleScrubber, registerScrubber, scrubEverything } from "./lib/redact";

const ID_KIND_LABELS: Readonly<Record<IdSource, string>> = { espn: "ESPN", mfl: "MFL", fleaflicker: "Fleaflicker", yahoo: "Yahoo", fantrax: "Fantrax", sportradar: "Sportradar", gsis: "GSIS" };
const SOURCE_LABELS: Readonly<Record<CrosswalkSourceKey, string>> = { dynastyProcess: "DynastyProcess", fantasyCalc: "FantasyCalc", sleeper: "Sleeper DB" };

/**
 * The crosswalk's "same player" overrides (PlayerIdCrosswalk.overrides()) as a report section: the
 * count, then one line per platform id with the player (from his chosen Sleeper record: an NFL
 * player's name, position and team), each source's Sleeper id and what matched. Pure.
 */
export function renderOverrides(overrides: readonly CrosswalkConflict[], playerOf: (sleeperId: string) => SleeperPlayerLite | undefined): string {
  const n = overrides.length;
  const L = [
    "## Player ID overrides (the whole crosswalk)",
    "",
    `${n === 1 ? "1 platform id" : `${n} platform ids`} where a lower-priority ID source's Sleeper id replaced the top source's (CLAUDE.md §2.9: the top source's id isn't an active fantasy player, and the other is an active player whose name and position, plus NFL team or GSIS id, match the top source's row). Each import notes the ones on its league's players; this lists all of them.`,
    "",
  ];
  for (const c of overrides) {
    const p = playerOf(c.chosen);
    const who = p ? `${p.name} (${[p.position, p.team].filter(Boolean).join(", ")})` : `Sleeper id ${c.chosen}`;
    const links = c.options.map((o) => `${o.from.map((f) => SOURCE_LABELS[f]).join(" + ")} → ${o.sleeperId}${o.active ? "" : " (not an active fantasy player)"}`).join("; ");
    const by = c.sameBy?.length ? c.sameBy.map((b) => (b === "team" ? "NFL team" : "GSIS id")).join(" and ") : "NFL team or GSIS id";
    L.push(`- ${who}, ${ID_KIND_LABELS[c.source]} id ${c.platformId}: ${links}. Using ${c.chosen} (same name, position and ${by}).`);
  }
  if (!n) L.push("- none");
  return `${L.join("\n")}\n`;
}

/** Replace every identifying name with a placeholder, before anything is rendered. */
function placeholders(result: ImportResult, label: string): ImportResponse {
  const s = result.snapshot;
  const swaps: Array<[string, string]> = [[s.name, label]];
  const teams = s.teams.map((t) => {
    swaps.push([t.name, `Team ${t.id}`]);
    for (const owner of t.ownerName.split(" & ")) swaps.push([owner, `Owner ${t.id}`]);
    return { ...t, name: `Team ${t.id}`, ownerName: `Owner ${t.id}` };
  });
  const snapshot: LeagueSnapshot = { ...s, name: label, leagueId: "{leagueId}", teams };
  let text = JSON.stringify({ ...result, snapshot });
  // Longest first, so a name that contains another is replaced whole.
  for (const [raw, placeholder] of swaps.filter(([raw]) => raw.trim().length > 2).sort((a, b) => b[0].length - a[0].length)) text = text.split(JSON.stringify(raw).slice(1, -1)).join(placeholder);
  return JSON.parse(text) as ImportResponse;
}

/** `aggregatesOnly`: no per-team table (a stranger's league, CLAUDE.md §0.6). */
function render(view: ImportReportView, heading: string, opts: { aggregatesOnly?: boolean } = {}): string {
  const L: string[] = [`## ${heading}`, ""];
  const l = view.league;
  L.push(`**${l.name}** · ${l.platformLabel} · ${l.season} season · week ${l.currentWeek} · ${l.numTeams} teams · ${l.leagueTypeLabel}${l.bestBall ? " · best ball" : ""}`, "");
  if (l.cookieNote) L.push(l.cookieNote, "");
  L.push("**At a glance**", "", ...view.glance.map((g) => `- ${g.label}: ${g.value}${g.detail ? ` (${g.detail})` : ""}`), "");
  const sc = view.scoring;
  L.push(`**Scoring: ${sc.formatLabel}**`, "");
  L.push(`- Per catch: ${sc.receptions.map((r) => `${r.pos} ${r.text}`).join(" · ")}${sc.tePremium ? ` (TE premium +${sc.tePremium})` : ""}`);
  for (const h of sc.highlights) L.push(`- ${h.label}: ${h.value}`);
  if (sc.bonuses.length) L.push(`- Bonuses: ${sc.bonuses.join("; ")}`);
  if (sc.defenseSummary) L.push(`- D/ST: ${sc.defenseSummary}`);
  for (const b of sc.defenseBuckets) L.push(`- ${b.title}: ${b.lines.map((x) => `${x.range} ${x.points > 0 ? "+" : ""}${x.points}`).join(", ")}`);
  L.push(`- Every per-unit rate (${sc.allRules.length}): ${sc.allRules.map((r) => `${r.label} ${r.value}`).join(" · ")}`);
  L.push(sc.unmapped.length ? `- Rules we couldn't map (${sc.unmapped.length}): ${sc.unmapped.map((u) => u.text).join("; ")}` : "- Rules we couldn't map: none", "");
  const lu = view.lineup;
  L.push("**Lineup and roster**", "", `- Starters: ${lu.startersText}`, `- Bench ${lu.bench} · IR ${lu.ir} · taxi ${lu.taxi} · max active roster ${lu.maxRosterSize}`);
  if (lu.limits.length) L.push(`- Position limits: ${lu.limits.map((x) => `${x.label} ${x.value}`).join(", ")}`);
  L.push("");
  const se = view.season;
  L.push("**Season and playoffs**", "", `- Regular season: ${se.regularSeason}`, `- Playoffs: ${se.playoffs} · ${se.playoffTeams} teams · byes: ${se.byes}${se.rounds ? ` · rounds: ${se.rounds}` : ""}`, `- Seeding: ${se.seeding}`, `- Ties in the standings: ${se.tiebreaker}`, `- Median game: ${se.medianGame ? "yes" : "no"} · points only: ${se.pointsOnly ? "yes" : "no"} · divisions: ${se.divisions.length || "none"}`, "");
  L.push("**Trades**", "", `- Deadline: ${view.trades.deadline}`, `- Review: ${view.trades.review}`, `- FAAB: ${view.trades.faab}`, `- Waiver order used: ${view.trades.waiverOrder}`, "");
  L.push("**Trade values**", "", `- ${view.values.text}`, "");
  const t = view.teams;
  L.push("**Teams** (names replaced with placeholders)", "", `- ${t.rows.length} teams; your team: ${t.myTeamId ? `Team ${t.myTeamId} (${t.myTeamSource === "platform" ? "found by the platform" : "picked"})` : "not identified: the user picks it"}`);
  if (!opts.aggregatesOnly) {
    L.push("", "| # | Team | Owner | Record | PF | PA | Roster | IR |", "|---|---|---|---|---|---|---|---|");
    for (const r of t.rows) L.push(`| ${r.rank} | ${r.name}${r.isMine ? " (you)" : ""} | ${r.owner} | ${r.record} | ${r.pointsFor} | ${r.pointsAgainst} | ${r.rosterCount} | ${r.irCount} |`);
  }
  const p = view.players;
  L.push("", "**Players**", "", `- ${p.total} players known: ${p.rostered} rostered (${p.onIr} on IR, ${p.onTaxi} on taxi), ${p.freeAgents} free agents`, `- Not matched to the player database: ${p.unmatched.length ? p.unmatched.map((u) => `${u.name} (${u.pos}, ${u.team})`).join("; ") : "none"}`, `- Missing details: ${p.missingDetails}`);
  L.push("", "**Schedule and activity**", "", `- ${view.schedule.matchups} matchups (${view.schedule.weeks})${view.schedule.missingRegularWeeks.length ? `; missing weeks ${view.schedule.missingRegularWeeks.join(", ")}` : ""}`, `- Final scores: ${view.schedule.results}`, `- Trades ${view.activity.trades} · adds ${view.activity.adds} · drops ${view.activity.drops} · waiver claims ${view.activity.waivers}${view.activity.tradedPicks !== undefined ? ` · traded picks ${view.activity.tradedPicks}` : ""}`);
  L.push("", `**Notes (${view.notes.length})**`, "", ...view.notes.map((n) => `- ${n}`));
  L.push("", `**Warnings (${view.warnings.length})**`, "", ...view.warnings.map((w) => `- \`${w.code}\` ${w.message}${w.platformPath ? ` (${w.platformPath})` : ""}`));
  L.push("", "**Data timestamps**", "", ...view.timestamps.map((x) => `- ${x.label}: ${x.value}`), "");
  return L.join("\n");
}

async function main(): Promise<void> {
  loadEnv();
  installConsoleScrubber();
  const withTestLeagues = process.argv.includes("--test-leagues");
  // Checkpoint 1 answer 6: the public-link path by default; the .env.local cookies only on request.
  const noCookies = process.argv.includes("--no-cookies") || !(process.argv.includes("--cookies") || env("USE_ENV_COOKIES") === "1");
  const responseOutIndex = process.argv.indexOf("--response-out");
  const responseOut = responseOutIndex > 0 ? process.argv[responseOutIndex + 1] : undefined;
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  for (const platform of ["espn", "sleeper"]) registerScrubber(await redactorFromMap(platform));
  const http = createHttpClient({ cache: new FileCache() });
  const started = Date.now();
  const resolver = await loadPlayerIdResolver({ http });
  const deps: ImportDeps = { http, resolver, now: new Date() };
  const sections: string[] = [];
  const timing: string[] = [`player-ID crosswalk ${((Date.now() - started) / 1000).toFixed(1)} s`];

  const espnLeague = env("ESPN_LEAGUE_ID");
  if (espnLeague) {
    const s2 = noCookies ? undefined : env("ESPN_S2");
    const swid = noCookies ? undefined : env("ESPN_SWID");
    const t0 = Date.now();
    const result = await importEspnLeague({ leagueId: espnLeague, season: Number(env("ESPN_SEASON") || 2026), ...(s2 && swid ? { credentials: { espnS2: s2, swid } } : {}) }, deps);
    timing.push(`ESPN import ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    const response = { ...placeholders(result, "League 1"), usedEspnCookies: Boolean(s2 && swid), ...(s2 && swid ? { espnCookieSource: "dev-env" as const } : {}), dataSources: dataSourceStamps(resolver) };
    sections.push(render(buildImportReport(response, { timeZone }), `ESPN: Parker's league${noCookies ? " (no cookies: the public-link path)" : ""}`));
    if (responseOut) {
      // The app's own record, in its current format (IMPORT_FORMAT_VERSION), so the pages accept it.
      const stored = toStoredImport({ request: { platform: "espn", season: response.snapshot.season, leagueId: "{leagueId}" }, response, savedAt: new Date().toISOString() });
      writeFileSync(responseOut, scrubEverything(JSON.stringify(stored)));
    }
  } else sections.push("## ESPN\n\nESPN_LEAGUE_ID is blank in .env.local.\n");

  const sleeperUser = env("SLEEPER_USERNAME");
  const sleeperLeague = env("SLEEPER_LEAGUE_ID");
  if (sleeperUser || sleeperLeague) {
    const t0 = Date.now();
    const result = await importSleeperLeague({ season: 2026, ...(sleeperUser ? { username: sleeperUser } : {}), ...(sleeperLeague ? { leagueId: sleeperLeague } : {}) }, deps);
    timing.push(`Sleeper import ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    sections.push(render(buildImportReport({ ...placeholders(result, "League 2"), dataSources: dataSourceStamps(resolver) }, { timeZone }), "Sleeper: Parker's league"));
  } else if (withTestLeagues) {
    // The pinned public test league (refreshing it is not a crawl, CLAUDE.md §0.6).
    const pin = path.join(ROOT, "fixtures", "raw", "sleeper", "fallback-league.json");
    const leagueId = existsSync(pin) ? (JSON.parse(readFileSync(pin, "utf8")) as { leagueId?: string }).leagueId : undefined;
    if (leagueId) {
      const t0 = Date.now();
      const result = await importSleeperLeague({ season: 2026, leagueId }, deps);
      timing.push(`Sleeper test-league import ${((Date.now() - t0) / 1000).toFixed(1)} s`);
      sections.push(render(buildImportReport({ ...placeholders(result, "Sleeper test league"), dataSources: dataSourceStamps(resolver) }, { timeZone }), "Sleeper: the pinned public test league (a stranger's league; no per-team table)", { aggregatesOnly: true }));
    } else sections.push("## Sleeper\n\nNo pinned public test league (run the Sleeper probe first).\n");
  } else sections.push("## Sleeper\n\nSLEEPER_USERNAME and SLEEPER_LEAGUE_ID are blank in .env.local, so Parker has no Sleeper league to import. The Sleeper adapter is tested on the public test league's minimized fixtures; `-- --test-leagues` also imports that league live.\n");

  sections.push(renderOverrides(resolver.overrides(), (id) => resolver.sleeperPlayer(id)));

  const doc = [
    "# Import Report contents",
    "",
    `Generated by \`npm run import:report\` on ${new Date().toISOString().slice(0, 10)} through the real adapters, cache and ID crosswalk (${timing.join(", ")}). Team, owner and league names are placeholders.`,
    "",
    ...sections,
  ].join("\n");
  const safe = scrubEverything(doc);
  writeFileSync(path.join(ROOT, "reports", "import-report.md"), safe);
  console.log(safe);
}

// Run only as a script (`npm run import:report`), so renderOverrides can be imported without side effects.
const isMain = process.argv[1] !== undefined && /import-report\.ts$/.test(process.argv[1]);
if (isMain) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? `${err.name}: ${err.message}` : String(err));
    process.exit(1);
  });
}
