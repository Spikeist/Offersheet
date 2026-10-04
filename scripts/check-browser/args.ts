/**
 * `npm run check:browser` options (pure parsing, tested).
 *
 * It imports Parker's league from ESPN, so it runs only with --live (planner reply to Checkpoint 4c, A5: scripts touch the
 * network only when asked; scripts/lib/runMode.ts). Without it the check says so and exits 2 (its "couldn't run").
 *
 * The documented form is `npm run check:browser -- --live --team 3`. Without the "--" (or when a shell drops it), npm keeps
 * the options as its own settings and passes them on as environment variables: `--team 3` becomes npm_config_team
 * "true" plus a stray "3" argument, `--team=3` becomes npm_config_team "3", `--show` npm_config_show "true", and
 * `--no-shots` an empty npm_config_shots (seen with npm 10 on Windows PowerShell), `--second-league`
 * npm_config_second_league "true", `--live` npm_config_live "true". resolveArgs reads those too, so both forms work; options given after "--" win. One stray value goes back to the one option that lost it; with two
 * (`--team 3 --max-search 15`) npm doesn't say which was whose, so the error says to put "--" first.
 */

export interface CheckBrowserArgs {
  /** --live: the network is allowed (the check imports your league); without it the check doesn't run (index.ts). */
  live: boolean;
  /** --team <id>: the team to pick on the Import Report; null keeps the Import Report's own choice. */
  team: string | null;
  /** --show: a visible browser window instead of headless. */
  show: boolean;
  /** --no-shots: no screenshots. */
  shots: boolean;
  /** --max-search <seconds>: the Trade Finder's full search must finish within this (CLAUDE.md §12: 10 seconds). */
  maxSearchSeconds: number;
  /**
   * --second-league: also adds the public ESPN test league (SECOND_LEAGUE, CLAUDE.md §17 Phase 0), switches to it and
   * back, and checks each page shows the league it should, settings and feedback per league, and Remove (Phase 4c).
   */
  secondLeague: boolean;
  help: boolean;
}

/** The public ESPN test league the --second-league check adds (CLAUDE.md §2.2, §17 Phase 0: viewable to the public). */
export const SECOND_LEAGUE = { leagueId: "899513", season: "2026" } as const;

/** §12's performance target for a full trade search. */
export const DEFAULT_MAX_SEARCH_SECONDS = 10;

export const USAGE = [
  "Checks the production build in headless Chrome at phone width (375 px), with your ESPN league imported through",
  "its public link (ESPN_LEAGUE_ID in .env.local; never printed).",
  "",
  "  npm run build",
  "  npm run check:browser -- --live --team 3",
  "",
  "Options:",
  "  --live               required: the check imports your league from ESPN (scripts touch the network only when asked)",
  "  --team <id>          pick this team on the Import Report (without it, the Import Report's own choice; with no",
  "                       team picked, the Trade Finder, card and Analyzer checks are skipped)",
  "  --show               show the browser window",
  "  --no-shots           no screenshots (they go to .cache/check-browser/shots, names replaced by placeholders)",
  "  --max-search <s>     the longest a full trade search may take (default 10 seconds)",
  "  --second-league      also add the public ESPN test league 899513 (2026), switch to it and back, and check that",
  "                       each page shows the right league and settings and feedback stay per league; then remove it",
  "  --help               this text",
  "",
  "Chrome: CHROME_PATH, else its usual install places. Exit code 0: every check passed; 1: a check failed;",
  "2: the check couldn't run (no --live, no build, no Chrome, no league id, or the server didn't start).",
].join("\n");

const TEAM_ID = /^[A-Za-z0-9_-]{1,40}$/;

/** The command line's options, and any bare values left over (pure). */
export function parseArgs(argv: readonly string[]): { args: CheckBrowserArgs; positionals: string[] } | { error: string } {
  const args: CheckBrowserArgs = { live: false, team: null, show: false, shots: true, maxSearchSeconds: DEFAULT_MAX_SEARCH_SECONDS, secondLeague: false, help: false };
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (!a.startsWith("-")) {
      positionals.push(a);
      continue;
    }
    const eq = a.startsWith("--") ? a.indexOf("=") : -1;
    const flag = eq > 0 ? a.slice(0, eq) : a;
    const inline = eq > 0 ? a.slice(eq + 1) : undefined;
    const value = (): string | null => {
      if (inline !== undefined) return inline;
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) return null;
      i++;
      return next;
    };
    switch (flag) {
      case "--live":
        args.live = true;
        break;
      case "--team": {
        const v = value()?.trim();
        if (!v || !TEAM_ID.test(v)) return { error: "--team needs a team id, for example --team 3." };
        args.team = v;
        break;
      }
      case "--show":
        args.show = true;
        break;
      case "--no-shots":
        args.shots = false;
        break;
      case "--second-league":
        args.secondLeague = true;
        break;
      case "--max-search": {
        const v = Number(value());
        if (!Number.isFinite(v) || v <= 0) return { error: "--max-search needs a number of seconds, for example --max-search 10." };
        args.maxSearchSeconds = v;
        break;
      }
      case "--help":
      case "-h":
        args.help = true;
        break;
      default:
        return { error: `Unknown option: ${a}. Run npm run check:browser -- --help for the options.` };
    }
  }
  return { args, positionals };
}

/** The options to run with (pure): the command line's, then what npm kept for itself (see the header). */
export function resolveArgs(parsed: { args: CheckBrowserArgs; positionals: readonly string[] }, env: Readonly<Record<string, string | undefined>>): { args: CheckBrowserArgs } | { error: string } {
  const args = { ...parsed.args };
  const rest = [...parsed.positionals];
  const npmTeam = env.npm_config_team?.trim();
  const npmMax = env.npm_config_max_search?.trim();
  // Options whose value npm split off (npm_config_<name> "true" and the value left as a stray argument).
  const lost = [npmTeam === "true" ? "--team" : null, npmMax === "true" ? "--max-search" : null].filter((x): x is string => x !== null);
  if (lost.length === 1 && rest.length === 1) {
    const value = rest.shift() as string;
    if (lost[0] === "--team") {
      if (!TEAM_ID.test(value)) return { error: "--team needs a team id, for example --team 3." };
      args.team ??= value;
    } else {
      const max = Number(value);
      if (!Number.isFinite(max) || max <= 0) return { error: "--max-search needs a number of seconds, for example --max-search 10." };
      if (args.maxSearchSeconds === DEFAULT_MAX_SEARCH_SECONDS) args.maxSearchSeconds = max;
    }
  }
  if (rest.length) {
    const why = lost.length ? ` npm kept ${lost.join(" and ")} for itself: put "--" before the options, for example npm run check:browser -- --live --team 3 --max-search 15.` : "";
    return { error: `Unexpected argument: ${rest[0]}.${why} Run npm run check:browser -- --help for the options.` };
  }
  if (npmTeam && npmTeam !== "true" && !args.team && TEAM_ID.test(npmTeam)) args.team = npmTeam;
  if (env.npm_config_live === "true") args.live = true;
  if (env.npm_config_show === "true") args.show = true;
  if (env.npm_config_second_league === "true") args.secondLeague = true;
  if (env.npm_config_shots === "false" || env.npm_config_shots === "") args.shots = false;
  const max = Number(npmMax);
  if (args.maxSearchSeconds === DEFAULT_MAX_SEARCH_SECONDS && npmMax && npmMax !== "true" && Number.isFinite(max) && max > 0) args.maxSearchSeconds = max;
  return { args };
}
