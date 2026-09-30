/**
 * Fantrax API documentation facts (CLAUDE.md §2.7). Fantrax's beta API docs are mirrored by
 * pmurley/go-fantrax; the probe fetches three public files (7-day docs cache) and these pure parsers
 * turn them into facts the report can cite, instead of hard-coded prose:
 *   README.md                         → documented endpoints and their parameters
 *   league_info.go                    → the getLeagueInfo response struct (JSON keys)
 *   git tree (GitHub API)             → where transaction code lives (public client vs logged-in client)
 */

export const GO_FANTRAX_REPO = "pmurley/go-fantrax";
export const GO_FANTRAX_README_URL = `https://raw.githubusercontent.com/${GO_FANTRAX_REPO}/HEAD/README.md`;
export const GO_FANTRAX_LEAGUE_INFO_URL = `https://raw.githubusercontent.com/${GO_FANTRAX_REPO}/HEAD/league_info.go`;
export const GO_FANTRAX_TREE_URL = `https://api.github.com/repos/${GO_FANTRAX_REPO}/git/trees/HEAD?recursive=1`;

export interface ReadmeFacts {
  /** "current as of documentation provided from Fantrax in April 2025" → "April 2025". */
  currentAsOf?: string;
  /** Endpoints named in the documented URLs (…/fxea/general/<endpoint>), in order of appearance. */
  endpoints: string[];
  /** Section heading → endpoint of its URL and its documented request parameters. */
  sections: Array<{ heading: string; endpoint?: string; params: string[]; text: string }>;
  /** Client methods used in the README's Go example (GetDraftResults…). */
  goMethods: string[];
}

export function parseReadme(md: string): ReadmeFacts {
  const currentAsOf = /current as of documentation provided from Fantrax in ([A-Z][a-z]+ \d{4})/.exec(md)?.[1];
  const endpoints = [...new Set([...md.matchAll(/fxea\/general\/(\w+)/g)].map((m) => m[1] ?? ""))].filter(Boolean);
  const sections: ReadmeFacts["sections"] = [];
  const parts = md.split(/^### /m).slice(1);
  for (const part of parts) {
    const [headingLine = "", ...rest] = part.split(/\r?\n/);
    const body = rest.join("\n").split(/^## /m)[0] ?? "";
    const endpoint = /fxea\/general\/(\w+)/.exec(body)?.[1];
    const params = [...body.matchAll(/^\s*-\s+`(\w+)`/gm)].map((m) => m[1] ?? "").filter(Boolean);
    const text = (body.split(/^\s*- URL:/m)[0] ?? "").replace(/\s+/g, " ").trim();
    sections.push({ heading: headingLine.trim(), endpoint, params, text });
  }
  const goMethods = [...new Set([...md.matchAll(/client\.(Get\w+)\(/g)].map((m) => m[1] ?? ""))].filter(Boolean);
  return { currentAsOf, endpoints, sections, goMethods };
}

/** JSON keys of a Go struct, e.g. structJsonKeys(src, "LeagueInfo") → ["leagueName", "draftSettings", …]. */
export function structJsonKeys(goSource: string, typeName: string): string[] {
  const start = goSource.search(new RegExp(`type\\s+${typeName}\\s+struct\\s*\\{`));
  if (start < 0) return [];
  const open = goSource.indexOf("{", start);
  const close = goSource.indexOf("\n}", open);
  const body = goSource.slice(open + 1, close < 0 ? undefined : close);
  return [...body.matchAll(/`json:"([^",]+)/g)].map((m) => m[1] ?? "").filter(Boolean);
}

export interface LeagueInfoFacts {
  /** Top-level getLeagueInfo keys (LeagueInfo struct). */
  keys: string[];
  /** Keys matching settings §17 item A needs (playoffs, trade deadline, league type, median games). */
  settingsKeys: string[];
  scoringConfigFields: string[];
  /** Groups declared on ScoringCategories (the struct was written against another sport if these aren't football). */
  scoringCategoryGroups: string[];
  teamInfoFields: string[];
  rosterInfoFields: string[];
}

export const ITEM_A_SETTINGS = /playoff|trade|deadline|veto|keeper|dynasty|leaguetype|median|allplay|pointsonly/i;

export function parseLeagueInfoGo(goSource: string): LeagueInfoFacts {
  const keys = structJsonKeys(goSource, "LeagueInfo");
  return {
    keys,
    settingsKeys: keys.filter((k) => ITEM_A_SETTINGS.test(k)),
    scoringConfigFields: structJsonKeys(goSource, "ScoringConfig"),
    scoringCategoryGroups: structJsonKeys(goSource, "ScoringCategories"),
    teamInfoFields: structJsonKeys(goSource, "TeamInfo"),
    rosterInfoFields: structJsonKeys(goSource, "RosterInfo"),
  };
}

export interface TreeFacts {
  /** Every Go file whose path mentions transactions or trades. */
  transactionFiles: string[];
  /** Those files per top-level folder ("auth_client", "models", "examples"; "(root)" = the public-API bindings). */
  byArea: Record<string, number>;
  /** Transaction files among the root-level public-API bindings (league_info.go, team_rosters.go…). */
  publicTransactionFiles: string[];
}

export function parseTree(json: unknown): TreeFacts | null {
  const tree = typeof json === "object" && json !== null && Array.isArray((json as { tree?: unknown }).tree) ? (json as { tree: unknown[] }).tree : null;
  if (!tree) return null;
  const paths = tree
    .map((t) => (typeof t === "object" && t !== null && (t as { type?: unknown }).type === "blob" ? (t as { path?: unknown }).path : undefined))
    .filter((p): p is string => typeof p === "string");
  const transactionFiles = paths.filter((p) => /transaction|trade/i.test(p) && p.endsWith(".go"));
  const byArea: Record<string, number> = {};
  for (const p of transactionFiles) {
    const area = p.includes("/") ? (p.split("/")[0] ?? "(root)") : "(root)";
    byArea[area] = (byArea[area] ?? 0) + 1;
  }
  // go-fantrax keeps its public-API bindings at the repo root; auth_client/ is the logged-in client.
  const publicTransactionFiles = transactionFiles.filter((p) => !p.includes("/"));
  return { transactionFiles, byArea, publicTransactionFiles };
}

/** "auth_client/ 4, examples/ 2, models/ 1" */
export function areaText(t: Pick<TreeFacts, "byArea">): string {
  return Object.entries(t.byArea)
    .sort(([, a], [, b]) => b - a)
    .map(([area, n]) => `${area === "(root)" ? "root" : `${area}/`} ${n}`)
    .join(", ");
}

export interface FantraxDocFacts {
  readme?: ReadmeFacts & { url: string; status: number };
  leagueInfo?: LeagueInfoFacts & { url: string; status: number };
  tree?: TreeFacts & { url: string; status: number };
}

/** "getAdp" → its documented parameters, from the README section whose URL names that endpoint. */
export function documentedParams(facts: ReadmeFacts | undefined, endpoint: string): string[] | undefined {
  return facts?.sections.find((s) => s.endpoint === endpoint)?.params;
}
