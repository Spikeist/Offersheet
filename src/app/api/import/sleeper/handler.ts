/**
 * POST /api/import/sleeper { season, username?, leagueId?, chooseLeagueId? }
 *   → ImportResponse, or { chooseLeague: {...} } when a username has several leagues that season,
 *     or { error: { code, message } }.
 *
 * The adapter does the username → leagues lookup (CLAUDE.md §2.3). When it can't tell which league
 * to import, it throws a NO_LEAGUE error carrying the choices; this handler turns that into
 * { chooseLeague } and the Connect page posts again with chooseLeagueId. A username (with or without
 * a league ID) also lets the adapter find "my team".
 */
import type { ImportDeps, ImportResult, SleeperImportRequest } from "@/adapters/types";
import type { ImportResponse, SleeperChooseLeagueResponse, SleeperLeagueChoice } from "@/lib/api";
import { isPlausibleSeason, seasonRangeMessage } from "@/lib/season";
import { dataSourceStamps, errorResponse, importErrorResponse, isSameOrigin, jsonResponse, readJsonBody } from "../../_lib/respond";
import { sleeperImportBodySchema } from "../../_lib/schemas";

/** The adapter's league choices (src/adapters/sleeper: SleeperLeagueChoice). */
export interface AdapterLeagueChoice {
  leagueId: string;
  name: string;
  teams: number | null;
  status: string | null;
  leagueType?: "redraft" | "keeper" | "dynasty" | "guillotine" | null;
  bestBall?: boolean;
  supported: boolean;
}

export interface SleeperImportHandlerDeps {
  importLeague: (req: SleeperImportRequest, deps: ImportDeps) => Promise<ImportResult>;
  getDeps: () => Promise<ImportDeps>;
  /** The choices on an import error, when it offers any (the adapter's leagueChoicesOf). */
  choicesOf: (err: unknown) => AdapterLeagueChoice[] | undefined;
  now?: () => Date;
}

function toChoice(c: AdapterLeagueChoice): SleeperLeagueChoice {
  return { id: c.leagueId, name: c.name, teams: c.teams, status: c.status, leagueType: c.leagueType ?? null, bestBall: c.bestBall ?? false, supported: c.supported };
}

export function createSleeperImportHandler(d: SleeperImportHandlerDeps): (request: Request) => Promise<Response> {
  return async function POST(request: Request): Promise<Response> {
    if (!isSameOrigin(request)) return errorResponse("BAD_ORIGIN");
    const body = await readJsonBody(request, sleeperImportBodySchema);
    if (!body.ok) return errorResponse("INVALID_REQUEST", body.message);
    const { season, username, leagueId, chooseLeagueId, refresh } = body.data;
    const now = d.now?.() ?? new Date();
    if (!isPlausibleSeason(season, now)) return errorResponse("INVALID_REQUEST", seasonRangeMessage(now));

    const req: SleeperImportRequest = {
      season,
      ...(username ? { username } : {}),
      ...(leagueId ? { leagueId } : {}),
      ...(chooseLeagueId && !leagueId ? { chooseLeagueId } : {}),
      ...(refresh ? { refresh: true } : {}),
    };
    try {
      const deps = await d.getDeps();
      const result = await d.importLeague(req, deps);
      const response: ImportResponse = { ...result, dataSources: dataSourceStamps(deps.resolver) };
      return jsonResponse(response);
    } catch (err) {
      const choices = d.choicesOf(err);
      if (choices?.length && username) {
        const leagues = choices.map(toChoice).sort((a, b) => Number(b.supported) - Number(a.supported) || a.name.localeCompare(b.name));
        const choose: SleeperChooseLeagueResponse = { chooseLeague: { username, season, leagues } };
        return jsonResponse(choose);
      }
      return importErrorResponse(err, { platform: "sleeper", season });
    }
  };
}
